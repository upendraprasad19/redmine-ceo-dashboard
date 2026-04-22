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

const VALID_STATUSES = ['sent','acked','replied','timeout_nudged','no_response','closed'];

async function logEvent({ thread_id, actor_id, event_type, payload = {} }) {
  const { getDb } = require('./db');
  const sql = getDb();
  await sql`
    INSERT INTO bot_thread_events (thread_id, actor_id, event_type, payload)
    VALUES (${thread_id}, ${actor_id}, ${event_type}, ${JSON.stringify(payload)}::jsonb)
  `;
  await sql`
    UPDATE bot_threads
    SET last_event_at = NOW()
    WHERE id = ${thread_id}
  `;
}

async function transitionStatus(thread_id, next_status) {
  if (!VALID_STATUSES.includes(next_status)) {
    throw new Error(`invalid status: ${next_status}`);
  }
  const { getDb } = require('./db');
  const sql = getDb();
  const rows = await sql`
    UPDATE bot_threads
    SET status = ${next_status},
        closed_at = CASE WHEN ${next_status} IN ('closed','no_response') THEN NOW() ELSE closed_at END
    WHERE id = ${thread_id}
    RETURNING status
  `;
  return rows[0]?.status;
}

async function getOpenThreadForTarget(target_id) {
  const { getDb } = require('./db');
  const sql = getDb();
  const rows = await sql`
    SELECT id, originator_id, target_id, cc_user_id, issue_id, status, last_event_at
    FROM bot_threads
    WHERE target_id = ${target_id}
      AND status NOT IN ('closed','no_response')
    ORDER BY last_event_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

module.exports = { createThread, logEvent, transitionStatus, getOpenThreadForTarget };
