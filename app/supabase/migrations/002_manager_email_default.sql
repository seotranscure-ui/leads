-- ============================================================================
-- Migration 002 — Lead-manager email default
-- Run this in the Supabase SQL Editor after 001_follow_ups.sql.
-- Safe to re-run. Does not touch leads, import_batches, or existing sequences.
-- ============================================================================

-- manager_email becomes optional. NULL means "use the account-wide default"
-- stored in app_settings under 'follow_up_manager_email'. A non-null value is a
-- per-lead override. This lets changing the Admin default propagate to every
-- sequence that has not been explicitly overridden.
alter table public.follow_up_sequences alter column manager_email drop not null;

-- Seed the account-wide default (empty until set in Admin).
insert into public.app_settings (key, value)
values ('follow_up_manager_email', '""'::jsonb)
on conflict (key) do nothing;

-- One sequence per lead. Sequences are now auto-created when a lead reaches
-- Negotiation, so without this two users loading the app at the same moment
-- could each insert one. De-duplicate any existing rows first (keep the oldest),
-- then enforce it.
delete from public.follow_up_sequences a
using public.follow_up_sequences b
where a.lead_record_id = b.lead_record_id
  and (a.created_at > b.created_at or (a.created_at = b.created_at and a.id > b.id));

alter table public.follow_up_sequences
  drop constraint if exists follow_up_sequences_lead_unique;
alter table public.follow_up_sequences
  add constraint follow_up_sequences_lead_unique unique (lead_record_id);

-- Verify.
select column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'follow_up_sequences'
  and column_name = 'manager_email';
