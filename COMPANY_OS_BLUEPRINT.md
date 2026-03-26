# COMPANY OS — Complete Implementation Blueprint
> Hand this entire file to Claude Code. Everything needed to build from scratch.

---

## CONTEXT: What Already Exists

- **CEO Dashboard** is already built in Next.js (Redmine data visualized)
- **Stack in use**: Next.js + Supabase + Vercel + Redmine API
- **Auth**: Already built (login, middleware, session cookies)
- **We are now extending this into a full Company OS**

---

## THE ONE UNBREAKABLE RULE

```
REDMINE = READ ONLY. ALWAYS. ZERO EXCEPTIONS.

Allowed:  GET requests to Redmine API only
Blocked:  POST, PUT, DELETE, PATCH — never, ever, under any condition

All writes go to Supabase only.
Redmine is the immutable master record.
Hardcode this in middleware. Make it impossible to bypass.
```

---

## SYSTEM OVERVIEW

```
REDMINE (Master Record — Read Only)
         │
         │ pull every 15 min via cron
         ▼
NODE.JS SERVER (Brain — existing Next.js project)
         │
         ├──► TELEGRAM BOT  → CEO, Delivery Managers, PMs, Team Leads
         │                     (full company intelligence)
         │
         ├──► SLACK BOT     → Developers only
         │                     (scoped to own tickets only)
         │
         └──► EMAIL         → Formal reports (auto-generated)
                              
         │
         ▼
SUPABASE (Living Brain)
  ├── Postgres (all structured data)
  ├── pgvector (semantic memory per user)
  └── Realtime (live updates to dashboard)

UPSTASH REDIS (Session cache — last 10 messages per user)
```

---

## TECH STACK

```bash
# Already installed (existing project)
next.js, @supabase/supabase-js, vercel

# Add these
npm install telegraf @slack/bolt @slack/web-api openai @upstash/redis node-cron nodemailer
```

---

## ENVIRONMENT VARIABLES

Add to `.env.local` and Vercel dashboard:

```env
# Telegram
TELEGRAM_BOT_TOKEN=
CEO_TELEGRAM_CHAT_ID=

# Slack
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_APP_TOKEN=

# Supabase (already have these)
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# OpenAI
OPENAI_API_KEY=

# Redmine (already have these — READ ONLY)
REDMINE_URL=
REDMINE_API_KEY=

# Email
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

---

## SUPABASE SCHEMA — Run These Migrations In Order

### Migration 1: Enable Vector Extension

```sql
create extension if not exists vector;
create extension if not exists pg_cron;
```

### Migration 2: Users & Identity

```sql
create table bot_users (
  id                uuid primary key default gen_random_uuid(),
  telegram_id       bigint unique,
  slack_id          text unique,
  name              text not null,
  role              text not null check (role in ('ceo','delivery_manager','project_manager','team_lead','developer')),
  email             text,
  team              text,
  allowed_projects  text[] default '{}',
  preferences       jsonb default '{}',
  behavior_profile  jsonb default '{}',
  top_concerns      text[] default '{}',
  active_hours      jsonb default '{}',
  response_style    text default 'concise',
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
```

### Migration 3: Vector Memory

```sql
-- Every conversation message stored as a vector
create table conversation_memory (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references bot_users(id) on delete cascade,
  role        text check (role in ('user', 'assistant')),
  content     text not null,
  embedding   vector(1536),
  metadata    jsonb default '{}',
  -- metadata shape: { session_id, tickets_mentioned[], projects_mentioned[], importance_score }
  created_at  timestamptz default now()
);

create index on conversation_memory
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index on conversation_memory (user_id, created_at desc);

-- Compressed long-term summaries (compress every 20 messages)
create table memory_summaries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references bot_users(id) on delete cascade,
  summary      text not null,
  embedding    vector(1536),
  covers_from  timestamptz,
  covers_to    timestamptz,
  message_count int,
  created_at   timestamptz default now()
);

create index on memory_summaries
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
```

### Migration 4: Vector Search Function

```sql
create or replace function match_memories(
  query_embedding   vector(1536),
  match_user_id     uuid,
  match_threshold   float default 0.75,
  match_count       int default 5
)
returns table(
  id         uuid,
  content    text,
  metadata   jsonb,
  similarity float
)
language sql stable
as $$
  select
    id,
    content,
    metadata,
    1 - (embedding <=> query_embedding) as similarity
  from conversation_memory
  where
    user_id = match_user_id
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_project_qa(
  query_embedding   vector(1536),
  p_project_id      uuid,
  match_threshold   float default 0.82,
  match_count       int default 3
)
returns table(
  id          uuid,
  question    text,
  answer      text,
  answered_at timestamptz,
  similarity  float
)
language sql stable
as $$
  select
    id,
    question,
    answer,
    answered_at,
    1 - (answer_embedding <=> query_embedding) as similarity
  from project_qa
  where
    project_id = p_project_id
    and status = 'answered'
    and 1 - (answer_embedding <=> query_embedding) > match_threshold
  order by answer_embedding <=> query_embedding
  limit match_count;
$$;
```

### Migration 5: Project Explorations (CEO Conceptual Projects)

```sql
-- These are NEW projects the CEO is thinking about.
-- NOT in Redmine. Stored only in Supabase.
create table project_explorations (
  id                uuid primary key default gen_random_uuid(),
  created_by        uuid references bot_users(id),
  name              text not null,
  status            text default 'conceptual' check (
                      status in ('conceptual','in_discussion','approved','killed')
                    ),
  description       text,
  vision            text,
  cost_structure    jsonb default '{}',
  -- { estimated_cost, breakdown: [], assumptions: [], currency: 'USD' }
  timeline          jsonb default '{}',
  -- { start_date, end_date, milestones: [] }
  team_requirements jsonb default '{}',
  -- { roles_needed: [], headcount: n, internal_vs_hire: '' }
  risks             jsonb default '[]',
  opportunities     jsonb default '[]',
  decisions_made    jsonb default '[]',
  -- [{ decision, rationale, made_by, made_at }]
  shared_with       uuid[] default '{}',
  embedding         vector(1536),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index on project_explorations
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);
```

### Migration 6: Q&A Knowledge Base

```sql
-- THE CORE: CEO's knowledge, async escalation, institutional memory
create table project_qa (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid references project_explorations(id) on delete cascade,
  
  -- Question side
  asked_by              uuid references bot_users(id),
  question              text not null,
  question_embedding    vector(1536),
  asked_at              timestamptz default now(),
  
  -- Answer side
  answered_by           uuid references bot_users(id),
  answer                text,
  answer_embedding      vector(1536),
  answered_at           timestamptz,
  
  -- State
  status                text default 'pending' check (status in ('pending','answered','archived')),
  
  -- CEO notification tracking
  ceo_notified_at       timestamptz,
  ceo_notification_read boolean default false,
  
  -- Engagement tracking (for KPI)
  view_count            int default 0
);

create index on project_qa (project_id, status);
create index on project_qa (asked_by, asked_at desc);
create index on project_qa
  using ivfflat (question_embedding vector_cosine_ops)
  with (lists = 50);
```

### Migration 7: CEO Notifications

```sql
create table ceo_notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text check (type in (
                'new_question','project_accessed','unanswered_backlog',
                'performance_alert','capacity_alert','deadline_risk'
              )),
  from_user   uuid references bot_users(id),
  project_id  uuid references project_explorations(id),
  qa_id       uuid references project_qa(id),
  message     text not null,
  action_url  text,
  is_read     boolean default false,
  created_at  timestamptz default now()
);

