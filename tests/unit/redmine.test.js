import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Set env before requiring module (module reads at require time)
process.env.REDMINE_URL = 'https://redmine.thinkingcode.com'
process.env.REDMINE_API_KEY = 'test-redmine-key'

const {
  getTickets,
  getTicket,
  getTicketsByAssignee,
  getOverdueTickets,
  getProjects,
  getProject,
  getUsers,
  getUser,
  getTimeEntries,
  getTimeEntriesByUser,
} = require('../../lib/redmine.js')

let mockFetch

beforeEach(() => {
  mockFetch = vi.fn()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function okJson(data) {
  return { ok: true, json: () => Promise.resolve(data) }
}

function errStatus(status, statusText = 'Error') {
  return { ok: false, status, statusText, json: () => Promise.resolve({}) }
}

describe('redmineFetch (internal)', () => {
  it('throws on non-OK HTTP response', async () => {
    mockFetch.mockResolvedValueOnce(errStatus(404, 'Not Found'))
    await expect(getTickets()).rejects.toThrow(/Redmine 404/)
  })

  it('appends API key as query parameter', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ issues: [] }))
    await getTickets()
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('key=test-redmine-key')
  })

  it('uses &key= when path already has query string', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ issues: [] }))
    await getTickets({ status: 'open' })
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('?status_id=open&key=test-redmine-key')
  })
})

describe('getTickets', () => {
  it('returns issues array', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ issues: [{ id: 1 }, { id: 2 }] }))
    const issues = await getTickets()
    expect(issues).toHaveLength(2)
  })

  it('passes all params as query string', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ issues: [] }))
    await getTickets({
      status: 'open',
      assignee: 5,
      project: 'test',
      limit: 10,
      offset: 20,
      sort: 'created_on:desc',
    })
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('status_id=open')
    expect(url).toContain('assigned_to_id=5')
    expect(url).toContain('project_id=test')
    expect(url).toContain('limit=10')
    expect(url).toContain('offset=20')
    expect(url).toContain('sort=created_on')
  })

  it('omits undefined params', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ issues: [] }))
    await getTickets({ status: 'open' })
    const url = mockFetch.mock.calls[0][0]
    expect(url).not.toContain('assigned_to_id')
    expect(url).not.toContain('project_id')
  })
})

describe('getTicket', () => {
  it('returns single issue', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ issue: { id: 42, subject: 'Fix bug' } }))
    const issue = await getTicket(42)
    expect(issue.id).toBe(42)
    expect(issue.subject).toBe('Fix bug')
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('/issues/42.json')
    expect(url).toContain('include=journals,attachments')
  })
})

describe('getTicketsByAssignee', () => {
  it('fetches open issues for a user', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ issues: [{ id: 10 }] }))
    const issues = await getTicketsByAssignee(7)
    expect(issues).toHaveLength(1)
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('assigned_to_id=7')
    expect(url).toContain('status_id=open')
  })
})

describe('getOverdueTickets', () => {
  it('fetches open issues with due_date <= today', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ issues: [] }))
    await getOverdueTickets()
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('status_id=open')
    expect(url).toContain('due_date=')
    expect(url).toContain('sort=due_date:asc')
  })
})

describe('getProjects', () => {
  it('returns projects array', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ projects: [{ id: 1 }] }))
    const projects = await getProjects()
    expect(projects).toHaveLength(1)
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('/projects.json')
  })
})

describe('getProject', () => {
  it('returns single project with includes', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ project: { id: 3, name: 'Test' } }))
    const project = await getProject(3)
    expect(project.id).toBe(3)
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('/projects/3.json')
    expect(url).toContain('include=trackers,issue_categories')
  })
})

describe('getUsers', () => {
  it('returns users array', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ users: [{ id: 1 }] }))
    const users = await getUsers()
    expect(users).toHaveLength(1)
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('/users.json')
    expect(url).toContain('status=0')
  })
})

describe('getUser', () => {
  it('returns single user with memberships', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ user: { id: 5, login: 'alice' } }))
    const user = await getUser(5)
    expect(user.login).toBe('alice')
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('/users/5.json')
    expect(url).toContain('include=memberships')
  })
})

describe('getTimeEntries', () => {
  it('returns time_entries array', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ time_entries: [{ id: 1 }] }))
    const entries = await getTimeEntries()
    expect(entries).toHaveLength(1)
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('/time_entries.json')
  })

  it('passes all params as query string', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ time_entries: [] }))
    await getTimeEntries({
      from: '2026-01-01',
      to: '2026-01-31',
      user_id: 3,
      project_id: 7,
      limit: 50,
      offset: 10,
    })
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('from=2026-01-01')
    expect(url).toContain('to=2026-01-31')
    expect(url).toContain('user_id=3')
    expect(url).toContain('project_id=7')
    expect(url).toContain('limit=50')
    expect(url).toContain('offset=10')
  })
})

describe('getTimeEntriesByUser', () => {
  it('fetches time entries for a user with date range', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ time_entries: [{ id: 1, hours: 2 }] }))
    const entries = await getTimeEntriesByUser(4, '2026-06-01', '2026-06-30')
    expect(entries).toHaveLength(1)
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('user_id=4')
    expect(url).toContain('from=2026-06-01')
    expect(url).toContain('to=2026-06-30')
  })

  it('works without from/to', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ time_entries: [] }))
    await getTimeEntriesByUser(4)
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('user_id=4')
    expect(url).not.toContain('from=')
    expect(url).not.toContain('to=')
  })
})
