const { getCurrentUser } = require('../../lib/auth')
const { getDb } = require('../../lib/db')
const { chat } = require('../../lib/ai')
const { getRecentMessages, saveMessage } = require('../../lib/redis')
const { tools } = require('../../lib/gpt-tools')
const { executeToolCall } = require('../../lib/gpt-executor')
const { send500 } = require('../../lib/api-error')

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const user = await getCurrentUser(req)
    if (!user) return res.status(401).json({ error: 'Not authenticated' })

    const { message } = req.body
    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' })
    }

    const sql = getDb()

    // Load recent context from Redis
    let recentMessages = []
    try {
      recentMessages = await getRecentMessages(user.id)
    } catch (e) {
      console.error('Redis getRecentMessages error:', e.message)
    }

    // Build system prompt based on user role and team
    const roleContext =
      user.role === 'manager'
        ? 'You have access to data across all teams and projects.'
        : `You are scoped to the "${user.team}" team. Focus responses on this team's data.`

    const systemPrompt = `You are the Intelligence Assistant for the Company OS Dashboard.
You help ${user.display_name} (${user.role}) with project management queries, team insights, and operational data.
${roleContext}

When referencing tickets, use format TK-{number} so they render as links.
Keep responses concise, actionable, and data-driven.
Use bullet points for lists. Bold key metrics.
If you don't have specific data, say so and suggest what to check.
Use severity indicators: 🔴 critical/urgent, 🟡 needs attention, 🟢 on track.
Today is ${new Date().toISOString().split('T')[0]}.`

    // Build messages array for AI
    const aiMessages = [{ role: 'system', content: systemPrompt }]

    // Add recent conversation context
    for (const msg of recentMessages.slice(-10)) {
      aiMessages.push({ role: msg.role, content: msg.content })
    }

    // Add current user message
    aiMessages.push({ role: 'user', content: message })

    // Call AI with shared tool definitions
    let response
    try {
      response = await chat(aiMessages, tools)
    } catch (aiErr) {
      console.error('AI chat error:', aiErr.message)
      // Try without tools as fallback (some models don't support tools)
      try {
        response = await chat(aiMessages)
      } catch (aiErr2) {
        console.error('AI chat fallback error:', aiErr2.message)
        return res.status(200).json({
          message: `I'm having trouble connecting to the AI service. Error: ${aiErr2.message}. Please check the AI configuration in Admin settings.`,
          role: 'assistant',
        })
      }
    }

    let aiResponse = ''
    let reply = response.choices[0].message

    // Handle tool calls — support up to 3 rounds
    let toolRounds = 0
    const MAX_TOOL_ROUNDS = 3

    while (reply.tool_calls && reply.tool_calls.length > 0 && toolRounds < MAX_TOOL_ROUNDS) {
      toolRounds++

      // Push assistant message with tool_calls
      aiMessages.push(reply)

      // Execute each tool call using the shared executor
      for (const tc of reply.tool_calls) {
        let args = {}
        try {
          args = JSON.parse(tc.function.arguments)
        } catch (_e) {
          args = {}
        }

        const result = await executeToolCall(tc.function.name, args, {
          id: user.id,
          role: user.role,
          team: user.team,
          display_name: user.display_name,
        })

        aiMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        })
      }

      // Call AI again with tool results
      const followUp = await chat(aiMessages, tools)
      reply = followUp.choices[0].message
    }

    aiResponse =
      reply.content ||
      'I received your message but could not generate a response. Please try rephrasing your question.'

    // Save messages to Redis
    try {
      await saveMessage(user.id, 'user', message)
      await saveMessage(user.id, 'assistant', aiResponse)
    } catch (e) {
      console.error('Redis saveMessage error:', e.message)
    }

    // Save to persistent chat_history in DB
    try {
      await sql`
        INSERT INTO chat_history (user_id, role, content, metadata, created_at)
        VALUES (${user.id}, 'user', ${message}, ${JSON.stringify({ source: 'dashboard' })}, NOW())
      `
      await sql`
        INSERT INTO chat_history (user_id, role, content, metadata, created_at)
        VALUES (${user.id}, 'assistant', ${aiResponse}, ${JSON.stringify({ source: 'dashboard', tool_rounds: toolRounds })}, NOW())
      `
    } catch (e) {
      console.error('DB chat_history insert error:', e.message)
    }

    res.status(200).json({ message: aiResponse, role: 'assistant' })
  } catch (err) {
    return send500(res, err, 'chat')
  }
}
