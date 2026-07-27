/**
 * pages/api/cron/run.js
 * Dynamic cron trigger API route for Vercel Cron.
 *
 * GET /api/cron/run?job=standup
 *
 * Protected by CRON_SECRET header (Vercel sends Authorization: Bearer <CRON_SECRET>).
 * Each job name maps to its cron function.
 */

// Job name to module/function mapping
const JOB_MAP = {
  standup: { module: '../../../crons/standup', fn: 'runStandup' },
  'pm-brief': { module: '../../../crons/briefings', fn: 'sendPMBriefs' },
  'ceo-brief': { module: '../../../crons/briefings', fn: 'sendCEOBrief' },
  'eod-alert': { module: '../../../crons/eod-alert', fn: 'runEODAlert' },
  capacity: { module: '../../../crons/capacity', fn: 'runCapacityUpdate' },
  silence: { module: '../../../crons/silence', fn: 'runSilenceDetector' },
  reports: { module: '../../../crons/reports', fn: 'runWeeklyReports' },
  performance: { module: '../../../crons/performance', fn: 'runPerformanceScoring' },
  insights: { module: '../../../crons/insights', fn: 'runInsightGeneration' },
  'team-health': { module: '../../../crons/team-health', fn: 'runTeamHealthCalc' },
  'memory-compress': { module: '../../../crons/memory-compress', fn: 'runMemoryCompression' },
  'pulse-digest': { module: '../../../crons/pulse-digest', fn: 'runPulseDigest' },
  predictions: { module: '../../../crons/predictions', fn: 'runVelocityPredictions' },
  'health-check': { module: '../../../crons/health-check', fn: 'runHealthCheck' },
}

export default async function handler(req, res) {
  // Only accept GET (Vercel Cron uses GET)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Auth: Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  // Also accept x-cron-secret header for manual triggers
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET

  // Always require auth — reject if no CRON_SECRET is configured
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' })
  }

  const bearerToken = authHeader ? authHeader.replace('Bearer ', '') : null
  const headerSecret = req.headers['x-cron-secret']

  if (bearerToken !== cronSecret && headerSecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Get job name from query
  const { job } = req.query

  if (!job || !JOB_MAP[job]) {
    return res.status(400).json({
      error: 'Invalid or missing job parameter',
      available: Object.keys(JOB_MAP),
    })
  }

  const jobConfig = JOB_MAP[job]
  const startTime = Date.now()

  try {
    // Dynamic require to load the cron module
    const cronModule = require(jobConfig.module)
    const cronFn = cronModule[jobConfig.fn]

    if (typeof cronFn !== 'function') {
      return res.status(500).json({
        error: `Function ${jobConfig.fn} not found in module`,
      })
    }

    console.log(`[CRON API] Starting job: ${job}`)
    const result = await cronFn()
    const duration = Date.now() - startTime

    console.log(`[CRON API] Job ${job} completed in ${duration}ms`)

    return res.status(200).json({
      ok: true,
      job,
      duration: `${duration}ms`,
      result,
    })
  } catch (err) {
    const duration = Date.now() - startTime
    console.error(`[CRON API] Job ${job} failed after ${duration}ms:`, err.message)

    return res.status(500).json({
      ok: false,
      job,
      duration: `${duration}ms`,
      error: err.message,
    })
  }
}
