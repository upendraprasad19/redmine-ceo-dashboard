/**
 * qa/answer.js
 * Answer an escalated question and notify the asker.
 */

const { getDb, formatVector } = require('../lib/db');
const { embed } = require('../lib/ai');

// ────────────────────────────────────────────────────────────────
// answerQuestion — Provide an answer to a pending Q&A
// ────────────────────────────────────────────────────────────────
async function answerQuestion(qaId, answer, answeredByUserId) {
  const sql = getDb();

  try {
    if (!qaId) return { error: 'Q&A ID is required' };
    if (!answer || !answer.trim()) return { error: 'Answer is required' };

    // 1. Verify the Q&A exists
    const qaRows = await sql`
      SELECT id, project_id, asked_by, question, status
      FROM project_qa
      WHERE id = ${qaId}
    `;

    if (!qaRows || qaRows.length === 0) {
      return { error: 'Q&A entry not found' };
    }

    const qa = qaRows[0];

    if (qa.status === 'answered') {
      return { error: 'This question has already been answered' };
    }

    // 2. Embed the answer
    const answerEmbedding = await embed(answer);
    const aVector =
      answerEmbedding && Array.isArray(answerEmbedding) && answerEmbedding.length > 0
        ? formatVector(answerEmbedding)
        : null;

    // 3. Update project_qa
    if (aVector) {
      await sql`
        UPDATE project_qa
        SET
          answer = ${answer},
          answer_embedding = ${aVector}::vector,
          answered_by = ${answeredByUserId},
          answered_at = NOW(),
          status = 'answered'
        WHERE id = ${qaId}
      `;
    } else {
      await sql`
        UPDATE project_qa
        SET
          answer = ${answer},
          answered_by = ${answeredByUserId},
          answered_at = NOW(),
          status = 'answered'
        WHERE id = ${qaId}
      `;
    }

    // 4. Notify the original asker
    if (qa.asked_by) {
      // Get answerer's name
      const answererRows = await sql`
        SELECT display_name FROM dashboard_users WHERE id = ${answeredByUserId}
      `;
      const answererName =
        answererRows && answererRows[0] ? answererRows[0].display_name : 'Someone';

      const questionSnippet = qa.question
        ? qa.question.slice(0, 100) + (qa.question.length > 100 ? '...' : '')
        : 'your question';

      const message = `${answererName} answered your question: "${questionSnippet}"`;

      await sql`
        INSERT INTO ceo_notifications (
          type, from_user, project_id, qa_id, message, action_url, created_at
        ) VALUES (
          'new_question',
          ${answeredByUserId},
          ${qa.project_id},
          ${qaId},
          ${message},
          ${qa.project_id ? `/projects/${qa.project_id}?qa=${qaId}` : null},
          NOW()
        )
      `;
    }

    return {
      qaId,
      success: true,
      message: 'Answer saved and asker notified',
    };
  } catch (err) {
    console.error('answer.answerQuestion: error:', err.message);
    return { error: err.message };
  }
}

module.exports = {
  answerQuestion,
};
