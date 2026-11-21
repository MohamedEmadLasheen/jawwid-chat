-- PD-59 lead reconciliation: READ-ONLY. Run with psql; it changes nothing and prints no contact value
-- (ids, counts, states and ages only). See docs/admin/pd059-stabilization.md.
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/db/reports/pd059-lead-reconciliation.sql
--
-- Part 1: where each lead stands against its trial and its hand-over (converted-but-unlinked leads).
-- Part 2: prospects with no owner, by who recorded them.
-- Part 3: leads a retention pass (a dry run, rolled back) would list.
-- (The lead-state query is repeated in each part: a read-only transaction cannot create a view.)
begin read only;



\echo '== PART 1: leads by state (a state 2-4 or 6 holds a lead contact copy until someone links it)'
with pd059_lead_state as (
select p.id as prospect_id, p.organization_id, p.created_at, p.owner_staff_id, p.created_by, p.learner_id,
       p.converted_at, p.converted_family_id, p.last_activity_at, p.pipeline_stage,
       coalesce(t.trials, 0)                  as trials,
       coalesce(t.subscribed, false)          as subscribed,
       coalesce(t.form_active, false)         as subscription_form,
       e.family_id                            as enrolled_family_id,
       (c.prospect_id is not null)            as has_lead_contact,
       case
         when p.converted_at is not null                                   then '5 linked (converted_at set)'
         when e.family_id is not null                                      then '4 enrolled, NOT linked (converted_at never set)'
         when coalesce(t.subscribed, false) and coalesce(t.form_active, false) then '3 subscribed, form recorded, awaiting Operations enrolment'
         when coalesce(t.subscribed, false)                                then '2 subscribed, no active form'
         when p.learner_id is not null                                     then '6 learner linked by Core, converted_at not set'
         else '1 not a customer'
       end as state
  from chat.trial_prospect p
  left join lateral (
    select count(*) as trials,
           bool_or(o.result = 'subscribed') as subscribed,
           bool_or(ts.lesson_id is not null and ts.withdrawn_at is null) filter (where o.result = 'subscribed') as form_active
      from chat.lesson l
      left join chat.trial_outcome o on o.lesson_id = l.id
      left join chat.trial_subscription ts on ts.lesson_id = l.id
     where l.prospect_id = p.id and l.kind = 'trial') t on true
  left join lateral (
    select se.family_id
      from chat.lesson l join chat.student_enrolment se on se.lesson_id = l.id
     where l.prospect_id = p.id limit 1) e on true
  left join chat.sales_lead_contact c on c.prospect_id = p.id
)
select state, count(*) as leads, count(*) filter (where has_lead_contact) as with_lead_contact_copy,
       min(created_at)::date as oldest, count(*) filter (where owner_staff_id is null) as unowned
  from pd059_lead_state group by state order by state;

\echo '== PART 1b: the actionable ones (enrolled but not linked, or subscribed and waiting), oldest first'
with pd059_lead_state as (
select p.id as prospect_id, p.organization_id, p.created_at, p.owner_staff_id, p.created_by, p.learner_id,
       p.converted_at, p.converted_family_id, p.last_activity_at, p.pipeline_stage,
       coalesce(t.trials, 0)                  as trials,
       coalesce(t.subscribed, false)          as subscribed,
       coalesce(t.form_active, false)         as subscription_form,
       e.family_id                            as enrolled_family_id,
       (c.prospect_id is not null)            as has_lead_contact,
       case
         when p.converted_at is not null                                   then '5 linked (converted_at set)'
         when e.family_id is not null                                      then '4 enrolled, NOT linked (converted_at never set)'
         when coalesce(t.subscribed, false) and coalesce(t.form_active, false) then '3 subscribed, form recorded, awaiting Operations enrolment'
         when coalesce(t.subscribed, false)                                then '2 subscribed, no active form'
         when p.learner_id is not null                                     then '6 learner linked by Core, converted_at not set'
         else '1 not a customer'
       end as state
  from chat.trial_prospect p
  left join lateral (
    select count(*) as trials,
           bool_or(o.result = 'subscribed') as subscribed,
           bool_or(ts.lesson_id is not null and ts.withdrawn_at is null) filter (where o.result = 'subscribed') as form_active
      from chat.lesson l
      left join chat.trial_outcome o on o.lesson_id = l.id
      left join chat.trial_subscription ts on ts.lesson_id = l.id
     where l.prospect_id = p.id and l.kind = 'trial') t on true
  left join lateral (
    select se.family_id
      from chat.lesson l join chat.student_enrolment se on se.lesson_id = l.id
     where l.prospect_id = p.id limit 1) e on true
  left join chat.sales_lead_contact c on c.prospect_id = p.id
)
select prospect_id, state, owner_staff_id, enrolled_family_id, has_lead_contact,
       (now() - created_at)::interval(0) as age
  from pd059_lead_state
 where state like '2 %' or state like '3 %' or state like '4 %' or state like '6 %'
 order by created_at, prospect_id;

