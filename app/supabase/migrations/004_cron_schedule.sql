-- ============================================================================
-- Migration 004 — Daily schedule for the reminder job
-- Run AFTER deploying the follow-up-reminders Edge Function.
--
-- Fill in the four placeholders below before running:
--   <PROJECT_REF>  your Supabase project ref (Settings -> General)
--   <CRON_SECRET>  the same value set as the CRON_SECRET function secret.
--                  Use letters and numbers only — punctuation breaks URLs.
--   <ANON_KEY>     your anon / publishable key (Settings -> API). Needed only
--                  so the gateway accepts the call; it is public and grants
--                  nothing by itself.
--   <UTC_HOUR>     digest hour converted to UTC (see note)
--
-- Timezone note: pg_cron schedules in UTC. Pakistan is UTC+5 year-round with no
-- DST, so subtract 5 from the local hour you want:
--   09:00 PK -> 4  |  08:00 PK -> 3  |  10:00 PK -> 5
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Re-running this file replaces the previous schedule rather than stacking.
select cron.unschedule('follow-up-reminders-daily')
where exists (select 1 from cron.job where jobname = 'follow-up-reminders-daily');

select cron.schedule(
  'follow-up-reminders-daily',
  '0 <UTC_HOUR> * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/follow-up-reminders',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 -- Satisfies the API gateway when the function has JWT
                 -- verification enabled. The anon key is public (it ships in the
                 -- browser bundle), so this grants nothing on its own — the
                 -- x-cron-secret below is what actually authorizes the call.
                 -- Leave as-is if you turned JWT verification off.
                 'Authorization', 'Bearer <ANON_KEY>',
                 'x-cron-secret', '<CRON_SECRET>'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Confirm it registered.
select jobid, jobname, schedule, active from cron.job where jobname = 'follow-up-reminders-daily';

-- Useful later:
--   Recent runs:  select * from cron.job_run_details
--                 where jobid = (select jobid from cron.job where jobname='follow-up-reminders-daily')
--                 order by start_time desc limit 20;
--   What was sent: select * from public.follow_up_reminders order by created_at desc limit 50;
--   Stop the job: select cron.unschedule('follow-up-reminders-daily');
