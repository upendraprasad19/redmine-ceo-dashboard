-- Migration 023: Drop orphan tables
-- These tables exist in the DB but have zero code references anywhere in the codebase.
-- Confirmed safe to remove via full-text search audit.

DROP TABLE IF EXISTS pending_registrations;
DROP TABLE IF EXISTS conversation_history;
DROP TABLE IF EXISTS notification_log;
DROP TABLE IF EXISTS leave_requests;
DROP TABLE IF EXISTS access_requests;
DROP TABLE IF EXISTS anomaly_alerts;
DROP TABLE IF EXISTS telegram_sessions;
DROP TABLE IF EXISTS register_rate_limit;
DROP TABLE IF EXISTS daily_snapshots;
