-- ============================================================================
-- Migration 005 — Cron secret in Vault, verified inside the database
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Replaces the previous arrangement, where the same secret had to be set as an
-- Edge Function secret AND pasted into the cron schedule, kept in sync by hand.
-- It now lives once in Vault. Because the vault schema is not exposed through
-- PostgREST, the Edge Function cannot read it directly — so the comparison
-- happens here instead: a candidate goes in, a boolean comes out, and the secret
-- itself never leaves Postgres.
-- ============================================================================

-- 1. Create the secret if absent. Generated in-database; never printed.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'cron_secret');
  end if;
end $$;

-- 2. Compare a candidate against it, without disclosing it.
create or replace function public.verify_cron_secret(candidate text)
returns boolean
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  expected text;
begin
  if candidate is null or length(candidate) = 0 then
    return false;
  end if;
  select decrypted_secret into expected
  from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if expected is null then
    return false;
  end if;
  -- Length check first, then compare digests rather than the raw strings.
  return length(candidate) = length(expected)
     and encode(extensions.digest(candidate, 'sha256'), 'hex')
       = encode(extensions.digest(expected,  'sha256'), 'hex');
end $$;

-- 3. Only the service role may call it — the browser must never reach this.
revoke all on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

-- Verify: false then true.
select public.verify_cron_secret('definitely-not-it') as wrong_is_false,
       public.verify_cron_secret(
         (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
       ) as right_is_true;
