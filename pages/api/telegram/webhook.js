/**
 * pages/api/telegram/webhook.js
 * Next.js API route that receives Telegram webhook updates.
 * Telegram sends POST requests here with message updates.
 */

const { bot } = require('../../../bots/telegram');

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Telegram webhook error:', err);
      // Always return 200 to Telegram to prevent retry storms
      res.status(200).json({ ok: true });
    }
  } else if (req.method === 'GET') {
    // Health check endpoint
    res.status(200).json({
      status: 'Telegram webhook active',
      timestamp: new Date().toISOString(),
    });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
