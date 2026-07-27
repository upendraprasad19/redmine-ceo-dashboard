import { describe, expect, it } from 'vitest'

const { normalizeEmail } = require('../../lib/email-utils.js')

describe('normalizeEmail', () => {
  it('returns null for null input', () => {
    expect(normalizeEmail(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(normalizeEmail(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeEmail('')).toBeNull()
  })

  it('trims whitespace and lowercases', () => {
    expect(normalizeEmail('  User@Thinking-Code.COM  ')).toBe('user@thinkingcode.com')
  })

  it('normalizes mail.thinking-code.com subdomain', () => {
    expect(normalizeEmail('admin@mail.thinking-code.com')).toBe('admin@mail.thinkingcode.com')
  })

  it('preserves already-correct domain', () => {
    expect(normalizeEmail('ok@thinkingcode.com')).toBe('ok@thinkingcode.com')
  })

  it('normalizes x-thinking-code.com variants', () => {
    expect(normalizeEmail('dev@x-thinking-code.com')).toBe('dev@x-thinkingcode.com')
  })

  it('does not modify non-thinking-code domains', () => {
    expect(normalizeEmail('user@gmail.com')).toBe('user@gmail.com')
  })
})