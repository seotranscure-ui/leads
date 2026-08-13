-- ============================================================================
-- Migration 003 — Per-channel completion + automatic daily reminders
-- Run in the Supabase SQL Editor after 002. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Per-channel completion. A week is only finished once EVERY channel for it
-- (Email, SMS, Call, LinkedIn) has been ticked off, so the daily reminder can
-- keep naming exactly what is still outstanding.
-- ---------------------------------------------------------------------------
alter table public.follow_up_steps
  add column if not exists completed_channels text[] not null default '{}';

-- Backfill: any step already marked done counts as all of its channels done.
update public.follow_up_steps
set completed_channels = channels
where status = 'done' and completed_channels = '{}';

-- ---------------------------------------------------------------------------
-- Resolution tracking. completed_at is stamped when the 5th step finishes; the
-- grace period for auto-marking Lost is counted from it. prompt_sent_at stops
-- the "did they reply?" email from going out more than once.
-- ---------------------------------------------------------------------------
alter table public.follow_up_sequences
  add column if not exists completed_at    timestamptz,
  add column if not exists prompt_sent_at  timestamptz,
  add column if not exists resolved_at     timestamptz,
  add column if not exists resolved_auto   boolean not null default false;

-- ---------------------------------------------------------------------------
-- Send log. Doubles as the idempotency guard: the cron job may fire more than
-- once, and the unique index means a recipient gets at most one digest per day.
-- ---------------------------------------------------------------------------
create table if not exists public.follow_up_reminders (
  id           uuid primary key default gen_random_uuid(),
  sent_on      date not null,
  recipient    text not null,
  kind         text not null default 'digest'
                 check (kind in ('digest', 'resolution_prompt', 'auto_lost', 'test')),
  subject      text,
  step_count   integer not null default 0,
  status       text not null default 'sent'
                 check (status in ('sent', 'failed')),
  error        text,
  created_at   timestamptz not null default now()
);

create unique index if not exists fup_reminder_once_per_day
  on public.follow_up_reminders (sent_on, recipient, kind)
  where status = 'sent' and kind = 'digest';

create index if not exists fup_reminder_sent_idx on public.follow_up_reminders (sent_on desc);

alter table public.follow_up_reminders enable row level security;

drop policy if exists "auth read reminders" on public.follow_up_reminders;
create policy "auth read reminders" on public.follow_up_reminders
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Automation settings. SMTP credentials are deliberately NOT stored here —
-- app_settings is readable by every authenticated user, so the password lives
-- in Edge Function secrets instead.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value)
values ('follow_up_automation',
        '{"enabled":true,"digestHour":9,"timezone":"Asia/Karachi","graceDays":7,"remindOverdueDaily":true}'::jsonb)
on conflict (key) do nothing;

-- Verify.
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='follow_up_steps'
      and column_name='completed_channels')                        as has_completed_channels,
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='follow_up_reminders') as has_reminder_log;
