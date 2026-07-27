/**
 * qa/knowledge.js
 * Knowledge base: semantic search over project Q&A and adding new entries.
 */

const { getDb, formatVector } = require('../lib/db')
const { embed } = require('../lib/ai')

// ────────────────────────────────────────────────────────────────
// searchKnowledgeBase — Semantic search for answered Q&A
// ────────────────────────────────────────────────────────────────
async function searchKnowledgeBase(query, projectId) {
  const sql = getDb()

  try {
    if (!query?.trim()) return []

    const embedding = await embed(query)

    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      // Fallback to text search if embedding unavailable
      if (projectId) {
        const rows = await sql`
          SELECT id, question, answer, answered_at, asked_at
          FROM project_qa
          WHERE project_id = ${projectId}
            AND answer IS NOT NULL
            AND status = 'answered'
            AND (
              question ILIKE ${`%${query}%`}
              OR answer ILIKE ${`%${query}%`}
            )
          ORDER BY answered_at DESC
          LIMIT 5
        `
        return rows || []
      }

      const rows = await sql`
        SELECT id, question, answer, answered_at, asked_at, project_id
        FROM project_qa
        WHERE answer IS NOT NULL
          AND status = 'answered'
          AND (
            question ILIKE ${`%${query}%`}
            OR answer ILIKE ${`%${query}%`}
          )
        ORDER BY answered_at DESC
        LIMIT 5
      `
      return rows || []
    }

    // Semantic search with embedding
    const vector = formatVector(embedding)

    if (projectId) {
      // Use the match_project_qa function (project-scoped)
      const rows = await sql`
        SELECT
          id,
          question,
          answer,
          answered_at,
          1 - (answer_embedding <=> ${vector}::vector) AS similarity
        FROM project_qa
        WHERE project_id = ${projectId}
          AND answer IS NOT NULL
          AND status = 'answered'
          AND answer_embedding IS NOT NULL
          AND 1 - (answer_embedding <=> ${vector}::vector) > 0.75
        ORDER BY similarity DESC
        LIMIT 5
      `
      return rows || []
    }

    // Global search (all projects)
    const rows = await sql`
      SELECT
        id,
        question,
        answer,
        answered_at,
        project_id,
        1 - (answer_embedding <=> ${vector}::vector) AS similarity
      FROM project_qa
      WHERE answer IS NOT NULL
        AND status = 'answered'
        AND answer_embedding IS NOT NULL
        AND 1 - (answer_embedding <=> ${vector}::vector) > 0.75
      ORDER BY similarity DESC
      LIMIT 5
    `
    return rows || []
  } catch (err) {
    console.error('knowledge.searchKnowledgeBase: error:', err.message)
    return []
  }
}

// ────────────────────────────────────────────────────────────────
// addToKnowledgeBase — Insert a new Q&A pair
// ────────────────────────────────────────────────────────────────
async function addToKnowledgeBase(projectId, question, answer, userId) {
  const sql = getDb()

  try {
    if (!question?.trim()) {
      return { error: 'Question is required' }
    }

    // Embed question
    const questionEmbedding = await embed(question)
    const qVector =
      questionEmbedding && Array.isArray(questionEmbedding) && questionEmbedding.length > 0
        ? formatVector(questionEmbedding)
        : null

    // Embed answer (if provided)
    let aVector = null
    if (answer?.trim()) {
      const answerEmbedding = await embed(answer)
      if (answerEmbedding && Array.isArray(answerEmbedding) && answerEmbedding.length > 0) {
        aVector = formatVector(answerEmbedding)
      }
    }

    const status = answer?.trim() ? 'answered' : 'pending'

    let insertRows

    if (qVector && aVector) {
      insertRows = await sql`
        INSERT INTO project_qa (
          project_id, asked_by, question, question_embedding,
          answer, answer_embedding, answered_by, answered_at, status
        ) VALUES (
          ${projectId},
          ${userId},
          ${question},
          ${qVector}::vector,
          ${answer},
          ${aVector}::vector,
          ${answer ? userId : null},
          ${answer ? sql`NOW()` : null},
          ${status}
        )
        RETURNING id
      `
    } else if (qVector) {
      insertRows = await sql`
        INSERT INTO project_qa (
          project_id, asked_by, question, question_embedding,
          answer, answered_by, answered_at, status
        ) VALUES (
          ${projectId},
          ${userId},
          ${question},
          ${qVector}::vector,
          ${answer || null},
          ${answer ? userId : null},
          ${answer ? sql`NOW()` : null},
          ${status}
        )
        RETURNING id
      `
    } else {
      insertRows = await sql`
        INSERT INTO project_qa (
          project_id, asked_by, question,
          answer, answered_by, answered_at, status
        ) VALUES (
          ${projectId},
          ${userId},
          ${question},
          ${answer || null},
          ${answer ? userId : null},
          ${answer ? sql`NOW()` : null},
          ${status}
        )
        RETURNING id
      `
    }

    const qaId = insertRows?.[0] ? insertRows[0].id : null
    return { id: qaId, status, success: true }
  } catch (err) {
    console.error('knowledge.addToKnowledgeBase: error:', err.message)
    return { error: err.message }
  }
}

module.exports = {
  searchKnowledgeBase,
  addToKnowledgeBase,
}
