import { describe, expect, it } from 'vitest'

const { getProjectBucket, MAYA_PROJECTS, BUCKET_LABELS } = require('../../lib/pm-pulse.js')

describe('getProjectBucket', () => {
  it('maps iCLAIMS 2.0 to its own bucket', () => {
    expect(getProjectBucket('iCLAIMS 2.0')).toBe('iCLAIMS 2.0')
  })

  it('maps Reports 3.0 to its own bucket', () => {
    expect(getProjectBucket('Reports 3.0')).toBe('Reports 3.0')
  })

  it('maps Maya Virtual Assistant to Maya bucket', () => {
    expect(getProjectBucket('Maya Virtual Assistant')).toBe('Maya Virtual Agent & Sub')
  })

  it('maps Producer App to Maya bucket', () => {
    expect(getProjectBucket('Producer App')).toBe('Maya Virtual Agent & Sub')
  })

  it('maps Claim Info Bot to Maya bucket', () => {
    expect(getProjectBucket('Claim Info Bot')).toBe('Maya Virtual Agent & Sub')
  })

  it('maps unknown projects to Miscellaneous', () => {
    expect(getProjectBucket('Random Project')).toBe('Miscellaneous')
  })

  it('maps iCLAIMS (without 2.0) to Miscellaneous', () => {
    expect(getProjectBucket('iCLAIMS')).toBe('Miscellaneous')
  })

  it('maps Reports (without 3.0) to Miscellaneous', () => {
    expect(getProjectBucket('Reports')).toBe('Miscellaneous')
  })
})

describe('MAYA_PROJECTS', () => {
  it('is an array', () => {
    expect(Array.isArray(MAYA_PROJECTS)).toBe(true)
  })

  it('contains Maya Virtual Assistant', () => {
    expect(MAYA_PROJECTS).toContain('Maya Virtual Assistant')
  })

  it('contains Producer App', () => {
    expect(MAYA_PROJECTS).toContain('Producer App')
  })

  it('has 11 entries', () => {
    expect(MAYA_PROJECTS).toHaveLength(11)
  })
})

describe('BUCKET_LABELS', () => {
  it('is an array', () => {
    expect(Array.isArray(BUCKET_LABELS)).toBe(true)
  })

  it('has 4 bucket labels', () => {
    expect(BUCKET_LABELS).toHaveLength(4)
  })

  it('contains all expected buckets', () => {
    expect(BUCKET_LABELS).toEqual([
      'iCLAIMS 2.0',
      'Reports 3.0',
      'Maya Virtual Agent & Sub',
      'Miscellaneous',
    ])
  })
})