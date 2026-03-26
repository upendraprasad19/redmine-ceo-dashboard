/**
 * bots/telegram/index.js
 * Main Telegram bot setup using Telegraf.
 * Handles authentication, AI conversation with tool calling, and message chunking.
 */

const { Telegraf } = require('telegraf');
const { getDb } = require('../../lib/db');
const { chat } = require('../../lib/ai');
const { getRecentMessages, saveMessage, getRedis } = require('../../lib/redis');
const { tools } = require('../../lib/gpt-tools');
const { executeToolCall } = require('../../lib/gpt-executor');
const { buildSystemPrompt } = require('./prompt');
const { startOnboarding, handleOnboardingCallback, handleOnboardingText } = require('./onboarding');

// ── Initialize bot ──
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ── Auth middleware: match telegram_id to dashboard_users ──
bot.use(async (ctx, next) => {
  // Only process messages with a sender
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  try {
    const sql = getDb();
    const users = await sql`
      SELECT * FROM dashboard_users
      WHERE telegram_id = ${String(telegramId)}
        AND active = true
      LIMIT 1
    `;

    if (users.length === 0) {
      return ctx.reply(
        `❌ You are not registered in the Company OS dashboard.\n\n` +
        `Share this with your admin to get access:\n` +
        `Your Telegram ID: \`${telegramId}\``
      );
    }

    ctx.botUser = users[0];
    return next();
  } catch (err) {
    console.error('Telegram auth middleware error:', err);
    return ctx.reply('⚠️ System error during authentication. Please try again later.');
  }
});

// ── /start command ──
bot.start(async (ctx) => {
  const user = ctx.botUser;
  if (!user) return;

  const greeting = user.role === 'manager'
    ? `Hello ${user.display_name || user.username}! 👋\n\nI'm your Company OS Intelligence Assistant. I have access to all teams and projects.\n\nYou can ask me things like:\n• "Show overdue tickets"\n• "Who hasn't logged time today?"\n• "Status of Project X"\n• "Prepare 1-on-1 for [Name]"\n• "Team health overview"`
    : `Hello ${user.display_name || user.username}! 👋\n\nI'm your Company OS Assistant for the *${user.team}* team.\n\nYou can ask me things like:\n• "Show my team's open tickets"\n• "Who's on leave this week?"\n• "Time log status for today"\n• "Prepare 1-on-1 for [Name]"\n• "Team workload check"`;

  await ctx.reply(greeting, { parse_mode: 'Markdown' });

  // Trigger onboarding if not done yet
  if (!user.onboarding_completed) {
    setTimeout(async () => {
      try { await startOnboarding(ctx, user); } catch (e) { console.error('Onboarding error:', e.message); }
    }, 1200);
  }
});

// ── /preferences command — restart onboarding ──
bot.command('preferences', async (ctx) => {
  const user = ctx.botUser;
  if (!user) return;
  try {
    const r = getRedis();
    await r.del(`onboard:${user.id}`);
  } catch (e) { /* ignore */ }
  await startOnboarding(ctx, user);
});

// ── Callback query handler (onboarding buttons) ──
bot.on('callback_query', async (ctx) => {
  const user = ctx.botUser;
  if (!user) return ctx.answerCbQuery('Not registered');
  try {
    const handled = await handleOnboardingCallback(ctx, user);
    if (!handled) await ctx.answerCbQuery();
  } catch (e) {
    console.error('Callback query error:', e.message);
    await ctx.answerCbQuery('Something went wrong');
  }
});

