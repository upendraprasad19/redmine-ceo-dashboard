// Shared helpers for self-registration endpoints.
// - generateCode(): 32-hex opaque registration code
// - generateOtp(): zero-padded 6-digit OTP (used in Phase 3b)
// - getClientIp(req): best-effort IP from common proxy headers
// - rateLimit(sql, ip, bucket, maxAttempts, windowMs): atomic fixed-window
//   upsert against register_rate_limit, returns { allowed, retryAfterSec }.
//   Near-boundary traffic can see up to ~2× the limit across two adjacent
//   windows — accepted trade-off for a single-statement limiter.
// - sendError(res, status, code, message, extra): consistent error shape
const crypto = require('crypto');

function generateCode() {
  return crypto.randomBytes(16).toString('hex');
}

function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function getClientIp(req) {
  const headers = (req && req.headers) || {};
  let ip = null;

  // x-vercel-forwarded-for is set and sealed by the Vercel edge, so it's
  // more tamper-resistant than the standard x-forwarded-for.
  const xvff = headers['x-vercel-forwarded-for'];
  if (xvff && typeof xvff === 'string') {
    ip = xvff.split(',')[0].trim();
  }
  if (!ip) {
    const xff = headers['x-forwarded-for'];
    if (xff && typeof xff === 'string') {
      ip = xff.split(',')[0].trim();
    }
  }
  if (!ip) {
    const xri = headers['x-real-ip'];
    if (xri && typeof xri === 'string') ip = xri.trim();
  }
  if (!ip) {
    ip = req?.socket?.remoteAddress || null;
  }
  if (!ip) return 'unknown';

  return String(ip).trim().toLowerCase() || 'unknown';
}

// Parse a Postgres-style interval literal like "1 hour", "10 minutes", "30 seconds"
// into milliseconds. Only the units needed by callers (second/minute/hour) are supported.
function parseWindowMs(windowMs) {
  if (typeof windowMs !== 'string') {
    throw new Error('windowMs must be a Postgres interval string like "1 hour"');
  }
  const parts = windowMs.trim().split(/\s+/);
  if (parts.length !== 2) {
    throw new Error(`Invalid windowMs: ${windowMs}`);
  }
  const n = parseInt(parts[0], 10);
  const unit = parts[1].toLowerCase();
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid windowMs quantity: ${windowMs}`);
  }
  let unitMs;
  if (unit.startsWith('second')) unitMs = 1000;
  else if (unit.startsWith('minute')) unitMs = 60 * 1000;
  else if (unit.startsWith('hour')) unitMs = 60 * 60 * 1000;
  else throw new Error(`Unsupported windowMs unit: ${unit}`);
  return n * unitMs;
}

async function rateLimit(sql, ip, bucket, maxAttempts, windowMs) {
  // `sql` is a Neon tagged-template client (from lib/db.js getDb()).
  // Use sql.query(text, params) for raw parameterized SQL so the interval
  // can be bound as $3::INTERVAL.
  const text = `
    INSERT INTO register_rate_limit (ip, bucket, window_start, attempts)
    VALUES ($1, $2, NOW(), 1)
    ON CONFLICT (ip, bucket) DO UPDATE
    SET window_start = CASE
          WHEN register_rate_limit.window_start < NOW() - ($3::INTERVAL)
          THEN NOW()
          ELSE register_rate_limit.window_start
        END,
        attempts = CASE
          WHEN register_rate_limit.window_start < NOW() - ($3::INTERVAL)
          THEN 1
          ELSE register_rate_limit.attempts + 1
        END
    RETURNING attempts, window_start
  `;
  const rows = await sql.query(text, [ip, bucket, windowMs]);
  const row = Array.isArray(rows) ? rows[0] : (rows && rows.rows ? rows.rows[0] : null);
  if (!row) {
    // Defensive: treat as not allowed to avoid abuse in the impossible case.
    return { allowed: false, retryAfterSec: Math.ceil(parseWindowMs(windowMs) / 1000) };
  }
  const attempts = Number(row.attempts);
  const allowed = attempts <= maxAttempts;
  if (allowed) return { allowed: true, retryAfterSec: 0 };

  const windowStartMs = new Date(row.window_start).getTime();
  const resetAtMs = windowStartMs + parseWindowMs(windowMs);
  const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
  return { allowed: false, retryAfterSec };
}

function sendError(res, status, code, message, extra) {
  const body = { error: code, message };
  if (extra && typeof extra === 'object') {
    for (const k of Object.keys(extra)) {
      body[k] = extra[k];
    }
  }
  res.status(status).json(body);
}

module.exports = {
  generateCode,
  generateOtp,
  getClientIp,
  rateLimit,
  sendError,
  // exposed for unit tests / callers that want to compute window durations
  parseWindowMs,
};
