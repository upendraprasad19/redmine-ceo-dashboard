/**
 * qa/escalate.js
 * Escalate an unanswered question to the CEO / manager for a response.
 */

const { getDb } = require('../lib/db');
const { embed } = require('../lib/ai');
const { formatVector } = require('../lib/db');

// ────────────────────────────────────────────────────────────────
// escalateToCEO — Create a pending Q&A and notify the CEO
// ────────────────────────────────────────────────────────────────
async function escalateToCEO(projectId, question, askedByUserId) {
  const sql = getDb();

  try {
    if (!question || !question.trim()) {
      return { error: 'Question is required' };
    }

    // 1. Embed the question
    const questionEmbedding = await embed(question);
    const qVector =
      questionEmbedding && Array.isArray(questionEmbedding) && questionEmbedding.length > 0
        ? formatVector(questionEmbedding)
        : null;

    // 2. Insert into project_qa with status = 'pending'
    let qaRows;
    if (qVector) {
      qaRows = await sql`
        INSERT INTO project_qa (
          project_id, asked_by, question, question_embedding, status
        ) VALUES (
          ${projectId},
          ${askedByUserId},
          ${question},
          ${qVector}::vector,
          'pending'
        )
        RETURNING id
      `;
    } else {
      qaRows = await sql`
        INSERT INTO project_qa (
          project_id, asked_by, question, status
        ) VALUES (
          ${projectId},
          ${askedByUserId},
          ${question},
          'pending'
        )
        RETURNING id
      `;
    }

    const qaId = qaRows && qaRows[0] ? qaRows[0].id : null;
    if (!qaId) {
      return { error: 'Failed to create Q&A entry' };
    }

    // 3. Get the asker's name for the notification message
    const askerRows = await sql`
      SELECT display_name FROM dashboard_users WHERE id = ${askedByUserId}
    `;
    const askerName =
      askerRows && askerRows[0] ? askerRows[0].display_name : 'A team member';

    // Get project name for context
    let projectName = 'a project';
    if (projectId) {
      const projRows = await sql`
        SELECT name FROM project_explorations WHERE id = ${projectId}
      `;
      if (projRows && projRows[0]) {
        projectName = projRows[0].name;
      }
    }

    // 4. Insert into ceo_notifications
    const message = `${askerName} asked a question about ${projectName}: "${question.slice(0, 150)}${question.length > 150 ? '...' : ''}"`;

    await sql`
      INSERT INTO ceo_notifications (
        type, from_user, project_id, qa_id, message, action_url, created_at
      ) VALUES (
        'new_question',
        ${askedByUserId},
        ${projectId},
        ${qaId},
        ${message},
        ${projectId ? `/projects/${projectId}?qa=${qaId}` : null},
        NOW()
      )
    `;

    return {
      qaId,
      success: true,
      message: 'Question escalated to CEO successfully',
    };
  } catch (err) {
    console.error('escalate.escalateToCEO: error:', err.message);
    return { error: err.message };
  }
}

module.exports = {
  escalateToCEO,
};
