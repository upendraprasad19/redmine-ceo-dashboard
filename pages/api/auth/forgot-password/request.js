const bcrypt = require('bcryptjs')
const { getDb } = require('../../../../lib/db')
const { sendTelegramMessage } = require('../../../../lib/telegram')
const { sendText } = require('../../../../lib/email')
const { send500 } = require('../../../../lib/api-error')

const CODE_TTL_MIN = 15

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { username, channels } = req.body || {}
    if (!username) return res.status(400).json({ error: 'username required' })
    if (!Array.isArray(channels) || channels.length === 0) {
      return res.status(400).json({ error: 'channels required' })
    }

    const sql = getDb()
    const rows = await sql`
      SELECT id, display_name, telegram_id, email
      FROM dashboard_users
      WHERE username = ${username} AND active = true LIMIT 1
    `
    const u = rows[0]

    // Always respond the same shape to prevent enumeration. Silently no-op if
    // user missing or chosen channel unavailable.
    const safe = { ok: true }
    if (!u) return res.status(200).json(safe)

    const usingTelegram = channels.includes('telegram') && u.telegram_id
    const usingEmail = channels.includes('email') && u.email
    if (!usingTelegram && !usingEmail) return res.status(200).json(safe)

    const code = generateCode()
    const codeHash = await bcrypt.hash(code, 10)
    const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60 * 1000)
    const finalChannels = [usingTelegram && 'telegram', usingEmail && 'email'].filter(Boolean)

    await sql`
      INSERT INTO password_reset_tokens (user_id, code_hash, channels, expires_at)
      VALUES (${u.id}, ${codeHash}, ${finalChannels}, ${expiresAt.toISOString()})
    `

    const message = `Your RedMine Dashboard password reset code is *${code}*. It expires in ${CODE_TTL_MIN} minutes. If you didn't request this, ignore this message.`

    if (usingTelegram) {
      try {
        await sendTelegramMessage(u.telegram_id, message)
      } catch (e) {
        console.error('telegram reset send failed:', e.message)
      }
    }
    if (usingEmail) {
      try {
        await sendText(
          u.email,
          'RedMine Dashboard — password reset code',
          `Hi ${u.display_name},\n\nYour password reset code is: ${code}\n\nIt expires in ${CODE_TTL_MIN} minutes. If you didn't request this, ignore this email.`,
        )
      } catch (e) {
        console.error('email reset send failed:', e.message)
      }
    }

    return res.status(200).json(safe)
  } catch (err) {
    return send500(res, err, 'forgot-password-request')
  }
}
