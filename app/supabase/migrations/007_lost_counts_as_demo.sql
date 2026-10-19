-- ============================================================================
-- Migration 007 — Leads lost after a demo count toward Demos
-- Run in the Supabase SQL Editor after 006. Safe to re-run.
-- ============================================================================
--
-- Leads lost after a demo ("Lost Lead" / "Lost" / "Lost / Contract Lead")
-- count toward Demos.
--
-- funnel.demoStatuses lists CRM statuses that count as demo-reached whatever
-- their stage, so these leads stay on the Lost stage but are counted in
-- Leads→Demos. Also maps the bare "Lost" status onto the Lost stage — it was
-- unmapped and fell back to the first stage (Lead).
--
-- Also repairs the stage flags: the stored funnel had `lost` set on the Demo
-- stage instead of the Lost stage, which would make auto-marking Lost move
-- leads to Demo. Exactly the stage named "Lost" is the lost stage.

update public.projects
set funnel = jsonb_set(
  jsonb_set(
    funnel,
    '{stages}',
    (select jsonb_agg(
       case
         when s->>'name' = 'Lost' then
           s || jsonb_build_object(
             'lost', true,
             'statuses', case when (s->'statuses') ? 'lost' then s->'statuses'
                              else jsonb_build_array('lost') || (s->'statuses') end)
         else
           s || jsonb_build_object('lost', false, 'statuses', (s->'statuses') - 'lost')
       end order by ord)
     from jsonb_array_elements(funnel->'stages') with ordinality as t(s, ord))
  ),
  '{demoStatuses}', '["lost lead","lost","lost / contract lead"]'::jsonb
)
where id = 'transcure';

-- Re-map existing leads whose status is the bare "Lost".
update public.leads
set stage = 'Lost'
where project_id = 'transcure' and lower(trim(status)) = 'lost';

-- Verify.
select s->>'name' as stage, s->'lost' as lost, s->'statuses' as statuses
from public.projects p, jsonb_array_elements(p.funnel->'stages') s where p.id = 'transcure';
select funnel->'demoStatuses' as demo_statuses from public.projects where id = 'transcure';
select status, stage, count(*) from public.leads
where project_id = 'transcure' and lower(trim(status)) in ('lost lead', 'lost', 'lost / contract lead')
group by 1, 2;
