import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.JWT_SECRET = 'test-secret'
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'

const dbModule = require('../../lib/db.js')
vi.spyOn(dbModule, 'getDb').mockReturnValue(vi.fn())

const authModule = require('../../lib/auth.js')
vi.spyOn(authModule, 'getCurrentUser')

const rolesModule = require('../../lib/roles.js')
vi.spyOn(rolesModule, 'checkAccess')

const { requireAdmin } = require('../../lib/admin.js')

afterEach(() => vi.clearAllMocks())

describe('requireAdmin', () => {
  it('returns user when authenticated and admin', async () => {
    const mockUser = { id: 1, role: 'manager' }
    authModule.getCurrentUser.mockResolvedValue(mockUser)
    rolesModule.checkAccess.mockReturnValue(true)
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }

    const result = await requireAdmin({}, res)

    expect(result).toBe(mockUser)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns null with 403 when not admin', async () => {
    const mockUser = { id: 2, role: 'developer' }
    authModule.getCurrentUser.mockResolvedValue(mockUser)
    rolesModule.checkAccess.mockReturnValue(false)
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }

    const result = await requireAdmin({}, res)

    expect(result).toBeNull()
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' })
  })

  it('returns null with 401 when unauthenticated', async () => {
    authModule.getCurrentUser.mockResolvedValue(null)
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }

    const result = await requireAdmin({}, res)

    expect(result).toBeNull()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' })
  })

  it('propagates error when getCurrentUser throws', async () => {
    authModule.getCurrentUser.mockRejectedValue(new Error('DB down'))
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }

    await expect(requireAdmin({}, res)).rejects.toThrow('DB down')
  })

  it('propagates error when checkAccess throws', async () => {
    const mockUser = { id: 1, role: 'manager' }
    authModule.getCurrentUser.mockResolvedValue(mockUser)
    rolesModule.checkAccess.mockImplementation(() => {
      throw new Error('bad user')
    })
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }

    await expect(requireAdmin({}, res)).rejects.toThrow('bad user')
  })
})
