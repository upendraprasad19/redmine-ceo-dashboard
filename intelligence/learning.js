/**
 * intelligence/learning.js
 * Behavioral learning: analyse conversations to build user profiles.
 */

const { getDb } = require('../lib/db');
const { chat } = require('../lib/ai');

// ────────────────────────────────────────────────────────────────
// learnFromConversation — Meta-analysis of a user's exchange
// Fire-and-forget after each chat turn.
// ────────────────────────────────────────────────────────────────
async function learnFromConversation(userId, userMessage, aiResponse) {
  if (!userId || !userMessage) return;

  try {
    const sql = getDb();

    const metaPrompt = `Analyze this conversation exchange between a user and an AI assistant.
Extract the following in strict JSON (no markdown, no code fences):
{
  "communication_style": "concise" | "detailed" | "data-heavy",
  "urgency_level": "low" | "medium" | "high",
  "top_concerns": ["array", "of", "topics they care about"],
  "preferred_metrics": ["optional array of KPIs or data points they ask about frequently"],
  "tone": "formal" | "casual" | "mixed"
}

User message:
${userMessage}

AI response:
${aiResponse || '(no response yet)'}`;

    const response = await chat([
      {
        role: 'system',
        content:
          'You are a behavioral analysis engine. Return ONLY valid JSON. No explanation, no markdown fences.',
      },
      { role: 'user', content: metaPrompt },
    ]);

    const raw =
      response &&
      response.choices &&
      response.choices[0] &&
      response.choices[0].message &&
      response.choices[0].message.content;

    if (!raw) return;

    // Parse the AI response — strip any accidental markdown fences
    let parsed;
    try {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('learning.learnFromConversation: JSON parse error:', parseErr.message);
      return;
    }

    // Build the behavior_profile update (merge with existing)
    const existingRows = await sql`
      SELECT behavior_profile, top_concerns
      FROM dashboard_users
      WHERE id = ${userId}
    `;

    if (!existingRows || existingRows.length === 0) return;

    const existing = existingRows[0];
    const currentProfile =
      typeof existing.behavior_profile === 'object' && existing.behavior_profile !== null
        ? existing.behavior_profile
        : {};

    // Merge — latest observation wins for scalars; arrays are unioned
    const updatedProfile = {
      ...currentProfile,
      communication_style: parsed.communication_style || currentProfile.communication_style,
      urgency_level: parsed.urgency_level || currentProfile.urgency_level,
      tone: parsed.tone || currentProfile.tone,
      preferred_metrics: dedupeArray([
        ...(currentProfile.preferred_metrics || []),
        ...(parsed.preferred_metrics || []),
      ]).slice(0, 20),
      last_learned_at: new Date().toISOString(),
    };

    // Merge top_concerns — keep unique, max 20
    const existingConcerns = Array.isArray(existing.top_concerns) ? existing.top_concerns : [];
    const newConcerns = Array.isArray(parsed.top_concerns) ? parsed.top_concerns : [];
    const mergedConcerns = dedupeArray([...existingConcerns, ...newConcerns]).slice(0, 20);

    await sql`
      UPDATE dashboard_users
      SET
        behavior_profile = ${JSON.stringify(updatedProfile)}::jsonb,
        top_concerns = ${mergedConcerns},
        updated_at = NOW()
      WHERE id = ${userId}
    `;
  } catch (err) {
    // Fire-and-forget: log but never throw
    console.error('learning.learnFromConversation: error:', err.message);
  }
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────
function dedupeArray(arr) {
  if (!Array.isArray(arr)) return [];
  const lower = new Set();
  const result = [];
  for (const item of arr) {
    if (item == null) continue;
    const key = String(item).toLowerCase().trim();
    if (!lower.has(key) && key.length > 0) {
      lower.add(key);
      result.push(String(item).trim());
    }
  }
  return result;
}

module.exports = {
  learnFromConversation,
};
