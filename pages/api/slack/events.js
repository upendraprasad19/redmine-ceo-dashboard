/**
 * pages/api/slack/events.js
 * Next.js API route for Slack Events API + Interactive payloads.
 *
 * Handles:
 *   - url_verification challenge (Slack app setup)
 *   - Event callbacks (message events routed to dev-queries)
 *   - Block Kit interactive actions (status changes, blockers)
 *   - View submissions (blocker modal)
 *
 * NOTE: When using Bolt's built-in HTTP receiver or Socket Mode,
 * this endpoint is a fallback/alternative for environments where
 * Bolt cannot run its own server (e.g., serverless on Vercel).
 * For Socket Mode, handlers are registered directly in bots/slack/index.js.
 */

const crypto = require('node:crypto')

// Disable Next.js body parsing — we need the raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
}

/**
 * Read the raw request body as a string.
 */
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

/**
 * Verify the Slack request signature.
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
function verifySlackSignature(rawBody, timestamp, signature) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!signingSecret) return false

  // Reject requests older than 5 minutes to prevent replay attacks
  const currentTime = Math.floor(Date.now() / 1000)
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > 300) {
    return false
  }

  const sigBasestring = `v0:${timestamp}:${rawBody}`
  const mySignature = `v0=${crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex')}`

  return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const rawBody = await getRawBody(req)
    const timestamp = req.headers['x-slack-request-timestamp']
    const signature = req.headers['x-slack-signature']

    // ── Signature verification ──
    // url_verification challenge doesn't carry signature headers
    if (payload?.type !== 'url_verification') {
      if (!timestamp || !signature) {
        return res.status(401).json({ error: 'Missing Slack signature headers' })
      }
      const valid = verifySlackSignature(rawBody, timestamp, signature)
      if (!valid) {
        console.warn('Slack events: Invalid signature')
        return res.status(401).json({ error: 'Invalid signature' })
      }
    }

    // ── Determine payload type ──
    let payload
    const contentType = req.headers['content-type'] || ''

    if (contentType.includes('application/x-www-form-urlencoded')) {
      // Interactive payloads come as form-urlencoded with a `payload` field
      const params = new URLSearchParams(rawBody)
      const payloadStr = params.get('payload')
      if (!payloadStr) {
        return res.status(400).json({ error: 'Missing payload' })
      }
      payload = JSON.parse(payloadStr)
      return await handleInteraction(payload, res)
    }

    // Events API sends JSON
    payload = JSON.parse(rawBody)

    // ── URL verification challenge ──
    if (payload.type === 'url_verification') {
      return res.status(200).json({ challenge: payload.challenge })
    }

    // ── Event callback ──
    if (payload.type === 'event_callback') {
      const event = payload.event
      if (!event) {
        return res.status(200).json({ ok: true })
      }

      // Acknowledge immediately — Slack expects a 200 within 3 seconds
      res.status(200).json({ ok: true })

      // Process the event asynchronously
      setImmediate(() =>
        processEvent(event).catch((err) => {
          console.error('Slack event processing error:', err)
        }),
      )
      return
    }

    // Unknown event type
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Slack events handler error:', err)
    // Always return 200 to prevent Slack from retrying
    return res.status(200).json({ ok: true })
  }
}

/**
 * Process a Slack event (message, app_mention, etc.)
 */
async function processEvent(event) {
  // Ignore bot messages and message changes
  if (event.subtype) return
  if (event.bot_id) return

  // Direct messages to the bot
  if (event.type === 'message' && event.channel_type === 'im') {
    const { handleDevMessage } = require('../../../bots/slack/dev-queries')
    const { resolveSlackUser, sendDirectMessage } = require('../../../bots/slack/index')

    // Build a minimal `say` function for the serverless context
    const say = async (msgOrObj) => {
      const text = typeof msgOrObj === 'string' ? msgOrObj : msgOrObj.text
      const blocks = typeof msgOrObj === 'object' ? msgOrObj.blocks : undefined
      await sendDirectMessage(event.user, text, blocks)
    }

    // Minimal client stub — in serverless mode, postEphemeral is a no-op
    const { getSlackApp } = require('../../../bots/slack/index')
    const app = getSlackApp()
    const client = app ? app.client : null

    await handleDevMessage(
      { user: event.user, text: event.text || '', channel: event.channel },
      say,
      client,
    )
    return
  }

  // App mention in channels
  if (event.type === 'app_mention') {
    const { handleDevMessage } = require('../../../bots/slack/dev-queries')
    const { sendDirectMessage, getSlackApp } = require('../../../bots/slack/index')

    const say = async (msgOrObj) => {
      const text = typeof msgOrObj === 'string' ? msgOrObj : msgOrObj.text
      const blocks = typeof msgOrObj === 'object' ? msgOrObj.blocks : undefined
      await sendDirectMessage(event.user, text, blocks)
    }

    const app = getSlackApp()
    const client = app ? app.client : null

    // Strip the bot mention from the text
    const cleanText = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim()

    await handleDevMessage(
      { user: event.user, text: cleanText, channel: event.channel },
      say,
      client,
    )
    return
  }
}

/**
 * Handle Slack interactive payloads (block_actions, view_submission).
 */
async function handleInteraction(payload, res) {
  // Acknowledge immediately
  res.status(200).json({ ok: true })

  const { getSlackApp } = require('../../../bots/slack/index')
  const app = getSlackApp()
  const client = app ? app.client : null

  if (!client) {
    console.warn('Slack events: Cannot handle interaction — app not initialized')
    return
  }

  setImmediate(async () => {
    try {
      if (payload.type === 'block_actions') {
        for (const action of payload.actions || []) {
          switch (action.action_id) {
            case 'ticket_status_change': {
              const { handleStatusChange } = require('../../../bots/slack/tickets')
              await handleStatusChange(payload, action, client)
              break
            }
            case 'ticket_mark_done': {
              const { handleTicketDone } = require('../../../bots/slack/tickets')
              await handleTicketDone(payload, action, client)
              break
            }
            case 'report_blocker': {
              const { handleBlockerButton } = require('../../../bots/slack/blockers')
              await handleBlockerButton(payload, client)
              break
            }
            default:
              console.log('Slack events: Unhandled action_id:', action.action_id)
          }
        }
      }

      if (payload.type === 'view_submission') {
        switch (payload.view?.callback_id) {
          case 'blocker_submission': {
            const { handleBlockerSubmission } = require('../../../bots/slack/blockers')
            await handleBlockerSubmission(payload, payload.view, client)
            break
          }
          default:
            console.log('Slack events: Unhandled view callback_id:', payload.view?.callback_id)
        }
      }
    } catch (err) {
      console.error('Slack interaction processing error:', err)
    }
  })
}