// ── /help command ──
bot.help(async (ctx) => {
  const helpText = `*Available Commands:*

/start — Welcome message
/help — Show this help
/status — Quick team/org status

*Ask me anything in natural language:*
• Ticket queries (overdue, blocked, by person)
• Time log reports (daily, weekly, missing)
• Person summaries and 1-on-1 prep
• Project status and velocity predictions
• Team health and capacity
• Leave schedules

Just type your question!`;

  return ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// ── /status quick command ──
bot.command('status', async (ctx) => {
  const user = ctx.botUser;
  if (!user) return;

  try {
    const sql = getDb();
    const isManager = user.role === 'manager';

    const [overdueResult, missingLogsResult, leaveResult] = await Promise.all([
      isManager
        ? sql`
            SELECT COUNT(*) AS count FROM issues
            WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE
              AND status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
          `
        : sql`
            SELECT COUNT(*) AS count FROM issues i
            JOIN users u ON u.id = i.assigned_to_id
            WHERE i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE
              AND i.status NOT IN ('Closed', 'Resolved', 'Verified', 'Rejected')
              AND u.team = ${user.team}
          `,
      isManager
        ? sql`
            SELECT COUNT(*) AS count FROM users u
            WHERE u.active = true
              AND NOT EXISTS (
                SELECT 1 FROM time_entries te
                WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE
              )
          `
        : sql`
            SELECT COUNT(*) AS count FROM users u
            WHERE u.active = true AND u.team = ${user.team}
              AND NOT EXISTS (
                SELECT 1 FROM time_entries te
                WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE
              )
          `,
      isManager
        ? sql`
            SELECT COUNT(*) AS count FROM leave_records
            WHERE CURRENT_DATE BETWEEN start_date AND end_date
          `
        : sql`
            SELECT COUNT(*) AS count FROM leave_records lr
            JOIN users u ON u.id = lr.user_id
            WHERE CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
              AND u.team = ${user.team}
          `,
    ]);

    const overdue = parseInt(overdueResult[0]?.count || 0);
    const missing = parseInt(missingLogsResult[0]?.count || 0);
    const onLeave = parseInt(leaveResult[0]?.count || 0);

    const scope = isManager ? 'Organization' : `${user.team} Team`;
    const overdueEmoji = overdue > 0 ? '🔴' : '🟢';
    const missingEmoji = missing > 0 ? '🟡' : '🟢';

    const statusText = `📊 *${scope} Quick Status*

${overdueEmoji} Overdue Tickets: *${overdue}*
${missingEmoji} Missing Time Log Today: *${missing}*
🏖️ On Leave Today: *${onLeave}*`;

    return ctx.reply(statusText, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Status command error:', err);
    return ctx.reply('⚠️ Could not fetch status. Please try again.');
  }
});

// ── Main message handler ──
bot.on('text', async (ctx) => {
  const user = ctx.botUser;
  if (!user) return;

  // Check if this text is part of the onboarding flow (e.g. challenge step free text)
  try {
    const onboardHandled = await handleOnboardingText(ctx, user);
    if (onboardHandled) return;
  } catch (e) {
    console.error('Onboarding text check error:', e.message);
  }

  const message = ctx.message.text;

  // Show "typing" indicator
  await ctx.sendChatAction('typing');

  try {
    // Get recent context from Redis
    let recent = [];
    try {
      recent = await getRecentMessages(user.id);
    } catch (e) {
      console.error('Redis getRecentMessages error:', e.message);
    }

    // Build system prompt based on role
    const systemPrompt = buildSystemPrompt(user);

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      ...recent.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    // Call AI with tools
    let response = await chat(messages, tools);
    let reply = response.choices[0].message;

    // Handle tool calls — support up to 3 rounds of tool calling
    let toolRounds = 0;
    const MAX_TOOL_ROUNDS = 3;

    while (reply.tool_calls && reply.tool_calls.length > 0 && toolRounds < MAX_TOOL_ROUNDS) {
      toolRounds++;

      // Push the assistant message with tool_calls into the conversation
      messages.push(reply);

      // Execute each tool call
      for (const tc of reply.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch (e) {
          args = {};
        }

        const result = await executeToolCall(tc.function.name, args, {
          id: user.id,
          role: user.role,
          team: user.team,
          display_name: user.display_name,
          linked_redmine_user_id: user.linked_redmine_user_id,
        });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        });
      }

      // Re-send typing indicator for subsequent rounds
      await ctx.sendChatAction('typing');

      // Call AI again with tool results
      const followUp = await chat(messages, tools);
      reply = followUp.choices[0].message;
    }

    // If AI still has no text after tool rounds (stuck in tool-call mode), force a text-only response
    let replyText = reply.content;
    if (!replyText || replyText.trim() === '') {
      try {
        await ctx.sendChatAction('typing');
        const forced = await chat(messages, null, null); // no tools = forces text
        replyText = forced.choices[0].message.content;
      } catch (e) {
        console.error('Forced text fallback error:', e.message);
      }
    }
    if (!replyText || replyText.trim() === '') {
      replyText = '⚠️ I processed your request but couldn\'t generate a summary. Please try rephrasing.';
    }

    // Save to Redis
    try {
      await saveMessage(user.id, 'user', message);
      await saveMessage(user.id, 'assistant', replyText);
    } catch (e) {
      console.error('Redis saveMessage error:', e.message);
    }

    // Save to persistent chat_history in DB
    try {
      const sql = getDb();
      await sql`
        INSERT INTO chat_history (user_id, role, content, metadata, created_at)
        VALUES (${user.id}, 'user', ${message}, ${JSON.stringify({ source: 'telegram', telegram_id: String(ctx.from.id) })}, NOW())
      `;
      await sql`
        INSERT INTO chat_history (user_id, role, content, metadata, created_at)
        VALUES (${user.id}, 'assistant', ${replyText}, ${JSON.stringify({ source: 'telegram', tool_rounds: toolRounds })}, NOW())
      `;
    } catch (e) {
      console.error('DB chat_history insert error:', e.message);
    }

    // Send reply — chunk if needed (Telegram 4096 char limit)
    await sendChunkedReply(ctx, replyText);

  } catch (err) {
    console.error('Telegram message handler error:', err);
    await ctx.reply('⚠️ Sorry, something went wrong processing your message. Please try again.');
  }
});

/**
 * Send a reply, chunking at 4096 characters if needed.
 * Attempts Markdown parse_mode; falls back to plain text on parse failure.
 */
async function sendChunkedReply(ctx, text) {
  // Split into chunks respecting Telegram's 4096 char limit
  // Try to split at newlines to avoid breaking mid-sentence
  const MAX_LEN = 4096;

  if (text.length <= MAX_LEN) {
    try {
      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (e) {
      // Markdown parse error — send as plain text
      if (e.description && e.description.includes("can't parse")) {
        await ctx.reply(text);
      } else {
        throw e;
      }
    }
    return;
  }

  // Chunk the message at line boundaries
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      chunks.push(remaining);
      break;
    }

    // Find the last newline within the limit
    let splitIdx = remaining.lastIndexOf('\n', MAX_LEN);
    if (splitIdx <= 0) {
      // No newline found — split at space
      splitIdx = remaining.lastIndexOf(' ', MAX_LEN);
    }
    if (splitIdx <= 0) {
      // No space found — hard split
      splitIdx = MAX_LEN;
    }

    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trimStart();
  }

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: 'Markdown' });
    } catch (e) {
      if (e.description && e.description.includes("can't parse")) {
        await ctx.reply(chunk);
      } else {
        throw e;
      }
    }
  }
}

module.exports = { bot };
