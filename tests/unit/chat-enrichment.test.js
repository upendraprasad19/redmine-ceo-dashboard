import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.CEREBRAS_API_KEY = 'key1'
process.env.CEREBRAS_API_KEY_2 = 'key2'
process.env.OPENROUTER_API_KEY = 'or-key'
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'

const dbModule = require('../../lib/db.js')
vi.spyOn(dbModule, 'getDb').mockReturnValue(vi.fn())

const aiModule = require('../../lib/ai.js')
vi.spyOn(aiModule, 'chat')

const { classifyOne, INTENT_ENUM } = require('../../lib/chat-enrichment.js')

afterEach(() => vi.clearAllMocks())

describe('INTENT_ENUM', () => {
  it('contains expected intents', () => {
    expect(INTENT_ENUM).toContain('query_ticket_status')
    expect(INTENT_ENUM).toContain('intimate_person')
    expect(INTENT_ENUM).toContain('log_time')
    expect(INTENT_ENUM).toContain('other')
  })
})

describe('classifyOne', () => {
  it('parses valid JSON response', async () => {
    aiModule.chat.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '{"intent":"log_time","entities":{"tickets":[],"users":["Bob"],"projects":[]}}',
          },
        },
      ],
    })

    const result = await classifyOne('log 2 hours for TK-100')
    expect(result.intent).toBe('log_time')
    expect(result.entities.users).toContain('Bob')
  })

  it('returns null on invalid JSON', async () => {
    aiModule.chat.mockResolvedValue({
      choices: [{ message: { content: 'not json at all' } }],
    })

    const result = await classifyOne('random text')
    expect(result).toBeNull()
  })

  it('returns null when no JSON in response', async () => {
    aiModule.chat.mockResolvedValue({
      choices: [{ message: { content: 'I cannot classify that.' } }],
    })

    const result = await classifyOne('hello')
    expect(result).toBeNull()
  })

  it('maps unknown intent to other', async () => {
    aiModule.chat.mockResolvedValue({
      choices: [{ message: { content: '{"intent":"unknown_intent","entities":{}}' } }],
    })

    const result = await classifyOne('test')
    expect(result.intent).toBe('other')
  })

  it('filters tickets to integers only', async () => {
    aiModule.chat.mockResolvedValue({
      choices: [
        { message: { content: '{"intent":"other","entities":{"tickets":[123,"abc",456.7]}}' } },
      ],
    })

    const result = await classifyOne('test')
    expect(result.entities.tickets).toEqual([123])
  })

  it('drops string ticket IDs', async () => {
    aiModule.chat.mockResolvedValue({
      choices: [{ message: { content: '{"intent":"other","entities":{"tickets":["12345"]}}' } }],
    })

    const result = await classifyOne('test')
    expect(result.entities.tickets).toEqual([])
  })

  it('caps users at 10 items', async () => {
    const users = Array.from({ length: 15 }, (_, i) => `User${i}`)
    aiModule.chat.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ intent: 'other', entities: { users } }) } }],
    })

    const result = await classifyOne('test')
    expect(result.entities.users).toHaveLength(10)
  })

  it('caps projects at 10 items', async () => {
    const projects = Array.from({ length: 20 }, (_, i) => `Proj${i}`)
    aiModule.chat.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ intent: 'other', entities: { projects } }) } },
      ],
    })

    const result = await classifyOne('test')
    expect(result.entities.projects).toHaveLength(10)
  })

  it('returns null when JSON.parse throws', async () => {
    aiModule.chat.mockResolvedValue({
      choices: [{ message: { content: '{broken json' } }],
    })

    const result = await classifyOne('test')
    expect(result).toBeNull()
  })
})
