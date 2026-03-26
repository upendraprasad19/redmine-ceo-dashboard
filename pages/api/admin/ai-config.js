const { getCurrentUser } = require('../../../lib/auth');
const { getDb } = require('../../../lib/db');
const { checkAccess } = require('../../../lib/roles');

export default async function handler(req, res) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (!checkAccess(user, 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const sql = getDb();

    // GET — return current AI config
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, provider, base_url, default_model, embedding_model, is_active, created_at,
               LEFT(api_key, 10) || '••••••••' AS api_key_preview
        FROM ai_config
        ORDER BY id DESC
      `;

      // Determine the effective config (DB active row, or env fallback)
      const activeDb = rows.find(r => r.is_active);
      const effective = activeDb
        ? { ...activeDb, source: 'db' }
        : {
            id: null,
            source: 'env',
            provider: 'openrouter',
            base_url: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
            default_model: process.env.AI_DEFAULT_MODEL || '',
            embedding_model: 'openai/text-embedding-3-small',
            api_key_preview: process.env.OPENROUTER_API_KEY
              ? process.env.OPENROUTER_API_KEY.slice(0, 10) + '••••••••'
              : '(not set)',
            is_active: true,
          };

      return res.status(200).json({ configs: rows, effective });
    }

    // PUT — update or create AI config
    if (req.method === 'PUT') {
      const { id, provider, api_key, base_url, default_model, embedding_model, is_active } = req.body;

      if (id) {
        // Restore (activate this config, deactivate others)
        if (is_active === true) {
          await sql`UPDATE ai_config SET is_active = false`;
          await sql`UPDATE ai_config SET is_active = true WHERE id = ${id}`;
        } else {
          // Update fields (api_key only updated if provided)
          await sql`
            UPDATE ai_config
            SET
              provider        = COALESCE(${provider || null}, provider),
              api_key         = COALESCE(${api_key || null}, api_key),
              base_url        = COALESCE(${base_url || null}, base_url),
              default_model   = COALESCE(${default_model || null}, default_model),
              embedding_model = COALESCE(${embedding_model || null}, embedding_model),
              updated_at      = NOW()
            WHERE id = ${id}
          `;
        }
      } else {
        // New config — deactivate all existing first
        await sql`UPDATE ai_config SET is_active = false`;
        await sql`
          INSERT INTO ai_config (provider, api_key, base_url, default_model, embedding_model, is_active, created_at)
          VALUES (
            ${provider || 'openrouter'},
            ${api_key || ''},
            ${base_url || 'https://openrouter.ai/api/v1'},
            ${default_model || ''},
            ${embedding_model || 'openai/text-embedding-3-small'},
            true,
            NOW()
          )
        `;
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('AI config admin error:', err);
    res.status(500).json({ error: err.message });
  }
}
