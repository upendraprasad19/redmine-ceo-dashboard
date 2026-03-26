/**
 * bots/slack/tickets.js
 * Handle interactive ticket actions from standup cards.
 * - Status dropdown change: log the update to Neon (NOT Redmine)
 * - "Done" button: mark ticket as acknowledged/completed locally
 */

const { getDb } = require('../../lib/db');
const { resolveSlackUser } = require('./index');

/**
 * Handle a ticket status change from the standup card dropdown.
 * Stores the status update in slack_ticket_updates table in Neon.
 * Does NOT push to Redmine — this is a local developer acknowledgment.
 *
 * @param {object} body - Slack interaction payload body
 * @param {object} action - The specific action triggered
 * @param {object} client - Slack WebClient
 */
async function handleStatusChange(body, action, client) {
  const sql = getDb();
  const slackUserId = body.user?.id;
  const selectedValue = action.selected_option?.value || '';

  // Value format: "ticketId|statusLabel"
  const [ticketIdStr, newStatus] = selectedValue.split('|');
  const ticketId = parseInt(ticketIdStr, 10);

  if (!ticketId || !newStatus) {
    console.warn('tickets: Invalid status change value:', selectedValue);
    return;
  }

  // Resolve the Slack user
  const resolved = await resolveSlackUser(slackUserId);
  if (!resolved) {
    console.warn('tickets: Unrecognized Slack user for status change:', slackUserId);
    return;
  }

  // Map the friendly status label to the internal status
  const statusMap = {
    'Not Started': 'New',
    'In Progress': 'In Progress',
    'Blocked': 'Blocked',
    'Done': 'Resolved',
  };
  const mappedStatus = statusMap[newStatus] || newStatus;

  // Fetch the current ticket info
  const tickets = await sql`
    SELECT id, redmine_id, title, status FROM issues WHERE id = ${ticketId} LIMIT 1
  `;

  if (tickets.length === 0) {
    console.warn('tickets: Ticket not found:', ticketId);
    return;
  }

  const ticket = tickets[0];
  const previousStatus = ticket.status;

  // Skip if no actual change
  if (previousStatus === mappedStatus) return;

  // Log the status update to the slack_ticket_updates table
  await sql`
    INSERT INTO slack_ticket_updates (
      issue_id, redmine_id, previous_status, new_status,
      updated_by_slack_id, updated_by_dashboard_user_id,
      source, created_at
    ) VALUES (
      ${ticketId},
      ${ticket.redmine_id},
      ${previousStatus},
      ${mappedStatus},
      ${slackUserId},
      ${resolved.dashboardUser.id},
      'standup_card',
      NOW()
    )
  `;

  // Also update the local issue status in Neon
  await sql`
    UPDATE issues
    SET status = ${mappedStatus}, updated_at = NOW()
    WHERE id = ${ticketId}
  `;

  // Send an ephemeral confirmation to the user
  const ticketLabel = ticket.redmine_id ? `TK-${ticket.redmine_id}` : `#${ticket.id}`;

  try {
    await client.chat.postEphemeral({
      channel: body.channel?.id || body.user.id,
      user: slackUserId,
      text: `:white_check_mark: *${ticketLabel}* status updated: ${previousStatus} → *${mappedStatus}*`,
    });
  } catch (err) {
    // Ephemeral messages can fail in DMs — not critical
    console.warn('tickets: Failed to send ephemeral confirmation:', err.message);
  }

  console.log(`tickets: ${resolved.displayName} updated ${ticketLabel}: ${previousStatus} → ${mappedStatus}`);
}

/**
 * Handle the "Mark Done" button click.
 * Marks the ticket as Resolved in the local Neon DB.
 *
 * @param {object} body - Slack interaction payload body
 * @param {object} action - The specific action triggered
 * @param {object} client - Slack WebClient
 */
async function handleTicketDone(body, action, client) {
  const sql = getDb();
  const slackUserId = body.user?.id;
  const ticketId = parseInt(action.value, 10);

  if (!ticketId) {
    console.warn('tickets: Invalid ticket ID for done action:', action.value);
    return;
  }

  const resolved = await resolveSlackUser(slackUserId);
  if (!resolved) return;

  // Fetch ticket
  const tickets = await sql`
    SELECT id, redmine_id, title, status FROM issues WHERE id = ${ticketId} LIMIT 1
  `;
  if (tickets.length === 0) return;

  const ticket = tickets[0];

  // Already done? Skip
  if (['Resolved', 'Closed'].includes(ticket.status)) {
    try {
      await client.chat.postEphemeral({
        channel: body.channel?.id || body.user.id,
        user: slackUserId,
        text: `:information_source: *${ticket.redmine_id ? 'TK-' + ticket.redmine_id : '#' + ticket.id}* is already marked as ${ticket.status}.`,
      });
    } catch (_) {}
    return;
  }

  // Log the update
  await sql`
    INSERT INTO slack_ticket_updates (
      issue_id, redmine_id, previous_status, new_status,
      updated_by_slack_id, updated_by_dashboard_user_id,
      source, created_at
    ) VALUES (
      ${ticketId},
      ${ticket.redmine_id},
      ${ticket.status},
      'Resolved',
      ${slackUserId},
      ${resolved.dashboardUser.id},
      'done_button',
      NOW()
    )
  `;

  // Update the issue locally
  await sql`
    UPDATE issues
    SET status = 'Resolved', updated_at = NOW()
    WHERE id = ${ticketId}
  `;

  const ticketLabel = ticket.redmine_id ? `TK-${ticket.redmine_id}` : `#${ticket.id}`;

  try {
    await client.chat.postEphemeral({
      channel: body.channel?.id || body.user.id,
      user: slackUserId,
      text: `:white_check_mark: *${ticketLabel}* marked as Done!`,
    });
  } catch (_) {}

  console.log(`tickets: ${resolved.displayName} marked ${ticketLabel} as Done`);
}

module.exports = { handleStatusChange, handleTicketDone };
