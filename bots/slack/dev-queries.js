/**
 * bots/slack/dev-queries.js
 * Two-way developer query handler.
 * Developers DM the bot and ask about their own data:
 *   - "my tickets" / "active tickets"
 *   - "overdue" / "my overdue tickets"
 *   - "hours today" / "hours this week"
 *   - "my blockers" / "blocked tickets"
 *   - "status" / "summary" (all-in-one)
 *   - "my leave" / "leave"
 *   - "help"
 */

const { getDb } = require('../../lib/db');
const { resolveSlackUser } = require('./index');

// ── Intent detection via keyword matching ──────────────────────
const INTENTS = [
  {
    name: 'overdue',
    patterns: [/overdue/i, /past\s*due/i, /late\s*tickets?/i, /missed\s*deadline/i],
  },
  {
    name: 'tickets',
    patterns: [/my\s*tickets?/i, /active\s*tickets?/i, /open\s*tickets?/i, /assigned\s*to\s*me/i, /my\s*tasks?/i],
  },
  {
    name: 'hours_today',
    patterns: [/hours?\s*today/i, /time\s*today/i, /logged\s*today/i, /today.?s?\s*hours?/i, /today.?s?\s*time/i],
  },
  {
    name: 'hours_week',
    patterns: [/hours?\s*this\s*week/i, /weekly\s*hours?/i, /time\s*this\s*week/i, /week.?s?\s*hours?/i],
  },
  {
    name: 'blockers',
    patterns: [/my\s*blockers?/i, /blocked/i, /blocking/i, /stuck/i],
  },
  {
    name: 'leave',
    patterns: [/my\s*leave/i, /leave\s*balance/i, /upcoming\s*leave/i, /leave\s*status/i, /time\s*off/i],
  },
  {
    name: 'status',
    patterns: [/^status$/i, /^summary$/i, /^dashboard$/i, /my\s*status/i, /my\s*summary/i, /how\s*am\s*i/i],
  },
  {
    name: 'help',
    patterns: [/^help$/i, /^commands$/i, /what\s*can\s*you/i, /^hi$/i, /^hello$/i, /^hey$/i],
  },
];

/**
 * Parse intent from a user message.
 * @param {string} text
 * @returns {string} intent name or 'unknown'
 */
function parseIntent(text) {
  const cleaned = text.trim();
  for (const intent of INTENTS) {
    for (const pattern of intent.patterns) {
      if (pattern.test(cleaned)) return intent.name;
    }
  }
  return 'unknown';
}

/**
 * Handle an incoming developer DM.
 * @param {object} message - Slack message event
 * @param {Function} say - Bolt say() function
 * @param {object} client - Slack WebClient
 */
async function handleDevMessage(message, say, client) {
  const slackUserId = message.user;
  const text = message.text || '';

  // Resolve the Slack user to a dashboard + Redmine identity
  const resolved = await resolveSlackUser(slackUserId);

  if (!resolved) {
    await say({
      text: ':no_entry_sign: You are not registered in the Company OS dashboard.\nPlease contact your admin to link your Slack account.',
    });
    return;
  }

  const intent = parseIntent(text);

  switch (intent) {
    case 'overdue':
      return await handleOverdue(resolved, say);
    case 'tickets':
      return await handleActiveTickets(resolved, say);
    case 'hours_today':
      return await handleHours(resolved, say, 'today');
    case 'hours_week':
      return await handleHours(resolved, say, 'week');
    case 'blockers':
      return await handleBlockers(resolved, say);
    case 'leave':
      return await handleLeave(resolved, say);
    case 'status':
      return await handleFullStatus(resolved, say);
    case 'help':
      return await handleHelp(resolved, say);
    default:
      return await handleHelp(resolved, say);
  }
}

// ── Query handlers ─────────────────────────────────────────────

