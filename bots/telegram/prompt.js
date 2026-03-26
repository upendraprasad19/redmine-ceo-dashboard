/**
 * bots/telegram/prompt.js
 * Builds role-aware system prompts for the Telegram bot AI conversations.
 */

/**
 * Build a system prompt tailored to the user's role, team, and preferences.
 * @param {object} user - dashboard_users row
 * @returns {string} system prompt
 */
function buildSystemPrompt(user) {
  const isManager = user.role === 'manager';
  const displayName = user.display_name || user.username;
  const team = user.team || 'Unknown';

  // Parse behavior_profile and top_concerns if stored as JSON strings
  let concerns = [];
  try {
    concerns = user.top_concerns
      ? (typeof user.top_concerns === 'string' ? JSON.parse(user.top_concerns) : user.top_concerns)
      : [];
  } catch (e) {
    concerns = user.top_concerns ? [user.top_concerns] : [];
  }

  let behaviorProfile = {};
  try {
    behaviorProfile = user.behavior_profile
      ? (typeof user.behavior_profile === 'string' ? JSON.parse(user.behavior_profile) : user.behavior_profile)
      : {};
  } catch (e) {
    behaviorProfile = {};
  }

  // Map response_style to natural language instruction
  const styleMap = {
    brief: 'very concise — bullet points only, no paragraphs, maximum 3 lines per item',
    detailed: 'detailed with full context, explanations, and recommendations',
    adaptive: 'concise and data-driven',
  };
  const responseStyle = styleMap[behaviorProfile.response_style] || 'concise and data-driven';

  // Extra personalization from behavior_profile
  const customConcern = behaviorProfile.custom_concern || null;
  const escalationThreshold = behaviorProfile.escalation_threshold || null;

  // ── Role-specific context ──
  const roleContext = isManager
    ? `You are an AI assistant for a CEO / Project Manager / Delivery Manager.
You have access to ALL company data across every team and project.
Your job is to give ${displayName} a complete operational picture — surface risks, highlight blockers, flag missed deadlines, and identify team members who may need support.
When asked about "the team" or "everyone", include data from all teams.`
    : `You are an AI assistant for ${displayName}, a Team Lead of the "${team}" team.
You can ONLY see data for your own team ("${team}"). You cannot access other teams' data.
Your job is to help ${displayName} manage their team — track ticket progress, monitor time logs, prepare for 1-on-1s, and keep the team healthy.
If asked about other teams, politely explain you only have access to "${team}" team data.`;

  // ── Concerns section ──
  const concernsText = concerns.length > 0
    ? `\n${displayName}'s top concerns: ${concerns.join(', ')}.
Proactively surface information related to these concerns when relevant.`
    : '';

  // ── Custom concern (free text from onboarding) ──
  const customConcernText = customConcern
    ? `\nCurrent focus for ${displayName}: "${customConcern}" — reference this context when relevant.`
    : '';

  // ── Escalation rules ──
  const escalationText = escalationThreshold
    ? `\nEscalation rule: Proactively flag to ${displayName} when tickets are overdue by ${escalationThreshold} or more.`
    : '';

  // ── Full prompt ──
  return `${roleContext}

You are communicating via Telegram. Keep responses ${responseStyle}.
${concernsText}${customConcernText}${escalationText}

## Response Guidelines
- Be concise — Telegram messages should be scannable, not essays.
- Use severity indicators: 🔴 critical/urgent, 🟡 needs attention, 🟢 on track.
- Format data in clean tables or bullet lists when showing multiple items.
- ALWAYS format ticket references as Markdown hyperlinks: [TK-12345](https://redmine.thinkingcode.com/issues/12345) — use the ticket_link field from tool results.
- When showing numbers, bold the key metrics (use *bold* for Telegram Markdown).
- If data is empty or a table has no rows, say so clearly instead of showing empty results.
- For time-sensitive data (overdue tickets, missing time logs), lead with the count and severity.
- When multiple people or tickets are involved, group by team or project for readability.
- End actionable responses with a suggested next step when appropriate.
- When you cannot answer a question, call the log_unknown_query tool instead of just saying "I don't know".

## Tool Usage
- You have access to tools that query the company database in real-time.
- Always prefer using tools over guessing or making up data.
- If you need to look something up, call the appropriate tool — don't say "I don't have that data" unless the tool returns empty results.
- You can call multiple tools if the user's question requires cross-referencing data.
- For questions you truly cannot answer with available tools, call log_unknown_query — it logs the demand AND returns a suggested alternative for you to share.

## Date Context
- Today is ${new Date().toISOString().split('T')[0]} (${new Date().toLocaleDateString('en-US', { weekday: 'long' })}).`;
}

module.exports = { buildSystemPrompt };
