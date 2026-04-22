import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Local mock for Resend. The `sendMock` is hoisted via vi.hoisted so the
// vi.mock factory (which vitest hoists above imports) can close over it.
const { sendMock, ResendCtor } = vi.hoisted(() => {
  const sendMock = vi.fn();
  const ResendCtor = vi.fn(() => ({ emails: { send: sendMock } }));
  return { sendMock, ResendCtor };
});

vi.mock('resend', () => ({ Resend: ResendCtor }));

// Import via dynamic ESM so the whole module graph (including the nested
// require('resend') inside lib/email.js) goes through vitest's loader and
// picks up the mock above.
const emailMod = await import('../../lib/email.js');
const { sendOtp, sendAccessApproved, sendAccessRejected } = emailMod.default || emailMod;

describe('lib/email (Resend transactional wrapper)', () => {
  let originalKey;
  let originalFrom;

  beforeEach(() => {
    originalKey = process.env.RESEND_API_KEY;
    originalFrom = process.env.EMAIL_FROM;
    process.env.RESEND_API_KEY = 'test_key';
    process.env.EMAIL_FROM = 'noreply@thinkingcode.in';
    sendMock.mockReset();
    ResendCtor.mockClear();
    sendMock.mockResolvedValue({ data: { id: 'msg_123' }, error: null });
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
  });

  // ---------- sendOtp ----------
  describe('sendOtp', () => {
    it('calls resend.emails.send with correct from/to/subject and embeds the code', async () => {
      await sendOtp('a@b.com', '123456');
      expect(sendMock).toHaveBeenCalledTimes(1);
      const payload = sendMock.mock.calls[0][0];
      expect(payload.from).toBe('noreply@thinkingcode.in');
      expect(payload.to).toBe('a@b.com');
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

    it('throws with Resend error message when send returns error', async () => {
      sendMock.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } });
      await expect(sendOtp('a@b.com', '123456')).rejects.toThrow(/rate limited/);
    });
  });

  // ---------- sendAccessApproved ----------
  describe('sendAccessApproved', () => {
    it('embeds name and link (href + text fallback)', async () => {
      const link = 'https://example.com/register?req=xyz';
      await sendAccessApproved('a@b.com', 'Vivek', link);
      const payload = sendMock.mock.calls[0][0];
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

    it('throws with Resend error message when send returns error', async () => {
      sendMock.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } });
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
      const payload = sendMock.mock.calls[0][0];
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
      const payload = sendMock.mock.calls[0][0];
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

    it('throws with Resend error message when send returns error', async () => {
      sendMock.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } });
      await expect(sendAccessRejected('a@b.com', 'Pradeep')).rejects.toThrow(/rate limited/);
    });

    it('escapes HTML-injection attempts in name', async () => {
      await sendAccessRejected('a@b.com', '<script>alert(1)</script>');
      const payload = sendMock.mock.calls[0][0];
      expect(payload.html).not.toContain('<script>alert(1)</script>');
      expect(payload.html).toContain('&lt;script&gt;');
    });
  });

  describe('email normalization', () => {
    it('normalizes thinking-code.com → thinkingcode.com on send', async () => {
      await sendOtp('  Someone@THINKING-CODE.com  ', '123456');
      expect(sendMock.mock.calls[0][0].to).toBe('someone@thinkingcode.com');
    });
  });
});