async function handleOverdue(user, say) {
  const sql = getDb();

  if (!user.redmineUserId) {
    await say(':warning: Your account is not linked to a Redmine user. Contact your admin.');
    return;
  }

  const tickets = await sql`
    SELECT
      i.id, i.redmine_id, i.title, i.status, i.priority, i.due_date,
      EXTRACT(DAY FROM NOW() - i.due_date::timestamptz)::int AS days_overdue
    FROM issues i
    WHERE i.assigned_to_id = ${user.redmineUserId}
      AND i.due_date IS NOT NULL
      AND i.due_date < CURRENT_DATE
      AND i.status NOT IN ('Closed', 'Resolved')
    ORDER BY i.due_date ASC
  `;

  if (tickets.length === 0) {
    await say(':white_check_mark: No overdue tickets! You\'re all caught up.');
    return;
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `You have ${tickets.length} overdue ticket(s)`, emoji: true },
    },
    { type: 'divider' },
  ];

  for (const t of tickets.slice(0, 10)) {
    const ticketId = t.redmine_id ? `TK-${t.redmine_id}` : `#${t.id}`;
    const dueStr = new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:rotating_light: *${ticketId}* — ${t.title}\nDue: ${dueStr} (*${t.days_overdue}d overdue*)  |  Status: ${t.status}  |  Priority: ${t.priority}`,
      },
    });
  }

  if (tickets.length > 10) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_...and ${tickets.length - 10} more_` }],
    });
  }

  await say({ text: `You have ${tickets.length} overdue ticket(s).`, blocks });
}

async function handleActiveTickets(user, say) {
  const sql = getDb();

  if (!user.redmineUserId) {
    await say(':warning: Your account is not linked to a Redmine user. Contact your admin.');
    return;
  }

  const tickets = await sql`
    SELECT
      i.id, i.redmine_id, i.title, i.status, i.priority, i.due_date,
      (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE) AS overdue
    FROM issues i
    WHERE i.assigned_to_id = ${user.redmineUserId}
      AND i.status NOT IN ('Closed', 'Resolved')
    ORDER BY
      (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE) DESC,
      i.due_date ASC NULLS LAST
  `;

  if (tickets.length === 0) {
    await say(':white_check_mark: No active tickets assigned to you.');
    return;
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Your ${tickets.length} active ticket(s)`, emoji: true },
    },
    { type: 'divider' },
  ];

  for (const t of tickets.slice(0, 10)) {
    const ticketId = t.redmine_id ? `TK-${t.redmine_id}` : `#${t.id}`;
    const dueText = t.due_date
      ? new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'No due date';
    const overdueTag = t.overdue ? '  :rotating_light: OVERDUE' : '';

    const statusIcon = {
      'New': ':new:',
      'In Progress': ':arrows_counterclockwise:',
      'Blocked': ':no_entry:',
      'Feedback': ':speech_balloon:',
    }[t.status] || ':grey_question:';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${statusIcon} *${ticketId}* — ${t.title}\n:calendar: ${dueText}${overdueTag}  |  Priority: ${t.priority}`,
      },
    });
  }

  if (tickets.length > 10) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_...and ${tickets.length - 10} more_` }],
    });
  }

  await say({ text: `You have ${tickets.length} active ticket(s).`, blocks });
}

async function handleHours(user, say, period) {
  const sql = getDb();

  if (!user.redmineUserId) {
    await say(':warning: Your account is not linked to a Redmine user. Contact your admin.');
    return;
  }

  let rows;
  let periodLabel;

  if (period === 'today') {
    periodLabel = 'today';
    rows = await sql`
      SELECT
        COALESCE(SUM(te.hours), 0) AS total_hours,
        COUNT(*) AS entry_count
      FROM time_entries te
      WHERE te.user_id = ${user.redmineUserId}
        AND te.spent_on = CURRENT_DATE
    `;
  } else {
    periodLabel = 'this week';
    rows = await sql`
      SELECT
        COALESCE(SUM(te.hours), 0) AS total_hours,
        COUNT(DISTINCT te.spent_on) AS days_logged,
        COUNT(*) AS entry_count
      FROM time_entries te
      WHERE te.user_id = ${user.redmineUserId}
        AND te.spent_on >= date_trunc('week', CURRENT_DATE)
    `;
  }

  const data = rows[0] || {};
  const totalHours = Math.round(parseFloat(data.total_hours || 0) * 10) / 10;
  const entryCount = parseInt(data.entry_count || 0);

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:clock1: *Time logged ${periodLabel}*`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Total Hours:*\n${totalHours}h` },
        { type: 'mrkdwn', text: `*Entries:*\n${entryCount}` },
      ],
    },
  ];

  if (period === 'week' && data.days_logged !== undefined) {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
    const workdaysSoFar = Math.min(dayOfWeek === 0 ? 5 : dayOfWeek, 5);
    const daysLogged = parseInt(data.days_logged || 0);

    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Days Logged:*\n${daysLogged} / ${workdaysSoFar} workdays` },
        { type: 'mrkdwn', text: `*Avg/Day:*\n${daysLogged > 0 ? (totalHours / daysLogged).toFixed(1) : 0}h` },
      ],
    });
  }

  if (totalHours === 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: ':warning: _No time logged yet. Remember to update your time entries!_' }],
    });
  }

  await say({ text: `You've logged ${totalHours}h ${periodLabel}.`, blocks });
}