create index on ceo_notifications (is_read, created_at desc);
```

### Migration 8: Performance Engine

```sql
create table performance_snapshots (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid references bot_users(id),
  snapshot_date               date not null,
  period                      text check (period in ('daily','weekly','monthly')),
  
  -- Raw metrics (from Redmine)
  tickets_closed              int default 0,
  tickets_in_progress         int default 0,
  tickets_overdue             int default 0,
  tickets_reopened            int default 0,
  hours_logged                decimal default 0,
  
  -- Speed metrics
  avg_resolution_time_hrs     decimal,
  avg_first_action_time_hrs   decimal,
  avg_response_to_blocker_hrs decimal,
  
  -- Quality metrics
  reopen_rate                 decimal,
  downstream_blockers_caused  int default 0,
  scope_additions             int default 0,
  
  -- Reliability metrics
  deadline_hit_rate           decimal,
  proactive_update_rate       decimal,
  estimate_accuracy           decimal,
  
  -- Collaboration metrics
  blockers_resolved_for_others int default 0,
  avg_unblock_time_hrs        decimal,
  
  -- Computed scores (0-100 each)
  output_score                decimal,
  speed_score                 decimal,
  quality_score               decimal,
  reliability_score           decimal,
  collaboration_score         decimal,
  overall_score               decimal,
  
  -- Trend
  score_delta                 decimal,
  trend                       text check (trend in ('rising','stable','declining')),
  
  raw_data                    jsonb default '{}',
  created_at                  timestamptz default now(),
  
  unique(user_id, snapshot_date, period)
);

-- Granular event log
create table performance_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references bot_users(id),
  event_type   text check (event_type in (
                 'ticket_closed','ticket_reopened','blocker_raised',
                 'blocker_resolved','deadline_missed','deadline_hit',
                 'update_proactive','update_chased','scope_added',
                 'hours_logged','hours_missing'
               )),
  ticket_id    text,
  event_data   jsonb default '{}',
  impact_score decimal,
  occurred_at  timestamptz default now()
);

create index on performance_events (user_id, occurred_at desc);
create index on performance_events (event_type, occurred_at desc);
```

### Migration 9: Capacity Tracking

```sql
create table capacity_status (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references bot_users(id) unique,
  current_workload_pct   decimal default 0,
  active_tickets         int default 0,
  available_capacity_pct decimal default 100,
  predicted_free_date    date,
  predicted_free_pct     decimal,
  days_underloaded       int default 0,
  alert_sent_today       boolean default false,
  last_calculated        timestamptz default now()
);

create table availability_alerts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references bot_users(id),
  available_capacity    decimal,
  alert_type            text check (alert_type in ('just_freed','becoming_free','underloaded')),
  suggested_tickets     jsonb default '[]',
  sent_to               uuid references bot_users(id),
  actioned              boolean default false,
  actioned_at           timestamptz,
  created_at            timestamptz default now()
);
```

### Migration 10: Escalation Log & Decision Trail

```sql
create table escalation_log (
  id              uuid primary key default gen_random_uuid(),
  rule_triggered  text not null,
  context         jsonb not null,
  action_taken    text,
  escalated_to    uuid references bot_users(id),
  actioned        boolean default false,
  actioned_at     timestamptz,
  triggered_at    timestamptz default now()
);

-- Every decision ever made — never deleted
create table decision_trail (
  id            uuid primary key default gen_random_uuid(),
  made_by       uuid references bot_users(id),
  project_id    uuid references project_explorations(id),
  decision      text not null,
  rationale     text,
  data_used     jsonb default '{}',
  outcome       text,
  outcome_date  timestamptz,
  embedding     vector(1536),
  created_at    timestamptz default now()
);
```

---

## FILE STRUCTURE TO CREATE

```
/
├── lib/
│   ├── redmine.js          ← Redmine API client (READ ONLY enforced)
│   ├── supabase.js         ← Supabase client
│   ├── redis.js            ← Upstash Redis client
│   ├── openai.js           ← OpenAI client + embedding helper
│   └── middleware/
│       └── redmine-guard.js ← Hard block on any Redmine writes
│
├── bots/
│   ├── telegram/
│   │   ├── index.js        ← Bot setup + message handler
│   │   ├── router.js       ← Detect mode: INTERNAL / EXPLORER / HYBRID
│   │   ├── prompt.js       ← Build personalized system prompt per user
│   │   ├── tools.js        ← All GPT function definitions
│   │   ├── executor.js     ← Execute tool calls
│   │   └── handlers/
│   │       ├── ceo.js      ← CEO-specific logic
│   │       ├── pm.js       ← PM-specific logic
│   │       └── dm.js       ← Delivery Manager logic
│   │
│   └── slack/
│       ├── index.js        ← Slack Bolt setup
│       ├── standup.js      ← Async standup workflow
│       ├── tickets.js      ← Ticket update cards
│       └── blockers.js     ← Blocker reporting + escalation
│
├── intelligence/
│   ├── memory.js           ← Save/retrieve vector memory
│   ├── learning.js         ← Extract learnings from conversations
│   ├── performance.js      ← Score calculation engine
│   ├── capacity.js         ← Capacity tracking + alerts
│   ├── escalation.js       ← Escalation rules engine
│   ├── matcher.js          ← Smart ticket-to-developer matching
│   └── reports.js          ← Auto-generate status reports
│
├── qa/
│   ├── knowledge.js        ← Search Q&A knowledge base
│   ├── escalate.js         ← Escalate unanswered Q to CEO
│   └── answer.js           ← CEO answers + notify questioner
│
├── crons/
│   ├── index.js            ← Register all cron jobs
│   ├── standup.js          ← 9AM standup sender
│   ├── briefings.js        ← CEO/PM morning briefs
│   ├── silence.js          ← Detect silent tickets
│   ├── capacity.js         ← Recalculate capacity every 2hr
│   ├── performance.js      ← Nightly score calculation
│   ├── memory-compress.js  ← Sunday memory compression
│   └── reports.js          ← Friday report generation
│
└── pages/api/
    ├── telegram/
    │   └── webhook.js      ← Telegram webhook endpoint
    └── slack/
        └── events.js       ← Slack events endpoint
```

---

## lib/redmine.js — READ ONLY CLIENT

```javascript
// lib/redmine.js
// CRITICAL: This file only makes GET requests. No writes. Ever.

const REDMINE_URL = process.env.REDMINE_URL;
const REDMINE_KEY = process.env.REDMINE_API_KEY;

function guardWrite(method) {
  const blocked = ['POST','PUT','DELETE','PATCH'];
  if (blocked.includes(method.toUpperCase())) {
    throw new Error(`HARD RULE VIOLATION: Cannot ${method} to Redmine. Read only.`);
  }
}

async function redmineGet(path, params = {}) {
  guardWrite('GET'); // still call guard for safety
  const url = new URL(`${REDMINE_URL}${path}.json`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  
  const res = await fetch(url.toString(), {
    headers: { 'X-Redmine-API-Key': REDMINE_KEY, 'Content-Type': 'application/json' }
  });
  
  if (!res.ok) throw new Error(`Redmine API error: ${res.status} ${path}`);
  return res.json();
}

const redmine = {
  // Issues / Tickets
  getTickets: (params = {}) => redmineGet('/issues', { limit: 100, ...params }),
  getTicket: (id) => redmineGet(`/issues/${id}`),
  getTicketsByProject: (projectId, params = {}) =>
    redmineGet('/issues', { project_id: projectId, limit: 100, ...params }),
  getOverdueTickets: () => redmineGet('/issues', {
    status_id: 'open', limit: 100
    // filter by due_date in application layer
  }),
  getTicketsByAssignee: (userId) => redmineGet('/issues', { assigned_to_id: userId, limit: 100 }),

  // Projects
  getProjects: () => redmineGet('/projects', { limit: 100 }),
  getProject: (id) => redmineGet(`/projects/${id}`),

  // Users / Members
  getUsers: () => redmineGet('/users', { limit: 100 }),
  getUser: (id) => redmineGet(`/users/${id}`),
  getProjectMemberships: (projectId) => redmineGet(`/projects/${projectId}/memberships`),

  // Time Entries
  getTimeEntries: (params = {}) => redmineGet('/time_entries', { limit: 100, ...params }),
  getTimeEntriesByUser: (userId, params = {}) =>
    redmineGet('/time_entries', { user_id: userId, limit: 100, ...params }),
  getTimeEntriesByProject: (projectId, params = {}) =>
    redmineGet('/time_entries', { project_id: projectId, limit: 100, ...params }),

  // Issue Statuses & Priorities
  getStatuses: () => redmineGet('/issue_statuses'),
  getPriorities: () => redmineGet('/enumerations/issue_priorities'),
};

module.exports = { redmine };
```

---

## lib/redis.js — SESSION STORE

```javascript
// lib/redis.js
import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Session helpers
export async function getRecentMessages(userId, count = 10) {
  try {
    const messages = await redis.lrange(`chat:${userId}`, 0, count - 1);
    return messages || [];
  } catch { return []; }
}

export async function saveMessage(userId, role, content) {
  const message = JSON.stringify({ role, content, ts: Date.now() });
  await redis.lpush(`chat:${userId}`, message);
  await redis.expire(`chat:${userId}`, 86400); // 24hr TTL
  // Keep only last 20
  await redis.ltrim(`chat:${userId}`, 0, 19);
}

export async function clearSession(userId) {
  await redis.del(`chat:${userId}`);
}
```

---

## lib/openai.js — AI + EMBEDDINGS

```javascript
// lib/openai.js
import OpenAI from 'openai';

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function embed(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000), // safety limit
  });
  return res.data[0].embedding;
}

