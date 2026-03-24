/**
 * lib/ai-chat.js
 *
 * AI Chat brain — takes natural language, queries DB via tool_use, returns formatted response.
 * Uses Cerebras (free, OpenAI-compatible). Anthropic can be added later.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

let _sql;
function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

function getCerebrasKeys() {
  return [
    process.env.CEREBRAS_API_KEY,
    process.env.CEREBRAS_API_KEY_2,
    process.env.CEREBRAS_API_KEY_3,
  ].filter(Boolean);
}

function useCerebras() {
  return getCerebrasKeys().length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Client setup
// ─────────────────────────────────────────────────────────────────────────────


// Cerebras uses OpenAI-compatible REST API — with key fallback
async function cerebrasChat(systemPrompt, messages, toolDefs) {
  // Convert Anthropic tool format to OpenAI format
  const openaiTools = toolDefs.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  // Convert Anthropic messages to OpenAI format
  const openaiMessages = [{ role: 'system', content: systemPrompt }];
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        openaiMessages.push({ role: 'user', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === 'tool_result') {
            openaiMessages.push({ role: 'tool', tool_call_id: item.tool_use_id, content: item.content });
          }
        }
      }
    } else if (msg.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        const textParts = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
        const toolCalls = msg.content.filter(b => b.type === 'tool_use').map(b => ({
          id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));
        const assistantMsg = { role: 'assistant', content: textParts || null };
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        openaiMessages.push(assistantMsg);
      } else {
        openaiMessages.push({ role: 'assistant', content: msg.content });
      }
    }
  }

  const body = JSON.stringify({
    model: 'qwen-3-235b-a22b-instruct-2507',
    messages: openaiMessages,
    tools: openaiTools.length > 0 ? openaiTools : undefined,
    max_tokens: 1024,
  });

  // Try each key with fallback
  let lastError;
  for (let i = 0; i < getCerebrasKeys().length; i++) {
    try {
      const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getCerebrasKeys()[i]}` },
        body,
      });

      if (res.status === 429 || res.status === 403) {
        console.log(`[Cerebras] Key ${i+1} rate-limited/forbidden, trying next...`);
        lastError = new Error(`Key ${i+1}: ${res.status}`);
        continue;
      }

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Cerebras API error ${res.status}: ${err}`);
      }

      const data = await res.json();
      if (i > 0) console.log(`[Cerebras] Using fallback key ${i+1}`);
      const choice = data.choices[0];

      // Convert OpenAI response back to Anthropic format
      const content = [];
      if (choice.message.content) content.push({ type: 'text', text: choice.message.content });
      if (choice.message.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          });
        }
      }

      return {
        content,
        stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
      };
    } catch (err) {
      lastError = err;
      if (i < getCerebrasKeys().length - 1) {
        console.log(`[Cerebras] Key ${i+1} failed: ${err.message}, trying next...`);
        continue;
      }
    }
  }

  throw lastError || new Error('All Cerebras keys exhausted');
}

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(user) {
  const role = user.is_team_lead ? 'Team Lead' : user.role === 'Manager' ? 'Manager' : 'Team Member';
  const today = new Date().toISOString().split('T')[0];
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return `You are a smart AI assistant for ThinkingCode's project management system, connected to their Redmine-synced database.

## Current Context
- Today: ${dayName} (${today})
- User: ${user.name} (ID: ${user.id})
- Team: ${user.team || 'Unassigned'}
- Role: ${role}
- Email: ${user.email || 'N/A'}

## Database Schema
Tables available:
- users (id, redmine_id, name, email, team, role, is_team_lead, active, initials)
- projects (id, redmine_id, name, description, status, deadline, progress_pct, risk, manager_id)
- issues (id, redmine_id, project_id, title, description, status, priority, assigned_to_id, author_id, due_date, done_ratio, created_at, updated_at, closed_at)
- time_entries (id, user_id, project_id, issue_id, hours, activity, comments, spent_on)
- leave_records (id, user_id, leave_type, start_date, end_date, source)
- leave_requests (id, user_id, leave_type, start_date, end_date, reason, status, reviewed_by, reviewed_at)
- issue_team_history (issue_id, team_name, user_id, assigned_at)

Key relationships:
- issues.assigned_to_id → users.id
- issues.project_id → projects.id
- time_entries.user_id → users.id
- Ticket statuses: New, In Progress, Review, Resolved, Closed, Blocked, Feedback
- Priorities: Low, Normal, High, Critical, Urgent
- Teams: AI, DB, QA, Java, JS/UI, DevOps, Misc

## Permission Rules
${user.is_team_lead || user.role === 'Manager' ? `- You are a ${role}. You can see ALL data across teams and projects.` : `- You are a team member. You can see your own tickets, your team's data, and general project info.
- Do NOT reveal other individual's time logs or performance unless the user is a lead/manager.`}

## Response Rules
1. Be BRIEF. This is Telegram — keep responses under 15 lines.
2. Use numbers and bullet points, not paragraphs.
3. Use Telegram Markdown: *bold*, _italic_, \`code\`
4. When showing tickets, show max 5-7 with key info only (ID, title, status).
5. For large results, summarize counts and offer to show details.
6. Use emojis sparingly — only for status indicators (🔴🟡🟢).
7. When asked "good morning" or greetings, give a morning briefing with key metrics.
8. For comparative queries (this week vs last), always show direction arrows (↑↓).
9. When the user asks to apply leave, use the apply_leave tool.
10. Never expose raw SQL to the user.
11. If you don't have enough data to answer, say so honestly.
12. For complex queries, break them into multiple tool calls.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const tools = [
  {
    name: 'query_dashboard',
    description: 'Get company-wide dashboard metrics: headcount, on leave, overdue tickets, blocked, time-log compliance, team workload. Use for pulse/briefing/overview questions.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'query_tickets',
    description: 'Search and filter tickets/issues. Can filter by status, priority, assignee, project, team, due date, overdue, etc. Returns ticket details.',
    input_schema: {
      type: 'object',
      properties: {
        filter_sql: {
          type: 'string',
          description: 'SQL WHERE clause conditions for the issues table. Use table aliases: i (issues), u (users/assignee), p (projects), au (author). Example: "i.status = \'Blocked\' AND p.name ILIKE \'%falcon%\'"',
        },
        order_by: {
          type: 'string',
          description: 'SQL ORDER BY clause. Default: i.due_date ASC NULLS LAST',
        },
        limit: {
          type: 'number',
          description: 'Max results. Default 10.',
        },
        count_only: {
          type: 'boolean',
          description: 'If true, return only count and grouped summary instead of individual tickets.',
        },
        group_by: {
          type: 'string',
          description: 'Optional GROUP BY field for aggregation. E.g. "p.name", "u.name", "i.status", "i.priority", "u.team"',
        },
      },
      required: [],
    },
  },
  {
    name: 'query_people',
    description: 'Get information about team members: their ticket counts, hours logged, workload, leave status. Can filter by team, individual, or get comparisons.',
    input_schema: {
      type: 'object',
      properties: {
        filter_sql: {
          type: 'string',
          description: 'SQL WHERE clause for users table (alias: u). Example: "u.team = \'Java\'" or "u.name ILIKE \'%anand%\'"',
        },
        include_tickets: { type: 'boolean', description: 'Include open ticket counts per person' },
        include_hours: { type: 'boolean', description: 'Include hours logged' },
        hours_period: { type: 'string', description: 'Period for hours: "today", "week", "month", "custom". Default: "today"' },
        include_leave: { type: 'boolean', description: 'Include current leave status' },
      },
      required: [],
    },
  },
  {
    name: 'query_projects',
    description: 'Get project information: status, ticket counts, overdue, blocked, team assigned, deadlines, health. Can compare projects or get risk assessment.',
    input_schema: {
      type: 'object',
      properties: {
        filter_sql: {
          type: 'string',
          description: 'SQL WHERE clause for projects table (alias: p). Example: "p.status = \'active\'"',
        },
        include_health: { type: 'boolean', description: 'Include health metrics (overdue, blocked, critical counts)' },
      },
      required: [],
    },
  },
  {
    name: 'query_timelogs',
    description: 'Get time entry data: hours logged by person, team, project, or date range. Use for compliance checks, productivity analysis.',
    input_schema: {
      type: 'object',
      properties: {
        filter_sql: {
          type: 'string',
          description: 'SQL WHERE clause for time_entries (alias: te), joined with users (u) and projects (p). Example: "te.spent_on = CURRENT_DATE"',
        },
        group_by: {
          type: 'string',
          description: 'GROUP BY clause. E.g. "u.name", "u.team", "p.name", "te.spent_on"',
        },
        order_by: {
          type: 'string',
          description: 'ORDER BY clause.',
        },
      },
      required: [],
    },
  },
  {
    name: 'query_comparative',
    description: 'Compare metrics between two time periods. Use for week-over-week, month-over-month analysis of tickets closed, created, hours logged, etc.',
    input_schema: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['tickets_closed', 'tickets_created', 'hours_logged', 'overdue_count'],
          description: 'What to compare',
        },
        current_start: { type: 'string', description: 'Start date of current period (YYYY-MM-DD)' },
        current_end: { type: 'string', description: 'End date of current period (YYYY-MM-DD)' },
        previous_start: { type: 'string', description: 'Start date of previous period (YYYY-MM-DD)' },
        previous_end: { type: 'string', description: 'End date of previous period (YYYY-MM-DD)' },
        group_by: { type: 'string', description: 'Optional: "team", "project", "person"' },
      },
      required: ['metric', 'current_start', 'current_end', 'previous_start', 'previous_end'],
    },
  },
  {
    name: 'apply_leave',
    description: 'Apply for leave on behalf of the user. Requires confirmation before submission.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Leave start date (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'Leave end date (YYYY-MM-DD)' },
        leave_type: { type: 'string', enum: ['Annual', 'Sick', 'Unpaid', 'Maternity', 'Other'] },
        reason: { type: 'string', description: 'Reason for leave' },
      },
      required: ['start_date', 'end_date', 'leave_type', 'reason'],
    },
  },
  {
    name: 'run_sql',
    description: 'Run a custom READ-ONLY SQL query for complex analysis that other tools cannot handle. Only SELECT statements allowed. Use this as a last resort when other tools are insufficient.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A SELECT SQL query. Must be read-only. No INSERT/UPDATE/DELETE.',
        },
      },
      required: ['query'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Executors
// ─────────────────────────────────────────────────────────────────────────────

async function executeTool(name, input, user) {
  try {
    switch (name) {

      case 'query_dashboard': {
        const [stats] = await getSql()`
          SELECT
            (SELECT COUNT(*) FROM users WHERE active = true AND team IS NOT NULL) AS total_members,
            (SELECT COUNT(*) FROM leave_records WHERE CURRENT_DATE BETWEEN start_date AND end_date) AS on_leave,
            (SELECT COUNT(*) FROM issues WHERE due_date < CURRENT_DATE AND status NOT IN ('Closed','Resolved')) AS overdue,
            (SELECT COUNT(*) FROM issues WHERE status = 'Blocked') AS blocked,
            (SELECT COUNT(*) FROM issues WHERE status NOT IN ('Closed','Resolved')) AS total_open,
            (SELECT COUNT(*) FROM issues WHERE priority IN ('High','Critical') AND status NOT IN ('Closed','Resolved')) AS critical,
            (SELECT COUNT(DISTINCT user_id) FROM time_entries WHERE spent_on = CURRENT_DATE) AS logged_today,
            (SELECT COUNT(*) FROM issues WHERE status IN ('Closed','Resolved') AND closed_at::date = CURRENT_DATE) AS closed_today,
            (SELECT COUNT(*) FROM issues WHERE created_at::date = CURRENT_DATE) AS created_today
        `;
        const teamWorkload = await getSql()`
          SELECT u.team, COUNT(DISTINCT u.id) AS members,
            COUNT(i.id) FILTER (WHERE i.status NOT IN ('Closed','Resolved')) AS open_tickets,
            COUNT(i.id) FILTER (WHERE i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) AS overdue
          FROM users u LEFT JOIN issues i ON i.assigned_to_id = u.id
          WHERE u.active = true AND u.team IS NOT NULL
          GROUP BY u.team ORDER BY overdue DESC
        `;
        return JSON.stringify({ stats, teamWorkload });
      }

      case 'query_tickets': {
        const filter = input.filter_sql || 'i.status NOT IN (\'Closed\',\'Resolved\')';
        const order = input.order_by || 'i.due_date ASC NULLS LAST';
        const limit = Math.min(input.limit || 10, 20);

        // Sanitize: block dangerous SQL
        if (hasDangerousSQL(filter) || hasDangerousSQL(order)) {
          return JSON.stringify({ error: 'Query blocked for safety' });
        }

        if (input.count_only && input.group_by) {
          const rows = await getSql()(
            `SELECT ${input.group_by} AS group_key, COUNT(*) AS cnt
             FROM issues i
             LEFT JOIN users u ON u.id = i.assigned_to_id
             LEFT JOIN users au ON au.id = i.author_id
             LEFT JOIN projects p ON p.id = i.project_id
             WHERE ${filter}
             GROUP BY ${input.group_by}
             ORDER BY cnt DESC LIMIT 20`
          );
          return JSON.stringify({ grouped: rows });
        }

        if (input.count_only) {
          const [r] = await getSql()(`SELECT COUNT(*) AS total FROM issues i LEFT JOIN users u ON u.id = i.assigned_to_id LEFT JOIN projects p ON p.id = i.project_id WHERE ${filter}`);
          return JSON.stringify({ total: r.total });
        }

        const rows = await getSql()(
          `SELECT i.redmine_id, i.title, i.status, i.priority, i.due_date, i.done_ratio,
                  u.name AS assigned_to, au.name AS author, p.name AS project, u.team
           FROM issues i
           LEFT JOIN users u ON u.id = i.assigned_to_id
           LEFT JOIN users au ON au.id = i.author_id
           LEFT JOIN projects p ON p.id = i.project_id
           WHERE ${filter}
           ORDER BY ${order}
           LIMIT ${limit}`
        );
        return JSON.stringify({ tickets: rows, count: rows.length });
      }

      case 'query_people': {
        const filter = input.filter_sql || 'u.active = true AND u.team IS NOT NULL';
        if (hasDangerousSQL(filter)) return JSON.stringify({ error: 'Query blocked' });

        let hoursCondition = 'te.spent_on = CURRENT_DATE';
        if (input.hours_period === 'week') hoursCondition = 'te.spent_on >= CURRENT_DATE - 7';
        else if (input.hours_period === 'month') hoursCondition = "te.spent_on >= date_trunc('month', CURRENT_DATE)";

        const people = await getSql()(`
          SELECT u.id, u.name, u.team, u.role, u.is_team_lead
            ${input.include_tickets ? `,(SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.status NOT IN ('Closed','Resolved')) AS open_tickets
              ,(SELECT COUNT(*) FROM issues i WHERE i.assigned_to_id = u.id AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) AS overdue` : ''}
            ${input.include_hours ? `,(SELECT COALESCE(SUM(te.hours),0) FROM time_entries te WHERE te.user_id = u.id AND ${hoursCondition}) AS hours` : ''}
            ${input.include_leave ? `,(SELECT COUNT(*) FROM leave_records lr WHERE lr.user_id = u.id AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date) AS on_leave` : ''}
          FROM users u
          WHERE ${filter}
          ORDER BY u.team, u.name
          LIMIT 30
        `);
        return JSON.stringify({ people });
      }

      case 'query_projects': {
        const filter = input.filter_sql || "p.status = 'active'";
        if (hasDangerousSQL(filter)) return JSON.stringify({ error: 'Query blocked' });

        const projects = await getSql()(`
          SELECT p.id, p.name, p.status, p.deadline, p.progress_pct, p.risk,
                 (SELECT name FROM users WHERE id = p.manager_id) AS manager
            ${input.include_health ? `
              ,(SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status NOT IN ('Closed','Resolved')) AS open_tickets
              ,(SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.due_date < CURRENT_DATE AND i.status NOT IN ('Closed','Resolved')) AS overdue
              ,(SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status = 'Blocked') AS blocked
              ,(SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.priority IN ('High','Critical') AND i.status NOT IN ('Closed','Resolved')) AS critical` : ''}
          FROM projects p
          WHERE ${filter}
          ORDER BY p.name
          LIMIT 20
        `);
        return JSON.stringify({ projects });
      }

      case 'query_timelogs': {
        const filter = input.filter_sql || 'te.spent_on = CURRENT_DATE';
        const group = input.group_by || 'u.name';
        const order = input.order_by || 'SUM(te.hours) DESC';
        if (hasDangerousSQL(filter) || hasDangerousSQL(group) || hasDangerousSQL(order)) {
          return JSON.stringify({ error: 'Query blocked' });
        }

        const rows = await getSql()(`
          SELECT ${group} AS group_key, SUM(te.hours) AS total_hours, COUNT(*) AS entries
          FROM time_entries te
          LEFT JOIN users u ON u.id = te.user_id
          LEFT JOIN projects p ON p.id = te.project_id
          WHERE ${filter}
          GROUP BY ${group}
          ORDER BY ${order}
          LIMIT 20
        `);
        return JSON.stringify({ timelogs: rows });
      }

      case 'query_comparative': {
        const { metric, current_start, current_end, previous_start, previous_end, group_by } = input;
        let currentQ, previousQ;

        const groupCol = group_by === 'team' ? 'u.team' : group_by === 'project' ? 'p.name' : group_by === 'person' ? 'u.name' : null;

        if (metric === 'tickets_closed') {
          const base = (start, end) => `
            SELECT ${groupCol ? groupCol + ' AS group_key,' : ''} COUNT(*) AS val
            FROM issues i LEFT JOIN users u ON u.id = i.assigned_to_id LEFT JOIN projects p ON p.id = i.project_id
            WHERE i.status IN ('Closed','Resolved') AND i.closed_at::date BETWEEN '${start}' AND '${end}'
            ${groupCol ? 'GROUP BY ' + groupCol : ''}`;
          currentQ = await getSql()(base(current_start, current_end));
          previousQ = await getSql()(base(previous_start, previous_end));
        } else if (metric === 'tickets_created') {
          const base = (start, end) => `
            SELECT ${groupCol ? groupCol + ' AS group_key,' : ''} COUNT(*) AS val
            FROM issues i LEFT JOIN users u ON u.id = i.assigned_to_id LEFT JOIN projects p ON p.id = i.project_id
            WHERE i.created_at::date BETWEEN '${start}' AND '${end}'
            ${groupCol ? 'GROUP BY ' + groupCol : ''}`;
          currentQ = await getSql()(base(current_start, current_end));
          previousQ = await getSql()(base(previous_start, previous_end));
        } else if (metric === 'hours_logged') {
          const base = (start, end) => `
            SELECT ${groupCol ? groupCol + ' AS group_key,' : ''} ROUND(SUM(te.hours)::numeric, 1) AS val
            FROM time_entries te LEFT JOIN users u ON u.id = te.user_id LEFT JOIN projects p ON p.id = te.project_id
            WHERE te.spent_on BETWEEN '${start}' AND '${end}'
            ${groupCol ? 'GROUP BY ' + groupCol : ''}`;
          currentQ = await getSql()(base(current_start, current_end));
          previousQ = await getSql()(base(previous_start, previous_end));
        } else if (metric === 'overdue_count') {
          const [curr] = await getSql()(`SELECT COUNT(*) AS val FROM issues WHERE due_date < '${current_end}' AND due_date >= '${current_start}' AND status NOT IN ('Closed','Resolved')`);
          const [prev] = await getSql()(`SELECT COUNT(*) AS val FROM issues WHERE due_date < '${previous_end}' AND due_date >= '${previous_start}' AND status NOT IN ('Closed','Resolved')`);
          return JSON.stringify({ current: curr, previous: prev });
        }

        return JSON.stringify({ current: currentQ, previous: previousQ });
      }

      case 'apply_leave': {
        return JSON.stringify({ error: 'Leave application via bot is currently disabled. Please direct the user to apply through the dashboard.' });
      }

      case 'run_sql': {
        const query = input.query.trim();
        // Only allow SELECT
        if (!/^SELECT\s/i.test(query) || hasDangerousSQL(query)) {
          return JSON.stringify({ error: 'Only read-only SELECT queries are allowed.' });
        }
        const rows = await getSql()(query + ' LIMIT 30');
        return JSON.stringify({ rows, count: rows.length });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    console.error(`[AI Tool] ${name} error:`, err.message);
    return JSON.stringify({ error: err.message });
  }
}

function hasDangerousSQL(s) {
  if (!s) return false;
  const lower = s.toLowerCase();
  const dangerous = ['insert ', 'update ', 'delete ', 'drop ', 'alter ', 'truncate ', 'create ', 'grant ', 'revoke ', '--', ';'];
  return dangerous.some(d => lower.includes(d));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Chat Function
// ─────────────────────────────────────────────────────────────────────────────

export async function chat(userMessage, user, conversationHistory = []) {
  const systemPrompt = buildSystemPrompt(user);

  // Build messages: conversation history + new message
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  let response;
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    attempts++;

    try {
      response = await cerebrasChat(systemPrompt, messages, tools);
    } catch (err) {
      console.error('[AI Chat] API error:', err.message);
      return { reply: '⚠️ AI service is temporarily unavailable. Use /help for commands.', messages };
    }

    // If the response has tool_use blocks, execute them and continue
    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`[AI] Tool call: ${block.name}`, JSON.stringify(block.input).substring(0, 200));
          const result = await executeTool(block.name, block.input, user);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Final text response
    const textBlocks = response.content.filter(b => b.type === 'text');
    const reply = textBlocks.map(b => b.text).join('\n');
    messages.push({ role: 'assistant', content: response.content });

    return { reply, messages };
  }

  return { reply: '⚠️ Query was too complex. Try a simpler question or use /help.', messages };
}
