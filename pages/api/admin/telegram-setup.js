/**
 * pages/api/admin/telegram-setup.js
 * GET  — check current webhook status
 * POST — register webhook with Telegram pointing to this deployment
 */
import { getCurrentUser } from '../../../lib/auth';
import { checkAccess } from '../../../lib/roles';

export default async function handler(req, res) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (!checkAccess(user, 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN not set in environment' });

    const telegramApi = `https://api.telegram.org/bot${token}`;

    // GET — return current webhook info from Telegram
    if (req.method === 'GET') {
      const tgRes = await fetch(`${telegramApi}/getWebhookInfo`);
      const data = await tgRes.json();
      return res.status(200).json(data);
    }

    // POST — set webhook
    if (req.method === 'POST') {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'url is required' });

      const webhookUrl = `${url.replace(/\/$/, '')}/api/telegram/webhook`;

      const tgRes = await fetch(`${telegramApi}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl }),
      });
      const data = await tgRes.json();
      return res.status(200).json({ ...data, webhookUrl });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('Telegram setup error:', err);
    res.status(500).json({ error: err.message });
  }
}
