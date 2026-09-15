-- Run this once in Supabase → SQL Editor (same project you already use
-- for Cloud Sync in the app — the one whose URL/anon key you entered via
-- the "Cloud sync" button).

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  sync_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  last_daily_reminder_date text,
  last_trip_notif_key text,
  last_low_office_month text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_sync_id_idx on push_subscriptions (sync_id);

-- Added for the Sunday weekly catch-up notification — dedupes per week
-- (stores that week's Monday date, e.g. '2026-09-14'). Safe to re-run this
-- whole file on an existing table: the column is only added if missing.
alter table push_subscriptions add column if not exists last_weekly_catchup_key text;

-- Added for shared to-do lists + their daily reminder dedupe.
alter table push_subscriptions add column if not exists last_todo_reminder_date text;

-- Locked down: no policies are added, so the anon/browser key gets zero
-- access to this table. Only the Vercel serverless functions can read or
-- write it, using the Supabase *service role* key (which always bypasses
-- RLS) kept in Vercel's environment variables — never in the browser.
alter table push_subscriptions enable row level security;

-- ---------- Shared to-do lists ----------
-- A to-do list "belongs" to whoever created it (owner_sync_id = their
-- existing Cloud Sync code). Sharing it is just handing that code to someone
-- else, who "joins" it — see shared_todo_subscribers below. Both the owner
-- and every subscriber can read/add/check off items.
create table if not exists shared_todos (
  id uuid primary key default gen_random_uuid(),
  owner_sync_id text not null,
  text text not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_todos_owner_idx on shared_todos (owner_sync_id);
alter table shared_todos enable row level security;

-- Who has joined whose list — the cron uses this to know who else to notify
-- about an owner's open to-dos, and it's what "remind [friend]" targets.
create table if not exists shared_todo_subscribers (
  id uuid primary key default gen_random_uuid(),
  owner_sync_id text not null,
  subscriber_sync_id text not null,
  created_at timestamptz not null default now(),
  unique (owner_sync_id, subscriber_sync_id)
);
create index if not exists shared_todo_subscribers_owner_idx on shared_todo_subscribers (owner_sync_id);
alter table shared_todo_subscribers enable row level security;
