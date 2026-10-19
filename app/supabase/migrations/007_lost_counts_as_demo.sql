-- ============================================================================
-- Migration 007 — Leads lost after a demo count toward Demos
-- Run in the Supabase SQL Editor after 006. Safe to re-run.
-- ============================================================================
--
-- Leads lost after a demo ("Lost" / "Lost / Contract Lead") count toward Demos.
--
-- funnel.demoStatuses lists CRM statuses that count as demo-reached whatever
-- their stage, so these leads stay on the Lost stage but are counted in
-- Leads→Demos. Also maps the bare "Lost" status onto the Lost stage — it was
-- unmapped and fell back to the first stage (Lead).

update public.projects
set funnel = jsonb_set(
  jsonb_set(
    funnel,
    '{stages}',
    (select jsonb_agg(
       case
         when (s->>'lost')::boolean and not (s->'statuses') ? 'lost'
           then jsonb_set(s, '{statuses}', jsonb_build_array('lost') || (s->'statuses'))
         else s
       end order by ord)
     from jsonb_array_elements(funnel->'stages') with ordinality as t(s, ord))
  ),
  '{demoStatuses}', '["lost","lost / contract lead"]'::jsonb
)
where id = 'transcure';

-- Re-map existing leads whose status is the bare "Lost".
update public.leads
set stage = (select s->>'name'
             from public.projects p, jsonb_array_elements(p.funnel->'stages') s
             where p.id = 'transcure' and (s->>'lost')::boolean limit 1)
where project_id = 'transcure' and lower(trim(status)) = 'lost';

-- Verify.
select funnel->'demoStatuses' as demo_statuses from public.projects where id = 'transcure';
select status, stage, count(*) from public.leads
where project_id = 'transcure' and lower(trim(status)) in ('lost', 'lost / contract lead')
group by 1, 2;
