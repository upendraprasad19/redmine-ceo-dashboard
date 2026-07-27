/**
 * bots/telegram/onboarding.js
 * Stateful Telegram onboarding flow using Redis for state storage.
 * Personalizes each user's bot experience via inline keyboard buttons.
 *
 * Steps: welcome → response_style → morning_briefing → briefing_time?
 *        → focus_areas (multi-select) → escalation (manager) / challenge (team_lead)
 *        → confirm → done
 */

const { getRedis } = require('../../lib/redis')
const { getDb } = require('../../lib/db')

const ONBOARD_TTL = 7200 // 2 hours

const FOCUS_OPTIONS = {
  manager: [
    { label: '🔴 Overdue tickets', value: 'overdue_tickets' },
    { label: '⏰ Missing time logs', value: 'missing_time_logs' },
    { label: '🚧 Blocked tickets', value: 'blocked_tickets' },
    { label: '📊 Projects at risk', value: 'project_risks' },
    { label: '👥 Team health scores', value: 'team_health' },
  ],
  team_lead: [
    { label: '⏰ Daily time logging', value: 'missing_time_logs' },
    { label: '🔴 Tickets going overdue', value: 'overdue_tickets' },
    { label: '🚧 Work getting blocked', value: 'blocked_tickets' },
    { label: '👥 Team capacity / overload', value: 'capacity' },
  ],
}

// ── Redis helpers ──────────────────────────────────────────────

async function getState(userId) {
  try {
    const r = getRedis()
    const raw = await r.get(`onboard:${userId}`)
    if (!raw) return null
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (_e) {
    return null
  }
}

async function setState(userId, state) {
  try {
    const r = getRedis()
    await r.set(`onboard:${userId}`, JSON.stringify(state), { ex: ONBOARD_TTL })
  } catch (e) {
    console.error('Onboarding setState error:', e.message)
  }
}

async function clearState(userId) {
  try {
    const r = getRedis()
    await r.del(`onboard:${userId}`)
  } catch (_e) {
    /* ignore */
  }
}

// ── Keyboard builders ──────────────────────────────────────────

function styleKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📋 Brief & bullet points', callback_data: 'ob:style:brief' }],
      [{ text: '📝 Full detail with context', callback_data: 'ob:style:detailed' }],
      [{ text: '🔄 Adaptive — mix it up', callback_data: 'ob:style:adaptive' }],
      [{ text: '⏩ Skip', callback_data: 'ob:style:skip' }],
    ],
  }
}

function briefingKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '☀️ Yes, every morning', callback_data: 'ob:briefing:daily' }],
      [{ text: '📅 Weekdays only (Mon-Fri)', callback_data: 'ob:briefing:weekdays' }],
      [{ text: '🚫 No thanks', callback_data: 'ob:briefing:off' }],
      [{ text: '⏩ Skip', callback_data: 'ob:briefing:skip' }],
    ],
  }
}

function briefingTimeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '7 AM', callback_data: 'ob:btime:07:00' },
        { text: '8 AM', callback_data: 'ob:btime:08:00' },
        { text: '9 AM', callback_data: 'ob:btime:09:00' },
      ],
      [
        { text: '10 AM', callback_data: 'ob:btime:10:00' },
        { text: '11 AM', callback_data: 'ob:btime:11:00' },
      ],
      [{ text: '⏩ Skip (default 9 AM)', callback_data: 'ob:btime:skip' }],
    ],
  }
}

function focusKeyboard(role, selected = []) {
  const options = FOCUS_OPTIONS[role] || FOCUS_OPTIONS.team_lead
  const rows = options.map((opt) => [
    {
      text: (selected.includes(opt.value) ? '✅ ' : '') + opt.label,
      callback_data: `ob:focus:${opt.value}`,
    },
  ])
  rows.push([{ text: '✅ Done — save these', callback_data: 'ob:focus:done' }])
  rows.push([{ text: '⏩ Skip', callback_data: 'ob:focus:skip' }])
  return { inline_keyboard: rows }
}

function escalationKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '1 day overdue', callback_data: 'ob:escalate:1 day' }],
      [{ text: '3 days overdue', callback_data: 'ob:escalate:3 days' }],
      [{ text: '5 days overdue', callback_data: 'ob:escalate:5 days' }],
      [{ text: 'Only Critical priority', callback_data: 'ob:escalate:critical priority' }],
      [{ text: '⏩ Skip', callback_data: 'ob:escalate:skip' }],
    ],
  }
}

// ── Step senders ───────────────────────────────────────────────

async function sendStyleStep(ctx, _name) {
  await ctx.reply(
    `Great! Let me set you up in 4 quick steps — you can skip any.\n\n*Step 1/4 — Response Style*\nHow do you like your updates?`,
    { parse_mode: 'Markdown', reply_markup: styleKeyboard() },
  )
}

async function sendBriefingStep(ctx) {
  await ctx.reply(
    '*Step 2/4 — Morning Briefing*\nShould I send you a personalized daily briefing?',
    { parse_mode: 'Markdown', reply_markup: briefingKeyboard() },
  )
}

