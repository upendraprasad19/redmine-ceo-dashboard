import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Set env before requiring module (module reads env at require time)
process.env.RESEND_API_KEY = 'test-resend-key'
process.env.EMAIL_FROM = 'test@thinkingcode.com'

const { sendReport, sendText, getTransporter } = require('../../lib/email.js')

let mockFetch

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ id: 'msg_123' }),
  })
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendReport', () => {
  it('sends email via Resend API and returns response', async () => {
    const result = await sendReport('user@thinkingcode.com', 'Subject', '<p>Body</p>')
    expect(result).toEqual({ id: 'msg_123' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body)
    expect(body.from).toBe('test@thinkingcode.com')
    expect(body.to).toEqual(['user@thinkingcode.com'])
    expect(body.subject).toBe('Subject')
    expect(body.html).toBe('<p>Body</p>')
  })

  it('normalizes thinking-code.com domain in recipient', async () => {
    await sendReport('admin@thinking-code.com', 'Hi', 'text')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.to).toEqual(['admin@thinkingcode.com'])
  })

  it('throws when all recipients are invalid', async () => {
    await expect(sendReport(null, 'Subject', 'body')).rejects.toThrow(/No valid recipient/)
  })

  it('throws when API returns error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'Invalid email' }),
    })
    await expect(sendReport('bad', 'Sub', 'body')).rejects.toThrow(/Resend 422/)
  })
})

describe('sendText', () => {
  it('sends plain text email', async () => {
    await sendText('user@thinkingcode.com', 'Subject', 'Plain body')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.text).toBe('Plain body')
    expect(body.html).toBeUndefined()
  })
})

describe('getTransporter', () => {
  it('returns object with sendMail function', () => {
    const t = getTransporter()
    expect(typeof t.sendMail).toBe('function')
  })

  it('sendMail delegates to Resend API', async () => {
    const t = getTransporter()
    await t.sendMail({ to: 'a@b.com', subject: 'S', html: '<p>h</p>' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('env validation', () => {
  it('throws when RESEND_API_KEY is missing', async () => {
    const orig = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    // Re-require to pick up env change
    vi.resetModules()
    const { sendReport: freshSend } = require('../../lib/email.js')
    await expect(freshSend('a@b.com', 'S', 'body')).rejects.toThrow(/RESEND_API_KEY/)
    process.env.RESEND_API_KEY = orig
  })
})
