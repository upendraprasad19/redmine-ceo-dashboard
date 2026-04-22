// Centralized Telegram sender. Use this instead of copy-pasting the fetch
// call in each cron/webhook file.
// Returns the raw Telegram response or { ok: false, reason } if prerequisites
// are missing so callers can branch without try/catch on trivial cases.

async function sendTelegramMessage(chatId, text, { parseMode = 'Markdown' } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, reason: 'TELEGRAM_BOT_TOKEN not set' };
  if (!chatId) return { ok: false, reason: 'chat_id missing' };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
  return res.json();
}

module.exports = { sendTelegramMessage };