\echo '== PART 2: prospects with no owner, by who recorded them'
with pd059_lead_state as (
select p.id as prospect_id, p.organization_id, p.created_at, p.owner_staff_id, p.created_by, p.learner_id,
       p.converted_at, p.converted_family_id, p.last_activity_at, p.pipeline_stage,
       coalesce(t.trials, 0)                  as trials,
       coalesce(t.subscribed, false)          as subscribed,
       coalesce(t.form_active, false)         as subscription_form,
       e.family_id                            as enrolled_family_id,
       (c.prospect_id is not null)            as has_lead_contact,
       case
         when p.converted_at is not null                                   then '5 linked (converted_at set)'
         when e.family_id is not null                                      then '4 enrolled, NOT linked (converted_at never set)'
         when coalesce(t.subscribed, false) and coalesce(t.form_active, false) then '3 subscribed, form recorded, awaiting Operations enrolment'
         when coalesce(t.subscribed, false)                                then '2 subscribed, no active form'
         when p.learner_id is not null                                     then '6 learner linked by Core, converted_at not set'
         else '1 not a customer'
       end as state
  from chat.trial_prospect p
  left join lateral (
    select count(*) as trials,
           bool_or(o.result = 'subscribed') as subscribed,
           bool_or(ts.lesson_id is not null and ts.withdrawn_at is null) filter (where o.result = 'subscribed') as form_active
      from chat.lesson l
      left join chat.trial_outcome o on o.lesson_id = l.id
      left join chat.trial_subscription ts on ts.lesson_id = l.id
     where l.prospect_id = p.id and l.kind = 'trial') t on true
  left join lateral (
    select se.family_id
      from chat.lesson l join chat.student_enrolment se on se.lesson_id = l.id
     where l.prospect_id = p.id limit 1) e on true
  left join chat.sales_lead_contact c on c.prospect_id = p.id
)
select case
         when s.role = 'super_admin'                                  then 'super admin'
         when s.left_at is not null or not s.is_active                then 'departed staff'
         when chat.sales_department_role(s.id) is not null            then 'Sales (should be owned: investigate)'
         when exists (select 1 from chat.department_member m join chat.department d on d.id = m.department_id
                       where m.staff_id = s.id and d.kind = 'operations')
              or chat.is_operations_manager(s.id, s.organization_id)  then 'Operations'
         when exists (select 1 from chat.department_member m join chat.department d on d.id = m.department_id
                       where m.staff_id = s.id and d.kind = 'teachers')
              or exists (select 1 from chat.department d where d.kind = 'teachers' and d.manager_id = s.id) then 'Teachers department'
         else 'other staff'
       end as recorded_by,
       count(*) as prospects,
       count(*) filter (where ls.trials > 0) as with_trial,
       count(*) filter (where ls.subscribed) as subscribed,
       count(*) filter (where ls.state not like '1 %') as customers_or_nearly,
       count(*) filter (where ls.has_lead_contact) as with_lead_contact,
       min(ls.created_at)::date as oldest
  from pd059_lead_state ls join chat.staff s on s.id = ls.created_by
 where ls.owner_staff_id is null
 group by 1 order by 2 desc;

\echo '== PART 3: what a retention pass would list right now (a dry run; nothing is changed)'
select count(*) as would_be_listed from chat.expired_sales_leads(1000000);

rollback;
