/**
 * bots/slack/standup.js
 * Async standup card sender — called by cron at 9 AM on weekdays.
 * For each developer with a slack_id, sends a Block Kit card showing
 * their active tickets with inline status controls.
 */

const { getDb } = require('../../lib/db');
const { sendDirectMessage } = require('./index');

/**
 * Build Block Kit blocks for a single developer's standup card.
 * @param {string} devName - Developer display name
 * @param {Array} tickets - Active tickets for this developer
 * @returns {Array} Slack Block Kit blocks
 */
function buildStandupBlocks(devName, tickets) {
  const blocks = [];

  // ── Header ──
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `Good morning ${devName}! Here are your active tickets:`,
      emoji: true,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `:calendar: *${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}*  |  ${tickets.length} active ticket${tickets.length !== 1 ? 's' : ''}`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  if (tickets.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':white_check_mark: No active tickets assigned to you right now. Enjoy your day!',
      },
    });
    return blocks;
  }

  // ── Ticket cards (max 10 to stay within Slack block limits) ──
  const displayTickets = tickets.slice(0, 10);

  for (const ticket of displayTickets) {
    const ticketId = ticket.redmine_id ? `TK-${ticket.redmine_id}` : `#${ticket.id}`;
    const isOverdue = ticket.due_date && new Date(ticket.due_date) < new Date() && !['Closed', 'Resolved'].includes(ticket.status);
    const dueText = ticket.due_date
      ? new Date(ticket.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'No due date';
    const overdueEmoji = isOverdue ? ' :rotating_light:' : '';

    const priorityEmoji = {
      'Urgent': ':red_circle:',
      'High': ':large_orange_circle:',
      'Normal': ':large_blue_circle:',
      'Low': ':white_circle:',
    }[ticket.priority] || ':large_blue_circle:';

    const statusEmoji = {
      'New': ':new:',
      'In Progress': ':arrows_counterclockwise:',
      'Blocked': ':no_entry:',
      'Feedback': ':speech_balloon:',
      'Resolved': ':white_check_mark:',
    }[ticket.status] || ':grey_question:';

    // Ticket info section with status dropdown accessory
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${priorityEmoji} *${ticketId}* — ${ticket.title}\n${statusEmoji} ${ticket.status}  |  :calendar: ${dueText}${overdueEmoji}`,
      },
      accessory: {
        type: 'static_select',
        action_id: 'ticket_status_change',
        placeholder: {
          type: 'plain_text',
          text: 'Update status',
        },
        initial_option: getStatusOption(ticket.status),
        options: [
          { text: { type: 'plain_text', text: ':new: Not Started' }, value: `${ticket.id}|Not Started` },
          { text: { type: 'plain_text', text: ':arrows_counterclockwise: In Progress' }, value: `${ticket.id}|In Progress` },
          { text: { type: 'plain_text', text: ':no_entry: Blocked' }, value: `${ticket.id}|Blocked` },
          { text: { type: 'plain_text', text: ':white_check_mark: Done' }, value: `${ticket.id}|Done` },
        ],
      },
    });
  }

  // ── "Mark all as Done" row if multiple tickets ──
  if (tickets.length > 1) {
    blocks.push({ type: 'divider' });
  }

  // ── Remaining ticket count ──
  if (tickets.length > 10) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `:page_facing_up: _...and ${tickets.length - 10} more active tickets_`,
        },
      ],
    });
  }

  // ── Action buttons ──
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':rotating_light: Report a Blocker', emoji: true },
        action_id: 'report_blocker',
        style: 'danger',
      },
    ],
  });

  return blocks;
}

/**
 * Map a ticket status string to a Slack option object.
 */
function getStatusOption(status) {
  const map = {
    'New': { text: { type: 'plain_text', text: ':new: Not Started' }, value: `0|Not Started` },
    'In Progress': { text: { type: 'plain_text', text: ':arrows_counterclockwise: In Progress' }, value: `0|In Progress` },
    'Blocked': { text: { type: 'plain_text', text: ':no_entry: Blocked' }, value: `0|Blocked` },
    'Resolved': { text: { type: 'plain_text', text: ':white_check_mark: Done' }, value: `0|Done` },
    'Closed': { text: { type: 'plain_text', text: ':white_check_mark: Done' }, value: `0|Done` },
    'Feedback': { text: { type: 'plain_text', text: ':arrows_counterclockwise: In Progress' }, value: `0|In Progress` },
  };
  return map[status] || map['New'];
}

/**
 * Send standup cards to all developers who have a slack_id.
 * Called from the cron scheduler at 9 AM weekdays.
 * @returns {object} { sent: number, errors: number, skipped: number }
 */
async function sendStandup() {
  const sql = getDb();
  const stats = { sent: 0, errors: 0, skipped: 0 };

  try {
    // Get all active dashboard users who have a slack_id linked and also have a linked Redmine user
    const developers = await sql`
      SELECT
        du.id AS dashboard_user_id,
        du.slack_id,
        du.display_name,
        du.linked_redmine_user_id,
        u.name AS redmine_name
      FROM dashboard_users du
      LEFT JOIN users u ON u.id = du.linked_redmine_user_id
      WHERE du.slack_id IS NOT NULL
        AND du.active = true
    `;

    if (developers.length === 0) {
      console.log('standup: No developers with slack_id found — skipping.');
      return stats;
    }

    for (const dev of developers) {
      try {
        if (!dev.linked_redmine_user_id) {
          // No linked Redmine user — can't look up tickets
          stats.skipped++;
          continue;
        }

        // Fetch active tickets assigned to this developer
        const tickets = await sql`
          SELECT
            i.id,
            i.redmine_id,
            i.title,
            i.status,
            i.priority,
            i.due_date,
            i.start_date,
            p.name AS project_name
          FROM issues i
          LEFT JOIN projects p ON p.id = i.project_id
          WHERE i.assigned_to_id = ${dev.linked_redmine_user_id}
            AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
          ORDER BY
            (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE) DESC,
            i.priority = 'Urgent' DESC,
            i.priority = 'High' DESC,
            i.due_date ASC NULLS LAST
        `;

        const devName = dev.display_name || dev.redmine_name || 'Developer';
        const blocks = buildStandupBlocks(devName, tickets);
        const fallbackText = tickets.length > 0
          ? `Good morning ${devName}! You have ${tickets.length} active ticket(s).`
          : `Good morning ${devName}! No active tickets right now.`;

        await sendDirectMessage(dev.slack_id, fallbackText, blocks);
        stats.sent++;

      } catch (devErr) {
        console.error(`standup: Error sending to ${dev.display_name} (${dev.slack_id}):`, devErr.message);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('standup: Fatal error:', err.message);
    stats.errors++;
  }

  console.log(`standup: Sent ${stats.sent}, errors ${stats.errors}, skipped ${stats.skipped}`);
  return stats;
}

module.exports = { sendStandup, buildStandupBlocks };
