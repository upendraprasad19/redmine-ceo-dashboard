/**
 * pages/api/cron/phase1-tick.js
 * Single Vercel cron entry that invokes all three Phase 1 background jobs:
 * intimation-followup, commitment-followup, chat-enrichment.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' })
  }

  const secret = req.headers['x-cron-secret']
  const bearer = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null
  if (secret !== cronSecret && bearer !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const results = {}
  const started = Date.now()

  try {
    const { runIntimationFollowup } = require('../../../crons/intimation-followup')
    results.intimation = await runIntimationFollowup()
  } catch (e) {
    results.intimation = { error: e.message }
  }

  try {
    const { runCommitmentFollowup } = require('../../../crons/commitment-followup')
    results.commitment = await runCommitmentFollowup()
  } catch (e) {
    results.commitment = { error: e.message }
  }

  try {
    const { runChatEnrichment } = require('../../../crons/chat-enrichment')
    results.enrichment = await runChatEnrichment()
  } catch (e) {
    results.enrichment = { error: e.message }
  }

  return res.status(200).json({
    ok: true,
    duration_ms: Date.now() - started,
    results,
  })
}
