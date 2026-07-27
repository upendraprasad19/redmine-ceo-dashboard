import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sendTelegramMessage } = require('../../lib/telegram.js')

let mockFetch

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
  })
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendTelegramMessage', () => {
  it('returns { ok: false, reason } when TELEGRAM_BOT_TOKEN is not set', async () => {
    const orig = process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_BOT_TOKEN
    const r = await sendTelegramMessage(123, 'hello')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/TELEGRAM_BOT_TOKEN/)
    process.env.TELEGRAM_BOT_TOKEN = orig
  })

  it('returns { ok: false, reason } when chatId is missing', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    const r = await sendTelegramMessage(null, 'hello')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/chat_id/)
  })

  it('returns { ok: false, reason } when chatId is 0', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    const r = await sendTelegramMessage(0, 'hello')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/chat_id/)
  })

  it('calls Telegram API with correct URL and body', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    await sendTelegramMessage(123, 'hello world')
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage')
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body)
    expect(body.chat_id).toBe(123)
    expect(body.text).toBe('hello world')
    expect(body.parse_mode).toBe('Markdown')
  })

  it('respects custom parseMode', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    await sendTelegramMessage(123, 'hi', { parseMode: 'HTML' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.parse_mode).toBe('HTML')
  })

  it('returns raw Telegram response', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    const r = await sendTelegramMessage(123, 'test')
    expect(r.ok).toBe(true)
    expect(r.result.message_id).toBe(42)
  })
})
