/**
 * crons/chat-enrichment.js
 * Thin wrapper around lib/chat-enrichment so the Vercel dispatcher can invoke it.
 */

const { runEnrichmentBatch } = require('../lib/chat-enrichment')

async function runChatEnrichment() {
  return await runEnrichmentBatch(50)
}

module.exports = { runChatEnrichment }
