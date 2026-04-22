/**
 * lib/gpt-tools.js
 * Shared OpenAI-format tool definitions used by both Telegram bot and Dashboard Intelligence tab.
 */

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_tickets',
      description: 'Get tickets with filters. Returns a list of tickets matching the criteria.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['open', 'in_progress', 'blocked', 'review', 'closed', 'overdue', 'all'],
            description: 'Filter by ticket status. "overdue" returns tickets past their due date.',
          },
          priority: {
            type: 'string',
            description: 'Filter by priority (e.g. High, Normal, Low, Urgent, Immediate)',
          },
          assignee_name: {
            type: 'string',
            description: 'Filter by assignee name (partial match supported)',
          },
          project_name: {
            type: 'string',
            description: 'Filter by project name (partial match supported)',
          },
          due_within_days: {
            type: 'integer',
            description: 'Return tickets due within this many days from today',
          },
          created_today: {
            type: 'boolean',
            description: 'If true, return only tickets created today',
          },
          created_since: {
            type: 'string',
            description: 'Return tickets created since this date. Use ISO date (YYYY-MM-DD) or relative values: "this_week", "this_month", "this_quarter"',
          },
          keyword: {
            type: 'string',
            description: 'Search tickets by keyword in title or description (partial match)',
          },
          my_tickets: {
            type: 'boolean',
            description: 'If true, return only tickets assigned to the current user (uses their linked Redmine account)',
          },
          unassigned: {
            type: 'boolean',
            description: 'If true, return only tickets with no assignee',
          },
          reporter_name: {
            type: 'string',
            description: 'Filter tickets by the person who created/reported them (partial name match)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_time_logs',
      description: 'Get time logging data for a period. Shows who logged hours, total hours, and optionally who is missing time entries.',
      parameters: {
        type: 'object',
        properties: {
          range: {
            type: 'string',
            enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
            description: 'Time range to query (default: daily)',
          },
          missing_only: {
            type: 'boolean',
            description: 'If true, return only users who have NOT logged time in the period',
          },
          team: {
            type: 'string',
            description: 'Filter by team name',
          },
          person_name: {
            type: 'string',
            description: 'Filter by a specific person name (partial match)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_person_summary',
      description: 'Get a comprehensive summary of a person including their open tickets, hours logged, current workload, leave status, and performance score.',
      parameters: {
        type: 'object',
        properties: {
          person_name: {
            type: 'string',
            description: 'Name of the person to look up (partial match supported)',
          },
        },
        required: ['person_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_status',
      description: 'Get the status of a project including deadline, completion percentage, risk level, open tickets, and blockers.',
      parameters: {
        type: 'object',
        properties: {
          project_name: {
            type: 'string',
            description: 'Project name to look up (partial match supported). Omit to get all active projects.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team_leave',
      description: 'Get leave/absence information for team members.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'this_week', 'upcoming'],
            description: 'Time period to check (default: today). "upcoming" shows next 14 days.',
          },
          team: {
            type: 'string',
            description: 'Filter by team name',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_capacity_status',
      description: 'Get workload and capacity information for team members. Shows who is overloaded and who has bandwidth.',
      parameters: {
        type: 'object',
        properties: {
          team: {
            type: 'string',
            description: 'Filter by team name',
          },
          available_only: {
            type: 'boolean',
            description: 'If true, return only members with more than 30% available capacity',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_performance_report',
      description: 'Get performance scores and trends for a person or team.',
      parameters: {
        type: 'object',
        properties: {
          person_name: {
            type: 'string',
            description: 'Specific person to get performance for (partial match)',
          },
          team: {
            type: 'string',
            description: 'Filter by team name',
          },
          period: {
            type: 'string',
            enum: ['latest', 'monthly', 'quarterly'],
            description: 'Period for the report (default: latest)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team_health',
      description: 'Get team health scores and trends. Shows overall team wellness metrics.',
      parameters: {
        type: 'object',
        properties: {
          team: {
            type: 'string',
            description: 'Specific team to check. Omit for all teams.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: 'Search the knowledge base for project documentation, Q&A, and past decisions using semantic search.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query in natural language',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_exploration',
      description: 'Create a new conceptual project exploration (idea / initiative). This is for brainstorming and tracking new ideas.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name/title of the exploration',
          },
          description: {
            type: 'string',
            description: 'Detailed description of the idea',
          },
          vision: {
            type: 'string',
            description: 'The vision or end goal',
          },
        },
        required: ['name', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_one_on_one',
      description: 'Generate structured 1-on-1 meeting talking points for a specific person based on their current data (tickets, hours, blockers, performance).',
      parameters: {
        type: 'object',
        properties: {
          person_name: {
            type: 'string',
            description: 'Name of the person to prepare the 1-on-1 for',
          },
        },
        required: ['person_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_velocity_prediction',
      description: 'Predict whether a project is likely to miss its deadline based on current ticket velocity and remaining work.',
      parameters: {
        type: 'object',
        properties: {
          project_name: {
            type: 'string',
            description: 'Project name to analyze',
          },
        },
        required: ['project_name'],
      },
    },
  },
  // ── NEW TOOLS ──────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_ticket_comments',
      description: 'Get comments/notes on a specific ticket.',
      parameters: {
        type: 'object',
        properties: {
          ticket_id: {
            type: 'string',
            description: 'The ticket ID — use TK-12345 format or just the number',
          },
        },
        required: ['ticket_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_trend_analysis',
      description: 'Get trend data over time: ticket velocity (closed per week), time log compliance trend, overdue ticket trend, creation vs closure rate. Use for questions like "are we improving?", "trend this month", "velocity last 4 weeks".',
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            enum: ['velocity', 'compliance', 'overdue_trend', 'creation_vs_closure', 'all'],
            description: 'Which trend to analyze. "all" returns all metrics.',
          },
          weeks: {
            type: 'integer',
            description: 'How many weeks of history to include (default: 4)',
          },
          team: {
            type: 'string',
            description: 'Filter by team name',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_unknown_query',
      description: 'Call this when you cannot answer the user\'s question because you lack the data, tool, or capability. This logs the demand for admin review and lets you suggest alternatives. ALWAYS call this instead of just saying "I don\'t know".',
      parameters: {
        type: 'object',
        properties: {
          original_query: {
            type: 'string',
            description: 'The user\'s original question, verbatim',
          },
          reason: {
            type: 'string',
            description: 'Why you cannot answer (e.g., "no tool to filter by X", "data not available")',
          },
          suggested_alternative: {
            type: 'string',
            description: 'What you CAN show instead — always provide this',
          },
        },
        required: ['original_query', 'reason', 'suggested_alternative'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Set a reminder for the user. They will receive a Telegram message at the specified time.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'What to remind the user about',
          },
          remind_at: {
            type: 'string',
            description: 'When to send the reminder. Use natural language: "tomorrow 10am", "in 2 hours", "Friday 3pm", or ISO datetime.',
          },
        },
        required: ['message', 'remind_at'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_intimation',
      description:
        'Propose sending an intimation to a developer about a Redmine ticket. Use when the user asks to "ping", "ask", "intimate", or "escalate to" a person about a ticket. Returns a preview the bot will confirm with [Yes, send] / [Cancel] buttons — do not send directly.',
      parameters: {
        type: 'object',
        required: ['target_user_hint', 'issue_redmine_id'],
        properties: {
          target_user_hint: {
            type: 'string',
            description: 'Developer name or partial name to intimate (e.g., "Ravi", "Priya S").',
          },
          issue_redmine_id: {
            type: 'integer',
            description: 'The Redmine issue id (TK-12345 -> 12345).',
          },
          note: {
            type: 'string',
            description: 'Optional extra context the originator wants included in the message.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_commitment',
      description:
        'Extract a time-bound commitment ("EOD", "tomorrow 5pm", "by Friday") from a developer reply. Returns null if none found.',
      parameters: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'Reply text to scan for a commitment.' },
        },
      },
    },
  },
];

module.exports = { tools };
