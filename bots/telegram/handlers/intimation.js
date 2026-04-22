/**
 * bots/telegram/handlers/intimation.js
 * Handles inline-keyboard callbacks for Intimation Relay.
 *
 * callback_data prefixes:
 *   int:confirm:<target_id>:<issue_id>   — originator confirms send
 *   int:cancel                            — originator cancels
 *   int:ack:<thread_id>                   — receiver acknowledges
 *   int:working:<thread_id>               — receiver 'working on it'
 *   int:blocked:<thread_id>               — receiver 'blocked'
 *   int:escalate:<thread_id>              — originator escalates after no_response
 *   int:close:<thread_id>                 — originator closes thread
 *   int:commit_done:<commitment_id>       — dev reports commitment kept
 *   int:commit_extend:<commitment_id>     — dev needs more time
 */

const { getDb } = require('../../../lib/db');
const {
  createThread, logEvent, transitionStatus, sendIntimation, relayResponse,
} = require('../../../lib/intimation-relay');
const { markCommitment } = require('../../../lib/commitments');

async function loadUser(sql, id) {
  const rows = await sql`SELECT id, display_name, username, role, team, telegram_id FROM dashboard_users WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

async function loadIssue(sql, id) {
  const rows = await sql`
    SELECT id, redmine_id, title AS subject, status, due_date,
           GREATEST(0, (CURRENT_DATE - due_date))::int AS days_overdue
      FROM issues WHERE id = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

async function loadThreadFull(sql, thread_id) {
  const rows = await sql`
    SELECT t.*, i.redmine_id, i.title AS issue_subject,
           tgt.display_name AS target_display_name
      FROM bot_threads t
      JOIN issues i ON i.id = t.issue_id
      JOIN dashboard_users tgt ON tgt.id = t.target_id
     WHERE t.id = ${thread_id} LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Returns true if the callback was handled by this module.
 */
async function handleIntimationCallback(ctx, botUser) {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith('int:')) return false;

  const sql = getDb();
  const parts = data.split(':');

  try {
    if (parts[1] === 'confirm') {
      const target_id = Number(parts[2]);
      const issue_id = Number(parts[3]);
      const originator = botUser;
      const target = await loadUser(sql, target_id);
      const issue = await loadIssue(sql, issue_id);
      if (!target || !issue) {
        await ctx.answerCbQuery('Target or issue not found');
        return true;
      }
      // CC rule: manager->dev CCs the dev's TL
      let cc = null;
      if (originator.role === 'manager' && target.team) {
        const tlRows = await sql`
          SELECT id, display_name, telegram_id
            FROM dashboard_users
           WHERE role = 'team_lead' AND team = ${target.team} AND active = true
           LIMIT 1
        `;
        if (tlRows.length) cc = tlRows[0];
      }
      const thread_id = await createThread({
        originator_id: originator.id,
        target_id: target.id,
        cc_user_id: cc ? cc.id : null,
        issue_id: issue.id,
      });
      await sendIntimation({ thread_id, originator, target, cc, issue });
      await ctx.editMessageText(`✓ Intimation sent to ${target.display_name}.`).catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (parts[1] === 'cancel') {
      await ctx.editMessageText('Cancelled.').catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (['ack','working','blocked'].includes(parts[1])) {
      const thread_id = Number(parts[2]);
      const thread = await loadThreadFull(sql, thread_id);
      if (!thread) { await ctx.answerCbQuery('Thread not found'); return true; }
      if (thread.target_id !== botUser.id) { await ctx.answerCbQuery('Not for you'); return true; }

      const labelMap = { ack: 'Acknowledged', working: 'Working on it', blocked: 'Blocked' };
      const buttonLabel = labelMap[parts[1]];

      await logEvent({
        thread_id,
        actor_id: botUser.id,
        event_type: 'button_reply',
        payload: { button: parts[1] },
      });
      await transitionStatus(thread_id, parts[1] === 'ack' ? 'acked' : 'replied');

      const originator = await loadUser(sql, thread.originator_id);
      const cc = thread.cc_user_id ? await loadUser(sql, thread.cc_user_id) : null;

      await relayResponse({
        thread: { redmine_id: thread.redmine_id, target_display_name: thread.target_display_name },
        originator,
        cc,
        responseText: null,
        buttonLabel,
      });
      await logEvent({
        thread_id,
        actor_id: botUser.id,
        event_type: 'relayed_to_originator',
        payload: { button: parts[1] },
      });
      await ctx.editMessageText(`✓ ${buttonLabel} — sent to ${originator.display_name}.`).catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (parts[1] === 'escalate') {
      const thread_id = Number(parts[2]);
      const thread = await loadThreadFull(sql, thread_id);
      if (!thread) { await ctx.answerCbQuery('Thread not found'); return true; }
      // Phase 1: escalation is a TL alert (if there's one) or noop
      if (thread.cc_user_id) {
        const tl = await loadUser(sql, thread.cc_user_id);
        if (tl?.telegram_id) {
          await relayResponse({
            thread: { redmine_id: thread.redmine_id, target_display_name: thread.target_display_name },
            originator: tl,
            cc: null,
            responseText: `Please follow up with ${thread.target_display_name} on TK-${thread.redmine_id} — no response in 24h.`,
          });
        }
      }
      await transitionStatus(thread_id, 'closed');
      await logEvent({ thread_id, actor_id: botUser.id, event_type: 'closed', payload: { via: 'escalate' } });
      await ctx.editMessageText('Escalated and closed.').catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (parts[1] === 'close') {
      const thread_id = Number(parts[2]);
      await transitionStatus(thread_id, 'closed');
      await logEvent({ thread_id, actor_id: botUser.id, event_type: 'closed', payload: { via: 'manual' } });
      await ctx.editMessageText('Closed.').catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (parts[1] === 'commit_done') {
      const commitment_id = Number(parts[2]);
      await markCommitment(commitment_id, 'kept');
      await ctx.editMessageText('Great — marked as kept.').catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    if (parts[1] === 'commit_extend') {
      const commitment_id = Number(parts[2]);
      await markCommitment(commitment_id, 'missed');
      await ctx.editMessageText('Noted — I\'ll let the originator know you need more time.').catch(() => {});
      await ctx.answerCbQuery();
      return true;
    }

    await ctx.answerCbQuery('Unknown intimation action');
    return true;
  } catch (e) {
    console.error('intimation handler error:', e);
    await ctx.answerCbQuery('Something went wrong').catch(() => {});
    return true;
  }
}

module.exports = { handleIntimationCallback };
