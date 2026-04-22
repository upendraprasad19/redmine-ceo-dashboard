/**
 * lib/commitments.js
 * Extract and track commitments that developers make in reply to intimations.
 */

const EXTRACT_PROMPT = `You extract time commitments from short replies. Given a reply and the current datetime, output strict JSON:
{ "has_commitment": true|false, "due_at": "ISO8601 with timezone" (optional), "promise_text": "short phrase" (optional) }

Rules:
- Only return has_commitment=true if the reply contains a clear deadline ("EOD", "tomorrow 5pm", "by Friday", "in 2 hours", specific date/time).
- Assume timezone Asia/Kolkata (+05:30) unless the reply specifies otherwise.
- "EOD" = 18:00 local time today.
- "end of the week" = Friday 18:00 local time.
- If already past the implied time, still return the literal interpretation; the caller will filter.
- Never guess. If ambiguous, return has_commitment=false.`;

async function extractCommitment({ text, now = new Date() }) {
  const { chat } = require('./ai');
  const userMsg = `Current datetime: ${now.toISOString()}\nReply: "${text}"`;
  try {
    const resp = await chat([
      { role: 'system', content: EXTRACT_PROMPT },
      { role: 'user', content: userMsg },
    ]);
    const content = resp.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.has_commitment) return null;
    if (!parsed.due_at || !parsed.promise_text) return null;
    const due = new Date(parsed.due_at);
    if (isNaN(due.getTime())) return null;
    if (due.getTime() <= now.getTime()) return null;
    return { due_at: due, promise_text: String(parsed.promise_text).slice(0, 200) };
  } catch (e) {
    console.error('extractCommitment error:', e.message);
    return null;
  }
}

async function createCommitment({ thread_id, user_id, issue_id, promise_text, due_at }) {
  const { getDb } = require('./db');
  const sql = getDb();
  const rows = await sql`
    INSERT INTO commitments (thread_id, user_id, issue_id, promise_text, due_at, status)
    VALUES (${thread_id}, ${user_id}, ${issue_id}, ${promise_text}, ${due_at.toISOString()}, 'pending')
    RETURNING id
  `;
  return rows[0].id;
}

async function findDueCommitments() {
  const { getDb } = require('./db');
  const sql = getDb();
  return await sql`
    SELECT c.id, c.thread_id, c.user_id, c.issue_id, c.promise_text, c.due_at,
           du.telegram_id AS user_telegram_id, du.display_name AS user_display_name,
           i.redmine_id AS issue_redmine_id
      FROM commitments c
      JOIN dashboard_users du ON du.id = c.user_id
      LEFT JOIN issues i ON i.id = c.issue_id
     WHERE c.status = 'pending'
       AND c.due_at <= NOW()
     ORDER BY c.due_at ASC
     LIMIT 20
  `;
}

async function markCommitment(id, status) {
  if (!['kept','missed','followed_up'].includes(status)) {
    throw new Error(`invalid commitment status: ${status}`);
  }
  const { getDb } = require('./db');
  const sql = getDb();
  await sql`
    UPDATE commitments
    SET status = ${status}, resolved_at = CASE WHEN ${status} <> 'followed_up' THEN NOW() ELSE resolved_at END
    WHERE id = ${id}
  `;
}

module.exports = { extractCommitment, createCommitment, findDueCommitments, markCommitment };
