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

/**
 * Phase 1 permission matrix:
 *   manager  -> developer (any team): allowed
 *   team_lead -> developer (own team): allowed
 *   everything else: denied
 */
function canIntimate(from, to) {
  if (!from || !to) return { allowed: false, reason: 'missing users' };
  if (from.role === 'manager' && to.role === 'developer') {
    return { allowed: true };
  }
  if (from.role === 'team_lead' && to.role === 'developer') {
    if (from.team && from.team === to.team) return { allowed: true };
    return { allowed: false, reason: 'You can only intimate developers on your own team.' };
  }
  return { allowed: false, reason: 'Phase 1 supports manager->dev and TL->own-team-dev only.' };
}

const TELEGRAM_API = (token) => `https://api.telegram.org/bot${token}`;

async function tgSend(chat_id, text, reply_markup = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = { chat_id, text, parse_mode: 'Markdown' };
  if (reply_markup) body.reply_markup = reply_markup;
  const r = await fetch(`${TELEGRAM_API(token)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${data.description}`);
  return data.result;
}

function receiverButtons(thread_id) {
  return {
    inline_keyboard: [
      [
        { text: 'Acknowledge', callback_data: `int:ack:${thread_id}` },
        { text: 'Working on it', callback_data: `int:working:${thread_id}` },
        { text: 'Blocked', callback_data: `int:blocked:${thread_id}` },
      ],
    ],
  };
}

/**
 * Send an intimation: delivers the message to the target and (if present) CC'd user.
 * Assumes the caller has already run canIntimate and created the thread.
 */
async function sendIntimation({ thread_id, originator, target, cc = null, issue, note = '' }) {
  const originatorName = originator.display_name || originator.username;
  const targetName = target.display_name || target.username;
  const ticketLink = `[TK-${issue.redmine_id}](https://redmine.thinkingcode.com/issues/${issue.redmine_id})`;
  const overdueLine = (issue.days_overdue && issue.days_overdue > 0)
    ? ` (overdue ${issue.days_overdue}d)` : '';
  const noteLine = note ? `\n\n_${note}_` : '';

  const receiverText =
    `Hi ${targetName}, *${originatorName}* is asking about ${ticketLink} '${issue.subject}'${overdueLine}. Can you share status?${noteLine}`;

  await tgSend(target.telegram_id, receiverText, receiverButtons(thread_id));

  if (cc && cc.telegram_id) {
    const ccText =
      `FYI: *${originatorName}* intimated *${targetName}* about ${ticketLink}. I'll relay the response back here.`;
    await tgSend(cc.telegram_id, ccText);
  }

  const confirmText = `✓ Sent to ${targetName}. I'll notify you when they respond.`;
  await tgSend(originator.telegram_id, confirmText);
}

/**
 * Relay a target's response back to the originator (and CC'd user, if any).
 */
async function relayResponse({ thread, originator, cc = null, responseText, buttonLabel = null }) {
  const ticketLink = `[TK-${thread.redmine_id}](https://redmine.thinkingcode.com/issues/${thread.redmine_id})`;
  const body = buttonLabel
    ? `${thread.target_display_name} on ${ticketLink}: *${buttonLabel}*`
    : `${thread.target_display_name} replied on ${ticketLink}: '${responseText}'`;

  await tgSend(originator.telegram_id, body);
  if (cc && cc.telegram_id) await tgSend(cc.telegram_id, body);
}

module.exports = {
  createThread, logEvent, transitionStatus, getOpenThreadForTarget, canIntimate,
  sendIntimation, relayResponse, receiverButtons,
};
