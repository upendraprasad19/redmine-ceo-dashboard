/**
 * lib/intimation-relay.js
 * Core state machine for Intimation Relay (Phase 1).
 * Threads are created by originators (manager/TL), sent to targets (developer),
 * and move through sent -> acked/replied -> closed states via explicit events.
 */

async function createThread({ originator_id, target_id, cc_user_id = null, issue_id, urgency = 'normal' }) {
  const { getDb } = require('./db');
  const sql = getDb();
  const rows = await sql`
    INSERT INTO bot_threads (originator_id, target_id, cc_user_id, issue_id, status, urgency)
    VALUES (${originator_id}, ${target_id}, ${cc_user_id}, ${issue_id}, 'sent', ${urgency})
    RETURNING id
  `;
  const id = rows[0].id;
  await sql`
    INSERT INTO bot_thread_events (thread_id, actor_id, event_type, payload)
    VALUES (${id}, ${originator_id}, 'sent', ${JSON.stringify({})}::jsonb)
  `;
  return id;
}

module.exports = { createThread };
