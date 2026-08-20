-- ============================================================================
-- Migration 006 — Multiple projects (workspaces)
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Adds a second business (Macralytics) alongside Transcure, each with its own
-- leads, funnel stages, high-ticket rule, charge %, reminder settings and logo.
--
-- Deliberately does NOT change the primary key of `leads`. record_id stays the
-- PK, so the existing upserts, the .eq('record_id', …) lookups and the
-- follow_up_sequences foreign key all keep working untouched — no risk to the
-- 410 rows already in there. Cross-project id collisions are prevented instead
-- by namespacing record_ids on import for any project with a prefix set
-- (Transcure keeps bare ids, so its existing rows are unaffected).
-- ============================================================================

create table if not exists public.projects (
  id                       text primary key,          -- 'transcure', 'macralytics'
  name                     text not null,
  sort_order               integer not null default 100,
  -- Prefix applied to imported record_ids to keep them unique across projects.
  -- NULL for the original project, whose ids predate this and must not change.
  record_id_prefix         text,
  logo_data_url            text,
  high_ticket_rule         jsonb  not null default '{"op":"gte","value":50000}'::jsonb,
  default_charge_pct       numeric not null default 5,
  follow_up_manager_email  text,
  follow_up_automation     jsonb  not null default '{"enabled":true,"digestHour":9,"timezone":"Asia/Karachi","graceDays":7,"remindOverdueDaily":true}'::jsonb,
  -- Ordered funnel stages plus the CRM statuses that map to each. See the seed
  -- below for the shape. `reachedDemo` marks stages that count toward the
  -- Leads->Demos ratio; `won` / `lost` mark the terminal stages.
  funnel                   jsonb  not null,
  -- Which stage enrols a lead in the 5-week follow-up sequence. NULL disables
  -- follow-ups for the project entirely.
  follow_up_stage          text,
  created_at               timestamptz not null default now()
);

alter table public.projects enable row level security;
drop policy if exists "auth full access" on public.projects;
create policy "auth full access" on public.projects
  for all to authenticated using (true) with check (true);

-- Let the login page read logos before sign-in, matching the existing behaviour
-- for the single-project logo.
drop policy if exists "public read projects" on public.projects;
create policy "public read projects" on public.projects
  for select to anon using (true);

-- ---------------------------------------------------------------------------
-- Seed. Transcure's funnel is the mapping that is currently hardcoded in
-- app/src/lib/funnel.ts, moved into data unchanged so behaviour is identical.
-- ---------------------------------------------------------------------------
insert into public.projects (id, name, sort_order, record_id_prefix, follow_up_stage, funnel)
values (
  'transcure', 'Transcure', 10, null, 'Negotiation',
  '{"stages":[
     {"name":"Lead",        "color":"#94a3b8","reachedDemo":false,"won":false,"lost":false,"statuses":[]},
     {"name":"Engaged",     "color":"#3b82f6","reachedDemo":false,"won":false,"lost":false,"statuses":["contacted","attempted to contact","follow up","contact in future"]},
     {"name":"Demo",        "color":"#6366f1","reachedDemo":true, "won":false,"lost":false,"statuses":["demo scheduled","demo completed","demo done"]},
     {"name":"Audit",       "color":"#16a34a","reachedDemo":true, "won":false,"lost":false,"statuses":["under audit"]},
     {"name":"Negotiation", "color":"#0891b2","reachedDemo":true, "won":false,"lost":false,"statuses":["agreement sent","contract sent"]},
     {"name":"Won",         "color":"#15803d","reachedDemo":true, "won":true, "lost":false,"statuses":["won lead","won"]},
     {"name":"Lost",        "color":"#dc2626","reachedDemo":false,"won":false,"lost":true, "statuses":["lost lead","lost / contract lead","not-qualified","not qualified","junk lead"]}
   ]}'::jsonb
)
on conflict (id) do nothing;

-- Macralytics starts from a generic analytics-SaaS pipeline. These stages are a
-- starting point only — edit them under Admin once the real pipeline is known.
insert into public.projects (id, name, sort_order, record_id_prefix, follow_up_stage, funnel)
values (
  'macralytics', 'Macralytics', 20, 'mac', 'Proposal',
  '{"stages":[
     {"name":"Lead",      "color":"#94a3b8","reachedDemo":false,"won":false,"lost":false,"statuses":[]},
     {"name":"Contacted", "color":"#3b82f6","reachedDemo":false,"won":false,"lost":false,"statuses":["contacted","attempted to contact","follow up"]},
     {"name":"Demo",      "color":"#6366f1","reachedDemo":true, "won":false,"lost":false,"statuses":["demo scheduled","demo completed"]},
     {"name":"Trial",     "color":"#a855f7","reachedDemo":true, "won":false,"lost":false,"statuses":["trial","in trial","pilot"]},
     {"name":"Proposal",  "color":"#0891b2","reachedDemo":true, "won":false,"lost":false,"statuses":["proposal sent","quote sent","agreement sent"]},
     {"name":"Won",       "color":"#15803d","reachedDemo":true, "won":true, "lost":false,"statuses":["won","won lead","closed won"]},
     {"name":"Lost",      "color":"#dc2626","reachedDemo":false,"won":false,"lost":true, "statuses":["lost","lost lead","closed lost","not qualified","not-qualified","junk lead"]}
   ]}'::jsonb
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Carry the existing single-project settings over to Transcure, so nothing
-- currently configured is lost.
-- ---------------------------------------------------------------------------
update public.projects p set
  high_ticket_rule = coalesce(
    (select value from public.app_settings where key = 'high_ticket_rule'), p.high_ticket_rule),
  logo_data_url = coalesce(
    (select value #>> '{}' from public.app_settings where key = 'logo_data_url'), p.logo_data_url),
  follow_up_manager_email = coalesce(
    nullif((select value #>> '{}' from public.app_settings where key = 'follow_up_manager_email'), ''),
    p.follow_up_manager_email),
  follow_up_automation = coalesce(
    (select value from public.app_settings where key = 'follow_up_automation'), p.follow_up_automation)
where p.id = 'transcure';

-- ---------------------------------------------------------------------------
-- Tag every existing row as Transcure. The default keeps older code paths and
-- any in-flight inserts working while the app is being deployed.
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists project_id text not null default 'transcure'
    references public.projects (id) on update cascade;

create index if not exists leads_project_idx on public.leads (project_id);
create index if not exists leads_project_stage_idx on public.leads (project_id, stage);

-- import_batches records which project an upload belonged to.
alter table public.import_batches
  add column if not exists project_id text not null default 'transcure'
    references public.projects (id) on update cascade;

-- Follow-up sequences inherit their project from the lead, but denormalising it
-- lets the reminder job group and scope by project in one read.
alter table public.follow_up_sequences
  add column if not exists project_id text not null default 'transcure'
    references public.projects (id) on update cascade;

create index if not exists fup_seq_project_idx on public.follow_up_sequences (project_id);

-- Reminder log, so per-project sends are distinguishable.
alter table public.follow_up_reminders
  add column if not exists project_id text;

-- Verify.
select id, name, follow_up_stage, jsonb_array_length(funnel->'stages') as stages from public.projects order by sort_order;
select project_id, count(*) as leads from public.leads group by project_id;
