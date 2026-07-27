-- Migration 021: Formalize password_reset_tokens table
-- Actively used by the forgot-password flow (request/verify/reset).
-- Was created ad-hoc outside the migration framework.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id integer NOT NULL DEFAULT nextval('password_reset_tokens_id_seq'::regclass),
  user_id integer NOT NULL,
  code_hash text NOT NULL,
  channels ARRAY NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  attempts integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prt_user_used ON public.password_reset_tokens USING btree (user_id, used_at);
