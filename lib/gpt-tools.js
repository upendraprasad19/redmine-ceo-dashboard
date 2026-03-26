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
];

module.exports = { tools };
