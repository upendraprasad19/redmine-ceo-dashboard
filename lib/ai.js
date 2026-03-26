const OpenAI = require('openai');
const { getDb } = require('./db');

// Get AI config from DB first, fall back to env vars
async function getAIConfig() {
  try {
    const sql = getDb();
    const rows = await sql`SELECT * FROM ai_config WHERE is_active = true ORDER BY id DESC LIMIT 1`;
    if (rows.length > 0) return rows[0];
  } catch (e) {
    // table may not exist yet, fall back to env vars
  }
  return {
    provider: 'openrouter',
    api_key: process.env.OPENROUTER_API_KEY,
    base_url: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    default_model: process.env.AI_DEFAULT_MODEL || 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
    embedding_model: 'openai/text-embedding-3-small',
  };
}

function getClient(config) {
  return new OpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url,
    defaultHeaders: {
      'HTTP-Referer': 'https://ceo-dashboard.vercel.app',
      'X-Title': 'CEO Dashboard',
    },
  });
}

async function chat(messages, tools = null, toolChoice = null) {
  const config = await getAIConfig();
  const client = getClient(config);
  const params = {
    model: config.default_model,
    messages,
    max_tokens: 2000,
  };
  if (tools) params.tools = tools;
  if (toolChoice) params.tool_choice = toolChoice;
  const response = await client.chat.completions.create(params);
  return response;
}

async function embed(text) {
  const config = await getAIConfig();
  const client = getClient(config);
  // Truncate to 8000 chars for safety
  const input = text.slice(0, 8000);
  try {
    const response = await client.embeddings.create({
      model: config.embedding_model || 'openai/text-embedding-3-small',
      input,
    });
    return response.data[0].embedding;
  } catch (e) {
    console.error('Embedding error (model may not support embeddings):', e.message);
    return null; // Gracefully handle if embedding model not available
  }
}

module.exports = { chat, embed, getAIConfig };
