/**
 * lib/telegram.js
 * Thin wrapper for sending Telegram messages via Bot API
 */

export async function sendTelegramMessage(chatId, text, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
  if (!chatId) return; // silently skip if user has no telegram registered

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    ...options,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    console.error(`[Telegram] sendMessage failed for chat ${chatId}:`, err.description);
  }
  return res.ok;
}
