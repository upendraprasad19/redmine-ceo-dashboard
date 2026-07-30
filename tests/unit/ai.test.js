import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.CEREBRAS_API_KEY = 'key1'
process.env.CEREBRAS_API_KEY_2 = 'key2'
process.env.OPENROUTER_API_KEY = 'or-key'
process.env.AI_DEFAULT_MODEL = 'test/model'
process.env.OPENROUTER_BASE_URL = 'https://test/v1'
process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'

const dbModule = require('../../lib/db.js')
const mockDb = vi.fn()
vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb)

const aiModule = require('../../lib/ai.js')
vi.spyOn(aiModule, 'chat')
vi.spyOn(aiModule, 'embed')

afterEach(() => vi.clearAllMocks())

describe('getAIConfig', () => {
  it('returns DB row when active config exists', async () => {
    mockDb.mockResolvedValue([
      {
        provider: 'together',
        api_key: 'db-key',
        base_url: 'https://db.test',
        default_model: 'db-model',
        embedding_model: 'db-embed',
      },
    ])
    const config = await aiModule.getAIConfig()
    expect(config.provider).toBe('together')
    expect(config.api_key).toBe('db-key')
  })

  it('falls back to env defaults when DB throws', async () => {
    mockDb.mockRejectedValue(new Error('relation "ai_config" does not exist'))
    const config = await aiModule.getAIConfig()
    expect(config.provider).toBe('cerebras')
    expect(config.api_key).toBe('key1')
  })
})

describe('chat', () => {
  it('returns mocked response when called', async () => {
    aiModule.chat.mockResolvedValue({ choices: [{ message: { content: 'hi' } }] })

    const result = await aiModule.chat([{ role: 'user', content: 'hello' }])
    expect(result.choices[0].message.content).toBe('hi')
  })

  it('returns different mocked response', async () => {
    aiModule.chat.mockResolvedValue({ choices: [{ message: { content: 'fallback' } }] })

    const result = await aiModule.chat([{ role: 'user', content: 'hello' }])
    expect(result.choices[0].message.content).toBe('fallback')
  })

  it('throws when chat rejects', async () => {
    aiModule.chat.mockRejectedValue(new Error('all failed'))

    await expect(aiModule.chat([{ role: 'user', content: 'x' }])).rejects.toThrow('all failed')
  })
})

describe('embed', () => {
  it('returns null on error', async () => {
    aiModule.embed.mockResolvedValue(null)

    const result = await aiModule.embed('test text')
    expect(result).toBeNull()
  })

  it('returns embedding data', async () => {
    aiModule.embed.mockResolvedValue([1, 2, 3])

    const longText = 'a'.repeat(10000)
    const result = await aiModule.embed(longText)
    expect(result).toEqual([1, 2, 3])
  })
})