async function sendBriefingTimeStep(ctx) {
  await ctx.reply('*What time? _(IST)_*', {
    parse_mode: 'Markdown',
    reply_markup: briefingTimeKeyboard(),
  })
}

async function sendFocusStep(ctx, role, selected = []) {
  const label = role === 'manager' ? 'Focus Areas' : 'What To Track'
  await ctx.reply(
    `*Step 3/4 — ${label}*\nWhat should I proactively flag for you?\n_(tap all that apply, then Done)_`,
    { parse_mode: 'Markdown', reply_markup: focusKeyboard(role, selected) },
  )
}

async function sendEscalationStep(ctx) {
  await ctx.reply(
    '*Step 4/4 — Escalation Threshold*\nWhen should I escalate issues to you directly?',
    { parse_mode: 'Markdown', reply_markup: escalationKeyboard() },
  )
}

async function sendChallengeStep(ctx, name) {
  await ctx.reply(
    `*Step 4/4 — Team Challenge*\nWhat's your team's biggest challenge right now, ${name}?\n\nType your answer, or tap Skip.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '⏩ Skip', callback_data: 'ob:challenge:skip' }]],
      },
    },
  )
}

async function sendConfirmStep(ctx, collected, userName) {
  const style = collected.response_style || 'adaptive'
  const briefing =
    collected.morning_briefing === 'off' || !collected.morning_briefing
      ? 'No briefing'
      : `${collected.morning_briefing} at ${collected.briefing_time || '9:00 AM'}`
  const concerns = (collected.top_concerns || []).join(', ') || 'none'
  const extra = collected.custom_concern ? `\n💬 Focus: "${collected.custom_concern}"` : ''
  const escalate = collected.escalation_threshold
    ? `\n🚨 Escalate: ${collected.escalation_threshold}`
    : ''

  await ctx.reply(
    `✅ *All set, ${userName}!*\n\n📋 Style: ${style}\n☀️ Briefing: ${briefing}\n🎯 Watching: ${concerns}${escalate}${extra}\n\nUpdate anytime with /preferences`,
    { parse_mode: 'Markdown' },
  )
}

// ── Main entry point ───────────────────────────────────────────

/**
 * Start onboarding for a user (called from /start or /preferences).
 */
async function startOnboarding(ctx, user) {
  const name = user.display_name || user.username
  await ctx.reply(
    `👋 Hi ${name}! I can personalize how I work for you.\n\n*Quick 2-min setup?* You can skip any step.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Let's do it", callback_data: 'ob:welcome:start' }],
          [{ text: '⏩ Skip for now', callback_data: 'ob:welcome:skip' }],
        ],
      },
    },
  )
  await setState(user.id, { step: 'welcome', collected: {}, focus_selected: [] })
}

/**
 * Handle callback_query from onboarding inline buttons.
 * Returns true if the callback was consumed by onboarding.
 */
async function handleOnboardingCallback(ctx, user) {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith('ob:')) return false

  await ctx.answerCbQuery().catch(() => {})

  const state = (await getState(user.id)) || { step: 'welcome', collected: {}, focus_selected: [] }
  const name = user.display_name || user.username
  const role = user.role

  // ob:welcome
  if (data === 'ob:welcome:skip') {
    await ctx
      .editMessageText('No problem! You can personalise anytime with /preferences')
      .catch(() => {})
    await markSkipped(user.id)
    await clearState(user.id)
    return true
  }
  if (data === 'ob:welcome:start') {
    await ctx.editMessageText("Great! Let's go.").catch(() => {})
    await sendStyleStep(ctx, name)
    await setState(user.id, { step: 'response_style', collected: {}, focus_selected: [] })
    return true
  }

  // ob:style
  if (data.startsWith('ob:style:')) {
    const value = data.replace('ob:style:', '')
    const collected = { ...state.collected }
    if (value !== 'skip') collected.response_style = value
    await sendBriefingStep(ctx)
    await setState(user.id, { step: 'morning_briefing', collected, focus_selected: [] })
    return true
  }

  // ob:briefing
  if (data.startsWith('ob:briefing:')) {
    const value = data.replace('ob:briefing:', '')
    const collected = { ...state.collected }
    if (value !== 'skip') collected.morning_briefing = value
    if (value !== 'off' && value !== 'skip') {
      await sendBriefingTimeStep(ctx)
      await setState(user.id, { step: 'briefing_time', collected, focus_selected: [] })
    } else {
      await sendFocusStep(ctx, role, [])
      await setState(user.id, { step: 'focus_areas', collected, focus_selected: [] })
    }
    return true
  }

  // ob:btime
  if (data.startsWith('ob:btime:')) {
    const value = data.replace('ob:btime:', '')
    const collected = { ...state.collected }
    if (value !== 'skip') collected.briefing_time = value
    await sendFocusStep(ctx, role, [])
    await setState(user.id, { step: 'focus_areas', collected, focus_selected: [] })
    return true
  }

  // ob:focus (multi-select)
  if (data.startsWith('ob:focus:')) {
    const value = data.replace('ob:focus:', '')
    if (value === 'skip') {
      const collected = { ...state.collected, top_concerns: state.focus_selected || [] }
      await advanceFromFocus(ctx, user, { ...state, collected })
      return true
    }
    if (value === 'done') {
      const collected = { ...state.collected, top_concerns: state.focus_selected || [] }
      await advanceFromFocus(ctx, user, { ...state, collected })
      return true
    }
    // Toggle item
    const selected = [...(state.focus_selected || [])]
    const idx = selected.indexOf(value)
    if (idx >= 0) selected.splice(idx, 1)
    else selected.push(value)
    try {
      await ctx.editMessageReplyMarkup(focusKeyboard(role, selected))
    } catch (_e) {
      /* message not modified is OK */
    }
    await setState(user.id, { ...state, focus_selected: selected })
    return true
  }

  // ob:escalate (manager)
  if (data.startsWith('ob:escalate:')) {
    const value = data.replace('ob:escalate:', '')
    const collected = { ...state.collected }
    if (value !== 'skip') collected.escalation_threshold = value
    await saveOnboardingData(user.id, collected)
    await sendConfirmStep(ctx, collected, name)
    await clearState(user.id)
    return true
  }

  // ob:challenge skip button
  if (data === 'ob:challenge:skip') {
    await saveOnboardingData(user.id, state.collected)
    await sendConfirmStep(ctx, state.collected, name)
    await clearState(user.id)
    return true
  }

  return false
}

