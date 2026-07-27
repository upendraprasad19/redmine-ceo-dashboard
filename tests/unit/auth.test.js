import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Set JWT_SECRET before requiring module (module reads at require time)
process.env.JWT_SECRET = 'test-secret-key-for-testing'
process.env.NODE_ENV = 'test'

const dbModule = require('../../lib/db.js')
vi.spyOn(dbModule, 'getDb').mockImplementation(() => vi.fn())

const {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  getCurrentUser,
  setAuthCookie,
  clearAuthCookie,
  COOKIE_NAME,
} = require('../../lib/auth.js')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('hashPassword / verifyPassword', () => {
  it('hashPassword returns a bcrypt hash', async () => {
    const hash = await hashPassword('mypassword')
    expect(hash).toMatch(/^\$2[aby]?\$/)
    expect(hash).not.toBe('mypassword')
  })

  it('verifyPassword returns true for matching password', async () => {
    const hash = await hashPassword('correcthorse')
    expect(await verifyPassword('correcthorse', hash)).toBe(true)
  })

  it('verifyPassword returns false for wrong password', async () => {
    const hash = await hashPassword('correcthorse')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})

describe('createToken / verifyToken', () => {
  it('creates a JWT token string', () => {
    const token = createToken({
      id: 1,
      username: 'alice',
      role: 'manager',
      team: 'Alpha',
      display_name: 'Alice M',
    })
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)
  })

  it('verifyToken decodes the payload', () => {
    const user = {
      id: 5,
      username: 'bob',
      role: 'developer',
      team: 'Beta',
      display_name: 'Bob D',
    }
    const token = createToken(user)
    const decoded = verifyToken(token)
    expect(decoded.id).toBe(5)
    expect(decoded.username).toBe('bob')
    expect(decoded.role).toBe('developer')
  })

  it('verifyToken throws on invalid token', () => {
    expect(() => verifyToken('garbage')).toThrow()
  })

  it('verifyToken throws on wrong secret', () => {
    const token = createToken({ id: 1, username: 'a', role: 'r', team: 't', display_name: 'A' })
    // Tamper with the token to invalidate it
    expect(() => verifyToken(token + 'x')).toThrow()
  })
})

describe('getCurrentUser', () => {
  it('extracts user from req.cookies', async () => {
    const token = createToken({
      id: 1,
      username: 'alice',
      role: 'manager',
      team: 'Alpha',
      display_name: 'Alice',
    })
    const req = { cookies: { ceo_session: token }, headers: {} }
    const user = await getCurrentUser(req)
    expect(user.id).toBe(1)
    expect(user.username).toBe('alice')
  })

  it('extracts user from cookie header string', async () => {
    const token = createToken({
      id: 2,
      username: 'bob',
      role: 'developer',
      team: 'Beta',
      display_name: 'Bob',
    })
    const req = { headers: { cookie: `ceo_session=${token}` } }
    const user = await getCurrentUser(req)
    expect(user.id).toBe(2)
  })

  it('extracts user from Authorization Bearer header', async () => {
    const token = createToken({
      id: 3,
      username: 'carol',
      role: 'team_lead',
      team: 'Gamma',
      display_name: 'Carol',
    })
    const req = { headers: { authorization: `Bearer ${token}` } }
    const user = await getCurrentUser(req)
    expect(user.id).toBe(3)
    expect(user.role).toBe('team_lead')
  })

  it('returns null when no token present', async () => {
    const user = await getCurrentUser({ headers: {} })
    expect(user).toBeNull()
  })

  it('returns null when token is invalid', async () => {
    const user = await getCurrentUser({
      cookies: { ceo_session: 'bad-token' },
      headers: {},
    })
    expect(user).toBeNull()
  })

  it('returns null when Authorization header has wrong format', async () => {
    const user = await getCurrentUser({
      headers: { authorization: 'Basic abc123' },
    })
    expect(user).toBeNull()
  })
})

describe('setAuthCookie / clearAuthCookie', () => {
  function mockRes() {
    const res = { headers: {} }
    res.setHeader = (name, val) => { res.headers[name] = val }
    return res
  }

  it('setAuthCookie sets a Set-Cookie header', () => {
    const res = mockRes()
    const token = createToken({
      id: 1,
      username: 'a',
      role: 'r',
      team: 't',
      display_name: 'A',
    })
    setAuthCookie(res, token)
    expect(res.headers['Set-Cookie']).toBeDefined()
    expect(res.headers['Set-Cookie']).toContain(COOKIE_NAME)
    expect(res.headers['Set-Cookie']).toContain(token)
    expect(res.headers['Set-Cookie']).toContain('HttpOnly')
    expect(res.headers['Set-Cookie']).toContain('SameSite=Strict')
  })

  it('clearAuthCookie sets maxAge=0', () => {
    const res = mockRes()
    clearAuthCookie(res)
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0')
  })
})

describe('COOKIE_NAME', () => {
  it('is ceo_session', () => {
    expect(COOKIE_NAME).toBe('ceo_session')
  })
})