async function handleBlockers(user, say) {
  const sql = getDb();

  if (!user.redmineUserId) {
    await say(':warning: Your account is not linked to a Redmine user. Contact your admin.');
    return;
  }

  const blocked = await sql`
    SELECT
      i.id, i.redmine_id, i.title, i.due_date, i.updated_at,
      EXTRACT(HOUR FROM NOW() - i.updated_at)::int AS hours_blocked
    FROM issues i
    WHERE i.assigned_to_id = ${user.redmineUserId}
      AND i.status = 'Blocked'
    ORDER BY i.updated_at ASC
  `;

  if (blocked.length === 0) {
    await say(':white_check_mark: No blocked tickets. All clear!');
    return;
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${blocked.length} blocked ticket(s)`, emoji: true },
    },
    { type: 'divider' },
  ];

  for (const t of blocked) {
    const ticketId = t.redmine_id ? `TK-${t.redmine_id}` : `#${t.id}`;
    const hoursBlocked = t.hours_blocked || 0;
    const urgency = hoursBlocked > 24 ? ':rotating_light:' : ':warning:';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${urgency} *${ticketId}* — ${t.title}\nBlocked for *${hoursBlocked}h*`,
      },
    });
  }

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

  await say({ text: `You have ${blocked.length} blocked ticket(s).`, blocks });
}

async function handleLeave(user, say) {
  const sql = getDb();

  if (!user.redmineUserId) {
    await say(':warning: Your account is not linked to a Redmine user. Contact your admin.');
    return;
  }

  const leaveRecords = await sql`
    SELECT
      lr.leave_type,
      lr.start_date,
      lr.end_date,
      CASE
        WHEN CURRENT_DATE BETWEEN lr.start_date AND lr.end_date THEN 'current'
        WHEN lr.start_date > CURRENT_DATE THEN 'upcoming'
        ELSE 'past'
      END AS timeframe
    FROM leave_records lr
    WHERE lr.user_id = ${user.redmineUserId}
      AND lr.end_date >= CURRENT_DATE
    ORDER BY lr.start_date ASC
  `;

  if (leaveRecords.length === 0) {
    await say(':calendar: No current or upcoming leave on record.');
    return;
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Your Leave Schedule', emoji: true },
    },
    { type: 'divider' },
  ];

  for (const lr of leaveRecords) {
    const startStr = new Date(lr.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = new Date(lr.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const icon = lr.timeframe === 'current' ? ':palm_tree:' : ':calendar:';
    const tag = lr.timeframe === 'current' ? ' _(currently on leave)_' : '';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${icon} *${lr.leave_type || 'Leave'}* — ${startStr} to ${endStr}${tag}`,
      },
    });
  }

  await say({ text: `You have ${leaveRecords.length} leave record(s).`, blocks });
}

