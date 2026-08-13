-- ============================================================================
-- Migration 001 — Follow-up sequences
-- Run this ALONE in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- It only ADDS the two follow-up tables. It does not touch leads, import_batches,
-- or app_settings, so your existing data cannot be affected by running it.
-- Safe to re-run.
-- ============================================================================

-- One sequence per lead that has an active follow-up campaign.
create table if not exists public.follow_up_sequences (
  id               uuid primary key default gen_random_uuid(),
  lead_record_id   text not null references public.leads(record_id) on delete cascade,
  manager_email    text not null,
  started_at       timestamptz not null default now(),
  started_by       uuid references auth.users(id),
  status           text not null default 'active'
                     check (status in ('active', 'won', 'lost')),
  created_at       timestamptz not null default now()
);

create index if not exists fup_seq_lead_idx on public.follow_up_sequences (lead_record_id);

-- Five steps per sequence (one per week).
create table if not exists public.follow_up_steps (
  id              uuid primary key default gen_random_uuid(),
  sequence_id     uuid not null references public.follow_up_sequences(id) on delete cascade,
  step_number     int not null check (step_number between 1 and 5),
  scheduled_date  date not null,
  channels        text[] not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'done', 'skipped')),
  completed_at    timestamptz,
  notes           text,
  unique (sequence_id, step_number)
);

create index if not exists fup_step_seq_idx  on public.follow_up_steps (sequence_id);
create index if not exists fup_step_date_idx on public.follow_up_steps (scheduled_date);

-- RLS: internal team tool — every authenticated user gets full access.
alter table public.follow_up_sequences enable row level security;
alter table public.follow_up_steps     enable row level security;

drop policy if exists "auth full access" on public.follow_up_sequences;
create policy "auth full access" on public.follow_up_sequences
  for all to authenticated using (true) with check (true);

drop policy if exists "auth full access" on public.follow_up_steps;
create policy "auth full access" on public.follow_up_steps
  for all to authenticated using (true) with check (true);

-- Verify: both rows should come back.
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('follow_up_sequences', 'follow_up_steps');