async function advanceFromFocus(ctx, user, state) {
  if (user.role === 'manager') {
    await sendEscalationStep(ctx)
    await setState(user.id, { step: 'escalation', collected: state.collected, focus_selected: [] })
  } else {
    await sendChallengeStep(ctx, user.display_name || user.username)
    await setState(user.id, { step: 'challenge', collected: state.collected, focus_selected: [] })
  }
}

/**
 * Handle free-text input during onboarding (challenge step).
 * Returns true if the text was consumed by onboarding.
 */
async function handleOnboardingText(ctx, user) {
  const state = await getState(user.id)
  if (state?.step !== 'challenge') return false

  const text = ctx.message?.text
  if (!text || text.startsWith('/')) return false

  const collected = { ...state.collected, custom_concern: text }
  await saveOnboardingData(user.id, collected)
  await sendConfirmStep(ctx, collected, user.display_name || user.username)
  await clearState(user.id)
  return true
}

// ── DB save ────────────────────────────────────────────────────

async function saveOnboardingData(userId, collected) {
  const sql = getDb()
  const behaviorProfile = {
    response_style: collected.response_style || 'adaptive',
    morning_briefing: collected.morning_briefing || 'off',
    briefing_time: collected.briefing_time || '09:00',
    briefing_days: collected.morning_briefing === 'daily' ? 'daily' : 'weekdays',
    escalation_threshold: collected.escalation_threshold || null,
    custom_concern: collected.custom_concern || null,
    onboarding_completed: true,
  }

  try {
    await sql`
      UPDATE dashboard_users
      SET
        behavior_profile = ${JSON.stringify(behaviorProfile)},
        top_concerns = ${collected.top_concerns || []},
        onboarding_completed = true,
        onboarding_step = NULL,
        briefing_time = ${`${collected.briefing_time || '09:00'}:00`},
        briefing_days = ${behaviorProfile.briefing_days},
        updated_at = NOW()
      WHERE id = ${userId}
    `
  } catch (e) {
    console.error('saveOnboardingData error:', e.message)
  }
}

async function markSkipped(userId) {
  const sql = getDb()
  try {
    await sql`
      UPDATE dashboard_users
      SET
        behavior_profile = COALESCE(behavior_profile, '{}'::jsonb) || '{"onboarding_skipped": true}'::jsonb,
        onboarding_completed = true,
        updated_at = NOW()
      WHERE id = ${userId}
    `
  } catch (e) {
    console.error('markSkipped error:', e.message)
  }
}

// ── Developer consent (Phase 1) ────────────────────────────────

const CONSENT_TEXT =
  `Your messages to this bot are logged and may be reviewed by your manager or team lead for coaching and delivery purposes.\n\n` +
  `Reply */agree* to continue receiving intimations and relaying replies, or */revoke* at any time to stop.`

async function sendDeveloperConsent(ctx) {
  await ctx.reply(CONSENT_TEXT, { parse_mode: 'Markdown' })
}

async function recordConsent(userId) {
  const sql = getDb()
  await sql`UPDATE dashboard_users SET consent_given_at = NOW() WHERE id = ${userId}`
}

async function revokeConsent(userId) {
  const sql = getDb()
  await sql`UPDATE dashboard_users SET consent_given_at = NULL WHERE id = ${userId}`
}

module.exports = {
  startOnboarding,
  handleOnboardingCallback,
  handleOnboardingText,
  sendDeveloperConsent,
  recordConsent,
  revokeConsent,
}