async function handleFullStatus(user, say) {
  const sql = getDb();

  if (!user.redmineUserId) {
    await say(':warning: Your account is not linked to a Redmine user. Contact your admin.');
    return;
  }

  // Run all queries in parallel
  const [activeResult, overdueResult, blockedResult, hoursToday, hoursWeek, leaveResult] = await Promise.all([
    sql`
      SELECT COUNT(*) AS count FROM issues
      WHERE assigned_to_id = ${user.redmineUserId}
        AND status NOT IN ('Closed', 'Resolved')
    `,
    sql`
      SELECT COUNT(*) AS count FROM issues
      WHERE assigned_to_id = ${user.redmineUserId}
        AND due_date IS NOT NULL AND due_date < CURRENT_DATE
        AND status NOT IN ('Closed', 'Resolved')
    `,
    sql`
      SELECT COUNT(*) AS count FROM issues
      WHERE assigned_to_id = ${user.redmineUserId}
        AND status = 'Blocked'
    `,
    sql`
      SELECT COALESCE(SUM(hours), 0) AS total FROM time_entries
      WHERE user_id = ${user.redmineUserId} AND spent_on = CURRENT_DATE
    `,
    sql`
      SELECT COALESCE(SUM(hours), 0) AS total FROM time_entries
      WHERE user_id = ${user.redmineUserId} AND spent_on >= date_trunc('week', CURRENT_DATE)
    `,
    sql`
      SELECT COUNT(*) AS count FROM leave_records
      WHERE user_id = ${user.redmineUserId}
        AND CURRENT_DATE BETWEEN start_date AND end_date
    `,
  ]);

  const active = parseInt(activeResult[0]?.count || 0);
  const overdue = parseInt(overdueResult[0]?.count || 0);
  const blocked = parseInt(blockedResult[0]?.count || 0);
  const todayH = Math.round(parseFloat(hoursToday[0]?.total || 0) * 10) / 10;
  const weekH = Math.round(parseFloat(hoursWeek[0]?.total || 0) * 10) / 10;
  const onLeave = parseInt(leaveResult[0]?.count || 0);

  const overdueEmoji = overdue > 0 ? ':red_circle:' : ':white_check_mark:';
  const blockedEmoji = blocked > 0 ? ':no_entry:' : ':white_check_mark:';
  const hoursEmoji = todayH > 0 ? ':white_check_mark:' : ':warning:';
  const leaveEmoji = onLeave > 0 ? ':palm_tree:' : ':office:';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${user.displayName}'s Status Dashboard`, emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Active Tickets:*\n:ticket: ${active}` },
        { type: 'mrkdwn', text: `*Overdue:*\n${overdueEmoji} ${overdue}` },
        { type: 'mrkdwn', text: `*Blocked:*\n${blockedEmoji} ${blocked}` },
        { type: 'mrkdwn', text: `*Status:*\n${leaveEmoji} ${onLeave > 0 ? 'On Leave' : 'Working'}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Hours Today:*\n${hoursEmoji} ${todayH}h` },
        { type: 'mrkdwn', text: `*Hours This Week:*\n:clock1: ${weekH}h` },
      ],
    },
  ];

  if (overdue > 0 || blocked > 0) {
    blocks.push({ type: 'divider' });
    const alerts = [];
    if (overdue > 0) alerts.push(`:rotating_light: ${overdue} ticket(s) are overdue — type *"overdue"* for details`);
    if (blocked > 0) alerts.push(`:no_entry: ${blocked} ticket(s) are blocked — type *"blockers"* for details`);
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: alerts.join('\n') }],
    });
  }

  await say({
    text: `Status: ${active} active, ${overdue} overdue, ${todayH}h logged today.`,
    blocks,
  });
}

async function handleHelp(user, say) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Company OS Slack Bot', emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Hey ${user.displayName}! Here's what you can ask me:`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          ':ticket: *"my tickets"* — Show your active tickets',
          ':rotating_light: *"overdue"* — Show your overdue tickets',
          ':no_entry: *"blockers"* — Show your blocked tickets',
          ':clock1: *"hours today"* — Time logged today',
          ':clock3: *"hours this week"* — Time logged this week',
          ':palm_tree: *"my leave"* — Your leave schedule',
          ':bar_chart: *"status"* — Full summary dashboard',
        ].join('\n'),
      },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '_Just type any of these phrases and I\'ll pull your data instantly._' },
      ],
    },
  ];

  await say({ text: 'Here are the commands you can use.', blocks });
}

module.exports = { handleDevMessage, parseIntent };
