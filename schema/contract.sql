-- Schema contract generated from database
-- Generated: 2026-07-30T15:56:09.530Z
-- This file is the source of truth for expected DB schema.
-- Run: node scripts/generate-schema-contract.js to regenerate.

CREATE TABLE _schema_migrations (
  filename text NOT NULL,
  applied_at timestamp with time zone DEFAULT now()
);

CREATE TABLE ai_config (
  id integer NOT NULL DEFAULT nextval('ai_config_id_seq'::regclass),
  provider text NOT NULL DEFAULT 'openrouter'::text,
  api_key text NOT NULL,
  base_url text,
  default_model text NOT NULL,
  embedding_model text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE availability_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id integer,
  available_capacity numeric,
  alert_type text,
  suggested_tickets jsonb DEFAULT '[]'::jsonb,
  sent_to integer,
  actioned boolean DEFAULT false,
  actioned_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE bot_thread_events (
  id integer NOT NULL DEFAULT nextval('bot_thread_events_id_seq'::regclass),
  thread_id integer NOT NULL,
  actor_id integer,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_thread_events_thread ON public.bot_thread_events USING btree (thread_id, created_at);

CREATE TABLE bot_threads (
  id integer NOT NULL DEFAULT nextval('bot_threads_id_seq'::regclass),
  originator_id integer NOT NULL,
  target_id integer NOT NULL,
  cc_user_id integer,
  issue_id integer NOT NULL,
  status text NOT NULL,
  urgency text NOT NULL DEFAULT 'normal'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_event_at timestamp with time zone NOT NULL DEFAULT now(),
  closed_at timestamp with time zone
);

CREATE INDEX idx_bot_threads_pending_followup ON public.bot_threads USING btree (last_event_at) WHERE (status = ANY (ARRAY['sent'::text, 'timeout_nudged'::text]));
CREATE INDEX idx_bot_threads_target_open ON public.bot_threads USING btree (target_id, status) WHERE (status <> ALL (ARRAY['closed'::text, 'no_response'::text]));

CREATE TABLE bot_unknown_queries (
  id integer NOT NULL DEFAULT nextval('bot_unknown_queries_id_seq'::regclass),
  user_id integer,
  query_text text NOT NULL,
  user_role text,
  user_team text,
  suggested_alternative text,
  frequency integer DEFAULT 1,
  status text DEFAULT 'unreviewed'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_bot_unknown_queries_freq ON public.bot_unknown_queries USING btree (frequency DESC);
CREATE INDEX idx_bot_unknown_queries_status ON public.bot_unknown_queries USING btree (status);
CREATE INDEX idx_bot_unknown_queries_text ON public.bot_unknown_queries USING btree (query_text);

CREATE TABLE capacity_status (
  id integer NOT NULL DEFAULT nextval('capacity_status_id_seq'::regclass),
  user_id integer,
  current_workload_pct numeric DEFAULT 0,
  active_tickets integer DEFAULT 0,
  available_capacity_pct numeric DEFAULT 100,
  predicted_free_date date,
  predicted_free_pct numeric,
  days_underloaded integer DEFAULT 0,
  alert_sent_today boolean DEFAULT false,
  last_calculated timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX capacity_status_user_id_key ON public.capacity_status USING btree (user_id);

CREATE TABLE ceo_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type text NOT NULL,
  from_user integer,
  project_id uuid,
  qa_id uuid,
  message text NOT NULL,
  action_url text,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_ceo_notifications_unread ON public.ceo_notifications USING btree (is_read, created_at DESC);

CREATE TABLE chat_history (
  id integer NOT NULL DEFAULT nextval('chat_history_id_seq'::regclass),
  user_id integer,
  role text,
  content text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  intent text,
  entities jsonb,
  role_at_time text,
  enriched_at timestamp with time zone
);

CREATE INDEX idx_chat_history_unenriched ON public.chat_history USING btree (created_at) WHERE (enriched_at IS NULL);
CREATE INDEX idx_chat_history_user_time ON public.chat_history USING btree (user_id, created_at DESC);

CREATE TABLE commitments (
  id integer NOT NULL DEFAULT nextval('commitments_id_seq'::regclass),
  thread_id integer,
  user_id integer NOT NULL,
  issue_id integer,
  promise_text text NOT NULL,
  due_at timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone
);

CREATE INDEX idx_commitments_due_pending ON public.commitments USING btree (due_at) WHERE (status = 'pending'::text);

CREATE TABLE conversation_memory (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id integer,
  role text,
  content text NOT NULL,
  embedding USER-DEFINED,
  metadata jsonb DEFAULT '{}'::jsonb,
  source text DEFAULT 'dashboard'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_conversation_memory_embedding ON public.conversation_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists='100');
CREATE INDEX idx_conversation_memory_user_time ON public.conversation_memory USING btree (user_id, created_at DESC);

CREATE TABLE daily_time_status (
  id integer,
  name text,
  team text,
  hours_today numeric,
  logged_today boolean
);

CREATE TABLE dashboard_users (
  id integer NOT NULL DEFAULT nextval('dashboard_users_id_seq'::regclass),
  username text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  team text,
  linked_redmine_user_id integer,
  telegram_id bigint,
  slack_id text,
  behavior_profile jsonb DEFAULT '{}'::jsonb,
  top_concerns ARRAY DEFAULT '{}'::text[],
  response_style text DEFAULT 'concise'::text,
  active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  onboarding_completed boolean DEFAULT false,
  onboarding_step text,
  briefing_time time without time zone DEFAULT '09:00:00'::time without time zone,
  briefing_days text DEFAULT 'weekdays'::text,
  morning_briefing text DEFAULT 'none'::text,
  consent_given_at timestamp with time zone,
  email text,
  notification_channels ARRAY DEFAULT ARRAY['telegram'::text]
);

CREATE UNIQUE INDEX dashboard_users_slack_id_key ON public.dashboard_users USING btree (slack_id);
CREATE UNIQUE INDEX dashboard_users_telegram_id_key ON public.dashboard_users USING btree (telegram_id);
CREATE UNIQUE INDEX dashboard_users_username_key ON public.dashboard_users USING btree (username);
CREATE INDEX idx_dashboard_users_email_lower ON public.dashboard_users USING btree (lower(email));

CREATE TABLE decision_trail (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  made_by integer,
  project_id uuid,
  decision text NOT NULL,
  rationale text,
  data_used jsonb DEFAULT '{}'::jsonb,
  outcome text,
  outcome_date timestamp with time zone,
  embedding USER-DEFINED,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE escalation_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  rule_triggered text NOT NULL,
  context jsonb DEFAULT '{}'::jsonb,
  action_taken text,
  raised_by integer,
  escalated_to integer,
  actioned boolean DEFAULT false,
  actioned_at timestamp with time zone,
  triggered_at timestamp with time zone DEFAULT now()
);

CREATE TABLE issue_journals (
  id integer NOT NULL DEFAULT nextval('issue_journals_id_seq'::regclass),
  redmine_id integer,
  issue_id integer,
  author_id integer,
  notes text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX issue_journals_redmine_id_key ON public.issue_journals USING btree (redmine_id);

CREATE TABLE issue_team_history (
  id integer NOT NULL DEFAULT nextval('issue_team_history_id_seq'::regclass),
  issue_id integer,
  team_name text NOT NULL,
  user_id integer,
  assigned_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX issue_team_history_issue_id_team_name_key ON public.issue_team_history USING btree (issue_id, team_name);

CREATE TABLE issues (
  id integer NOT NULL DEFAULT nextval('issues_id_seq'::regclass),
  redmine_id integer,
  project_id integer,
  title text NOT NULL,
  description text,
  status text,
  priority text,
  assigned_to_id integer,
  author_id integer,
  start_date date,
  due_date date,
  done_ratio integer DEFAULT 0,
  closed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  bz_id text,
  delivery_owner_ids ARRAY
);

CREATE INDEX idx_issues_assigned ON public.issues USING btree (assigned_to_id);
CREATE INDEX idx_issues_due_date ON public.issues USING btree (due_date);
CREATE INDEX idx_issues_project ON public.issues USING btree (project_id);
CREATE INDEX idx_issues_status ON public.issues USING btree (status);
CREATE UNIQUE INDEX issues_redmine_id_key ON public.issues USING btree (redmine_id);

CREATE TABLE leave_records (
  id integer NOT NULL DEFAULT nextval('leave_records_id_seq'::regclass),
  user_id integer,
  leave_type text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  source text DEFAULT 'manual'::text
);

CREATE INDEX idx_leave_user ON public.leave_records USING btree (user_id);

CREATE TABLE memory_summaries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id integer,
  summary text NOT NULL,
  embedding USER-DEFINED,
  covers_from timestamp with time zone,
  covers_to timestamp with time zone,
  message_count integer,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_memory_summaries_embedding ON public.memory_summaries USING ivfflat (embedding vector_cosine_ops) WITH (lists='100');

CREATE TABLE password_reset_tokens (
  id integer NOT NULL DEFAULT nextval('password_reset_tokens_id_seq'::regclass),
  user_id integer NOT NULL,
  code_hash text NOT NULL,
  channels ARRAY NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  attempts integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_prt_user_used ON public.password_reset_tokens USING btree (user_id, used_at);

CREATE TABLE performance_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id integer,
  event_type text NOT NULL,
  ticket_id text,
  event_data jsonb DEFAULT '{}'::jsonb,
  impact_score numeric DEFAULT 0,
  occurred_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_perf_events_type_time ON public.performance_events USING btree (event_type, occurred_at DESC);
CREATE INDEX idx_perf_events_user_time ON public.performance_events USING btree (user_id, occurred_at DESC);

CREATE TABLE performance_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  period text DEFAULT 'daily'::text,
  tickets_closed integer DEFAULT 0,
  tickets_in_progress integer DEFAULT 0,
  tickets_overdue integer DEFAULT 0,
  tickets_reopened integer DEFAULT 0,
  hours_logged numeric DEFAULT 0,
  avg_resolution_time_hrs numeric,
  avg_first_action_time_hrs numeric,
  reopen_rate numeric DEFAULT 0,
  deadline_hit_rate numeric DEFAULT 0,
  output_score integer DEFAULT 0,
  speed_score integer DEFAULT 0,
  quality_score integer DEFAULT 0,
  reliability_score integer DEFAULT 0,
  collaboration_score integer DEFAULT 0,
  overall_score integer DEFAULT 0,
  score_delta numeric DEFAULT 0,
  trend text DEFAULT 'stable'::text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  user_id integer NOT NULL
);

CREATE INDEX idx_perf_snapshots_user_date ON public.performance_snapshots USING btree (user_id, snapshot_date DESC);
CREATE UNIQUE INDEX performance_snapshots_user_id_snapshot_date_period_key ON public.performance_snapshots USING btree (user_id, snapshot_date, period);

CREATE TABLE person_performance (
  id integer,
  name text,
  team text,
  role text,
  initials text,
  tickets_created bigint,
  tickets_worked bigint,
  hours_this_month numeric
);

CREATE TABLE pinned_insights (
  id integer NOT NULL DEFAULT nextval('pinned_insights_id_seq'::regclass),
  user_id integer,
  insight_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  severity text DEFAULT 'info'::text,
  data jsonb DEFAULT '{}'::jsonb,
  dismissed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_pinned_insights_user_active ON public.pinned_insights USING btree (user_id, dismissed, created_at DESC);

CREATE TABLE project_explorations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by integer,
  name text NOT NULL,
  description text,
  vision text,
  status text DEFAULT 'conceptual'::text,
  cost_structure jsonb DEFAULT '{}'::jsonb,
  timeline jsonb DEFAULT '{}'::jsonb,
  team_requirements jsonb DEFAULT '{}'::jsonb,
  risks jsonb DEFAULT '[]'::jsonb,
  opportunities jsonb DEFAULT '[]'::jsonb,
  decisions_made jsonb DEFAULT '[]'::jsonb,
  shared_with ARRAY DEFAULT '{}'::integer[],
  embedding USER-DEFINED,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE project_qa (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid,
  asked_by integer,
  question text NOT NULL,
  question_embedding USER-DEFINED,
  asked_at timestamp with time zone DEFAULT now(),
  answered_by integer,
  answer text,
  answer_embedding USER-DEFINED,
  answered_at timestamp with time zone,
  status text DEFAULT 'pending'::text,
  view_count integer DEFAULT 0
);

CREATE INDEX idx_project_qa_asked_by_time ON public.project_qa USING btree (asked_by, asked_at DESC);
CREATE INDEX idx_project_qa_project_status ON public.project_qa USING btree (project_id, status);

CREATE TABLE projects (
  id integer NOT NULL DEFAULT nextval('projects_id_seq'::regclass),
  redmine_id integer,
  name text NOT NULL,
  description text,
  status text DEFAULT 'active'::text,
  deadline date,
  progress_pct integer DEFAULT 0,
  risk text DEFAULT 'low'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  manager_id integer
);

CREATE UNIQUE INDEX projects_redmine_id_key ON public.projects USING btree (redmine_id);

CREATE TABLE slack_ticket_updates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  issue_id integer NOT NULL,
  redmine_id integer,
  previous_status text,
  new_status text NOT NULL,
  updated_by_slack_id text,
  updated_by_dashboard_user_id integer,
  source text DEFAULT 'standup_card'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_slack_ticket_updates_created ON public.slack_ticket_updates USING btree (created_at DESC);
CREATE INDEX idx_slack_ticket_updates_issue ON public.slack_ticket_updates USING btree (issue_id);
CREATE INDEX idx_slack_ticket_updates_user ON public.slack_ticket_updates USING btree (updated_by_dashboard_user_id);

CREATE TABLE sync_log (
  id integer NOT NULL DEFAULT nextval('sync_log_id_seq'::regclass),
  entity text NOT NULL,
  last_synced timestamp with time zone DEFAULT now(),
  records_added integer DEFAULT 0,
  records_updated integer DEFAULT 0,
  status text DEFAULT 'ok'::text,
  error text
);

CREATE TABLE sync_state (
  key text NOT NULL,
  value text,
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE team_health (
  id integer NOT NULL DEFAULT nextval('team_health_id_seq'::regclass),
  team text NOT NULL,
  week_start date NOT NULL,
  on_time_delivery_rate numeric DEFAULT 0,
  hours_consistency numeric DEFAULT 0,
  blocker_resolution_speed numeric DEFAULT 0,
  reopen_rate numeric DEFAULT 0,
  overall_score integer DEFAULT 0,
  trend text DEFAULT 'stable'::text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX team_health_team_week_start_key ON public.team_health USING btree (team, week_start);

CREATE TABLE team_workload (
  team text,
  member_count bigint,
  open_tickets bigint,
  avg_tickets_per_person numeric
);

CREATE TABLE time_entries (
  id integer NOT NULL DEFAULT nextval('time_entries_id_seq'::regclass),
  redmine_id integer,
  issue_id integer,
  user_id integer,
  project_id integer,
  hours numeric,
  activity text,
  comments text,
  spent_on date NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_time_entries_date ON public.time_entries USING btree (spent_on);
CREATE INDEX idx_time_entries_user ON public.time_entries USING btree (user_id);
CREATE UNIQUE INDEX time_entries_redmine_id_key ON public.time_entries USING btree (redmine_id);

CREATE TABLE user_reminders (
  id integer NOT NULL DEFAULT nextval('user_reminders_id_seq'::regclass),
  user_id integer,
  telegram_id text NOT NULL,
  message text NOT NULL,
  remind_at timestamp with time zone NOT NULL,
  sent boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_user_reminders_unsent ON public.user_reminders USING btree (remind_at) WHERE (sent = false);

CREATE TABLE users (
  id integer NOT NULL DEFAULT nextval('users_id_seq'::regclass),
  redmine_id integer,
  name text NOT NULL,
  email text,
  initials text,
  team text,
  role text,
  active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_team_lead boolean DEFAULT false,
  telegram_chat_id text,
  telegram_username text
);

CREATE UNIQUE INDEX users_redmine_id_key ON public.users USING btree (redmine_id);
CREATE UNIQUE INDEX users_telegram_chat_id_key ON public.users USING btree (telegram_chat_id);

