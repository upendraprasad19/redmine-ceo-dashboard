import { describe, it, expect } from 'vitest';
import {
  generateCode,
  generateOtp,
  getClientIp,
} from '../../lib/register-helpers.js';

describe('generateCode', () => {
  it('returns a 32-character lowercase hex string', () => {
    const code = generateCode();
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    expect(code).toHaveLength(32);
  });

  it('returns a different value on subsequent calls', () => {
    const a = generateCode();
    const b = generateCode();
    expect(a).not.toBe(b);
  });
});

describe('generateOtp', () => {
  it('returns exactly 6 digits, zero-padded', () => {
    for (let i = 0; i < 100; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
      expect(otp).toHaveLength(6);
    }
  });
});

describe('getClientIp', () => {
  it('prefers the first entry of x-forwarded-for, trimmed', () => {
    const req = {
      headers: { 'x-forwarded-for': '  203.0.113.5 , 10.0.0.1 , 10.0.0.2  ' },
      socket: { remoteAddress: '10.0.0.99' },
    };
    expect(getClientIp(req)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip when x-forwarded-for absent', () => {
    const req = {
      headers: { 'x-real-ip': '198.51.100.7' },
      socket: { remoteAddress: '10.0.0.99' },
    };
    expect(getClientIp(req)).toBe('198.51.100.7');
  });

  it('falls back to socket.remoteAddress when headers absent', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: '192.0.2.42' },
    };
    expect(getClientIp(req)).toBe('192.0.2.42');
  });

  it('returns "unknown" when no source is available', () => {
    expect(getClientIp({ headers: {} })).toBe('unknown');
    expect(getClientIp({ headers: {}, socket: {} })).toBe('unknown');
    expect(getClientIp({})).toBe('unknown');
  });

  it('lowercases and trims the result', () => {
    const req = { headers: { 'x-forwarded-for': '  2001:DB8::1  ' } };
    expect(getClientIp(req)).toBe('2001:db8::1');
  });
});
