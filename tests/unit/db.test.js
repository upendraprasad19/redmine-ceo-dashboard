import { describe, expect, it } from 'vitest'

const { formatVector } = require('../../lib/db.js')

describe('formatVector', () => {
  it('formats array of floats', () => {
    expect(formatVector([1, 2.5, 3])).toBe('[1,2.5,3]')
  })

  it('formats empty array', () => {
    expect(formatVector([])).toBe('[]')
  })

  it('collapses integer floats', () => {
    expect(formatVector([1.0, 2.0])).toBe('[1,2]')
  })
})
