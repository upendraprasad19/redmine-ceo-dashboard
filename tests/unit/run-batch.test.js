import { describe, expect, it } from 'vitest'
import { BATCH_SCHEDULE, getJobsForHour } from '../../pages/api/cron/run.js'

describe('getJobsForHour', () => {
  const ALWAYS_RUN_JOBS = [
    'intimation-followup',
    'commitment-followup',
    'chat-enrichment',
    'reminder-delivery',
  ]

  it('returns always-run jobs at any hour', () => {
    const jobs = getJobsForHour(3, 3)
    for (const job of ALWAYS_RUN_JOBS) {
      expect(jobs).toContain(job)
    }
  })

  it('includes scheduled jobs at matching hour with no days constraint', () => {
    const jobs = getJobsForHour(0, 3)
    expect(jobs).toContain('performance')
    expect(jobs).toContain('insights')
    expect(jobs).toContain('team-health')
    expect(jobs).toContain('capacity')
    expect(jobs).toContain('silence')
  })

  it('includes day-specific jobs only on matching days', () => {
    const sundayJobs = getJobsForHour(0, 0)
    expect(sundayJobs).toContain('memory-compress')

    const mondayJobs = getJobsForHour(0, 1)
    expect(mondayJobs).not.toContain('memory-compress')
  })

  it('includes weekday-only jobs on weekdays', () => {
    const jobs = getJobsForHour(9, 3)
    expect(jobs).toContain('standup')
    expect(jobs).toContain('pm-brief')
    expect(jobs).toContain('ceo-brief')
  })

  it('excludes weekday-only jobs on weekends', () => {
    const sundayJobs = getJobsForHour(9, 0)
    expect(sundayJobs).not.toContain('standup')
    expect(sundayJobs).not.toContain('pm-brief')
  })

  it('includes friday-only jobs on Friday', () => {
    const jobs = getJobsForHour(14, 5)
    expect(jobs).toContain('friday-summary')
  })

  it('excludes friday-only jobs on other days', () => {
    const jobs = getJobsForHour(14, 1)
    expect(jobs).not.toContain('friday-summary')
  })

  it('deduplicates jobs from multiple schedule entries', () => {
    const jobs = getJobsForHour(12, 3)
    const capacityCount = jobs.filter((j) => j === 'capacity').length
    expect(capacityCount).toBe(1)
  })

  it('includes monday-only jobs on Monday', () => {
    const jobs8 = getJobsForHour(8, 1)
    expect(jobs8).toContain('pulse-digest')
    expect(jobs8).toContain('predictions')

    const jobs4 = getJobsForHour(4, 1)
    expect(jobs4).toContain('morning-briefing')
    expect(jobs4).toContain('health-check')
  })

  it('excludes monday-only jobs on other days', () => {
    const jobs8 = getJobsForHour(8, 3)
    expect(jobs8).not.toContain('pulse-digest')
    expect(jobs8).not.toContain('predictions')
  })

  it('excludes hourly jobs on Saturday', () => {
    const jobs = getJobsForHour(9, 6)
    expect(jobs).not.toContain('standup')
    expect(jobs).not.toContain('pm-brief')
    expect(jobs).not.toContain('ceo-brief')
  })
})

describe('BATCH_SCHEDULE', () => {
  it('has no duplicate hour+days combinations', () => {
    const keys = BATCH_SCHEDULE.map((e) => `${e.hour}:${(e.days || []).sort().join(',')}`)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  })

  it('every hour with jobs has non-empty jobs array', () => {
    for (const entry of BATCH_SCHEDULE) {
      expect(entry.jobs.length).toBeGreaterThan(0)
    }
  })
})
