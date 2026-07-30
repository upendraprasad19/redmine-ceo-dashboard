import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'

const dbModule = require('../../lib/db.js')
const mockSql = vi.fn()
vi.spyOn(dbModule, 'getDb').mockReturnValue(mockSql)

const { executeToolCall } = require('../../lib/gpt-executor.js')

const managerUser = { id: 1, role: 'manager', team: 'Alpha', display_name: 'Alice' }
const teamLeadUser = {
  id: 2,
  role: 'team_lead',
  team: 'Alpha',
  display_name: 'Bob',
  linked_redmine_user_id: 10,
}
const devUser = { id: 3, role: 'developer', team: 'Beta', display_name: 'Charlie' }

beforeEach(() => {
  mockSql.mockReset()
})

afterEach(() => vi.clearAllMocks())

describe('get_tickets', () => {
  it('uses linked_redmine_user_id when my_tickets=true', async () => {
    mockSql.mockResolvedValue([])
    await executeToolCall('get_tickets', { my_tickets: true, status: 'open' }, teamLeadUser)
    const allArgs = mockSql.mock.calls[0].slice(1)
    expect(allArgs).toContain(teamLeadUser.linked_redmine_user_id)
  })

  it('filters overdue tickets with date condition', async () => {
    mockSql.mockResolvedValue([])
    await executeToolCall('get_tickets', { status: 'overdue' }, teamLeadUser)
    expect(mockSql).toHaveBeenCalled()
    const queryStr = String(mockSql.mock.calls[0][0])
    expect(queryStr).toContain('CURRENT_DATE')
  })

  it('filters closed tickets', async () => {
    mockSql.mockResolvedValue([])
    await executeToolCall('get_tickets', { status: 'closed' }, managerUser)
    expect(mockSql).toHaveBeenCalled()
  })

  it('applies team filter for team_lead', async () => {
    mockSql.mockResolvedValue([])
    await executeToolCall('get_tickets', { status: 'open' }, teamLeadUser)
    const allArgs = mockSql.mock.calls[0].slice(1)
    expect(allArgs).toContain('Alpha')
  })

  it('no team filter for manager', async () => {
    mockSql.mockResolvedValue([])
    await executeToolCall('get_tickets', { status: 'open' }, managerUser)
    expect(mockSql).toHaveBeenCalled()
  })
})

describe('can_intimate', () => {
  it('true for open + assigned + overdue', async () => {
    mockSql.mockResolvedValue([
      {
        id: 1,
        redmine_id: 100,
        ticket_id: 'TK-100',
        title: 't',
        status: 'New',
        priority: 'High',
        due_date: '2025-01-01',
        created_on: new Date(),
        project_name: 'p',
        assigned_to: 'u',
        team: 'Alpha',
        assignee_id: 5,
      },
    ])
    const result = JSON.parse(
      await executeToolCall('get_tickets', { status: 'overdue' }, managerUser),
    )
    expect(result.tickets[0].can_intimate).toBe(true)
  })

  it('false for null assignee + blocked', async () => {
    mockSql.mockResolvedValue([
      {
        id: 1,
        redmine_id: 101,
        ticket_id: 'TK-101',
        title: 't',
        status: 'Blocked',
        priority: 'High',
        due_date: '2025-01-01',
        created_on: new Date(),
        project_name: 'p',
        assigned_to: null,
        team: 'Alpha',
        assignee_id: null,
      },
    ])
    const result = JSON.parse(
      await executeToolCall('get_tickets', { status: 'overdue' }, managerUser),
    )
    expect(result.tickets[0].can_intimate).toBe(false)
  })

  it('true for assigned + no due_date + blocked', async () => {
    mockSql.mockResolvedValue([
      {
        id: 1,
        redmine_id: 102,
        ticket_id: 'TK-102',
        title: 't',
        status: 'Blocked',
        priority: 'High',
        due_date: null,
        created_on: new Date(),
        project_name: 'p',
        assigned_to: 'u',
        team: 'Alpha',
        assignee_id: 5,
      },
    ])
    const result = JSON.parse(await executeToolCall('get_tickets', { status: 'open' }, managerUser))
    expect(result.tickets[0].can_intimate).toBe(true)
  })

  it('false for closed ticket', async () => {
    mockSql.mockResolvedValue([
      {
        id: 1,
        redmine_id: 103,
        ticket_id: 'TK-103',
        title: 't',
        status: 'Closed',
        priority: 'Normal',
        due_date: null,
        created_on: new Date(),
        project_name: 'p',
        assigned_to: 'u',
        team: 'Alpha',
        assignee_id: 5,
      },
    ])
    const result = JSON.parse(
      await executeToolCall('get_tickets', { status: 'closed' }, managerUser),
    )
    expect(result.tickets[0].can_intimate).toBe(false)
  })
})

describe('get_time_logs', () => {
  it('applies team filter for team_lead', async () => {
    mockSql.mockResolvedValue([
      { id: 1, name: 'Bob', team: 'Alpha', initials: 'B', hours: 8, logged: true, days_logged: 1 },
    ])
    const result = JSON.parse(
      await executeToolCall('get_time_logs', { range: 'daily' }, teamLeadUser),
    )
    expect(result).toHaveProperty('summary')
    expect(result.summary).toHaveProperty('missing_names')
  })

  it('filters missing_only', async () => {
    mockSql.mockResolvedValue([
      { id: 1, name: 'Bob', team: 'Alpha', initials: 'B', hours: 0, logged: false, days_logged: 0 },
      {
        id: 2,
        name: 'Alice',
        team: 'Alpha',
        initials: 'A',
        hours: 8,
        logged: true,
        days_logged: 1,
      },
    ])
    const result = JSON.parse(
      await executeToolCall('get_time_logs', { range: 'weekly', missing_only: true }, teamLeadUser),
    )
    expect(result.logs).toHaveLength(1)
    expect(result.logs[0].name).toBe('Bob')
  })
})

describe('search_knowledge', () => {
  it('returns placeholder', async () => {
    const result = JSON.parse(await executeToolCall('search_knowledge', {}, managerUser))
    expect(result.results).toEqual([])
    expect(result.note).toContain('coming soon')
  })
})

describe('get_ticket_comments', () => {
  it('returns empty comments when journals table missing', async () => {
    mockSql
      .mockResolvedValueOnce([
        { id: 1, redmine_id: 100, title: 't', status: 'New', priority: 'High', assigned_to: 'u' },
      ])
      .mockRejectedValueOnce(new Error('relation "journals" does not exist'))

    const result = JSON.parse(
      await executeToolCall('get_ticket_comments', { ticket_id: 'TK-100' }, managerUser),
    )
    expect(result.comments).toEqual([])
    expect(result.note).toContain('not synced yet')
  })
})

describe('create_exploration', () => {
  it('returns error when name missing', async () => {
    const result = JSON.parse(
      await executeToolCall('create_exploration', { description: 'd' }, managerUser),
    )
    expect(result.error).toContain('required')
  })

  it('returns error when description missing', async () => {
    const result = JSON.parse(
      await executeToolCall('create_exploration', { name: 'n' }, managerUser),
    )
    expect(result.error).toContain('required')
  })
})

describe('get_person_summary', () => {
  it('returns error when person_name missing', async () => {
    const result = JSON.parse(await executeToolCall('get_person_summary', {}, managerUser))
    expect(result.error).toContain('required')
  })
})

describe('default', () => {
  it('returns error for unknown tool', async () => {
    const result = JSON.parse(await executeToolCall('nonexistent_tool', {}, managerUser))
    expect(result.error).toContain('Unknown tool')
  })
})
