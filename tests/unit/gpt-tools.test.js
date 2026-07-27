import { describe, expect, it } from 'vitest'

const { tools } = require('../../lib/gpt-tools.js')

describe('tools', () => {
  it('is an array', () => {
    expect(Array.isArray(tools)).toBe(true)
  })

  it('has at least 15 tools', () => {
    expect(tools.length).toBeGreaterThanOrEqual(15)
  })

  it('all items have type function', () => {
    for (const t of tools) {
      expect(t.type).toBe('function')
    }
  })

  it('all items have a function.name', () => {
    for (const t of tools) {
      expect(t.function).toBeDefined()
      expect(t.function.name).toBeDefined()
      expect(typeof t.function.name).toBe('string')
    }
  })

  it('all tool names are unique', () => {
    const names = tools.map((t) => t.function.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('all items have a description', () => {
    for (const t of tools) {
      expect(t.function.description).toBeDefined()
      expect(t.function.description.length).toBeGreaterThan(0)
    }
  })

  it('all items have parameters with type object', () => {
    for (const t of tools) {
      expect(t.function.parameters).toBeDefined()
      expect(t.function.parameters.type).toBe('object')
    }
  })

  it('contains get_tickets', () => {
    const names = tools.map((t) => t.function.name)
    expect(names).toContain('get_tickets')
  })

  it('contains propose_intimation', () => {
    const names = tools.map((t) => t.function.name)
    expect(names).toContain('propose_intimation')
  })

  it('contains extract_commitment', () => {
    const names = tools.map((t) => t.function.name)
    expect(names).toContain('extract_commitment')
  })

  it('contains log_unknown_query', () => {
    const names = tools.map((t) => t.function.name)
    expect(names).toContain('log_unknown_query')
  })

  it('tools with required params have them declared', () => {
    const requiredTools = tools.filter((t) => t.function.parameters.required)
    for (const t of requiredTools) {
      const propKeys = Object.keys(t.function.parameters.properties)
      for (const req of t.function.parameters.required) {
        expect(propKeys).toContain(req)
      }
    }
  })
})