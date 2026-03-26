/**
 * bots/slack/blockers.js
 * Handle "Report a Blocker" button from standup cards.
 * Opens a modal for the developer to describe what's blocking them,
 * saves to escalation_log, and optionally notifies the PM/manager.
 */

const { getDb } = require('../../lib/db');
const { resolveSlackUser } = require('./index');

/**
 * Handle the "Report a Blocker" button click.
 * Opens a modal with a ticket selector and description field.
 *
 * @param {object} body - Slack interaction payload body
 * @param {object} client - Slack WebClient
 */
async function handleBlockerButton(body, client) {
  const sql = getDb();
  const slackUserId = body.user?.id;
  const triggerId = body.trigger_id;

  if (!triggerId) {
    console.warn('blockers: No trigger_id in button payload');
    return;
  }

  // Resolve user
  const resolved = await resolveSlackUser(slackUserId);
  if (!resolved || !resolved.redmineUserId) return;

  // Fetch this dev's active tickets for the dropdown
  const tickets = await sql`
    SELECT i.id, i.redmine_id, i.title, i.status
    FROM issues i
    WHERE i.assigned_to_id = ${resolved.redmineUserId}
      AND i.status NOT IN ('Closed', 'Resolved')
    ORDER BY i.due_date ASC NULLS LAST
    LIMIT 25
  `;

  // Build ticket options for the modal dropdown
  const ticketOptions = tickets.map(t => {
    const label = t.redmine_id ? `TK-${t.redmine_id}` : `#${t.id}`;
    // Slack plain_text has a 75 char limit for option text
    const titleTrunc = t.title.length > 55 ? t.title.substring(0, 52) + '...' : t.title;
    return {
      text: { type: 'plain_text', text: `${label} — ${titleTrunc}` },
      value: String(t.id),
    };
  });

  // If no tickets, add a placeholder
  if (ticketOptions.length === 0) {
    ticketOptions.push({
      text: { type: 'plain_text', text: 'No active tickets found' },
      value: '0',
    });
  }

  // Open the blocker modal
  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'blocker_submission',
      title: { type: 'plain_text', text: 'Report a Blocker' },
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Cancel' },
      private_metadata: JSON.stringify({
        slackUserId,
        dashboardUserId: resolved.dashboardUser.id,
      }),
      blocks: [
        {
          type: 'input',
          block_id: 'ticket_block',
          label: { type: 'plain_text', text: 'Which ticket is blocked?' },
          element: {
            type: 'static_select',
            action_id: 'blocked_ticket',
            placeholder: { type: 'plain_text', text: 'Select a ticket' },
            options: ticketOptions,
          },
        },
        {
          type: 'input',
          block_id: 'description_block',
          label: { type: 'plain_text', text: 'What is blocking you?' },
          element: {
            type: 'plain_text_input',
            action_id: 'blocker_description',
            multiline: true,
            min_length: 10,
            max_length: 1000,
            placeholder: {
              type: 'plain_text',
              text: 'Describe the blocker — what do you need, who can help, etc.',
            },
          },
        },
        {
          type: 'input',
          block_id: 'severity_block',
          label: { type: 'plain_text', text: 'Severity' },
          element: {
            type: 'static_select',
            action_id: 'blocker_severity',
            initial_option: {
              text: { type: 'plain_text', text: 'Medium' },
              value: 'medium',
            },
            options: [
              { text: { type: 'plain_text', text: 'Low — Can work around it' }, value: 'low' },
              { text: { type: 'plain_text', text: 'Medium — Slowing me down' }, value: 'medium' },
              { text: { type: 'plain_text', text: 'High — Completely blocked' }, value: 'high' },
              { text: { type: 'plain_text', text: 'Critical — Urgent, needs escalation now' }, value: 'critical' },
            ],
          },
        },
      ],
    },
  });
}

/**
 * Handle the blocker modal form submission.
 * Saves the blocker to escalation_log and notifies the manager.
 *
 * @param {object} body - Slack view submission payload body
 * @param {object} view - The submitted view object
 * @param {object} client - Slack WebClient
 */