export async function chat(messages, tools = null, toolChoice = 'auto') {
  const params = {
    model: 'gpt-4o',
    messages,
    max_tokens: 1500,
  };
  if (tools) {
    params.tools = tools;
    params.tool_choice = toolChoice;
  }
  return openai.chat.completions.create(params);
}
```

---

## intelligence/memory.js — VECTOR MEMORY

```javascript
// intelligence/memory.js
import { supabase } from '../lib/supabase';
import { embed } from '../lib/openai';
import { getRecentMessages, saveMessage } from '../lib/redis';

export async function getContext(userId, currentMessage) {
  // Layer 1: Recent messages from Redis (fast)
  const recent = await getRecentMessages(userId, 10);

  // Layer 2: Semantically relevant memories from Supabase
  const embedding = await embed(currentMessage);
  const { data: relevant } = await supabase.rpc('match_memories', {
    query_embedding: embedding,
    match_user_id: userId,
    match_threshold: 0.75,
    match_count: 5,
  });

  return { recent, relevant: relevant || [] };
}

export async function saveToMemory(userId, userMessage, assistantResponse) {
  // Save to Redis immediately (sync)
  await saveMessage(userId, 'user', userMessage);
  await saveMessage(userId, 'assistant', assistantResponse);

  // Save to Supabase async (don't block response)
  setImmediate(async () => {
    try {
      const [userEmbedding, assistantEmbedding] = await Promise.all([
        embed(userMessage),
        embed(assistantResponse),
      ]);

      await supabase.from('conversation_memory').insert([
        {
          user_id: userId,
          role: 'user',
          content: userMessage,
          embedding: userEmbedding,
          metadata: extractMetadata(userMessage),
        },
        {
          user_id: userId,
          role: 'assistant',
          content: assistantResponse,
          embedding: assistantEmbedding,
        },
      ]);
    } catch (e) {
      console.error('Memory save error:', e);
    }
  });
}

export async function compressMemory(userId) {
  // Get messages not yet in a summary
  const { data: messages } = await supabase
    .from('conversation_memory')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(20);

  if (!messages || messages.length < 20) return;

  const conversation = messages.map(m => `${m.role}: ${m.content}`).join('\n');

  const { choices } = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `Compress this conversation into a 3-5 sentence summary capturing:
      - Key topics discussed
      - Decisions or facts stated
      - Concerns or patterns noticed
      - People or projects mentioned
      
      Conversation:
      ${conversation}
      
      Return only the summary, nothing else.`
    }]
  });

  const summary = choices[0].message.content;
  const summaryEmbedding = await embed(summary);

  await supabase.from('memory_summaries').insert({
    user_id: userId,
    summary,
    embedding: summaryEmbedding,
    covers_from: messages[0].created_at,
    covers_to: messages[messages.length - 1].created_at,
    message_count: messages.length,
  });
}

function extractMetadata(message) {
  // Extract ticket IDs, project names, people mentioned
  const tickets = message.match(/TK-\d+/g) || [];
  return { tickets_mentioned: tickets };
}
```

---

## intelligence/learning.js — BEHAVIORAL LEARNING

```javascript
// intelligence/learning.js
// Runs after every conversation. Extracts learnings. Updates user profile.

import { supabase } from '../lib/supabase';
import { openai } from '../lib/openai';

export async function learnFromConversation(userId, userMessage, assistantResponse) {
  setImmediate(async () => {
    try {
      const { choices } = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: `Analyze this single exchange and extract learnings about the USER only.
          
          User said: "${userMessage}"
          Assistant responded: "${assistantResponse}"
          
          Return JSON only, no markdown:
          {
            "facts": [{ "key": "", "value": "" }],
            "behavioral_signals": {
              "response_length_preference": "short|medium|long|null",
              "communication_style": "formal|casual|direct|null",
              "detail_preference": "summary|detailed|null",
              "urgency_level": "high|normal|low|null"
            },
            "topics_of_concern": [],
            "corrections": [{ "corrected": "", "correction": "" }]
          }`
        }],
        max_tokens: 500,
      });

      let learned;
      try {
        learned = JSON.parse(choices[0].message.content);
      } catch { return; }

      // Get current profile
      const { data: user } = await supabase
        .from('bot_users')
        .select('behavior_profile, top_concerns, preferences')
        .eq('id', userId)
        .single();

      if (!user) return;

      // Merge behavioral signals
      const updatedProfile = {
        ...user.behavior_profile,
        ...Object.fromEntries(
          Object.entries(learned.behavioral_signals || {})
            .filter(([, v]) => v !== null)
        ),
        last_updated: new Date().toISOString(),
      };

      // Merge top concerns
      const currentConcerns = user.top_concerns || [];
      const newConcerns = learned.topics_of_concern || [];
      const mergedConcerns = [...new Set([...currentConcerns, ...newConcerns])].slice(0, 10);

      await supabase.from('bot_users').update({
        behavior_profile: updatedProfile,
        top_concerns: mergedConcerns,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);

    } catch (e) {
      console.error('Learning error:', e);
    }
  });
}
```

---

## bots/telegram/prompt.js — PERSONALIZED SYSTEM PROMPT

```javascript
// bots/telegram/prompt.js

export function buildSystemPrompt(user, memories, recentMessages) {
  const roleAccess = {
    ceo: 'Full access to all company data, all teams, all projects, all people.',
    delivery_manager: `Access limited to: ${user.allowed_projects?.join(', ') || 'your assigned projects'} and their teams only.`,
    project_manager: `Access limited to: ${user.allowed_projects?.join(', ') || 'your assigned projects'} and assigned team members only.`,
    team_lead: `Access limited to: your team's tickets and time logs only.`,
    developer: `Access limited to: your own tickets only. Nothing else.`,
  };

  const memoryContext = memories.relevant?.length > 0
    ? `\nRELEVANT CONTEXT FROM PAST CONVERSATIONS:\n${memories.relevant.map(m => `- ${m.content}`).join('\n')}`
    : '';

  const recentContext = recentMessages?.length > 0
    ? `\nRECENT CONVERSATION:\n${recentMessages.slice(0, 6).join('\n')}`
    : '';

  const styleGuide = buildStyleGuide(user);

  return `You are a personal AI operations assistant for ${user.name}.
Role: ${user.role.replace(/_/g, ' ')}.
Team: ${user.team || 'N/A'}.

DATA ACCESS:
${roleAccess[user.role]}

ABSOLUTE RULES:
1. Redmine is READ ONLY. Never suggest, imply, or execute any writes to Redmine.
2. All new data (projects, notes, decisions) goes to Supabase only.
3. Never share data outside this user's access scope.
4. Never hallucinate ticket IDs, names, or numbers. Only use real data from tools.
5. If you don't have data to answer — say so and offer to escalate or research.

${styleGuide}

${memoryContext}
${recentContext}

Today: ${new Date().toDateString()}.
Be direct, accurate, and immediately useful.`;
}

function buildStyleGuide(user) {
  const profile = user.behavior_profile || {};
  const lines = ['COMMUNICATION STYLE:'];

  if (profile.response_length_preference === 'short') {
    lines.push('- This person prefers SHORT responses. Bullets only. No preamble.');
  } else if (profile.response_length_preference === 'long') {
    lines.push('- This person prefers detailed responses with full context.');
  } else {
    lines.push('- Use concise bullets. Lead with the answer. Details after.');
  }

  if (profile.urgency_level === 'high') {
    lines.push('- They are often in a hurry. Skip pleasantries entirely.');
  }

  if (user.top_concerns?.length > 0) {
    lines.push(`- Their recurring concerns: ${user.top_concerns.slice(0,5).join(', ')}`);
  }

  lines.push('- Use emojis for quick visual scanning (🔴 critical, 🟡 watch, 🟢 ok, ✅ done, ⚠️ alert)');
  lines.push('- Always end actionable messages with a decision prompt or next step');

  return lines.join('\n');
}
```

---

## bots/telegram/tools.js — GPT FUNCTION DEFINITIONS

```javascript
// bots/telegram/tools.js

