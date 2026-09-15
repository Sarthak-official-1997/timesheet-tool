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

-- Locked down: no policies are added, so the anon/browser key gets zero
-- access to this table. Only the Vercel serverless functions can read or
-- write it, using the Supabase *service role* key (which always bypasses
-- RLS) kept in Vercel's environment variables — never in the browser.
alter table push_subscriptions enable row level security;
