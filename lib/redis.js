const { Redis } = require('@upstash/redis');

let redis;

function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
}

async function getRecentMessages(userId, count = 20) {
  const r = getRedis();
  const key = `chat:${userId}`;
  const messages = await r.lrange(key, 0, count - 1);
  return messages
    .map((m) => (typeof m === 'string' ? JSON.parse(m) : m))
    .reverse(); // oldest first
}

async function saveMessage(userId, role, content) {
  const r = getRedis();
  const key = `chat:${userId}`;
  const msg = JSON.stringify({ role, content, ts: Date.now() });
  await r.lpush(key, msg);
  await r.ltrim(key, 0, 19); // keep last 20
  await r.expire(key, 86400); // 24h TTL
}

async function clearSession(userId) {
  const r = getRedis();
  await r.del(`chat:${userId}`);
}

module.exports = { getRecentMessages, saveMessage, clearSession, getRedis };
