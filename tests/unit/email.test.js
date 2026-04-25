import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendOtp, sendAccessApproved, sendAccessRejected } from '../../lib/email.js';

// lib/email.js calls global fetch() to hit the Resend HTTP API. Mock that
// directly so we can assert the request payload without touching the network.
const fetchMock = vi.fn();

describe('lib/email (Resend HTTP transactional templates)', () => {
  let originalFetch;
  let originalKey;
  let originalFrom;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = fetchMock;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg_123' }),
    });

    originalKey = process.env.RESEND_API_KEY;
    originalFrom = process.env.EMAIL_FROM;
    process.env.RESEND_API_KEY = 'test_key';
    process.env.EMAIL_FROM = 'noreply@thinkingcode.in';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
  });

  function lastPayload() {
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return JSON.parse(call[1].body);
  }

  // ---------- sendOtp ----------
  describe('sendOtp', () => {
    it('posts to Resend with correct from/to/subject and embeds the code', async () => {
      await sendOtp('a@b.com', '123456');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const payload = lastPayload();
      expect(payload.from).toBe('noreply@thinkingcode.in');
      expect(payload.to).toEqual(['a@b.com']);
      expect(payload.subject).toBe('Your RedMine Dashboard verification code');
      expect(payload.html).toContain('123456');
      expect(payload.text).toContain('123456');
    });

    it('throws when RESEND_API_KEY is unset', async () => {
      delete process.env.RESEND_API_KEY;
      await expect(sendOtp('a@b.com', '123456')).rejects.toThrow(/RESEND_API_KEY/);
    });

    it('throws when `to` is empty', async () => {
      await expect(sendOtp('', '123456')).rejects.toThrow(/to/);
      await expect(sendOtp(undefined, '123456')).rejects.toThrow(/to/);
    });

    it('throws with Resend error message when send returns non-2xx', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ message: 'rate limited' }),
      });
      await expect(sendOtp('a@b.com', '123456')).rejects.toThrow(/rate limited/);
    });
  });

  // ---------- sendAccessApproved ----------
  describe('sendAccessApproved', () => {
    it('embeds name and link (href + text fallback)', async () => {
      const link = 'https://example.com/register?req=xyz';
      await sendAccessApproved('a@b.com', 'Vivek', link);
      const payload = lastPayload();
      expect(payload.subject).toBe('Your RedMine Dashboard access is ready');
      expect(payload.html).toContain(`href="${link}"`);
      expect(payload.html).toContain('Vivek');
      expect(payload.text).toContain(link);
      expect(payload.text).toContain('Vivek');
    });

    it('throws when RESEND_API_KEY is unset', async () => {
      delete process.env.RESEND_API_KEY;
      await expect(
        sendAccessApproved('a@b.com', 'Vivek', 'https://x.test/r')
      ).rejects.toThrow(/RESEND_API_KEY/);
    });

    it('throws when `to` is empty', async () => {
      await expect(sendAccessApproved('', 'Vivek', 'https://x.test/r')).rejects.toThrow(/to/);
    });

    it('throws with Resend error message when send returns non-2xx', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ message: 'rate limited' }),
      });
      await expect(
        sendAccessApproved('a@b.com', 'Vivek', 'https://x.test/r')
      ).rejects.toThrow(/rate limited/);
    });

    it('rejects non-http(s) links', async () => {
      await expect(
        sendAccessApproved('a@b.com', 'Vivek', 'javascript:alert(1)')
      ).rejects.toThrow(/http\(s\)/);
    });

    it('escapes HTML-injection attempts in name and link', async () => {
      await sendAccessApproved('a@b.com', '"><img src=x>', 'https://x.test/y?q="><script>');
      const payload = lastPayload();
      expect(payload.html).not.toContain('<img src=x>');
      expect(payload.html).not.toContain('"><script>');
      expect(payload.html).toContain('&quot;&gt;&lt;img');
      expect(payload.html).toContain('&quot;&gt;&lt;script&gt;');
    });
  });

  // ---------- sendAccessRejected ----------
  describe('sendAccessRejected', () => {
    it('uses correct subject and embeds name', async () => {
      await sendAccessRejected('a@b.com', 'Pradeep');
      const payload = lastPayload();
      expect(payload.subject).toBe('Your RedMine Dashboard access request');
      expect(payload.html).toContain('Pradeep');
      expect(payload.text).toContain('Pradeep');
    });

    it('throws when RESEND_API_KEY is unset', async () => {
      delete process.env.RESEND_API_KEY;
      await expect(sendAccessRejected('a@b.com', 'Pradeep')).rejects.toThrow(/RESEND_API_KEY/);
    });

    it('throws when `to` is empty', async () => {
      await expect(sendAccessRejected('', 'Pradeep')).rejects.toThrow(/to/);
    });

    it('throws with Resend error message when send returns non-2xx', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'rate limited' }),
      });
      await expect(sendAccessRejected('a@b.com', 'Pradeep')).rejects.toThrow(/rate limited/);
    });

    it('escapes HTML-injection attempts in name', async () => {
      await sendAccessRejected('a@b.com', '<script>alert(1)</script>');
      const payload = lastPayload();
      expect(payload.html).not.toContain('<script>alert(1)</script>');
      expect(payload.html).toContain('&lt;script&gt;');
    });
  });

  describe('email normalization', () => {
    it('normalizes thinking-code.com → thinkingcode.com on send', async () => {
      await sendOtp('  Someone@THINKING-CODE.com  ', '123456');
      expect(lastPayload().to).toEqual(['someone@thinkingcode.com']);
    });
  });
});
