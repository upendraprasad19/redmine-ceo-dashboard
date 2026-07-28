import { describe, expect, it, vi, afterEach } from 'vitest'

process.env.JWT_SECRET = 'test-secret-key-for-testing'
process.env.NODE_ENV = 'test'

vi.mock('../../lib/auth.js', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('../../lib/api-error.js', () => ({
  send500: vi.fn((res) => res.status(500).json({ error: 'Internal server error' })),
}))

const mockSql = vi.fn()
vi.mock('../../lib/db.js', () => ({
  getDb: vi.fn(() => mockSql),
}))

import { getCurrentUser } from '../../lib/auth.js'
import handler from '../../pages/api/people/[id]/profile.js'

afterEach(() => {
  vi.clearAllMocks()
  mockSql.mockReset()
})

function mockRes() {
  const res = { statusData: null, statusCode: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (data) => { res.statusData = data; return res }
  res.end = () => res
  return res
}

function mockReq(overrides = {}) {
  return { method: 'GET', query: { id: '1', period: 'daily', ...overrides.query }, cookies: {}, headers: {} }
}

const personRow = { id: 1, name: 'Alice', team: 'AI', role: 'developer', initials: 'AD' }
const dashUserRow = { dashboard_user_id: 50 }
const perfRow = { overall_score: 75, trend: 'rising', score_delta: 5, output_score: 80, speed_score: 70, quality_score: 85, reliability_score: 65, collaboration_score: 70, tickets_closed: 12, tickets_in_progress: 3, tickets_overdue: 1, tickets_reopened: 1, hours_logged: 120, avg_resolution_time_hrs: 18, reopen_rate: 0.08, deadline_hit_rate: 0.85, raw_data: { blockers_helped: 5 } }
const velocityRows = [{ week_start: '2026-07-21', closed: 4 }, { week_start: '2026-07-14', closed: 3 }]
const workloadRow = { overdue: 1, due_soon: 2, high_priority: 3, avg_age_days: 15, max_age_days: 45, tickets_7plus: 4, tickets_15plus: 2 }
const capacityRow = { current_workload_pct: 60, available_capacity_pct: 40, predicted_free_date: '2026-08-15' }
const teamHealthRow = { overall_score: 70, reopen_rate: 0.1, on_time_delivery_rate: 0.8 }

function setupFull() {
  mockSql.mockResolvedValueOnce([personRow])
  mockSql.mockResolvedValueOnce([])
  mockSql.mockResolvedValueOnce([dashUserRow])
  mockSql.mockResolvedValueOnce([perfRow])
  mockSql.mockResolvedValueOnce(velocityRows)
  mockSql.mockResolvedValueOnce([{ active_tickets: 5 }])
  mockSql.mockResolvedValueOnce([workloadRow])
  mockSql.mockResolvedValueOnce([capacityRow])
  mockSql.mockResolvedValueOnce([{ hours_this_month: 80, days_logged: 15 }])
  mockSql.mockResolvedValueOnce([{ hours_last_7days: 20, last_log_date: '2026-07-28', days_since_last_log: 0 }])
  mockSql.mockResolvedValueOnce([{ status: 'kept', count: 8 }, { status: 'missed', count: 2 }])
  mockSql.mockResolvedValueOnce([teamHealthRow])
  mockSql.mockResolvedValueOnce([{ team_avg: 68 }])
}

describe('GET /api/people/[id]/profile', () => {
  it('returns 401 when not authenticated', async () => {
    getCurrentUser.mockResolvedValue(null)
    const res = mockRes()
    await handler(mockReq(), res)
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 for invalid user id', async () => {
    getCurrentUser.mockResolvedValue({ id: 100, role: 'manager', team: 'AI' })
    const res = mockRes()
    await handler(mockReq({ query: { id: 'abc', period: 'daily' } }), res)
    expect(res.statusCode).toBe(400)
    expect(res.statusData.error).toContain('Invalid user id')
  })

  it('returns 400 for invalid period', async () => {
    getCurrentUser.mockResolvedValue({ id: 100, role: 'manager', team: 'AI' })
    const res = mockRes()
    await handler(mockReq({ query: { id: '1', period: 'quarterly' } }), res)
    expect(res.statusCode).toBe(400)
    expect(res.statusData.error).toContain('Supported periods')
  })

  it('returns 404 for non-existent person', async () => {
    getCurrentUser.mockResolvedValue({ id: 100, role: 'manager', team: 'AI' })
    mockSql.mockResolvedValueOnce([])
    const res = mockRes()
    await handler(mockReq(), res)
    expect(res.statusCode).toBe(404)
  })

  it('returns 403 when team_lead accesses other team', async () => {
    getCurrentUser.mockResolvedValue({ id: 101, role: 'team_lead', team: 'AI' })
    mockSql.mockResolvedValueOnce([{ ...personRow, team: 'Java' }])
    const res = mockRes()
    await handler(mockReq(), res)
    expect(res.statusCode).toBe(403)
  })

  it('returns full profile for manager', async () => {
    getCurrentUser.mockResolvedValue({ id: 100, role: 'manager', team: 'AI' })
    setupFull()
    const res = mockRes()
    await handler(mockReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.statusData.person.name).toBe('Alice')
    expect(res.statusData.person.team).toBe('AI')
    expect(res.statusData.performance.overall_score).toBe(75)
    expect(res.statusData.velocity.tickets_per_week).toBeDefined()
    expect(res.statusData.workload.active_tickets).toBe(5)
    expect(res.statusData.time_logging.hours_this_month).toBe(80)
    expect(res.statusData.commitments.total).toBe(10)
    expect(res.statusData.commitments.kept_rate).toBe(80)
    expect(res.statusData.team_context.team_overall_score).toBe(70)
  })

  it('returns full profile for team_lead accessing own team', async () => {
    getCurrentUser.mockResolvedValue({ id: 101, role: 'team_lead', team: 'AI' })
    setupFull()
    const res = mockRes()
    await handler(mockReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.statusData.person.name).toBe('Alice')
  })

  it('handles user with no dashboard_users link', async () => {
    getCurrentUser.mockResolvedValue({ id: 100, role: 'manager', team: 'AI' })
    mockSql.mockResolvedValueOnce([personRow])
    mockSql.mockResolvedValueOnce([])
    mockSql.mockResolvedValueOnce([])
    mockSql.mockResolvedValueOnce([])
    mockSql.mockResolvedValueOnce([{ active_tickets: 0 }])
    mockSql.mockResolvedValueOnce([{}])
    mockSql.mockResolvedValueOnce([])
    mockSql.mockResolvedValueOnce([{}])
    mockSql.mockResolvedValueOnce([])
    mockSql.mockResolvedValueOnce([teamHealthRow])
    mockSql.mockResolvedValueOnce([{ team_avg: 68 }])
    const res = mockRes()
    await handler(mockReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.statusData.performance).toBeNull()
    expect(res.statusData.commitments.total).toBe(0)
  })

  it('defaults period to daily when not specified', async () => {
    getCurrentUser.mockResolvedValue({ id: 100, role: 'manager', team: 'AI' })
    mockSql.mockResolvedValueOnce([personRow])
    mockSql.mockResolvedValueOnce([])
    mockSql.mockResolvedValueOnce([dashUserRow])
    mockSql.mockResolvedValueOnce([perfRow])
    mockSql.mockResolvedValueOnce([])
    mockSql.mockResolvedValueOnce([{ active_tickets: 0 }])
    mockSql.mockResolvedValueOnce([{}])
    mockSql.mockResolvedValueOnce([capacityRow])
    mockSql.mockResolvedValueOnce([{ hours_this_month: 0, days_logged: 0 }])
    mockSql.mockResolvedValueOnce([{}])
    mockSql.mockResolvedValueOnce([])
    mockSql.mockResolvedValueOnce([teamHealthRow])
    mockSql.mockResolvedValueOnce([{ team_avg: 68 }])
    const res = mockRes()
    await handler(mockReq({ query: { id: '1' } }), res)
    expect(res.statusCode).toBe(200)
  })
})
