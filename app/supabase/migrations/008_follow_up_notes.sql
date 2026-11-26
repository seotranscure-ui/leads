-- ============================================================================
-- Migration 008 — A notes field on each follow-up sequence
-- Run in the Supabase SQL Editor after 007. Safe to re-run.
-- ============================================================================
--
-- follow_up_steps already has a `notes` column, but it belongs to one week:
-- it is written when a week is marked all-done. There was nowhere to put a
-- note about the lead's follow-up as a whole — "decision maker is away until
-- the 14th", "asked us to stop calling, email only" — which is the note a
-- manager actually wants to see without expanding the row.
--
-- Nullable with no default, so existing sequences are unaffected.

alter table public.follow_up_sequences
  add column if not exists notes text;

-- Verify.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'follow_up_sequences'
  and column_name = 'notes';
