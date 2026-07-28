/**
 * crons/index.js
 *
 * This file previously registered 13 cron jobs via node-cron.
 * It is now DEAD CODE — on Vercel there is no persistent process,
 * so node-cron jobs never executed.
 *
 * All cron jobs are now dispatched from pages/api/cron/run.js:
 *   - Single job:  GET /api/cron/run?job=standup
 *   - Batch mode:  GET /api/cron/run?job=batch
 *
 * See JOB_MAP and BATCH_SCHEDULE in run.js for the full list.
 */
