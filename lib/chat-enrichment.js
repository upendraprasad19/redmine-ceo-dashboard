/**
 * lib/chat-enrichment.js
 * Tags unenriched chat_history rows with intent + entities for future
 * personalization phases (ideas A/B/C/E). Non-blocking — runs via cron.
 */

const INTENT_ENUM = [
  'query_ticket_status',
  'intimate_person',
  'log_time',
  'ask_person_summary',
  'ask_project_status',
  'other',
];

const SYSTEM_PROMPT = `You classify short user messages from a company operations bot.
Return STRICT JSON: { "intent": "<one_of>", "entities": { "tickets": [int...], "users": [name...], "projects": [name...] } }
Allowed intents: ${INTENT_ENUM.join(', ')}
- tickets: extract numeric ticket IDs (TK-12345 -> 12345).
- users: extract person names mentioned (strings, no guessing).
- projects: extract project names mentioned.
If none, use empty arrays. Never invent.`;

async function classifyOne(content) {
  const { chat } = require('./ai');
  const resp = await chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content },
  ]);
  const text = resp.choices?.[0]?.message?.content || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const intent = INTENT_ENUM.includes(parsed.intent) ? parsed.intent : 'other';
    const entities = {
      tickets: Array.isArray(parsed.entities?.tickets) ? parsed.entities.tickets.filter(Number.isInteger) : [],
      users: Array.isArray(parsed.entities?.users) ? parsed.entities.users.slice(0, 10).map(String) : [],
      projects: Array.isArray(parsed.entities?.projects) ? parsed.entities.projects.slice(0, 10).map(String) : [],
    };
    return { intent, entities };
  } catch (e) {
    return null;
  }
}

/**
 * Process up to `limit` unenriched chat_history rows. Returns { processed, failed, scanned }.
 */
async function runEnrichmentBatch(limit = 50) {
  const { getDb } = require('./db');
  const sql = getDb();
  const rows = await sql`
    SELECT id, content
      FROM chat_history
     WHERE enriched_at IS NULL
       AND role = 'user'
     ORDER BY created_at ASC
     LIMIT ${limit}
  `;
  let processed = 0, failed = 0;
  for (const row of rows) {
    try {
      const result = await classifyOne(row.content);
      if (!result) { failed++; continue; }
      await sql`
        UPDATE chat_history
        SET intent = ${result.intent},
            entities = ${JSON.stringify(result.entities)}::jsonb,
            enriched_at = NOW()
        WHERE id = ${row.id}
      `;
      processed++;
    } catch (e) {
      console.error('enrichment row failed:', row.id, e.message);
      failed++;
    }
  }
  // Also mark non-user (assistant/tool) rows as "enriched" with null intent so they don't clog the queue.
  await sql`
    UPDATE chat_history
    SET enriched_at = NOW()
    WHERE enriched_at IS NULL AND role <> 'user'
  `;
  return { processed, failed, scanned: rows.length };
}

module.exports = { runEnrichmentBatch, classifyOne, INTENT_ENUM };
