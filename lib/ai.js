/**
 * lib/ai.js
 * AI provider abstraction.
 * Primary: Cerebras (fast inference, reliable tool calling)
 * Fallback 1: Cerebras secondary API key
 * Fallback 2: OpenRouter (legacy)
 * Config can also be overridden via DB ai_config table.
 */

const OpenAI = require('openai');
const { getDb } = require('./db');

// Cerebras config
const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';
const CEREBRAS_MODEL = 'qwen-3-235b';

// Get AI config from DB first, fall back to env vars
async function getAIConfig() {
  try {
    const sql = getDb();
    const rows = await sql`SELECT * FROM ai_config WHERE is_active = true ORDER BY id DESC LIMIT 1`;
    if (rows.length > 0) return rows[0];
  } catch (e) {
    // table may not exist yet, fall back to env vars
  }
  // Default: Cerebras
  return {
    provider: 'cerebras',
    api_key: process.env.CEREBRAS_API_KEY,
    base_url: CEREBRAS_BASE_URL,
    default_model: CEREBRAS_MODEL,
    embedding_model: 'openai/text-embedding-3-small',
  };
}

function getCerebrasClient(apiKey) {
  return new OpenAI({
    apiKey,
    baseURL: CEREBRAS_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': 'https://thinking-code-delivery-ai.vercel.app',
      'X-Title': 'CEO Dashboard',
    },
  });
}

function getOpenRouterClient() {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://thinking-code-delivery-ai.vercel.app',
      'X-Title': 'CEO Dashboard',
    },
  });
}

/**
 * Call AI with automatic fallback chain:
 * Cerebras primary → Cerebras fallback → OpenRouter
 */
async function chat(messages, tools = null, toolChoice = null) {
  const config = await getAIConfig();

  // If DB config specifies a non-cerebras provider, use it directly
  if (config.provider && config.provider !== 'cerebras') {
    const client = new OpenAI({
      apiKey: config.api_key,
      baseURL: config.base_url,
      defaultHeaders: {
        'HTTP-Referer': 'https://thinking-code-delivery-ai.vercel.app',
        'X-Title': 'CEO Dashboard',
      },
    });
    const params = { model: config.default_model, messages, max_tokens: 2000 };
    if (tools && tools.length > 0) params.tools = tools;
    if (toolChoice) params.tool_choice = toolChoice;
    return await client.chat.completions.create(params);
  }

  // Cerebras chain with fallback
  const attempts = [
    { key: process.env.CEREBRAS_API_KEY, label: 'Cerebras primary' },
    { key: process.env.CEREBRAS_API_KEY_2, label: 'Cerebras fallback' },
  ].filter(a => a.key);

  let lastError;
  for (const attempt of attempts) {
    try {
      const client = getCerebrasClient(attempt.key);
      const params = {
        model: CEREBRAS_MODEL,
        messages,
        max_tokens: 2000,
      };
      if (tools && tools.length > 0) params.tools = tools;
      if (toolChoice) params.tool_choice = toolChoice;
      const response = await client.chat.completions.create(params);
      return response;
    } catch (err) {
      console.error(`${attempt.label} failed:`, err.message);
      lastError = err;
    }
  }

  // Final fallback: OpenRouter
  console.warn('Both Cerebras keys failed, falling back to OpenRouter');
  try {
    const client = getOpenRouterClient();
    const params = {
      model: process.env.AI_DEFAULT_MODEL || 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
      messages,
      max_tokens: 2000,
    };
    if (tools && tools.length > 0) params.tools = tools;
    if (toolChoice) params.tool_choice = toolChoice;
    return await client.chat.completions.create(params);
  } catch (err) {
    console.error('OpenRouter fallback also failed:', err.message);
    throw lastError || err;
  }
}

async function embed(text) {
  // Use OpenRouter for embeddings (Cerebras doesn't support embeddings)
  const client = getOpenRouterClient();
  const input = text.slice(0, 8000);
  try {
    const response = await client.embeddings.create({
      model: 'openai/text-embedding-3-small',
      input,
    });
    return response.data[0].embedding;
  } catch (e) {
    console.error('Embedding error:', e.message);
    return null;
  }
}

module.exports = { chat, embed, getAIConfig };