async function handleBlockerSubmission(body, view, client) {
  const sql = getDb();

  // Extract private metadata
  let metadata = {};
  try {
    metadata = JSON.parse(view.private_metadata || '{}');
  } catch (_) {}

  const slackUserId = metadata.slackUserId || body.user?.id;
  const dashboardUserId = metadata.dashboardUserId;

  // Extract form values
  const values = view.state?.values || {};
  const ticketId = parseInt(
    values.ticket_block?.blocked_ticket?.selected_option?.value || '0',
    10
  );
  const description = values.description_block?.blocker_description?.value || '';
  const severity = values.severity_block?.blocker_severity?.selected_option?.value || 'medium';

  if (!ticketId || ticketId === 0) {
    console.warn('blockers: No valid ticket selected in blocker form');
    return;
  }

  // Fetch ticket details
  const tickets = await sql`
    SELECT i.id, i.redmine_id, i.title, i.assigned_to_id, u.team
    FROM issues i
    LEFT JOIN users u ON u.id = i.assigned_to_id
    WHERE i.id = ${ticketId}
    LIMIT 1
  `;

  const ticket = tickets[0] || {};
  const ticketLabel = ticket.redmine_id ? `TK-${ticket.redmine_id}` : `#${ticketId}`;

  // Find the escalation target (team lead for this team, or any manager)
  let escalatedTo = null;
  if (ticket.team) {
    const leadRows = await sql`
      SELECT id FROM dashboard_users
      WHERE team = ${ticket.team}
        AND role = 'team_lead'
        AND active = true
      LIMIT 1
    `;
    if (leadRows.length > 0) {
      escalatedTo = leadRows[0].id;
    }
  }

  // Fall back to any manager
  if (!escalatedTo) {
    const managerRows = await sql`
      SELECT id FROM dashboard_users
      WHERE role = 'manager'
        AND active = true
      LIMIT 1
    `;
    if (managerRows.length > 0) {
      escalatedTo = managerRows[0].id;
    }
  }

  // Build the escalation context
  const context = {
    ticket_id: String(ticket.redmine_id || ticketId),
    title: ticket.title || 'Unknown ticket',
    team: ticket.team || null,
    description,
    severity,
    reported_via: 'slack_blocker_modal',
    slack_user_id: slackUserId,
  };

  // Insert into escalation_log
  await sql`
    INSERT INTO escalation_log (
      rule_triggered, context, action_taken,
      raised_by, escalated_to,
      actioned, triggered_at
    ) VALUES (
      'developer_reported_blocker',
      ${JSON.stringify(context)}::jsonb,
      ${`Developer reported blocker on ${ticketLabel}: ${description.substring(0, 200)}`},
      ${dashboardUserId || null},
      ${escalatedTo},
      false,
      NOW()
    )
  `;

  // Update the ticket status to Blocked in Neon
  await sql`
    UPDATE issues
    SET status = 'Blocked', updated_at = NOW()
    WHERE id = ${ticketId}
      AND status NOT IN ('Closed', 'Resolved')
  `;

  // Log in slack_ticket_updates
  await sql`
    INSERT INTO slack_ticket_updates (
      issue_id, redmine_id, previous_status, new_status,
      updated_by_slack_id, updated_by_dashboard_user_id,
      source, created_at
    ) VALUES (
      ${ticketId},
      ${ticket.redmine_id},
      ${ticket.status || 'Unknown'},
      'Blocked',
      ${slackUserId},
      ${dashboardUserId || null},
      'blocker_report',
      NOW()
    )
  `;

  // ── Notify the manager/team lead ──

  // Try Slack notification first (if the escalation target has a slack_id)
  if (escalatedTo) {
    const targetUsers = await sql`
      SELECT slack_id, telegram_id, display_name
      FROM dashboard_users
      WHERE id = ${escalatedTo}
      LIMIT 1
    `;

    const target = targetUsers[0];

    if (target?.slack_id) {
      // Notify via Slack DM
      const resolved = await resolveSlackUser(slackUserId);
      const reporterName = resolved?.displayName || 'A developer';

      try {
        const { sendDirectMessage } = require('./index');
        await sendDirectMessage(target.slack_id, `Blocker reported by ${reporterName}`, [
          {
            type: 'header',
            text: { type: 'plain_text', text: ':rotating_light: Blocker Reported', emoji: true },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Ticket:* ${ticketLabel} — ${ticket.title || 'N/A'}\n*Reported by:* ${reporterName}\n*Severity:* ${severity}\n\n*Description:*\n${description}`,
            },
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `_Reported via Slack at ${new Date().toLocaleString()}_` },
            ],
          },
        ]);
      } catch (err) {
        console.error('blockers: Failed to notify manager via Slack:', err.message);
      }
    }

    // If the target has a telegram_id, we could also notify via Telegram
    // This is handled by the existing Telegram bot infrastructure if needed
    if (target?.telegram_id && !target?.slack_id) {
      // Log for future Telegram notification hook
      console.log(`blockers: Manager ${target.display_name} (telegram_id: ${target.telegram_id}) should be notified via Telegram about blocker on ${ticketLabel}`);
    }
  }

  // ── Confirm to the developer ──
  try {
    await client.chat.postMessage({
      channel: slackUserId,
      text: `:white_check_mark: Blocker reported for *${ticketLabel}*`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:white_check_mark: *Blocker reported successfully!*\n\n*Ticket:* ${ticketLabel} — ${ticket.title || 'N/A'}\n*Severity:* ${severity}\n*Status:* Ticket marked as Blocked`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: escalatedTo
                ? '_Your team lead / manager has been notified._'
                : '_No manager found to notify — please follow up manually._',
            },
          ],
        },
      ],
    });
  } catch (err) {
    console.warn('blockers: Failed to send confirmation to developer:', err.message);
  }

  console.log(`blockers: Blocker reported on ${ticketLabel} by Slack user ${slackUserId}, severity: ${severity}`);
}

module.exports = { handleBlockerButton, handleBlockerSubmission };
