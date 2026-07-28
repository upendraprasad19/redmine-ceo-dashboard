/**
 * pages/api/cron/run.js
 * Cron dispatch hub for Vercel Cron.
 *
 * Single job:  GET /api/cron/run?job=standup
 * Batch mode:  GET /api/cron/run?job=batch  (runs all jobs for current UTC hour)
 *
 * Protected by CRON_SECRET header (Vercel sends Authorization: Bearer <CRON_SECRET>).
 */

import { send500 } from '../../../lib/api-error'

export const BATCH_SCHEDULE = [
  { hour: 0, jobs: ['performance', 'insights', 'team-health', 'capacity', 'silence'] },
  { hour: 0, jobs: ['memory-compress'], days: [0] },
  { hour: 2, jobs: ['capacity'] },
  { hour: 4, jobs: ['capacity', 'silence'] },
  { hour: 4, jobs: ['morning-briefing', 'health-check'], days: [1] },
  { hour: 6, jobs: ['capacity'] },
  { hour: 8, jobs: ['capacity'] },
  { hour: 8, jobs: ['pulse-digest', 'predictions'], days: [1] },
  { hour: 9, jobs: ['capacity', 'standup', 'pm-brief', 'ceo-brief'], days: [1, 2, 3, 4, 5] },
  { hour: 10, jobs: ['capacity'] },
  { hour: 12, jobs: ['capacity', 'silence'] },
  { hour: 12, jobs: ['missing-log-reminder'], days: [1, 2, 3, 4, 5] },
  { hour: 14, jobs: ['capacity'] },
  { hour: 14, jobs: ['friday-summary'], days: [5] },
  { hour: 16, jobs: ['capacity'] },
  { hour: 16, jobs: ['reports'], days: [5] },
  { hour: 18, jobs: ['capacity', 'silence'] },
  { hour: 18, jobs: ['eod-alert'], days: [1, 2, 3, 4, 5] },
  { hour: 20, jobs: ['capacity'] },
  { hour: 21, jobs: ['learning-layer'], days: [0] },
  { hour: 22, jobs: ['capacity'] },
]

const ALWAYS_RUN = ['intimation-followup', 'commitment-followup', 'chat-enrichment', 'reminder-delivery']

const ESM_CRONS = new Set([
  'morning-briefing', 'missing-log-reminder', 'friday-summary', 'learning-layer', 'reminder-delivery',
])

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

function toPascal(str) {
  return str
    .split('-')
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('')
}

async function execJob(name) {
  if (ESM_CRONS.has(name)) {
    const mod = await import(`./${name}.js`)
    const fn = mod[`run${toPascal(name)}`]
    if (!fn) throw new Error(`Function run${toPascal(name)} not found in ./${name}.js`)
    return fn()
  }
  const entry = JOB_MAP[name]
  if (!entry) throw new Error(`Unknown job: ${name}`)
  const mod = require(entry.module)
  const fn = mod[entry.fn]
  if (typeof fn !== 'function') throw new Error(`Function ${entry.fn} not found in module`)
  return fn()
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(500).json({ error: 'CRON_SECRET not configured' })

  const bearerToken = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null
  const headerSecret = req.headers['x-cron-secret']
  if (bearerToken !== cronSecret && headerSecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { job } = req.query

  if (job === 'batch') {
    return handleBatch(res)
  }

  if (!job || !JOB_MAP[job]) {
    return res.status(400).json({
      error: 'Invalid or missing job parameter',
      available: Object.keys(JOB_MAP),
    })
  }

  const startTime = Date.now()
  try {
    console.log(`[CRON API] Starting job: ${job}`)
    const result = await execJob(job)
    const duration = Date.now() - startTime
    console.log(`[CRON API] Job ${job} completed in ${duration}ms`)
    return res.status(200).json({ ok: true, job, duration: `${duration}ms`, result })
  } catch (err) {
    const duration = Date.now() - startTime
    console.error(`[CRON API] Job ${job} failed after ${duration}ms:`, err.message)
    return send500(res, err)
  }
}

export function getJobsForHour(hour, day) {
  const scheduled = new Set()
  for (const entry of BATCH_SCHEDULE) {
    if (entry.hour === hour && (!entry.days || entry.days.includes(day))) {
      for (const job of entry.jobs) scheduled.add(job)
    }
  }
  for (const job of ALWAYS_RUN) scheduled.add(job)
  return [...scheduled]
}

async function handleBatch(res) {
  const now = new Date()
  const currentHour = now.getUTCHours()
  const currentDay = now.getUTCDay()

  const scheduledJobs = new Set()
  for (const entry of BATCH_SCHEDULE) {
    if (entry.hour === currentHour && (!entry.days || entry.days.includes(currentDay))) {
      for (const job of entry.jobs) scheduledJobs.add(job)
    }
  }
  for (const job of ALWAYS_RUN) scheduledJobs.add(job)

  const allJobs = [...scheduledJobs]
  if (allJobs.length === 0) {
    return res.status(200).json({ ok: true, hour: currentHour, day: currentDay, executed: [], message: 'No jobs scheduled' })
  }

  console.log(`[BATCH] Hour ${currentHour}, day ${currentDay} — running ${allJobs.length} jobs: ${allJobs.join(', ')}`)

  const results = []
  const startTime = Date.now()
  for (const job of allJobs) {
    if (Date.now() - startTime > 25000) {
      results.push({ job, status: 'skipped', reason: 'budget_exceeded' })
      continue
    }
    const jobStart = Date.now()
    try {
      const result = await execJob(job)
      results.push({ job, status: 'ok', duration: Date.now() - jobStart, result })
    } catch (err) {
      results.push({ job, status: 'error', duration: Date.now() - jobStart, error: err.message })
    }
  }

  const totalDuration = Date.now() - startTime
  console.log(`[BATCH] Completed in ${totalDuration}ms — ${results.filter((r) => r.status === 'ok').length} ok, ${results.filter((r) => r.status === 'error').length} errors, ${results.filter((r) => r.status === 'skipped').length} skipped`)

  return res.status(200).json({
    ok: true,
    hour: currentHour,
    day: currentDay,
    duration: `${totalDuration}ms`,
    executed: allJobs,
    results,
  })
}
