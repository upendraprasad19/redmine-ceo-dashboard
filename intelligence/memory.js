/**
 * intelligence/memory.js
 * Vector memory system: retrieval, storage, and compression of conversation context.
 */

const { getDb, formatVector } = require('../lib/db')
const { chat, embed } = require('../lib/ai')
const { getRecentMessages, saveMessage } = require('../lib/redis')

// ────────────────────────────────────────────────────────────────
// getContext — Retrieve recent + semantically relevant memories
// ────────────────────────────────────────────────────────────────
async function getContext(userId, message) {
  const result = { recent: [], relevant: [] }

  // 1. Recent messages from Redis
  try {
    const recent = await getRecentMessages(userId, 20)
    result.recent = Array.isArray(recent) ? recent : []
  } catch (err) {
    console.error('memory.getContext: Redis error:', err.message)
  }

  // 2. Semantic search via embedding
  try {
    const embedding = await embed(message)
    if (embedding && Array.isArray(embedding) && embedding.length > 0) {
      const sql = getDb()
      const vector = formatVector(embedding)
      const rows = await sql`
        SELECT id, content, metadata, 1 - (embedding <=> ${vector}::vector) AS similarity
        FROM conversation_memory
        WHERE user_id = ${userId}
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> ${vector}::vector) > 0.75
        ORDER BY similarity DESC
        LIMIT 5
      `
      result.relevant = rows || []
    }
  } catch (err) {
    console.error('memory.getContext: vector search error:', err.message)
  }

  return result
}

// ────────────────────────────────────────────────────────────────
// saveToMemory — Persist a message to Redis + DB with embedding
// ────────────────────────────────────────────────────────────────
async function saveToMemory(userId, role, content, source = 'dashboard') {
  if (!content?.trim()) return

  // 1. Save to Redis (short-term)
  try {
    await saveMessage(userId, role, content)
  } catch (err) {
    console.error('memory.saveToMemory: Redis error:', err.message)
  }

  // 2. Save to DB with embedding (long-term)
  try {
    const sql = getDb()
    const embedding = await embed(content)

    if (embedding && Array.isArray(embedding) && embedding.length > 0) {
      const vector = formatVector(embedding)
      await sql`
        INSERT INTO conversation_memory (user_id, role, content, embedding, metadata, source, created_at)
        VALUES (
          ${userId},
          ${role},
          ${content},
          ${vector}::vector,
          ${JSON.stringify({ ts: Date.now() })}::jsonb,
          ${source},
          NOW()
        )
      `
    } else {
      // Save without embedding — still valuable for compression later
      await sql`
        INSERT INTO conversation_memory (user_id, role, content, metadata, source, created_at)
        VALUES (
          ${userId},
          ${role},
          ${content},
          ${JSON.stringify({ ts: Date.now() })}::jsonb,
          ${source},
          NOW()
        )
      `
    }
  } catch (err) {
    console.error('memory.saveToMemory: DB error:', err.message)
  }
}

// ────────────────────────────────────────────────────────────────
// compressMemory — Summarise the oldest 20 messages for a user
// ────────────────────────────────────────────────────────────────
async function compressMemory(userId) {
  const sql = getDb()

  try {
    // 1. Count uncompressed messages
    const countRows = await sql`
      SELECT COUNT(*)::int AS cnt
      FROM conversation_memory
      WHERE user_id = ${userId}
    `
    const total = countRows?.[0]?.cnt || 0

    if (total < 20) return { compressed: false, reason: 'fewer than 20 messages' }

    // 2. Fetch oldest 20
    const oldest = await sql`
      SELECT id, role, content, created_at
      FROM conversation_memory
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
      LIMIT 20
    `

    if (!oldest || oldest.length === 0) return { compressed: false, reason: 'no messages found' }

    // 3. Build transcript and ask AI to summarise
    const transcript = oldest.map((m) => `${m.role}: ${m.content}`).join('\n')

    const response = await chat([
      {
        role: 'system',
        content:
          'You are a memory compression assistant. Summarise the following conversation into 3-5 concise sentences that capture the key topics, decisions, and user preferences. Preserve any important facts, names, and data points.',
      },
      { role: 'user', content: transcript },
    ])

    const summary = response?.choices?.[0]?.message?.content

    if (!summary) return { compressed: false, reason: 'AI returned empty summary' }

    // 4. Embed the summary
    const summaryEmbedding = await embed(summary)

    const coversFrom = oldest[0].created_at
    const coversTo = oldest[oldest.length - 1].created_at

    if (summaryEmbedding && Array.isArray(summaryEmbedding) && summaryEmbedding.length > 0) {
      const vector = formatVector(summaryEmbedding)
      await sql`
        INSERT INTO memory_summaries (user_id, summary, embedding, covers_from, covers_to, message_count, created_at)
        VALUES (
          ${userId},
          ${summary},
          ${vector}::vector,
          ${coversFrom},
          ${coversTo},
          ${oldest.length},
          NOW()
        )
      `
    } else {
      await sql`
        INSERT INTO memory_summaries (user_id, summary, covers_from, covers_to, message_count, created_at)
        VALUES (
          ${userId},
          ${summary},
          ${coversFrom},
          ${coversTo},
          ${oldest.length},
          NOW()
        )
      `
    }

    // 5. Delete compressed messages
    const ids = oldest.map((m) => m.id)
    await sql`
      DELETE FROM conversation_memory
      WHERE id = ANY(${ids}::uuid[])
    `

    return { compressed: true, count: oldest.length, coversFrom, coversTo }
  } catch (err) {
    console.error('memory.compressMemory: error:', err.message)
    return { compressed: false, reason: err.message }
  }
}

// ────────────────────────────────────────────────────────────────
// compressAllMemories — Batch compression across all users
// ────────────────────────────────────────────────────────────────
async function compressAllMemories() {
  const sql = getDb()
  const results = []

  try {
    // Find all users with > 20 uncompressed memories
    const users = await sql`
      SELECT user_id, COUNT(*)::int AS cnt
      FROM conversation_memory
      GROUP BY user_id
      HAVING COUNT(*) >= 20
    `

    if (!users || users.length === 0) {
      return { compressed: 0, details: [] }
    }

    for (const row of users) {
      const result = await compressMemory(row.user_id)
      results.push({ userId: row.user_id, ...result })
    }
  } catch (err) {
    console.error('memory.compressAllMemories: error:', err.message)
  }

  return {
    compressed: results.filter((r) => r.compressed).length,
    details: results,
  }
}

module.exports = {
  getContext,
  saveToMemory,
  compressMemory,
  compressAllMemories,
}
