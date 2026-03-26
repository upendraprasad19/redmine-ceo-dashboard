/**
 * bots/slack/index.js
 * Slack App setup using @slack/bolt.
 * Supports both HTTP (Events API) and Socket Mode.
 * Deferred — tokens not yet configured, but all code is ready.
 */

const { App } = require('@slack/bolt');
const { getDb } = require('../../lib/db');

let slackApp;

/**
 * Lazily initialize the Slack Bolt app.
 * Returns null if required env vars are missing (deferred setup).
 */
function getSlackApp() {
  if (!slackApp && process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET) {
    slackApp = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      socketMode: !!process.env.SLACK_APP_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN || undefined,
    });

    // Register all handlers once the app is initialized
    registerHandlers(slackApp);
  }
  return slackApp;
}

/**
 * Register message, action, and view handlers on the Slack app.
 */
function registerHandlers(app) {
  const { handleDevMessage } = require('./dev-queries');
  const { handleStatusChange, handleTicketDone } = require('./tickets');
  const { handleBlockerButton, handleBlockerSubmission } = require('./blockers');

  // ── Two-way developer messages ──
  app.message(async ({ message, say, client }) => {
    // Ignore bot messages and message changes
    if (message.subtype) return;
    if (message.bot_id) return;

    try {
      await handleDevMessage(message, say, client);
    } catch (err) {
      console.error('Slack message handler error:', err);
      await say(':warning: Something went wrong processing your message. Please try again.');
    }
  });

  // ── Block Kit interactive actions ──

  // Status dropdown from standup card
  app.action('ticket_status_change', async ({ ack, body, action, client }) => {
    await ack();
    try {
      await handleStatusChange(body, action, client);
    } catch (err) {
      console.error('Slack ticket status action error:', err);
    }
  });

  // "Mark Done" button from standup card
  app.action('ticket_mark_done', async ({ ack, body, action, client }) => {
    await ack();
    try {
      await handleTicketDone(body, action, client);
    } catch (err) {
      console.error('Slack ticket done action error:', err);
    }
  });

  // "Report a Blocker" button
  app.action('report_blocker', async ({ ack, body, client }) => {
    await ack();
    try {
      await handleBlockerButton(body, client);
    } catch (err) {
      console.error('Slack blocker button error:', err);
    }
  });

  // Blocker modal submission
  app.view('blocker_submission', async ({ ack, body, view, client }) => {
    await ack();
    try {
      await handleBlockerSubmission(body, view, client);
    } catch (err) {
      console.error('Slack blocker submission error:', err);
    }
  });
}

/**
 * Send a direct message to a Slack user by their Slack user ID.
 * @param {string} slackUserId - Slack user ID (e.g., U01ABCDEF)
 * @param {string} text - Fallback plain text
 * @param {Array} [blocks] - Optional Block Kit blocks
 * @returns {object|null} Slack API response or null if app not ready
 */
async function sendDirectMessage(slackUserId, text, blocks) {
  const app = getSlackApp();
  if (!app) {
    console.warn('Slack app not initialized — skipping DM to', slackUserId);
    return null;
  }

  try {
    const result = await app.client.chat.postMessage({
      channel: slackUserId,
      text,
      blocks: blocks || undefined,
    });
    return result;
  } catch (err) {
    console.error('Slack sendDirectMessage error:', err.message);
    return null;
  }
}

/**
 * Resolve a Slack user ID to a dashboard_user + linked Redmine user.
 * @param {string} slackUserId - Slack user ID
 * @returns {object|null} { dashboardUser, redmineUser } or null
 */
async function resolveSlackUser(slackUserId) {
  const sql = getDb();

  try {
    // Find dashboard user by slack_id
    const dashUsers = await sql`
      SELECT du.*, u.id AS redmine_user_id, u.name AS redmine_name, u.team AS redmine_team
      FROM dashboard_users du
      LEFT JOIN users u ON u.id = du.linked_redmine_user_id
      WHERE du.slack_id = ${slackUserId}
        AND du.active = true
      LIMIT 1
    `;

    if (dashUsers.length === 0) return null;

    const du = dashUsers[0];
    return {
      dashboardUser: du,
      redmineUserId: du.redmine_user_id || du.linked_redmine_user_id,
      displayName: du.display_name,
      team: du.team || du.redmine_team,
      role: du.role,
    };
  } catch (err) {
    console.error('resolveSlackUser error:', err.message);
    return null;
  }
}

module.exports = { getSlackApp, sendDirectMessage, resolveSlackUser };
