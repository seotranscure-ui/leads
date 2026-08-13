-- ============================================================================
-- Transcure SEO Lead Tracker — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: uses "if not exists" / "or replace".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- leads: one row per Zoho CRM lead, keyed by Record Id.
--   * CRM-owned columns are refreshed on every import (upsert).
--   * manual_* columns are entered in-app and are NEVER touched by an import.
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  record_id            text primary key,
  -- CRM-owned (overwritten by import)
  lead_owner           text,
  company              text,
  first_name           text,
  last_name            text,
  lead_name            text,
  email                text,
  phone                text,
  source               text,
  status               text,
  stage                text,
  tag                  text,
  specialty            text,
  practice             text,
  physicians           text,            -- de-mangled range, e.g. "2-5"
  monthly_collections  numeric,         -- Zoho "Monthly Collections" = ticket size
  first_page           text,
  referrer             text,
  message              text,
  comments             text,            -- CRM Comments, HTML stripped
  phase                text,
  created_utc          timestamptz,     -- Created Time, parsed from US-Central to UTC
  modified_utc         timestamptz,
  raw                  jsonb,           -- full original row, for safety
  crm_updated_at       timestamptz default now(),
  -- Manual enrichment (preserved across imports)
  manual_ticket        numeric,         -- override of monthly_collections
  manual_high          boolean,         -- null = auto by threshold; true/false = override
  manual_notes         text,            -- override of CRM comments
  -- source tracking (the old Source Tracking sheet — not in the CRM export)
  manual_source_medium text,
  manual_first_landing text,
  manual_second_page   text,
  manual_submit_page   text,
  manual_search_query  text,
  manual_recording     text,
  manual_charge_pct    numeric,         -- % of collections we charge this lead (default 5)
  manual_revenue_month text,            -- 'YYYY-MM' to recognize revenue in a chosen month (default: created month)
  manual_updated_by    uuid references auth.users (id),
  manual_updated_at    timestamptz
);

-- Patch existing tables (safe if the table already existed before these columns).
alter table public.leads add column if not exists manual_source_medium text;
alter table public.leads add column if not exists manual_first_landing text;
alter table public.leads add column if not exists manual_second_page   text;
alter table public.leads add column if not exists manual_submit_page   text;
alter table public.leads add column if not exists manual_search_query  text;
alter table public.leads add column if not exists manual_recording     text;
alter table public.leads add column if not exists manual_charge_pct    numeric;
alter table public.leads add column if not exists manual_revenue_month text;

create index if not exists leads_created_idx  on public.leads (created_utc);
create index if not exists leads_stage_idx    on public.leads (stage);
create index if not exists leads_source_idx   on public.leads (source);

-- ---------------------------------------------------------------------------
-- import_batches: audit log of each CSV upload.
-- ---------------------------------------------------------------------------
create table if not exists public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  file_name      text,
  uploaded_by    uuid references auth.users (id),
  uploaded_at    timestamptz default now(),
  rows_total     integer,
  rows_inserted  integer,
  rows_updated   integer,
  rows           jsonb            -- full CRM payload of this import, for re-apply / rollback
);

-- Patch existing table.
alter table public.import_batches add column if not exists rows jsonb;

-- ---------------------------------------------------------------------------
-- app_settings: shared, editable config (e.g. high-ticket threshold).
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz default now()
);

insert into public.app_settings (key, value)
values ('high_ticket_rule', '{"op":"gte","value":50000}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security: this is an internal team tool, so every authenticated
-- user gets full read/write. Public (anon) users get nothing.
-- ---------------------------------------------------------------------------
alter table public.leads          enable row level security;
alter table public.import_batches enable row level security;
alter table public.app_settings   enable row level security;

drop policy if exists "auth full access" on public.leads;
create policy "auth full access" on public.leads
  for all to authenticated using (true) with check (true);

drop policy if exists "auth full access" on public.import_batches;
create policy "auth full access" on public.import_batches
  for all to authenticated using (true) with check (true);

drop policy if exists "auth read settings" on public.app_settings;
create policy "auth read settings" on public.app_settings
  for select to authenticated using (true);

drop policy if exists "auth write settings" on public.app_settings;
create policy "auth write settings" on public.app_settings
  for all to authenticated using (true) with check (true);

-- Allow the (pre-login) public to read ONLY the logo row, so the login page can show it.
drop policy if exists "public read logo" on public.app_settings;
create policy "public read logo" on public.app_settings
  for select to anon using (key = 'logo_data_url');

-- ---------------------------------------------------------------------------
-- follow_up_sequences: one per lead that has an active follow-up campaign.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- follow_up_steps: 5 steps per sequence (one per week).
-- ---------------------------------------------------------------------------
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

-- RLS: authenticated users have full access.
alter table public.follow_up_sequences enable row level security;
alter table public.follow_up_steps     enable row level security;

drop policy if exists "auth full access" on public.follow_up_sequences;
create policy "auth full access" on public.follow_up_sequences
  for all to authenticated using (true) with check (true);

drop policy if exists "auth full access" on public.follow_up_steps;
create policy "auth full access" on public.follow_up_steps
  for all to authenticated using (true) with check (true);