export const tools = [
  {
    type: 'function',
    function: {
      name: 'get_tickets',
      description: 'Get Redmine tickets filtered by various criteria',
      parameters: {
        type: 'object',
        properties: {
          status:          { type: 'string', enum: ['open','in_progress','blocked','review','closed','overdue','all'] },
          priority:        { type: 'string', enum: ['critical','high','medium','low'] },
          assignee_name:   { type: 'string', description: 'Name of person assigned to tickets' },
          project_name:    { type: 'string', description: 'Project name to filter by' },
          created_today:   { type: 'boolean' },
          due_within_days: { type: 'number', description: 'Tickets due within N days' },
          silent_days:     { type: 'number', description: 'Tickets with no update in N days' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_time_logs',
      description: 'Get time logging status — who logged, who did not, totals',
      parameters: {
        type: 'object',
        properties: {
          range:        { type: 'string', enum: ['daily','weekly','monthly','quarterly','yearly'] },
          missing_only: { type: 'boolean', description: 'Only return people who have NOT logged' },
          team:         { type: 'string' },
          person_name:  { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_person_summary',
      description: 'Full summary for a team member — tickets, hours, workload, leave, performance',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Person's full name" },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_status',
      description: 'Status, deadline, completion %, risk, blockers for projects',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: 'Specific project or omit for all' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team_leave',
      description: 'Who is on leave — today, this week, or upcoming',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['today','this_week','upcoming'] },
          team:   { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_capacity_status',
      description: 'Who is free, who is overloaded, capacity percentages, availability forecast',
      parameters: {
        type: 'object',
        properties: {
          team:          { type: 'string' },
          available_only: { type: 'boolean', description: 'Only show people with available capacity' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_performance_report',
      description: 'Individual or team performance scores, trends, alerts',
      parameters: {
        type: 'object',
        properties: {
          person_name: { type: 'string' },
          team:        { type: 'string' },
          period:      { type: 'string', enum: ['daily','weekly','monthly'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_project_knowledge',
      description: 'Search CEO project knowledge base — conceptual projects, Q&A, decisions',
      parameters: {
        type: 'object',
        properties: {
          query:        { type: 'string', description: 'What to search for' },
          project_name: { type: 'string', description: 'Specific project or search all' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project_exploration',
      description: 'Create a new conceptual project workspace in Supabase. NEVER creates in Redmine.',
      parameters: {
        type: 'object',
        properties: {
          name:        { type: 'string' },
          description: { type: 'string' },
          vision:      { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_project_exploration',
      description: 'Add cost structure, timeline, risks, decisions to a conceptual project',
      parameters: {
        type: 'object',
        properties: {
          project_name:     { type: 'string' },
          cost_structure:   { type: 'object' },
          timeline:         { type: 'object' },
          team_requirements:{ type: 'object' },
          risks:            { type: 'array', items: { type: 'string' } },
          decision:         { type: 'string', description: 'A decision to add to the trail' },
          decision_rationale:{ type: 'string' },
        },
        required: ['project_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalate_question_to_ceo',
      description: 'Save an unanswered question and notify the CEO. Use when knowledge base has no answer.',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string' },
          question:     { type: 'string' },
          asked_by_name:{ type: 'string' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'research_topic',
      description: 'EXPLORER MODE ONLY: Research any external topic — market size, costs, competitors, technology. Use when CEO is exploring a NEW idea not yet in the system.',
      parameters: {
        type: 'object',
        properties: {
          topic:   { type: 'string' },
          angles:  { type: 'array', items: { type: 'string' }, description: 'Specific angles: market_size, competitors, cost_to_build, risks, opportunities' },
          depth:   { type: 'string', enum: ['quick','deep'] },
        },
        required: ['topic'],
      },
    },
  },
];
```

---

## bots/telegram/router.js — MODE DETECTION

```javascript
// bots/telegram/router.js
// Detects whether a message needs internal data, external research, or both

export function detectMode(message) {
  const msg = message.toLowerCase();

  const internalKeywords = [
    'ticket','tickets','tk-','leave','logged','time log',
    'project','deadline','team','assigned','overdue','blocked',
    'capacity','performance','sprint','hours','status'
  ];

  const explorerKeywords = [
    'new project','thinking about','want to build','explore',
    'market size','cost of','how would we','what if we built',
    'should we build','competitor','industry','research'
  ];

  const isInternal = internalKeywords.some(k => msg.includes(k));
  const isExplorer = explorerKeywords.some(k => msg.includes(k));

  if (isExplorer && !isInternal) return 'EXPLORER';
  if (isInternal && isExplorer) return 'HYBRID';
  return 'INTERNAL';
}
```

---

## bots/telegram/index.js — MAIN BOT

```javascript
// bots/telegram/index.js
import { Telegraf } from 'telegraf';
import { supabase } from '../../lib/supabase';
import { chat } from '../../lib/openai';
import { getContext, saveToMemory } from '../../intelligence/memory';
import { learnFromConversation } from '../../intelligence/learning';
import { buildSystemPrompt } from './prompt';
import { tools } from './tools';
import { executeTools } from './executor';
import { detectMode } from './router';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Security middleware — only registered users
bot.use(async (ctx, next) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const { data: user } = await supabase
    .from('bot_users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();

  if (!user) {
    return ctx.reply('You are not registered. Contact your CEO to get access.');
  }

  ctx.botUser = user;
  return next();
});

// Registration command (CEO only)
bot.command('register', async (ctx) => {
  if (ctx.botUser.role !== 'ceo') {
    return ctx.reply('Only CEO can register users.');
  }
  // Format: /register @name email@co.com role
  const parts = ctx.message.text.split(' ');
  if (parts.length < 4) {
    return ctx.reply('Format: /register @name email role\nRoles: delivery_manager, project_manager, team_lead, developer');
  }
  // TODO: implement registration
});

// CEO answers a Q&A question
bot.command('answer', async (ctx) => {
  if (ctx.botUser.role !== 'ceo') return;
  const text = ctx.message.text;
  const parts = text.split(' ');
  const qaId = parts[1];
  const answer = parts.slice(2).join(' ');

  if (!qaId || !answer) {
    return ctx.reply('Format: /answer [qa_id] [your answer]');
  }

  const { answerQuestion } = require('../../qa/answer');
  await answerQuestion(qaId, answer, ctx.botUser.id, ctx);
});

// Main message handler
bot.on('text', async (ctx) => {
  const user = ctx.botUser;
  const message = ctx.message.text;

  await ctx.sendChatAction('typing');

  try {
    // Get context (Redis + vector memory)
    const context = await getContext(user.id, message);

    // Build personalized system prompt
    const systemPrompt = buildSystemPrompt(user, context, context.recent);

    // Detect mode
    const mode = detectMode(message);

    // Select tools based on mode
    const activeTools = mode === 'EXPLORER'
      ? tools.filter(t => t.function.name === 'research_topic' ||
                          t.function.name === 'create_project_exploration' ||
                          t.function.name === 'update_project_exploration')
      : tools;

    // First GPT call
    const response = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      activeTools
    );

    const msg = response.choices[0].message;
    let finalReply;

    if (msg.tool_calls?.length > 0) {
      // Execute tool calls
      const toolResults = await executeTools(msg.tool_calls, user);

      // Second GPT call with results
      const finalResponse = await chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
        msg,
        ...toolResults,
      ]);

      finalReply = finalResponse.choices[0].message.content;
    } else {
      finalReply = msg.content;
    }

    // Send reply
    await ctx.reply(finalReply, { parse_mode: 'Markdown' });

    // Save to memory + learn (async, non-blocking)
    saveToMemory(user.id, message, finalReply);
    learnFromConversation(user.id, message, finalReply);

  } catch (error) {
    console.error('Telegram bot error:', error);
    await ctx.reply('Something went wrong. Try again.');
  }
});

export { bot };
```

---

## qa/knowledge.js — Q&A SEARCH + ESCALATION

```javascript
// qa/knowledge.js
import { supabase } from '../lib/supabase';
import { embed } from '../lib/openai';

export async function searchKnowledgeBase(projectName, question) {
  // Find project
  const { data: project } = await supabase
    .from('project_explorations')
    .select('id, name, description, vision, cost_structure, timeline, risks, decisions_made')
    .ilike('name', `%${projectName}%`)
    .single();

  if (!project) return null;

  // Search Q&A
  const questionEmbedding = await embed(question);
  const { data: matches } = await supabase.rpc('match_project_qa', {
    query_embedding: questionEmbedding,
    p_project_id: project.id,
    match_threshold: 0.82,
    match_count: 3,
  });

  return {
    project,
    answers: matches || [],
    hasAnswer: matches?.length > 0,
  };
}

export async function escalateToCEO(projectId, question, askedBy, telegramBot) {
  const questionEmbedding = await embed(question);

  // Save pending Q&A
  const { data: qa } = await supabase
    .from('project_qa')
    .insert({
      project_id: projectId,
      asked_by: askedBy.id,
      question,
      question_embedding: questionEmbedding,
      status: 'pending',
    })
    .select()
    .single();

  // Get project name
  const { data: project } = await supabase
    .from('project_explorations')
    .select('name')
    .eq('id', projectId)
    .single();

  // Save notification
  await supabase.from('ceo_notifications').insert({
    type: 'new_question',
    from_user: askedBy.id,
    project_id: projectId,
    qa_id: qa.id,
    message: `${askedBy.name} asked about ${project?.name}: "${question}"`,
  });

  // Notify CEO on Telegram
  const ceoUser = await getCEO();
  if (ceoUser?.telegram_id && telegramBot) {
    await telegramBot.telegram.sendMessage(
      ceoUser.telegram_id,
      `❓ *New Question — ${project?.name}*\n\n*From:* ${askedBy.name} (${askedBy.role})\n*Question:* "${question}"\n\n*To answer:*\n\`/answer ${qa.id} [your answer]\`\n\n_Answering builds the knowledge base for everyone._`,
      { parse_mode: 'Markdown' }
    );
  }

  return qa.id;
}

async function getCEO() {
  const { data } = await supabase
    .from('bot_users')
    .select('*')
    .eq('role', 'ceo')
    .single();
  return data;
}
```

---

## qa/answer.js — CEO ANSWERS + NOTIFIES

```javascript
// qa/answer.js
import { supabase } from '../lib/supabase';
import { embed } from '../lib/openai';

export async function answerQuestion(qaId, answer, ceoUserId, ctx) {
  const answerEmbedding = await embed(answer);

  // Update Q&A record
  const { data: qa } = await supabase
    .from('project_qa')
    .update({
      answer,
      answer_embedding: answerEmbedding,
      answered_by: ceoUserId,
      answered_at: new Date().toISOString(),
      status: 'answered',
    })
    .eq('id', qaId)
    .select('*, asked_by_user:asked_by(name, telegram_id, slack_id), project:project_id(name)')
    .single();

  if (!qa) {
    return ctx.reply('Question not found. Check the ID.');
  }

  // Notify the person who asked — Telegram
  const asker = qa.asked_by_user;
  if (asker?.telegram_id) {
    await ctx.telegram.sendMessage(
      asker.telegram_id,
      `✅ *CEO answered your question*\n\n*Project:* ${qa.project?.name}\n*Your question:* "${qa.question}"\n\n*Answer:*\n${answer}\n\n_This is now in the project knowledge base._`,
      { parse_mode: 'Markdown' }
    );
  }

  // Confirm to CEO
  await ctx.reply(`✅ Answer saved. ${asker?.name} has been notified.\n\nThis Q&A is now in the knowledge base.`);
}
```

---

## intelligence/performance.js — SCORING ENGINE

```javascript
// intelligence/performance.js
// Run nightly via cron

import { supabase } from '../lib/supabase';
import { redmine } from '../lib/redmine';

export async function calculatePerformanceScores(period = 'daily') {
  const { data: users } = await supabase
    .from('bot_users')
    .select('*')
    .neq('role', 'ceo');

  for (const user of users) {
    try {
      const metrics = await gatherMetrics(user, period);
      const scores = computeScores(metrics);

      await supabase.from('performance_snapshots').upsert({
        user_id: user.id,
        snapshot_date: new Date().toISOString().split('T')[0],
        period,
        ...metrics,
        ...scores,
        trend: await calculateTrend(user.id, scores.overall_score, period),
      });
    } catch (e) {
      console.error(`Score calc error for ${user.name}:`, e);
    }
  }
}

async function gatherMetrics(user, period) {
  const dateFilter = getDateFilter(period);

  // From Redmine (read only)
  const [tickets, timeEntries] = await Promise.all([
    redmine.getTicketsByAssignee(user.redmine_user_id),
    redmine.getTimeEntriesByUser(user.redmine_user_id, dateFilter),
  ]);

  const closed = tickets.issues?.filter(t => t.status.name === 'Closed') || [];
  const overdue = tickets.issues?.filter(t => {
    return t.due_date && new Date(t.due_date) < new Date() && t.status.name !== 'Closed';
  }) || [];

  const hours = timeEntries.time_entries?.reduce((s, e) => s + e.hours, 0) || 0;

  return {
    tickets_closed: closed.length,
    tickets_overdue: overdue.length,
    hours_logged: hours,
    deadline_hit_rate: closed.length > 0
      ? closed.filter(t => !isLate(t)).length / closed.length
      : null,
  };
}

function computeScores(metrics) {
  const outputScore = Math.min(100, (metrics.tickets_closed / 8) * 100);
  const qualityScore = metrics.tickets_overdue === 0 ? 100
    : Math.max(0, 100 - (metrics.tickets_overdue * 15));
  const reliabilityScore = metrics.deadline_hit_rate != null
    ? metrics.deadline_hit_rate * 100 : 70;

  const overall = (
    outputScore * 0.25 +
    qualityScore * 0.25 +
    reliabilityScore * 0.20 +
    70 * 0.20 + // speed placeholder
    70 * 0.10   // collaboration placeholder
  );

  return {
    output_score: Math.round(outputScore),
    quality_score: Math.round(qualityScore),
    reliability_score: Math.round(reliabilityScore),
    speed_score: 70,
    collaboration_score: 70,
    overall_score: Math.round(overall),
  };
}

function getDateFilter(period) {
  const now = new Date();
  const from = new Date();
  if (period === 'daily') from.setDate(now.getDate() - 1);
  if (period === 'weekly') from.setDate(now.getDate() - 7);
  if (period === 'monthly') from.setMonth(now.getMonth() - 1);
  return { from: from.toISOString().split('T')[0], to: now.toISOString().split('T')[0] };
}

async function calculateTrend(userId, currentScore, period) {
  const { data: last } = await supabase
    .from('performance_snapshots')
    .select('overall_score')
    .eq('user_id', userId)
    .eq('period', period)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .single();

  if (!last) return 'stable';
  const delta = currentScore - last.overall_score;
  if (delta > 3) return 'rising';
  if (delta < -3) return 'declining';
  return 'stable';
}
```

---

## intelligence/capacity.js — AVAILABILITY ENGINE

```javascript
// intelligence/capacity.js
import { supabase } from '../lib/supabase';
import { redmine } from '../lib/redmine';

export async function updateCapacityStatus() {
  const { data: developers } = await supabase
    .from('bot_users')
    .select('*')
    .eq('role', 'developer');

  // Reset daily alert flag
  await supabase.from('capacity_status').update({ alert_sent_today: false });

  for (const dev of developers) {
    if (!dev.redmine_user_id) continue;

    const { issues } = await redmine.getTicketsByAssignee(dev.redmine_user_id);
    const activeTickets = issues?.filter(t => t.status.name !== 'Closed') || [];

    const totalEstimatedHours = activeTickets.reduce((s, t) =>
      s + (t.estimated_hours || 8), 0); // default 8hrs if no estimate

    const workloadPct = Math.min(100, (totalEstimatedHours / 160) * 100);
    const availablePct = Math.max(0, 100 - workloadPct);

    await supabase.from('capacity_status').upsert({
      user_id: dev.id,
      current_workload_pct: Math.round(workloadPct),
      active_tickets: activeTickets.length,
      available_capacity_pct: Math.round(availablePct),
      last_calculated: new Date().toISOString(),
    });

    // Trigger alert if developer has capacity
    if (availablePct >= 40) {
      await triggerAvailabilityAlert(dev, availablePct);
    }
  }
}

async function triggerAvailabilityAlert(dev, availablePct) {
  // Find PM for this developer
  const pm = await getPMForDeveloper(dev);
  if (!pm?.telegram_id) return;

  // Find best matching unassigned tickets
  const suggestions = await findMatchingTickets(dev);

  // Save alert
  await supabase.from('availability_alerts').insert({
    user_id: dev.id,
    available_capacity: availablePct,
    alert_type: 'just_freed',
    suggested_tickets: suggestions,
    sent_to: pm.id,
  });

  // Send to PM via Telegram
  const { bot } = require('../bots/telegram');
  const ticketList = suggestions.slice(0, 3).map((t, i) =>
    `${i + 1}. *${t.id}* — ${t.subject}\n   Priority: ${t.priority} | Est: ${t.estimated_hours || '?'}hrs`
  ).join('\n\n');

  await bot.telegram.sendMessage(
    pm.telegram_id,
    `🟢 *${dev.name} has capacity — ${Math.round(availablePct)}% free*\n\n*Suggested tickets:*\n\n${ticketList}\n\n_Assign a ticket?_`,
    { parse_mode: 'Markdown' }
  );
}

async function findMatchingTickets(dev) {
  // Get unassigned high priority tickets from Redmine
  const { issues } = await redmine.getTickets({
    assigned_to_id: 'none',
    status_id: 'open',
    limit: 20,
  });
  return (issues || [])
    .sort((a, b) => {
      const priority = { 'Immediate': 4, 'Urgent': 3, 'High': 2, 'Normal': 1, 'Low': 0 };
      return (priority[b.priority?.name] || 0) - (priority[a.priority?.name] || 0);
    })
    .slice(0, 5);
}
```

---

## crons/index.js — ALL SCHEDULED JOBS

```javascript
// crons/index.js
import cron from 'node-cron';
import { bot } from '../bots/telegram';
import { supabase } from '../lib/supabase';
import { redmine } from '../lib/redmine';
import { updateCapacityStatus } from '../intelligence/capacity';
import { calculatePerformanceScores } from '../intelligence/performance';
import { generateReport } from '../intelligence/reports';

export function startAllCrons() {

  // 9:00 AM weekdays — Async standup on Slack
  cron.schedule('0 9 * * 1-5', async () => {
    const { sendStandup } = require('../bots/slack/standup');
    await sendStandup();
  });

  // 9:05 AM weekdays — PM morning briefs on Telegram
  cron.schedule('5 9 * * 1-5', async () => {
    await sendPMBriefs();
  });

  // 9:10 AM weekdays — CEO morning brief
  cron.schedule('10 9 * * 1-5', async () => {
    await sendCEOBrief();
  });

  // 6:00 PM weekdays — EOD time log check
  cron.schedule('0 18 * * 1-5', async () => {
    await sendTimeLogAlert();
  });

  // Every 2 hours — Capacity recalculation
  cron.schedule('0 */2 * * *', async () => {
    await updateCapacityStatus();
  });

  // Every 6 hours — Silence detector
  cron.schedule('0 */6 * * *', async () => {
    await detectSilentTickets();
  });

  // Friday 4 PM — Auto-generate weekly status reports
  cron.schedule('0 16 * * 5', async () => {
    await generateWeeklyReports();
  });

  // Midnight daily — Performance scores
  cron.schedule('0 0 * * *', async () => {
    await calculatePerformanceScores('daily');
  });

  // Midnight Sunday — Memory compression
  cron.schedule('0 0 * * 0', async () => {
    const { compressAllMemories } = require('../intelligence/memory');
    await compressAllMemories();
  });

  // Monday 8 AM — Weekly predictive brief
  cron.schedule('0 8 * * 1', async () => {
    await calculatePerformanceScores('weekly');
    await sendWeeklyPredictions();
  });

  console.log('✅ All cron jobs started');
}

async function sendCEOBrief() {
  const { data: ceo } = await supabase
    .from('bot_users').select('*').eq('role', 'ceo').single();
  if (!ceo?.telegram_id) return;

  const [overdueTickets, missingLogs, onLeave, capacity] = await Promise.all([
    getOverdueCount(),
    getMissingTimeLogCount(),
    getOnLeaveCount(),
    getCriticalCapacityAlerts(),
  ]);

  const message = `☀️ *Good morning. Company pulse:*

🔴 Overdue tickets: *${overdueTickets}*
⏱ Missing time logs: *${missingLogs}*
🏖 On leave today: *${onLeave}*
${capacity.length > 0 ? `\n⚠️ *Capacity alerts:*\n${capacity.join('\n')}` : ''}

_Reply with anything you want to know._`;

  await bot.telegram.sendMessage(ceo.telegram_id, message, { parse_mode: 'Markdown' });
}

async function detectSilentTickets() {
  const { issues } = await redmine.getTickets({ status_id: 'open', limit: 100 });
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  const silent = (issues || []).filter(ticket => {
    const lastUpdate = new Date(ticket.updated_on);
    return lastUpdate < fiveDaysAgo;
  });

  for (const ticket of silent) {
    // Notify assigned developer on Slack
    const { notifyDeveloperSlack } = require('../bots/slack/tickets');
    await notifyDeveloperSlack(ticket, 'silent');

    // Notify PM on Telegram
    await notifyPMAboutSilentTicket(ticket);
  }
}

async function sendTimeLogAlert() {
  const today = new Date().toISOString().split('T')[0];
  const { time_entries } = await redmine.getTimeEntries({ spent_on: today });
  
  const { data: allDevs } = await supabase
    .from('bot_users').select('*').in('role', ['developer','team_lead']);

  const loggedIds = new Set(time_entries?.map(e => e.user?.id) || []);
  const missing = allDevs.filter(u => u.redmine_user_id && !loggedIds.has(u.redmine_user_id));

  if (missing.length === 0) return;

  const { data: pms } = await supabase
    .from('bot_users').select('*').in('role', ['project_manager','delivery_manager','ceo']);

  const names = missing.map(u => u.name).join(', ');

  for (const pm of pms) {
    if (!pm.telegram_id) continue;
    await bot.telegram.sendMessage(
      pm.telegram_id,
      `⏰ *EOD Time Log Alert*\n\nNot logged yet:\n${missing.map(u => `• ${u.name}`).join('\n')}\n\n_Automated reminder sent via Slack._`,
      { parse_mode: 'Markdown' }
    );
  }
}
```

---

## bots/slack/index.js — SLACK BOT SETUP

```javascript
// bots/slack/index.js
import { App } from '@slack/bolt';
import { supabase } from '../../lib/supabase';

export const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Identity middleware
slackApp.use(async ({ context, client, body, next }) => {
  const slackUserId = body.event?.user || body.user?.id;
  if (!slackUserId) return next();

  const { data: user } = await supabase
    .from('bot_users')
    .select('*')
    .eq('slack_id', slackUserId)
    .single();

  if (!user) return; // Silently ignore unregistered users
  
  // ENFORCE: Developers cannot access non-developer data
  if (user.role !== 'developer' && user.role !== 'team_lead') {
    return; // Leaders use Telegram only
  }

  context.botUser = user;
  return next();
});

// Handle button actions from ticket cards
slackApp.action(/ticket_action_.+/, async ({ action, body, ack, client }) => {
  await ack();
  const { handleTicketAction } = require('./tickets');
  await handleTicketAction(action, body, client);
});

export async function sendDirectMessage(slackUserId, message, blocks = null) {
  try {
    const result = await slackApp.client.conversations.open({ users: slackUserId });
    await slackApp.client.chat.postMessage({
      channel: result.channel.id,
      text: message,
      blocks: blocks || undefined,
    });
  } catch (e) {
    console.error('Slack DM error:', e);
  }
}
```

---

## bots/slack/standup.js — ASYNC STANDUP

```javascript
// bots/slack/standup.js
import { supabase } from '../../lib/supabase';
import { redmine } from '../../lib/redmine';
import { sendDirectMessage } from './index';

export async function sendStandup() {
  const { data: developers } = await supabase
    .from('bot_users')
    .select('*')
    .in('role', ['developer', 'team_lead'])
    .not('slack_id', 'is', null);

  for (const dev of developers) {
    if (!dev.redmine_user_id) continue;

    const { issues } = await redmine.getTicketsByAssignee(dev.redmine_user_id);
    const activeTickets = (issues || []).filter(t => t.status.name !== 'Closed').slice(0, 5);

    if (activeTickets.length === 0) continue;

    const blocks = buildStandupCard(dev, activeTickets);
    await sendDirectMessage(dev.slack_id, `Good morning ${dev.name.split(' ')[0]}! Your tickets today:`, blocks);
  }
}

function buildStandupCard(user, tickets) {
  const ticketBlocks = tickets.map(ticket => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${ticket.id}* — ${ticket.subject}\nStatus: ${ticket.status.name} | Due: ${ticket.due_date || 'No date'}`
    },
    accessory: {
      type: 'static_select',
      placeholder: { type: 'plain_text', text: 'Update status' },
      action_id: `ticket_action_${ticket.id}`,
      options: [
        { text: { type: 'plain_text', text: '✅ Done' }, value: `done_${ticket.id}` },
        { text: { type: 'plain_text', text: '🔄 In Progress' }, value: `progress_${ticket.id}` },
        { text: { type: 'plain_text', text: '🚫 Blocked' }, value: `blocked_${ticket.id}` },
        { text: { type: 'plain_text', text: '📋 Not Started' }, value: `todo_${ticket.id}` },
      ],
    },
  }));

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Good morning ${user.name.split(' ')[0]}! 👋` }
    },
    { type: 'divider' },
    ...ticketBlocks,
    { type: 'divider' },
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '🚫 Report a Blocker' },
        style: 'danger',
        action_id: 'report_blocker',
        value: user.id,
      }]
    }
  ];
}
```

---

## pages/api/telegram/webhook.js — NEXT.JS WEBHOOK

```javascript
// pages/api/telegram/webhook.js
import { bot } from '../../../bots/telegram';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  } else {
    res.status(200).json({ status: 'Telegram webhook active' });
  }
}
```

---

## ESCALATION RULES ENGINE

```javascript
// intelligence/escalation.js

const ESCALATION_RULES = [
  {
    name: 'ticket_blocked_24h',
    check: async () => {
      const { issues } = await redmine.getTickets({ status_id: 'open' });
      return (issues || []).filter(t => {
        const hoursSinceUpdate = (Date.now() - new Date(t.updated_on)) / 3600000;
        return t.status.name === 'Blocked' && hoursSinceUpdate > 24;
      });
    },
    action: 'notify_pm',
    message: (ticket) => `🟡 TK blocked 24h+: *${ticket.subject}* — assigned to ${ticket.assigned_to?.name}`,
  },
  {
    name: 'ticket_blocked_48h_high',
    check: async () => {
      const { issues } = await redmine.getTickets({ status_id: 'open' });
      return (issues || []).filter(t => {
        const hoursSinceUpdate = (Date.now() - new Date(t.updated_on)) / 3600000;
        return t.status.name === 'Blocked' &&
               hoursSinceUpdate > 48 &&
               ['High','Urgent','Immediate'].includes(t.priority?.name);
      });
    },
    action: 'notify_pm_urgent',
    message: (ticket) => `🔴 HIGH priority blocked 48h+: *${ticket.subject}*\nAssigned: ${ticket.assigned_to?.name}\nDue: ${ticket.due_date || 'No date'}`,
  },
  {
    name: 'ticket_overdue_deadline',
    check: async () => {
      const { issues } = await redmine.getTickets({ status_id: 'open' });
      return (issues || []).filter(t =>
        t.due_date && new Date(t.due_date) < new Date()
      );
    },
    action: 'notify_ceo',
    message: (ticket) => `🚨 OVERDUE: *${ticket.subject}*\nDue: ${ticket.due_date} | Assigned: ${ticket.assigned_to?.name}`,
  },
  {
    name: 'low_team_capacity',
    check: async () => {
      const { data } = await supabase
        .from('capacity_status')
        .select('*, bot_users(name, team)')
        .lt('available_capacity_pct', 20);
      return data || [];
    },
    action: 'notify_ceo',
    message: (item) => `⚠️ ${item.bot_users?.name} at ${Math.round(100 - item.available_capacity_pct)}% capacity`,
  },
];

export async function runEscalationEngine() {
  for (const rule of ESCALATION_RULES) {
    try {
      const items = await rule.check();
      for (const item of items) {
        await executeEscalation(rule, item);
      }
    } catch (e) {
      console.error(`Escalation rule error [${rule.name}]:`, e);
    }
  }
}

async function executeEscalation(rule, item) {
  const message = rule.message(item);

  // Log it
  await supabase.from('escalation_log').insert({
    rule_triggered: rule.name,
    context: item,
    action_taken: rule.action,
    triggered_at: new Date().toISOString(),
  });

  // Execute the action
  if (rule.action.includes('ceo')) {
    const { data: ceo } = await supabase
      .from('bot_users').select('*').eq('role', 'ceo').single();
    if (ceo?.telegram_id) {
      await bot.telegram.sendMessage(ceo.telegram_id, message, { parse_mode: 'Markdown' });
    }
  } else if (rule.action.includes('pm')) {
    const { data: pms } = await supabase
      .from('bot_users').select('*').in('role', ['project_manager','delivery_manager']);
    for (const pm of pms) {
      if (pm.telegram_id) {
        await bot.telegram.sendMessage(pm.telegram_id, message, { parse_mode: 'Markdown' });
      }
    }
  }
}
```

---

## intelligence/reports.js — AUTO-GENERATED REPORTS

```javascript
// intelligence/reports.js
import { supabase } from '../lib/supabase';
import { redmine } from '../lib/redmine';
import { openai } from '../lib/openai';
import { bot } from '../bots/telegram';

export async function generateWeeklyReports() {
  const { data: pms } = await supabase
    .from('bot_users')
    .select('*')
    .in('role', ['project_manager', 'delivery_manager'])
    .not('telegram_id', 'is', null);

  for (const pm of pms) {
    const report = await buildWeeklyReport(pm);
    
    await bot.telegram.sendMessage(
      pm.telegram_id,
      `📊 *Weekly Report Ready*\n\n${report.summary}\n\n_Review and send?_`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Send to CEO', callback_data: `send_report_ceo_${pm.id}` },
            { text: '✏️ Edit first', callback_data: `edit_report_${pm.id}` },
            { text: '📅 Schedule Monday', callback_data: `schedule_report_${pm.id}` },
          ]]
        }
      }
    );
  }
}

async function buildWeeklyReport(pm) {
  const { issues } = await redmine.getTickets({ limit: 100 });
  const pmProjects = pm.allowed_projects || [];

  const projectTickets = (issues || []).filter(t =>
    pmProjects.includes(t.project?.name)
  );

  const completed = projectTickets.filter(t => t.status.name === 'Closed');
  const inProgress = projectTickets.filter(t => t.status.name === 'In Progress');
  const blocked = projectTickets.filter(t => t.status.name === 'Blocked');
  const overdue = projectTickets.filter(t =>
    t.due_date && new Date(t.due_date) < new Date() && t.status.name !== 'Closed'
  );

  const summary = `*Projects: ${pmProjects.join(', ')}*

✅ Completed: ${completed.length} tickets
🔄 In Progress: ${inProgress.length} tickets
🚫 Blocked: ${blocked.length} tickets
🔴 Overdue: ${overdue.length} tickets

${blocked.length > 0 ? `*Blockers:*\n${blocked.map(t => `• ${t.subject}`).join('\n')}` : ''}
${overdue.length > 0 ? `\n*Overdue:*\n${overdue.map(t => `• ${t.subject} (was due ${t.due_date})`).join('\n')}` : ''}`;

  return { summary, raw: { completed, inProgress, blocked, overdue } };
}
```

---

## ROLES — What Each Person Sees

### CEO (Telegram)
- Full company data — all teams, all projects, all people
- Cross-user intelligence — sees patterns across all conversations
- Company IQ score, org health, succession risks
- All escalations — the ultimate decision maker
- `/register` command to add new users
- `/answer [qa_id] [answer]` to answer CTO/PM questions

### Delivery Manager (Telegram)
- Their assigned projects only
- Their team's tickets, capacity, performance
- Blocker escalations for their projects
- Weekly status reports ready to send

### Project Manager (Telegram)
- Their 3 assigned projects
- Full PM 100x automation (morning brief, reports, decisions)
- Capacity alerts with ticket matching
- Sprint optimizer

### Team Lead (Telegram)
- Their team's tickets and time logs
- Daily standup results
- Team performance snapshot

### Developer (Slack only)
- ONLY their own tickets
- Tap to update ticket status
- Blocker reporting
- Sprint brief on Monday mornings
- NOTHING else — enforced at DB query level

---

## PM 100x — KEY AUTOMATIONS TO BUILD

```
1. Morning Brief (9:05 AM)
   → What changed overnight
   → 3 most important actions today
   → One-tap decisions

2. Status Report Generator (Friday 4 PM)
   → Auto-built from Redmine data
   → PM reviews in Telegram, one tap to send

3. Blocker Escalation (Real-time)
   → Developer taps "Blocked" on Slack
   → PM notified on Telegram in 10 seconds
   → Auto-message sent to blocking person

4. Availability Alerts (Every 2 hours)
   → Developer capacity drops below 65%
   → PM gets Telegram alert with top 3 ticket matches

5. Sprint Optimizer (Before planning meetings)
   → Bot generates optimal sprint allocation
   → Based on: capacity + skill match + velocity history
   → PM approves or modifies

6. Silence Detector (Every 6 hours)
   → Tickets with no update in 5+ days
   → PM alerted before they become overdue

7. Meeting Eliminator (Before any scheduled meeting)
   → Bot checks if info already available
   → Suggests async summary instead if yes
```

---

## Q&A SYSTEM — THE CRITICAL FLOW

```
RULE: Bot NEVER researches independently for project Q&A.
RULE: Bot NEVER guesses or makes up an answer.
RULE: Only CEO's answers enter the knowledge base.

FLOW:
1. CTO/DM asks about a conceptual project
2. Bot searches project_qa table (vector similarity, threshold 0.82)
3a. FOUND → Answer immediately from knowledge base
3b. NOT FOUND →
    - Save to project_qa as 'pending'
    - Notify CEO on Telegram immediately
    - Tell questioner: "Escalated to CEO. Will notify you when answered."
4. CEO uses /answer command
5. Answer saved + vectorized
6. Questioner notified on Telegram
7. Next person who asks → instant answer

CEO GETS NOTIFIED:
"❓ New Question — AI Recruitment Tool
From: CTO (name)
Question: "What is our monetization model?"
/answer qa_abc123 [type your answer here]"

CEO ANSWERS:
/answer qa_abc123 We go per-hire, not subscription. $500 per successful hire.

BOT:
"✅ Answer saved. CTO notified. This is now in the knowledge base."
```

---

## PERFORMANCE SCORING — 5 DIMENSIONS

```
OVERALL SCORE = weighted average:

Output Score       (25%) = tickets closed × complexity weight / target
Speed Score        (20%) = team avg resolution time / this person's avg × 100
Quality Score      (25%) = 100 - (reopen_rate × 40) - (downstream_blockers × 15)
Reliability Score  (20%) = deadline_hit_rate × 100
Collaboration Score(10%) = (blockers_resolved_for_others / avg_team) × 100

Score thresholds:
90-100 = Exceptional 🟢
75-89  = Good 🟢  
60-74  = Adequate 🟡
45-59  = Below average 🔴
0-44   = Critical ⚠️

Trends:
Rising   = current > last period by 3+ points
Declining = current < last period by 3+ points
Stable   = within ±3 points
```

---

## CAPACITY ALERT THRESHOLDS

```
Available capacity >= 40% → Trigger PM availability alert
Available capacity >= 60% → Flag as underutilized if 3+ days
Available capacity < 20%  → Flag as near overload to CEO
Available capacity < 10%  → Alert CEO: burnout risk

Blocker SLA timers:
24 hours → Notify PM
48 hours (high priority) → Notify PM + draft escalation
72 hours (deadline impact) → Notify CEO with business impact $
```

---

## DEPLOYMENT NOTES

### Vercel (Existing Project)
```bash
# Webhook setup for Telegram
# Set this URL in Telegram: https://api.telegram.org/bot{TOKEN}/setWebhook
# URL: https://your-app.vercel.app/api/telegram/webhook

# For Slack: Use Socket Mode (no public URL needed for development)
# For production: Set SLACK_EVENTS_URL in Slack app config
```

### Supabase
```bash
# Run migrations in order 1-10
# Enable pgvector extension first (Migration 1)
# Row Level Security: Enable on all tables
# Service role key only on server — never expose to client
```

### Upstash Redis
```bash
# Create at upstash.com
# Select "Global" type for lowest latency
# Free tier: 10,000 commands/day — enough for your team size
```

### Cron Jobs
```bash
# Register crons in your server startup file (e.g., server.js or _app.js)
# For Vercel: Use Vercel Cron Jobs (vercel.json)
# Or: Run a separate Node.js process on a VPS/Railway for crons
```

---

## WHAT TO BUILD FIRST (Phases)

```
PHASE 1 (Week 1-2): Foundation
□ Supabase schema migrations 1-7
□ Redmine client (read only enforced)
□ Telegram bot basic setup
□ Identity + role middleware  
□ Basic queries (tickets, leave, time logs)
□ CEO can query company data

PHASE 2 (Week 3-4): Slack + Bridge
□ Slack bot for developers
□ Async standup workflow
□ Blocker reporting → Telegram bridge
□ Ticket update cards
□ Performance schema (migrations 8-9)

PHASE 3 (Week 5-6): Memory
□ pgvector memory setup
□ Upstash Redis sessions
□ Personalized system prompts
□ Context-aware responses
□ Learning from conversations

PHASE 4 (Week 7-8): Q&A System
□ Project Explorations workspace
□ Q&A knowledge base
□ CEO escalation flow (/answer command)
□ Async notification loop
□ CEO KPI from engagement

PHASE 5 (Month 2): Performance + Capacity
□ Nightly scoring engine
□ Capacity tracker (every 2 hours)
□ Availability alerts with ticket matching
□ Weekly performance reports
□ Monthly impact summaries

PHASE 6 (Month 2): PM Automation
□ Morning brief (9:05 AM)
□ Silence detector (6-hour cron)
□ Status report generator
□ Meeting eliminator
□ Sprint optimizer

PHASE 7 (Month 3): Full Personalization
□ Behavioral fingerprinting
□ Communication style adaptation
□ Energy protection (peak hours)
□ Negotiation coach feature
□ 6 AM personal brief

PHASE 8 (Month 3-4): Deep Intelligence
□ Company DNA model
□ Scenario simulator
□ Business impact calculator ($)
□ Relationship mesh scoring
□ Org health index

PHASE 9 (Month 5-6): Self-Compiling
□ Succession intelligence
□ Living company playbook
□ Pre-mortem engine
□ Future state modeler
□ Self-correcting prediction model
```

---

## FINAL CHECKLIST BEFORE GOING LIVE

```
Security:
□ Redmine client only makes GET requests (middleware blocks writes)
□ Every Supabase query filtered by user_id or role
□ Developer bot queries return ONLY their own data
□ Telegram bot ignores messages from unregistered users
□ Slack bot ignores unregistered Slack users
□ No API keys in client-side code

Data:
□ All 10 migrations run in order
□ pgvector indexes created
□ match_memories SQL function deployed
□ match_project_qa SQL function deployed
□ Upstash Redis connected

Bots:
□ Telegram webhook URL set
□ Slack Socket Mode enabled (or events URL configured)
□ CEO registered in bot_users table
□ CEO's Telegram ID stored

Crons:
□ All cron jobs registered and running
□ Test each cron manually before scheduling
□ Escalation engine tested with dummy data

Testing:
□ CEO can query tickets on Telegram
□ CEO can create a project exploration
□ CTO asks question → CEO gets notified → CEO answers → CTO notified
□ Developer gets standup on Slack
□ Developer reports blocker → PM gets Telegram alert within 10 seconds
□ Capacity drops → PM gets alert with ticket matches
```

---

*Company OS Blueprint v1.0 — March 2026*  
*Stack: Next.js + Supabase + pgvector + Upstash Redis + Telegram + Slack + GPT-4o + Redmine (Read Only)*
