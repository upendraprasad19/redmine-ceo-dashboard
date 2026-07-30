import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  findApiFiles,
  extractTableNames,
  classifyTableUsage,
  auditTableUsage,
} = require('../../lib/table-audit.js')

afterEach(() => vi.restoreAllMocks())

describe('extractTableNames', () => {
  it('extracts FROM and JOIN table names', () => {
    const spy = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('SELECT id FROM users JOIN projects ON users.team = projects.name')
    const tables = extractTableNames('/fake/file.js')
    expect(tables).toContain('users')
    expect(tables).toContain('projects')
    spy.mockRestore()
  })

  it('ignores SQL keywords', () => {
    const spy = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('SELECT id FROM users JOIN projects ON users.team = projects.name')
    const tables = extractTableNames('/fake/file.js')
    expect(tables.has('select')).toBe(false)
    expect(tables.has('where')).toBe(false)
    spy.mockRestore()
  })

  it('extracts INSERT INTO table names', () => {
    const spy = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue("INSERT INTO issues (title) VALUES ('test')")
    const tables = extractTableNames('/fake/file.js')
    expect(tables).toContain('issues')
    spy.mockRestore()
  })

  it('extracts UPDATE table names', () => {
    const spy = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue("UPDATE users SET role = 'admin' WHERE id = 1")
    const tables = extractTableNames('/fake/file.js')
    expect(tables).toContain('users')
    spy.mockRestore()
  })
})

describe('classifyTableUsage', () => {
  it('classifies reads vs writes', () => {
    const content =
      "SELECT id FROM users JOIN projects ON users.team = projects.name; INSERT INTO issues (title) VALUES ('test')"
    const spy = vi.spyOn(fs, 'readFileSync').mockReturnValue(content)
    const { reads, writes } = classifyTableUsage(['/fake/file.js'])

    expect(reads.has('users')).toBe(true)
    expect(writes.has('issues')).toBe(true)
    spy.mockRestore()
  })
})

describe('auditTableUsage', () => {
  it('returns error when no API files found', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const result = await auditTableUsage(vi.fn())
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No API files found')
    existsSpy.mockRestore()
  })

  it('calls sql for DB table list', async () => {
    class MockDirent {
      constructor(name, isDir = false) {
        this.name = name
        this._isDir = isDir
      }
      isDirectory() {
        return this._isDir
      }
      isFile() {
        return !this._isDir
      }
    }
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue('SELECT id FROM users')
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    const readdirSpy = vi
      .spyOn(fs, 'readdirSync')
      .mockReturnValueOnce([new MockDirent('test.js')])
      .mockReturnValue([])

    const mockSql = vi.fn().mockResolvedValue([{ table_name: 'users' }, { table_name: 'projects' }])

    const result = await auditTableUsage(mockSql)

    expect(result).toHaveProperty('totalFiles')
    expect(result).toHaveProperty('totalDbTables')
    readSpy.mockRestore()
    readdirSpy.mockRestore()
    existsSpy.mockRestore()
  })
})
