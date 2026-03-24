/**
 * scripts/telegram-bot.js
 *
 * Main Telegram bot — long-polling process.
 * Run continuously:  node scripts/telegram-bot.js
 *
 * Design: Summary first → drill-down via inline buttons
 *
 * Commands:
 *   📊 /pulse              — company health snapshot
 *   📋 /mytickets          — your open tickets (summary + buttons)
 *   /overdue               — overdue grouped by project
 *   /blockers [project]    — blocked tickets
 *   📁 /projects           — all active projects ranked by risk
 *   /status <project>      — project ticket breakdown
 *   /report <project>      — full project health report
 *   👥 /myteam             — your team's summary (leads)
 *   /workload [team]       — per-member ticket + hours
 *   /nolog                 — who hasn't logged time today
 *   /whoisout              — who's on leave today/this week
 *   🏖 /leave              — apply for leave
 *   /myleave               — your upcoming/pending leaves
 *   /approve <id>          — approve leave (managers)
 *   👤 /start /help /delink
 *   ⚙️ /add_user
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import TelegramBot from 'node-telegram-bot-api';
import { neon } from '@neondatabase/serverless';
import { sendEmail } from '../lib/mailer.js';
import { chat as aiChat } from '../lib/ai-chat.js';
import { transcribeVoice } from '../lib/voice-stt.js';

const sql = neon(process.env.DATABASE_URL);
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Conversation memory — hybrid: in-memory cache (fast) + DB (persistent across restarts)
const convCache = new Map(); // chatId -> { messages, ts }
const CONV_CACHE_TTL = 5 * 60 * 1000; // 5 min in-memory cache

async function getConversation(chatId) {
  const cached = convCache.get(chatId);
  if (cached && Date.now() - cached.ts < CONV_CACHE_TTL) return cached.messages;

  // Load last 20 turns from DB
  const rows = await sql`
    SELECT role, content FROM conversation_history
    WHERE telegram_id = ${String(chatId)}
    ORDER BY created_at DESC LIMIT 20
  `;
  const messages = rows.reverse().map(r => {
    try { return { role: r.role, content: JSON.parse(r.content) }; }
    catch { return { role: r.role, content: r.content }; }
  });
  convCache.set(chatId, { messages, ts: Date.now() });
  return messages;
}

async function saveConversation(chatId, messages) {
  const trimmed = messages.slice(-20);
  convCache.set(chatId, { messages: trimmed, ts: Date.now() });

  // Persist only the newest 2 messages (latest user + assistant exchange)
  const newMsgs = trimmed.slice(-2);
  for (const m of newMsgs) {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (!content) continue;
    await sql`
      INSERT INTO conversation_history (telegram_id, role, content)
      VALUES (${String(chatId)}, ${m.role}, ${content})
    `.catch(() => {}); // ignore duplicate/constraint errors
  }

  // Keep only last 20 rows per user in DB
  await sql`
    DELETE FROM conversation_history
    WHERE telegram_id = ${String(chatId)}
      AND id NOT IN (
        SELECT id FROM conversation_history
        WHERE telegram_id = ${String(chatId)}
        ORDER BY created_at DESC LIMIT 20
      )
  `.catch(() => {});
}

async function clearConversation(chatId) {
  convCache.delete(chatId);
  await sql`DELETE FROM conversation_history WHERE telegram_id = ${String(chatId)}`.catch(() => {});
}

const AI_ENABLED = !!(process.env.ANTHROPIC_API_KEY || process.env.CEREBRAS_API_KEY);

console.log('🤖 Redmine Assistant Bot is running...');
console.log(`🧠 AI Chat: ${AI_ENABLED ? 'ENABLED' : 'DISABLED (set ANTHROPIC_API_KEY or CEREBRAS_API_KEY)'}\n`);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function esc(text) {
  if (!text) return '';
  return text.replace(/([_*`[\]()])/g, '\\$1');
}

function today() { return new Date().toISOString().split('T')[0]; }

function fmtDate(d) {
  if (!d) return '';
  const s = typeof d === 'string' ? d : d.toISOString().split('T')[0];
  const [y, m, day] = s.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(day)} ${months[parseInt(m)-1]}`;
}

function riskBar(overdue, blocked, critical) {
  const score = Number(overdue)*3 + Number(blocked)*2 + Number(critical);
  if (score >= 10) return '🔴';
  if (score >= 5) return '🟡';
  return '🟢';
}

async function send(chatId, text, buttons) {
  const opts = { parse_mode: 'Markdown' };
  if (buttons && buttons.length > 0) {
    opts.reply_markup = { inline_keyboard: buttons };
  }
  return bot.sendMessage(chatId, text, opts);
}

async function edit(chatId, msgId, text, buttons) {
  const opts = { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' };
  if (buttons && buttons.length > 0) {
    opts.reply_markup = { inline_keyboard: buttons };
  }
  return bot.editMessageText(text, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// DB Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getUserByChatId(chatId) {
  const rows = await sql`SELECT * FROM users WHERE telegram_chat_id = ${String(chatId)} LIMIT 1`;
  return rows[0] || null;
}

async function getSession(chatId) {
  const rows = await sql`SELECT * FROM telegram_sessions WHERE chat_id = ${String(chatId)} LIMIT 1`;
  return rows[0] || null;
}

async function setSession(chatId, state, context = {}) {
  await sql`
    INSERT INTO telegram_sessions (chat_id, state, context, updated_at)
    VALUES (${String(chatId)}, ${state}, ${JSON.stringify(context)}, NOW())
    ON CONFLICT (chat_id) DO UPDATE
      SET state = EXCLUDED.state, context = EXCLUDED.context, updated_at = NOW()
  `;
}

async function clearSession(chatId) {
  await setSession(chatId, 'idle', {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration Flow (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

async function handleStart(chatId, username) {
  const existing = await getUserByChatId(chatId);
  if (existing) {
    return send(chatId,
      `👋 Welcome back, *${esc(existing.name)}*!\n\nType /help to see available commands.`);
  }
  await setSession(chatId, 'registering_search', { telegram_username: username });
  return send(chatId,
    `👋 Welcome! I'm the *Redmine Assistant Bot*.\n\nTo link your account, please *type your name* (or part of it) to search:`);
}

async function handleRegisterSearch(chatId, text) {
  if (text.length < 2) return send(chatId, '⚠️ Please type at least 2 characters.');
  const users = await sql`
    SELECT id, name, team FROM users
    WHERE telegram_chat_id IS NULL AND active = true
      AND LOWER(name) LIKE LOWER(${'%' + text + '%'})
    ORDER BY name LIMIT 10
  `;
  if (users.length === 0) return send(chatId, `❌ No matching users for "${text}". Try a different name.`);
  const kb = users.map(u => [{ text: `${u.name}${u.team ? ` (${u.team})` : ''}`, callback_data: `reg:${u.id}` }]);
  return send(chatId, `🔍 Found ${users.length} match(es). Select your name:`, kb);
}

// ─────────────────────────────────────────────────────────────────────────────
// Leave Wizard (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const LEAVE_TYPES = ['Annual', 'Sick', 'Unpaid', 'Maternity', 'Other'];

async function startLeaveWizard(chatId) {
  await setSession(chatId, 'leave_start_date', {});
  return send(chatId, `📅 *Leave Application*\n\nStep 1/4 — Enter *start date* (YYYY-MM-DD):`);
}

async function handleLeaveWizard(chatId, text, session) {
  const ctx = session.context || {};

  if (session.state === 'leave_start_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return send(chatId, '❌ Use YYYY-MM-DD format (e.g. 2026-03-28):');
    ctx.start_date = text;
    await setSession(chatId, 'leave_end_date', ctx);
    return send(chatId, `Step 2/4 — Enter *end date* (YYYY-MM-DD):`);
  }

  if (session.state === 'leave_end_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text < ctx.start_date)
      return send(chatId, '❌ Invalid or end date is before start date. Try again:');
    ctx.end_date = text;
    await setSession(chatId, 'leave_type', ctx);
    const kb = LEAVE_TYPES.map(t => [{ text: t, callback_data: `lt:${t}` }]);
    return send(chatId, `Step 3/4 — Select *leave type*:`, kb);
  }

  if (session.state === 'leave_reason') {
    ctx.reason = text;
    await setSession(chatId, 'leave_confirm', ctx);
    return send(chatId,
      `*Confirm leave request:*\n\n📅 ${ctx.start_date} → ${ctx.end_date}\n🏷 ${ctx.leave_type}\n📝 ${ctx.reason}`,
      [[{ text: '✅ Submit', callback_data: 'lc:yes' }, { text: '❌ Cancel', callback_data: 'lc:no' }]]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// /pulse — Company health snapshot
// ─────────────────────────────────────────────────────────────────────────────

async function handlePulse(chatId) {
  const [stats] = await sql`
    SELECT
      (SELECT COUNT(*) FROM users WHERE active = true AND team IS NOT NULL) AS total,
      (SELECT COUNT(*) FROM leave_records
       WHERE CURRENT_DATE BETWEEN start_date AND end_date) AS on_leave,
      (SELECT COUNT(*) FROM issues
       WHERE due_date < CURRENT_DATE AND status NOT IN ('Closed','Resolved')) AS overdue,
      (SELECT COUNT(*) FROM issues
       WHERE status = 'Blocked' AND status NOT IN ('Closed','Resolved')) AS blocked,
      (SELECT COUNT(DISTINCT i.assigned_to_id) FROM issues i
       WHERE i.status NOT IN ('Closed','Resolved') AND i.priority IN ('High','Critical')) AS critical_assignees,
      (SELECT COUNT(DISTINCT te.user_id) FROM time_entries te
       WHERE te.spent_on = CURRENT_DATE) AS logged_today
  `;

  const present = Number(stats.total) - Number(stats.on_leave);
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });

  const msg =
    `📊 *Daily Pulse — ${dayName}*\n\n` +
    `👥 *${present}/${stats.total}* present (${stats.on_leave} on leave)\n` +
    `🔴 *${stats.overdue}* overdue tickets\n` +
    `🚧 *${stats.blocked}* blocked\n` +
    `⏱ *${stats.logged_today}/${present}* logged time today\n` +
    (Number(stats.overdue) > 5 ? `\n⚠️ _Overdue count is high — review needed_` : '');

  const buttons = [
    [{ text: '🔴 Overdue', callback_data: 'p:od' }, { text: '🚧 Blocked', callback_data: 'p:bl' }],
    [{ text: '👥 Who\'s Out', callback_data: 'p:out' }, { text: '⏱ No Log', callback_data: 'p:nolog' }],
    [{ text: '📁 Projects', callback_data: 'p:proj' }],
  ];

  return send(chatId, msg, buttons);
}

// ─────────────────────────────────────────────────────────────────────────────
// /mytickets — Your tickets summary + drill-down
// ─────────────────────────────────────────────────────────────────────────────

async function handleMyTickets(chatId, user) {
  const [counts] = await sql`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE due_date < CURRENT_DATE) AS overdue,
      COUNT(*) FILTER (WHERE priority IN ('High','Critical')) AS critical,
      COUNT(*) FILTER (WHERE status = 'In Progress') AS in_progress,
      COUNT(*) FILTER (WHERE status = 'Blocked') AS blocked
    FROM issues
    WHERE assigned_to_id = ${user.id} AND status NOT IN ('Closed','Resolved')
  `;

  if (Number(counts.total) === 0) return send(chatId, '🎉 You have no open tickets!');

  const msg =
    `📋 *Your Tickets*\n\n` +
    `Total: *${counts.total}* open\n` +
    `🔴 ${counts.overdue} overdue · 🔥 ${counts.critical} critical\n` +
    `⚡ ${counts.in_progress} in progress · 🚧 ${counts.blocked} blocked`;

  const buttons = [];
  if (Number(counts.overdue) > 0) buttons.push([{ text: `🔴 Overdue (${counts.overdue})`, callback_data: 'mt:od' }]);
  buttons.push(
    [{ text: '📋 Show All', callback_data: 'mt:all' }, { text: '📁 By Project', callback_data: 'mt:proj' }]
  );

  return send(chatId, msg, buttons);
}

// ─────────────────────────────────────────────────────────────────────────────
// /overdue — Grouped by project
// ─────────────────────────────────────────────────────────────────────────────

async function handleOverdue(chatId) {
  const rows = await sql`
    SELECT p.name AS project, p.id AS pid, COUNT(*) AS cnt
    FROM issues i
    JOIN projects p ON p.id = i.project_id
    WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')
    GROUP BY p.name, p.id ORDER BY cnt DESC
  `;

  if (rows.length === 0) return send(chatId, '✅ No overdue tickets!');

  const total = rows.reduce((s, r) => s + Number(r.cnt), 0);
  const lines = rows.map(r => `  ${r.project}: *${r.cnt}*`).join('\n');
  const msg = `🔴 *Overdue Tickets: ${total}*\n\n${lines}`;

  const buttons = rows.slice(0, 8).map(r => [{ text: `${r.project} (${r.cnt})`, callback_data: `od:${r.pid}` }]);

  return send(chatId, msg, buttons);
}

// ─────────────────────────────────────────────────────────────────────────────
// /blockers [project] — Blocked tickets
// ─────────────────────────────────────────────────────────────────────────────

async function handleBlockers(chatId, projectArg) {
  let tickets;
  if (projectArg) {
    tickets = await sql`
      SELECT i.redmine_id, i.title, u.name AS assigned, p.name AS project
      FROM issues i
      LEFT JOIN users u ON u.id = i.assigned_to_id
      JOIN projects p ON p.id = i.project_id
      WHERE i.status = 'Blocked' AND LOWER(p.name) LIKE LOWER(${'%' + projectArg + '%'})
      ORDER BY i.due_date ASC NULLS LAST LIMIT 15
    `;
  } else {
    tickets = await sql`
      SELECT i.redmine_id, i.title, u.name AS assigned, p.name AS project
      FROM issues i
      LEFT JOIN users u ON u.id = i.assigned_to_id
      JOIN projects p ON p.id = i.project_id
      WHERE i.status = 'Blocked'
      ORDER BY i.due_date ASC NULLS LAST LIMIT 15
    `;
  }

  if (tickets.length === 0) return send(chatId, '✅ No blocked tickets!' + (projectArg ? ` in "${projectArg}"` : ''));

  const lines = tickets.map(t =>
    `🚧 *#${t.redmine_id}* ${esc(t.title)}\n   👤 ${t.assigned || 'Unassigned'} · _${esc(t.project)}_`
  ).join('\n\n');

  return send(chatId, `🚧 *Blocked Tickets (${tickets.length}):*\n\n${lines}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// /projects — All active ranked by risk
// ─────────────────────────────────────────────────────────────────────────────

async function handleProjects(chatId) {
  const rows = await sql`
    SELECT p.name, p.id AS pid,
      COUNT(*) FILTER (WHERE i.status NOT IN ('Closed','Resolved')) AS open,
      COUNT(*) FILTER (WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) AS overdue,
      COUNT(*) FILTER (WHERE i.status = 'Blocked') AS blocked,
      COUNT(*) FILTER (WHERE i.priority IN ('High','Critical') AND i.status NOT IN ('Closed','Resolved')) AS critical
    FROM projects p
    LEFT JOIN issues i ON i.project_id = p.id
    WHERE p.status = 'active'
    GROUP BY p.name, p.id
    HAVING COUNT(*) FILTER (WHERE i.status NOT IN ('Closed','Resolved')) > 0
    ORDER BY COUNT(*) FILTER (WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) DESC,
             COUNT(*) FILTER (WHERE i.status = 'Blocked') DESC
  `;

  if (rows.length === 0) return send(chatId, '📁 No active projects with open tickets.');

  const lines = rows.slice(0, 12).map(r =>
    `${riskBar(r.overdue, r.blocked, r.critical)} *${esc(r.name)}*\n   📌 ${r.open} open · 🔴 ${r.overdue} overdue · 🚧 ${r.blocked} blocked`
  ).join('\n\n');

  const msg = `📁 *Active Projects (${rows.length}):*\n\n${lines}`;
  const buttons = rows.slice(0, 6).map(r => [{ text: `${r.name}`, callback_data: `pj:${r.pid}` }]);

  return send(chatId, msg, buttons);
}

// ─────────────────────────────────────────────────────────────────────────────
// /status <project> — Project breakdown
// ─────────────────────────────────────────────────────────────────────────────

async function handleStatus(chatId, projectArg) {
  if (!projectArg) return send(chatId, '❌ Usage: `/status ProjectName`');

  const rows = await sql`
    SELECT p.name AS project_name, p.id AS pid,
      COUNT(*) FILTER (WHERE i.status NOT IN ('Closed','Resolved')) AS open,
      COUNT(*) FILTER (WHERE i.priority IN ('High','Critical') AND i.status NOT IN ('Closed','Resolved')) AS high,
      COUNT(*) FILTER (WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) AS overdue,
      COUNT(*) FILTER (WHERE i.status = 'In Progress') AS in_progress,
      COUNT(*) FILTER (WHERE i.status IN ('Review','Resolved')) AS in_review,
      COUNT(*) FILTER (WHERE i.status = 'Blocked') AS blocked,
      COUNT(*) FILTER (WHERE i.status = 'New') AS new_tickets
    FROM issues i JOIN projects p ON p.id = i.project_id
    WHERE LOWER(p.name) LIKE LOWER(${'%' + projectArg + '%'})
    GROUP BY p.name, p.id LIMIT 1
  `;

  if (rows.length === 0) return send(chatId, `❌ Project "${projectArg}" not found.`);
  const r = rows[0];

  const msg =
    `📊 *${esc(r.project_name)}*\n\n` +
    `📌 Open: *${r.open}*\n` +
    `🆕 New: ${r.new_tickets} · ⚡ In Progress: ${r.in_progress}\n` +
    `🔍 Review: ${r.in_review} · 🚧 Blocked: ${r.blocked}\n` +
    `🔥 High/Critical: *${r.high}* · 🔴 Overdue: *${r.overdue}*`;

  const buttons = [
    [{ text: '🔴 Overdue List', callback_data: `od:${r.pid}` }, { text: '🚧 Blockers', callback_data: `bl:${r.pid}` }],
    [{ text: '📋 Full Report', callback_data: `rp:${r.pid}` }],
  ];

  return send(chatId, msg, buttons);
}

// ─────────────────────────────────────────────────────────────────────────────
// /report <project> — Full project health
// ─────────────────────────────────────────────────────────────────────────────

async function handleReport(chatId, projectArg) {
  if (!projectArg) return send(chatId, '❌ Usage: `/report ProjectName`');

  const [s] = await sql`
    SELECT p.name, p.id AS pid,
      COUNT(i.id) FILTER (WHERE i.status NOT IN ('Closed','Resolved')) AS open,
      COUNT(i.id) FILTER (WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) AS overdue,
      COUNT(i.id) FILTER (WHERE i.status = 'Blocked') AS blocked,
      COUNT(i.id) FILTER (WHERE i.priority IN ('High','Critical') AND i.status NOT IN ('Closed','Resolved')) AS critical,
      ROUND(AVG(i.done_ratio) FILTER (WHERE i.status NOT IN ('Closed','Resolved'))) AS avg_done,
      COUNT(i.id) FILTER (WHERE i.status IN ('Closed','Resolved') AND i.closed_at >= CURRENT_DATE - 7) AS closed_7d
    FROM projects p LEFT JOIN issues i ON i.project_id = p.id
    WHERE LOWER(p.name) LIKE LOWER(${'%' + projectArg + '%'})
    GROUP BY p.name, p.id LIMIT 1
  `;

  if (!s) return send(chatId, `❌ Project "${projectArg}" not found.`);

  const team = await sql`
    SELECT u.name, COUNT(*) AS cnt
    FROM issues i JOIN users u ON u.id = i.assigned_to_id JOIN projects p ON p.id = i.project_id
    WHERE LOWER(p.name) LIKE LOWER(${'%' + projectArg + '%'}) AND i.status NOT IN ('Closed','Resolved')
    GROUP BY u.name ORDER BY cnt DESC LIMIT 5
  `;

  const health = riskBar(s.overdue, s.blocked, s.critical);
  const teamLines = team.map(t => `  • ${esc(t.name)}: ${t.cnt}`).join('\n') || '  None';

  const msg =
    `📋 *Report: ${esc(s.name)}*\n\n` +
    `${health} Health: ${Number(s.overdue) > 3 ? 'At Risk' : Number(s.critical) > 2 ? 'Caution' : 'On Track'}\n` +
    `📌 Open: *${s.open}* · 🔴 Overdue: *${s.overdue}*\n` +
    `🚧 Blocked: *${s.blocked}* · 🔥 Critical: *${s.critical}*\n` +
    `📈 Avg Progress: *${s.avg_done || 0}%*\n` +
    `✅ Closed (7d): *${s.closed_7d}*\n\n` +
    `👥 *Top Assignees:*\n${teamLines}`;

  const buttons = [
    [{ text: '🔴 Overdue', callback_data: `od:${s.pid}` }, { text: '🚧 Blocked', callback_data: `bl:${s.pid}` }],
  ];

  return send(chatId, msg, buttons);
}

// ─────────────────────────────────────────────────────────────────────────────
// /myteam — Team lead's summary
// ─────────────────────────────────────────────────────────────────────────────

async function handleMyTeam(chatId, user) {
  if (!user.team) return send(chatId, '❌ You are not assigned to a team.');

  const members = await sql`
    SELECT u.id, u.name, u.is_team_lead,
      (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.status NOT IN ('Closed','Resolved')) AS open,
      (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) AS overdue,
      (SELECT COALESCE(SUM(te.hours),0) FROM time_entries te WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE) AS hours_today
    FROM users u WHERE u.team = ${user.team} AND u.active = true ORDER BY u.name
  `;

  const onLeave = await sql`
    SELECT u.name FROM users u JOIN leave_records lr ON lr.user_id = u.id
    WHERE u.team = ${user.team} AND u.active = true AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
  `;

  const totalOpen = members.reduce((s, m) => s + Number(m.open), 0);
  const totalOd = members.reduce((s, m) => s + Number(m.overdue), 0);
  const logged = members.filter(m => Number(m.hours_today) > 0).length;
  const leaveNames = onLeave.map(l => l.name);

  const msg =
    `👥 *Team ${esc(user.team)}* — ${members.length} members\n\n` +
    `📌 Open tickets: *${totalOpen}*\n` +
    `🔴 Overdue: *${totalOd}*\n` +
    `⏱ Logged today: *${logged}/${members.length}*\n` +
    (leaveNames.length > 0 ? `🏖 On leave: ${leaveNames.join(', ')}\n` : '') +
    `\n_Tap below for details_`;

  const buttons = [
    [{ text: '👥 Member Details', callback_data: `tw:${user.team}` }],
    [{ text: '⏱ No Time Log', callback_data: `tn:${user.team}` }],
  ];

  return send(chatId, msg, buttons);
}

// ─────────────────────────────────────────────────────────────────────────────
// /workload [team] — Per-member breakdown
// ─────────────────────────────────────────────────────────────────────────────

async function handleWorkload(chatId, teamArg) {
  let condition;
  if (teamArg) {
    condition = sql`u.team = ${teamArg}`;
  } else {
    condition = sql`u.team IS NOT NULL`;
  }

  const members = await sql`
    SELECT u.name, u.team,
      (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.status NOT IN ('Closed','Resolved')) AS open,
      (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) AS overdue,
      (SELECT COALESCE(SUM(te.hours),0) FROM time_entries te WHERE te.user_id = u.id AND te.spent_on >= CURRENT_DATE - 7) AS hours_7d
    FROM users u WHERE u.active = true AND ${condition}
    ORDER BY (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) DESC,
             (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.status NOT IN ('Closed','Resolved')) DESC
    LIMIT 20
  `;

  if (members.length === 0) return send(chatId, `❌ No members found${teamArg ? ` in "${teamArg}"` : ''}.`);

  const lines = members.map(m => {
    const flag = Number(m.overdue) > 0 ? '🔴' : Number(m.open) > 8 ? '🟡' : '🟢';
    return `${flag} *${esc(m.name)}*${!teamArg ? ` (${m.team})` : ''}\n   📌 ${m.open} open · 🔴 ${m.overdue} overdue · ⏱ ${m.hours_7d}h (7d)`;
  }).join('\n\n');

  return send(chatId, `👥 *Workload${teamArg ? ` — ${esc(teamArg)}` : ''}:*\n\n${lines}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// /nolog — Who hasn't logged time today
// ─────────────────────────────────────────────────────────────────────────────

async function handleNoLog(chatId) {
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return send(chatId, '📅 It\'s the weekend — no time logging expected.');

  const missing = await sql`
    SELECT u.name, u.team
    FROM users u
    WHERE u.active = true AND u.team IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM time_entries te WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE
      )
      AND NOT EXISTS (
        SELECT 1 FROM leave_records lr WHERE lr.user_id = u.id AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
      )
    ORDER BY u.team, u.name
  `;

  if (missing.length === 0) return send(chatId, '✅ Everyone has logged time today!');

  // Group by team
  const byTeam = {};
  for (const m of missing) {
    const t = m.team || 'Unassigned';
    if (!byTeam[t]) byTeam[t] = [];
    byTeam[t].push(m.name);
  }

  const lines = Object.entries(byTeam).map(([team, names]) =>
    `*${team}* (${names.length}): ${names.join(', ')}`
  ).join('\n');

  return send(chatId, `⏱ *No Time Log Today (${missing.length}):*\n\n${lines}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// /whoisout — Who's on leave
// ─────────────────────────────────────────────────────────────────────────────

async function handleWhoisout(chatId) {
  const todayLeave = await sql`
    SELECT u.name, u.team, lr.leave_type, lr.end_date
    FROM leave_records lr JOIN users u ON u.id = lr.user_id
    WHERE u.active = true AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
    ORDER BY u.team, u.name
  `;

  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + (5 - weekEnd.getDay()));
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const upcoming = await sql`
    SELECT u.name, u.team, lr.leave_type, lr.start_date, lr.end_date
    FROM leave_records lr JOIN users u ON u.id = lr.user_id
    WHERE u.active = true AND lr.start_date > CURRENT_DATE AND lr.start_date <= ${weekEndStr}
    ORDER BY lr.start_date, u.name
  `;

  let msg = '';
  if (todayLeave.length === 0) {
    msg = '🏖 *Who\'s Out*\n\n✅ No one is on leave today.';
  } else {
    const lines = todayLeave.map(l =>
      `  • ${esc(l.name)} (${l.team || '—'}) — ${l.leave_type}, back ${fmtDate(l.end_date)}`
    ).join('\n');
    msg = `🏖 *On Leave Today (${todayLeave.length}):*\n\n${lines}`;
  }

  if (upcoming.length > 0) {
    const upLines = upcoming.map(l =>
      `  • ${esc(l.name)} — ${fmtDate(l.start_date)} to ${fmtDate(l.end_date)}`
    ).join('\n');
    msg += `\n\n📅 *Upcoming This Week (${upcoming.length}):*\n\n${upLines}`;
  }

  return send(chatId, msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// /myleave — Your upcoming/pending leaves
// ─────────────────────────────────────────────────────────────────────────────

async function handleMyLeave(chatId, user) {
  const records = await sql`
    SELECT lr.start_date, lr.end_date, lr.leave_type, lr.source
    FROM leave_records lr
    WHERE lr.user_id = ${user.id} AND lr.end_date >= CURRENT_DATE
    ORDER BY lr.start_date
  `;

  const requests = await sql`
    SELECT id, start_date, end_date, leave_type, status, reason
    FROM leave_requests
    WHERE user_id = ${user.id} AND end_date >= CURRENT_DATE
    ORDER BY start_date
  `;

  if (records.length === 0 && requests.length === 0) {
    return send(chatId, '📅 No upcoming leaves or pending requests.');
  }

  let msg = `📅 *Your Leave*\n`;

  if (records.length > 0) {
    const lines = records.map(r =>
      `  • ${fmtDate(r.start_date)} → ${fmtDate(r.end_date)} — ${r.leave_type}`
    ).join('\n');
    msg += `\n*Approved/Recorded:*\n${lines}`;
  }

  if (requests.length > 0) {
    const lines = requests.map(r => {
      const icon = r.status === 'approved' ? '✅' : r.status === 'rejected' ? '❌' : '⏳';
      return `  ${icon} #${r.id}: ${fmtDate(r.start_date)} → ${fmtDate(r.end_date)} — ${r.leave_type} (${r.status})`;
    }).join('\n');
    msg += `\n\n*Requests:*\n${lines}`;
  }

  return send(chatId, msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// /help
// ─────────────────────────────────────────────────────────────────────────────

async function handleHelp(chatId) {
  return send(chatId, `
🤖 *Redmine Assistant*

🧠 *AI Chat*${AI_ENABLED ? ' ✅' : ' ❌'}
Just type or send a voice note!
_"How's the company doing?"_
_"Who's overloaded in Java team?"_
_"Compare this week to last week"_

📊 *Quick Commands*
/pulse — Company health snapshot
/projects — All projects by risk
/mytickets — Your open tickets
/overdue — Overdue by project
/nolog — Missing time logs
/whoisout — Who's on leave

📋 *Project*
/status _project_ — Breakdown
/report _project_ — Full report
/blockers _project_ — Blocked tickets

👥 *Team*
/myteam — Your team summary
/workload _team_ — Per-member load

🏖 *Leave*
/myleave — Your leaves
/approve _id_ — Approve leave`.trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback Handlers (drill-down buttons)
// ─────────────────────────────────────────────────────────────────────────────

async function handleCallback(chatId, msgId, data, user) {

  // ── Pulse drill-downs ──────────────────────────────────
  if (data === 'p:od') {
    const rows = await sql`
      SELECT p.name, COUNT(*) AS cnt
      FROM issues i JOIN projects p ON p.id = i.project_id
      WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')
      GROUP BY p.name ORDER BY cnt DESC
    `;
    const total = rows.reduce((s, r) => s + Number(r.cnt), 0);
    const lines = rows.map(r => `  • ${esc(r.name)}: *${r.cnt}*`).join('\n');
    return edit(chatId, msgId, `🔴 *Overdue Tickets: ${total}*\n\n${lines}\n\n_/overdue for full details_`);
  }

  if (data === 'p:bl') {
    const rows = await sql`
      SELECT i.redmine_id, i.title, u.name AS assigned, p.name AS project
      FROM issues i LEFT JOIN users u ON u.id = i.assigned_to_id JOIN projects p ON p.id = i.project_id
      WHERE i.status = 'Blocked'
      ORDER BY i.due_date ASC NULLS LAST LIMIT 10
    `;
    if (rows.length === 0) return edit(chatId, msgId, '✅ No blocked tickets!');
    const lines = rows.map(t =>
      `🚧 *#${t.redmine_id}* ${esc(t.title)}\n   👤 ${t.assigned || 'Unassigned'} · _${esc(t.project)}_`
    ).join('\n\n');
    return edit(chatId, msgId, `🚧 *Blocked Tickets (${rows.length}):*\n\n${lines}`);
  }

  if (data === 'p:out') {
    const rows = await sql`
      SELECT u.name, u.team, lr.leave_type
      FROM leave_records lr JOIN users u ON u.id = lr.user_id
      WHERE u.active = true AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
      ORDER BY u.team, u.name
    `;
    if (rows.length === 0) return edit(chatId, msgId, '✅ No one is on leave today!');
    const lines = rows.map(r => `  • ${esc(r.name)} (${r.team || '—'}) — ${r.leave_type}`).join('\n');
    return edit(chatId, msgId, `🏖 *On Leave Today (${rows.length}):*\n\n${lines}`);
  }

  if (data === 'p:nolog') {
    const missing = await sql`
      SELECT u.name, u.team FROM users u
      WHERE u.active = true AND u.team IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE)
        AND NOT EXISTS (SELECT 1 FROM leave_records lr WHERE lr.user_id = u.id AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date)
      ORDER BY u.team, u.name
    `;
    if (missing.length === 0) return edit(chatId, msgId, '✅ Everyone logged time today!');
    const byTeam = {};
    for (const m of missing) { const t = m.team; if (!byTeam[t]) byTeam[t] = []; byTeam[t].push(m.name); }
    const lines = Object.entries(byTeam).map(([team, names]) => `*${team}* (${names.length}): ${names.join(', ')}`).join('\n');
    return edit(chatId, msgId, `⏱ *No Log Today (${missing.length}):*\n\n${lines}`);
  }

  if (data === 'p:proj') {
    const rows = await sql`
      SELECT p.name,
        COUNT(*) FILTER (WHERE i.status NOT IN ('Closed','Resolved')) AS open,
        COUNT(*) FILTER (WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) AS overdue,
        COUNT(*) FILTER (WHERE i.status = 'Blocked') AS blocked
      FROM projects p LEFT JOIN issues i ON i.project_id = p.id
      WHERE p.status = 'active'
      GROUP BY p.name HAVING COUNT(*) FILTER (WHERE i.status NOT IN ('Closed','Resolved')) > 0
      ORDER BY COUNT(*) FILTER (WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) DESC LIMIT 10
    `;
    const lines = rows.map(r =>
      `${riskBar(r.overdue, r.blocked, 0)} *${esc(r.name)}* — ${r.open} open, ${r.overdue} overdue`
    ).join('\n');
    return edit(chatId, msgId, `📁 *Projects:*\n\n${lines}\n\n_/projects for full list_`);
  }

  // ── My tickets drill-downs ─────────────────────────────
  if (data === 'mt:od' || data === 'mt:all') {
    const condition = data === 'mt:od' ? sql`AND i.due_date < CURRENT_DATE` : sql``;
    const tickets = await sql`
      SELECT i.redmine_id, i.title, i.status, i.priority, i.due_date, p.name AS project
      FROM issues i LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.assigned_to_id = ${user.id} AND i.status NOT IN ('Closed','Resolved') ${condition}
      ORDER BY (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE) DESC, i.due_date ASC NULLS LAST
      LIMIT 15
    `;
    if (tickets.length === 0) return edit(chatId, msgId, '✅ None!');
    const label = data === 'mt:od' ? 'Overdue' : 'All Open';
    const lines = tickets.map((t, i) => {
      const od = t.due_date && t.due_date < today() ? ' 🔴' : '';
      return `${i+1}. *#${t.redmine_id}* ${esc(t.title)}${od}\n   ${t.priority} · ${t.status} · _${esc(t.project)}_`;
    }).join('\n\n');
    return edit(chatId, msgId, `📋 *${label} (${tickets.length}):*\n\n${lines}`);
  }

  if (data === 'mt:proj') {
    const rows = await sql`
      SELECT p.name, COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE i.due_date < CURRENT_DATE) AS overdue
      FROM issues i JOIN projects p ON p.id = i.project_id
      WHERE i.assigned_to_id = ${user.id} AND i.status NOT IN ('Closed','Resolved')
      GROUP BY p.name ORDER BY cnt DESC
    `;
    const lines = rows.map(r => `  • *${esc(r.name)}*: ${r.cnt} open${Number(r.overdue) > 0 ? ` (🔴 ${r.overdue} overdue)` : ''}`).join('\n');
    return edit(chatId, msgId, `📁 *Your Tickets by Project:*\n\n${lines}`);
  }

  // ── Overdue by project drill-down ──────────────────────
  if (data.startsWith('od:')) {
    const pid = parseInt(data.split(':')[1]);
    const tickets = await sql`
      SELECT i.redmine_id, i.title, i.due_date, u.name AS assigned
      FROM issues i LEFT JOIN users u ON u.id = i.assigned_to_id
      WHERE i.project_id = ${pid} AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')
      ORDER BY i.due_date ASC LIMIT 15
    `;
    if (tickets.length === 0) return edit(chatId, msgId, '✅ No overdue tickets in this project!');
    const lines = tickets.map(t =>
      `🔴 *#${t.redmine_id}* ${esc(t.title)}\n   Due: ${fmtDate(t.due_date)} · 👤 ${t.assigned || 'Unassigned'}`
    ).join('\n\n');
    return edit(chatId, msgId, `🔴 *Overdue (${tickets.length}):*\n\n${lines}`);
  }

  // ── Blocked by project drill-down ──────────────────────
  if (data.startsWith('bl:')) {
    const pid = parseInt(data.split(':')[1]);
    const tickets = await sql`
      SELECT i.redmine_id, i.title, u.name AS assigned
      FROM issues i LEFT JOIN users u ON u.id = i.assigned_to_id
      WHERE i.project_id = ${pid} AND i.status = 'Blocked'
      ORDER BY i.due_date ASC NULLS LAST LIMIT 15
    `;
    if (tickets.length === 0) return edit(chatId, msgId, '✅ No blocked tickets!');
    const lines = tickets.map(t =>
      `🚧 *#${t.redmine_id}* ${esc(t.title)}\n   👤 ${t.assigned || 'Unassigned'}`
    ).join('\n\n');
    return edit(chatId, msgId, `🚧 *Blocked (${tickets.length}):*\n\n${lines}`);
  }

  // ── Project detail from /projects ──────────────────────
  if (data.startsWith('pj:') || data.startsWith('rp:')) {
    const pid = parseInt(data.split(':')[1]);
    const [s] = await sql`
      SELECT p.name,
        COUNT(i.id) FILTER (WHERE i.status NOT IN ('Closed','Resolved')) AS open,
        COUNT(i.id) FILTER (WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) AS overdue,
        COUNT(i.id) FILTER (WHERE i.status = 'Blocked') AS blocked,
        COUNT(i.id) FILTER (WHERE i.priority IN ('High','Critical') AND i.status NOT IN ('Closed','Resolved')) AS critical,
        ROUND(AVG(i.done_ratio) FILTER (WHERE i.status NOT IN ('Closed','Resolved'))) AS avg_done,
        COUNT(i.id) FILTER (WHERE i.status IN ('Closed','Resolved') AND i.closed_at >= CURRENT_DATE - 7) AS closed_7d
      FROM projects p LEFT JOIN issues i ON i.project_id = p.id WHERE p.id = ${pid} GROUP BY p.name
    `;
    if (!s) return edit(chatId, msgId, '❌ Project not found.');
    const team = await sql`
      SELECT u.name, COUNT(*) AS cnt FROM issues i JOIN users u ON u.id = i.assigned_to_id
      WHERE i.project_id = ${pid} AND i.status NOT IN ('Closed','Resolved')
      GROUP BY u.name ORDER BY cnt DESC LIMIT 5
    `;
    const health = riskBar(s.overdue, s.blocked, s.critical);
    const teamLines = team.map(t => `  • ${esc(t.name)}: ${t.cnt}`).join('\n') || '  None';
    const msg =
      `📋 *${esc(s.name)}*\n\n` +
      `${health} ${Number(s.overdue) > 3 ? 'At Risk' : Number(s.critical) > 2 ? 'Caution' : 'On Track'}\n` +
      `📌 Open: *${s.open}* · 🔴 Overdue: *${s.overdue}*\n` +
      `🚧 Blocked: *${s.blocked}* · 🔥 Critical: *${s.critical}*\n` +
      `📈 Progress: *${s.avg_done || 0}%* · ✅ Closed (7d): *${s.closed_7d}*\n\n` +
      `👥 *Top Assignees:*\n${teamLines}`;
    const buttons = [
      [{ text: '🔴 Overdue', callback_data: `od:${pid}` }, { text: '🚧 Blocked', callback_data: `bl:${pid}` }],
    ];
    return edit(chatId, msgId, msg, buttons);
  }

  // ── Team workload drill-down ───────────────────────────
  if (data.startsWith('tw:')) {
    const teamName = data.substring(3);
    const members = await sql`
      SELECT u.name, u.is_team_lead,
        (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.status NOT IN ('Closed','Resolved')) AS open,
        (SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) AS overdue,
        (SELECT COALESCE(SUM(te.hours),0) FROM time_entries te WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE) AS today_hrs
      FROM users u WHERE u.team = ${teamName} AND u.active = true ORDER BY u.is_team_lead DESC, u.name
    `;
    const lines = members.map(m => {
      const flag = Number(m.overdue) > 0 ? '🔴' : Number(m.open) > 8 ? '🟡' : '🟢';
      const lead = m.is_team_lead ? ' ⭐' : '';
      return `${flag} *${esc(m.name)}*${lead}\n   📌 ${m.open} open · 🔴 ${m.overdue} overdue · ⏱ ${m.today_hrs}h today`;
    }).join('\n\n');
    return edit(chatId, msgId, `👥 *Team ${esc(teamName)}:*\n\n${lines}`);
  }

  // ── Team no-log drill-down ─────────────────────────────
  if (data.startsWith('tn:')) {
    const teamName = data.substring(3);
    const missing = await sql`
      SELECT u.name FROM users u
      WHERE u.team = ${teamName} AND u.active = true
        AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.user_id = u.id AND te.spent_on = CURRENT_DATE)
        AND NOT EXISTS (SELECT 1 FROM leave_records lr WHERE lr.user_id = u.id AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date)
      ORDER BY u.name
    `;
    if (missing.length === 0) return edit(chatId, msgId, `✅ Everyone in ${teamName} logged time today!`);
    const names = missing.map(m => `  • ${m.name}`).join('\n');
    return edit(chatId, msgId, `⏱ *No Time Log — ${esc(teamName)} (${missing.length}):*\n\n${names}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Router
// ─────────────────────────────────────────────────────────────────────────────

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = (msg.text || '').trim();
  const username = msg.from?.username || '';

  if (!text) return;

  try {
    const session = await getSession(chatId);

    // ── Registration Wizard ──────────────────────────────
    if (session?.state === 'registering_search' && !text.startsWith('/')) {
      return handleRegisterSearch(chatId, text);
    }

    if (session?.state === 'registering_email' && !text.startsWith('/')) {
      const email = text.toLowerCase();
      const ctx = session.context || {};

      if (!email.includes('@')) return send(chatId, '❌ Invalid email. Enter your ThinkingCode email:');

      const [u] = await sql`SELECT email, name FROM users WHERE id = ${ctx.user_id}`;
      if (!u || u.email?.toLowerCase() !== email) {
        return send(chatId, `❌ Email doesn't match records for *${esc(u?.name || 'this user')}*. Try again:`);
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      ctx.otp = otp; ctx.email = email;
      await setSession(chatId, 'registering_otp', ctx);

      await sendEmail(email, 'Your Redmine Bot Verification Code', `
        <div style="font-family:sans-serif;max-width:500px;margin:auto;border:1px solid #e5e7eb;padding:24px;border-radius:12px">
          <h2 style="color:#3b82f6;margin-top:0">Redmine Bot Verification</h2>
          <p>Your verification code is:</p>
          <div style="background:#f3f4f6;padding:16px;font-size:32px;font-weight:bold;text-align:center;letter-spacing:8px;border-radius:8px">${otp}</div>
          <p style="color:#6b7280;font-size:14px;margin-top:20px">Enter this code in Telegram to complete registration.</p>
        </div>
      `);
      return send(chatId, `📨 Code sent to *${email}*.\nEnter the 6-digit code:`);
    }

    if (session?.state === 'registering_otp' && !text.startsWith('/')) {
      const ctx = session.context || {};
      if (text === ctx.otp) {
        await sql`UPDATE users SET telegram_chat_id = ${String(chatId)}, telegram_username = ${username || null} WHERE id = ${ctx.user_id}`;
        const [u] = await sql`SELECT name FROM users WHERE id = ${ctx.user_id}`;
        await clearSession(chatId);
        return send(chatId, `✅ Linked! Welcome, *${esc(u.name)}*!\n\nType /help to see commands.`);
      }
      return send(chatId, '❌ Incorrect code. Try again:');
    }

    // ── Leave Wizard continuation ────────────────────────
    if (session && !['idle','registering_search','registering_email','registering_otp'].includes(session.state) && !text.startsWith('/')) {
      const user = await getUserByChatId(chatId);
      if (user) return handleLeaveWizard(chatId, text, session);
    }

    // ── Public Commands ──────────────────────────────────
    if (text.startsWith('/start'))  return handleStart(chatId, username);
    if (text.startsWith('/help'))   return handleHelp(chatId);
    if (text.startsWith('/cancel')) { await clearSession(chatId); return send(chatId, '✅ Cancelled. What can I help you with?'); }
    if (text.startsWith('/clear'))  { await clearSession(chatId); await clearConversation(chatId); return send(chatId, '🧹 Chat cleared. Start fresh!'); }

    if (text.startsWith('/delink')) {
      const user = await getUserByChatId(chatId);
      if (!user) return send(chatId, '👤 You are not currently linked.');
      await setSession(chatId, 'delink_confirm', { user_id: user.id });
      return send(chatId, `❓ Delink your Telegram from *${esc(user.name)}*?`,
        [[{ text: '✅ Yes', callback_data: 'dl:yes' }, { text: '❌ No', callback_data: 'dl:no' }]]);
    }

    // ── Require registration ─────────────────────────────
    const user = await getUserByChatId(chatId);
    if (!user) return send(chatId, '👤 Please register first: /start');

    // ── Commands ─────────────────────────────────────────
    if (text.startsWith('/pulse'))     return handlePulse(chatId);
    if (text.startsWith('/mytickets')) return handleMyTickets(chatId, user);
    if (text.startsWith('/overdue'))   return handleOverdue(chatId);
    if (text.startsWith('/projects'))  return handleProjects(chatId);
    if (text.startsWith('/nolog'))     return handleNoLog(chatId);
    if (text.startsWith('/whoisout'))  return handleWhoisout(chatId);
    if (text.startsWith('/myteam'))    return handleMyTeam(chatId, user);
    if (text.startsWith('/myleave'))   return handleMyLeave(chatId, user);

    if (text.startsWith('/blockers')) {
      const arg = text.replace('/blockers', '').trim();
      return handleBlockers(chatId, arg || null);
    }

    if (text.startsWith('/status')) {
      const arg = text.replace('/status', '').trim();
      return handleStatus(chatId, arg);
    }

    if (text.startsWith('/report')) {
      const arg = text.replace('/report', '').trim();
      return handleReport(chatId, arg);
    }

    if (text.startsWith('/workload')) {
      const arg = text.replace('/workload', '').trim();
      return handleWorkload(chatId, arg || null);
    }

    if (text.startsWith('/leave')) return send(chatId, '🏖 Leave application via bot is currently disabled. Please apply through the dashboard.');

    // ── Admin: /add_user ─────────────────────────────────
    if (text.startsWith('/add_user')) {
      if (user.role !== 'admin' && !user.is_team_lead) return send(chatId, '🚫 Only admins or team leads can add users.');
      const match = text.match(/^\/add_user\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"/);
      if (!match) return send(chatId, '❌ Usage: `/add_user "Name" "Email" "Team"`');
      const [_, name, email, team] = match;
      const initials = name.split(' ').map(n => n[0]).join('').toUpperCase();
      try {
        const [nu] = await sql`INSERT INTO users (name, email, team, initials, active) VALUES (${name}, ${email}, ${team}, ${initials}, true) RETURNING id`;
        return send(chatId, `✅ *${esc(name)}* added (ID: ${nu.id}). They can register via /start.`);
      } catch (e) { return send(chatId, `❌ Error: ${e.message}`); }
    }

    // ── Admin: /approve ──────────────────────────────────
    if (text.startsWith('/approve')) {
      const leaveId = parseInt(text.replace('/approve', '').trim());
      if (isNaN(leaveId)) return send(chatId, '❌ Usage: /approve 42');
      const rows = await sql`
        UPDATE leave_requests SET status = 'approved', reviewed_by = ${user.id}, reviewed_at = NOW()
        WHERE id = ${leaveId} AND status = 'pending'
        RETURNING *, (SELECT telegram_chat_id FROM users WHERE id = leave_requests.user_id) AS applicant_chat,
                     (SELECT name FROM users WHERE id = leave_requests.user_id) AS applicant_name
      `;
      if (rows.length === 0) return send(chatId, `❌ Leave #${leaveId} not found or already processed.`);
      const lr = rows[0];
      await send(chatId, `✅ Leave #${leaveId} for *${esc(lr.applicant_name)}* approved!`);
      if (lr.applicant_chat) {
        await send(lr.applicant_chat, `✅ Your leave *#${leaveId}* has been *approved*!\n\n📅 ${lr.start_date} → ${lr.end_date}\n🏷 ${lr.leave_type}`);
      }
      return;
    }

    // ── AI Chat (non-command text) ─────────────────────
    if (text.startsWith('/')) {
      return send(chatId, 'ℹ️ Unknown command. Type /help to see options.');
    }

    if (!AI_ENABLED) {
      return send(chatId, 'ℹ️ AI chat is not configured. Use /help for available commands.');
    }

    await bot.sendChatAction(chatId, 'typing');
    const history = await getConversation(chatId);
    const { reply, messages: newHistory } = await aiChat(text, user, history);
    await saveConversation(chatId, newHistory);
    return send(chatId, reply || '🤔 I couldn\'t process that. Try rephrasing or use /help.');

  } catch (err) {
    console.error(`[Bot] Error from ${chatId}:`, err.message);
    await send(chatId, '⚠️ Something went wrong. Please try again.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Voice Message Handler
// ─────────────────────────────────────────────────────────────────────────────

bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;

  try {
    const user = await getUserByChatId(chatId);
    if (!user) return send(chatId, '👤 Please register first: /start');

    if (!process.env.GROQ_API_KEY) {
      return send(chatId, '🎤 Voice support requires GROQ_API_KEY. Please use text instead.');
    }

    await bot.sendChatAction(chatId, 'typing');

    // Get voice file URL from Telegram
    const file = await bot.getFile(msg.voice.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    // Transcribe
    const transcript = await transcribeVoice(fileUrl);
    if (!transcript) return send(chatId, '🎤 Couldn\'t understand the audio. Please try again or type your question.');

    // Show what was heard
    await send(chatId, `🎤 _"${esc(transcript)}"_`);
    await bot.sendChatAction(chatId, 'typing');

    if (!AI_ENABLED) {
      return send(chatId, 'ℹ️ AI chat is not configured. Use /help for commands.');
    }

    // Process through AI
    const history = await getConversation(chatId);
    const { reply, messages: newHistory } = await aiChat(transcript, user, history);
    await saveConversation(chatId, newHistory);
    return send(chatId, reply || '🤔 I couldn\'t process that. Try rephrasing.');

  } catch (err) {
    console.error(`[Bot] Voice error from ${chatId}:`, err.message);
    await send(chatId, '⚠️ Voice processing failed. Please type your question instead.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Callback Query Handler
// ─────────────────────────────────────────────────────────────────────────────

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId  = query.message.message_id;
  const data   = query.data;

  await bot.answerCallbackQuery(query.id);

  try {
    // ── Registration ─────────────────────────────────────
    if (data.startsWith('reg:')) {
      const userId = parseInt(data.split(':')[1]);
      await setSession(chatId, 'registering_email', { user_id: userId });
      const [u] = await sql`SELECT name FROM users WHERE id = ${userId}`;
      return edit(chatId, msgId, `👤 Selected: *${esc(u.name)}*\n\nEnter your *ThinkingCode email* to verify:`);
    }

    // ── Delink ───────────────────────────────────────────
    if (data.startsWith('dl:')) {
      if (data === 'dl:yes') {
        const session = await getSession(chatId);
        if (session?.context?.user_id) {
          await sql`UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL WHERE id = ${session.context.user_id}`;
        }
        await clearSession(chatId);
        return edit(chatId, msgId, '✅ Account *delinked*. Register again with /start.');
      }
      await clearSession(chatId);
      return edit(chatId, msgId, '❌ Delink cancelled.');
    }

    // ── Leave type selection ─────────────────────────────
    if (data.startsWith('lt:')) {
      const leaveType = data.substring(3);
      const session = await getSession(chatId);
      const ctx = { ...(session?.context || {}), leave_type: leaveType };
      await setSession(chatId, 'leave_reason', ctx);
      return edit(chatId, msgId, `Step 4/4 — Enter a brief *reason* for your leave:`);
    }

    // ── Leave confirm ────────────────────────────────────
    if (data.startsWith('lc:')) {
      const session = await getSession(chatId);
      const ctx = session?.context || {};

      if (data === 'lc:no') {
        await clearSession(chatId);
        return edit(chatId, msgId, '❌ Leave request cancelled.');
      }

      const user = await getUserByChatId(chatId);
      const [lr] = await sql`
        INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, reason)
        VALUES (${user.id}, ${ctx.leave_type}, ${ctx.start_date}, ${ctx.end_date}, ${ctx.reason || ''})
        RETURNING id
      `;
      await clearSession(chatId);
      await edit(chatId, msgId, `✅ *Leave request #${lr.id} submitted!*\n\nYour manager will be notified.`);

      // Notify managers via Telegram
      const managers = await sql`
        SELECT telegram_chat_id, name FROM users
        WHERE (role = 'manager' OR is_team_lead = true) AND telegram_chat_id IS NOT NULL
      `;
      for (const mgr of managers) {
        await send(mgr.telegram_chat_id,
          `📋 *Leave Request #${lr.id}*\n\n👤 ${esc(user.name)}\n📅 ${ctx.start_date} → ${ctx.end_date}\n🏷 ${ctx.leave_type}\n📝 ${ctx.reason || 'N/A'}\n\nTo approve: /approve ${lr.id}`);
      }

      // Notify managers via Email
      const mgrEmails = await sql`
        SELECT email FROM users WHERE (role = 'manager' OR is_team_lead = true) AND email IS NOT NULL
      `;
      for (const mgr of mgrEmails) {
        await sendEmail(mgr.email, `Leave Request #${lr.id} from ${user.name}`, `
          <div style="font-family:sans-serif;max-width:560px;margin:auto">
            <div style="background:#3b82f6;color:#fff;padding:12px 20px;border-radius:8px 8px 0 0"><h2 style="margin:0">Leave Request #${lr.id}</h2></div>
            <div style="border:1px solid #e5e7eb;padding:20px;border-radius:0 0 8px 8px">
              <p><strong>From:</strong> ${user.name}</p>
              <p><strong>Dates:</strong> ${ctx.start_date} → ${ctx.end_date}</p>
              <p><strong>Type:</strong> ${ctx.leave_type}</p>
              <p><strong>Reason:</strong> ${ctx.reason || 'N/A'}</p>
              <p style="color:#6b7280;font-size:13px">Reply /approve ${lr.id} on Telegram to approve.</p>
            </div>
          </div>
        `);
      }
      return;
    }

    // ── All other drill-down callbacks ───────────────────
    const user = await getUserByChatId(chatId);
    if (user) return handleCallback(chatId, msgId, data, user);

  } catch (err) {
    console.error(`[Bot] Callback error:`, err.message);
    await send(chatId, '⚠️ Something went wrong. Please try again.');
  }
});

bot.on('polling_error', err => console.error('[Bot] Polling error:', err.message));

process.on('SIGINT', () => {
  console.log('\n🛑 Bot stopped.');
  bot.stopPolling();
  process.exit(0);
});
