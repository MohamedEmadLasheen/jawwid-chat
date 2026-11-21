-- PD-59 lead reconciliation: READ-ONLY. Run with psql; it changes nothing and prints no contact value
-- (ids, counts, states, role labels and ages only). See docs/admin/pd059-stabilization.md.
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/db/reports/pd059-lead-reconciliation.sql
--   psql -v ON_ERROR_STOP=1 -v id_limit=500 "$DATABASE_URL" -f ...      (id lists are capped, default 200 per list)
--
-- Part 1:  where each lead stands against its trial and its hand-over (converted-but-unlinked leads).
-- Part 2:  prospects with no owner, by who recorded them.
-- Part 3:  leads a retention pass (a dry run, rolled back) would list.
-- Part 4:  UNASSIGNED PROSPECTS: total; by creator role and department; those ELIGIBLE for automatic ownership
--          assignment versus those REQUIRING MANUAL reassignment, with the reason bucket. Nothing is assigned.
-- Part 5:  CONVERTED-BUT-NOT-LINKED: leads enrolled by Operations (or another workflow) with no Sales Convert,
--          by the numbered states 3, 6 and 7 of the stabilization document, with counts and ids.
--
-- The lead-state query is held once in the psql variable :base (a read-only transaction cannot create a view) and
-- placed in front of each query.
\if :{?id_limit}
\else
  \set id_limit 200
\endif

begin read only;

select $q$
with pd059_lead_state as (
select p.id as prospect_id, p.organization_id, p.created_at, p.owner_staff_id, p.created_by, p.learner_id,
       p.converted_at, p.converted_family_id, p.last_activity_at, p.pipeline_stage,
       coalesce(t.trials, 0)                  as trials,
       coalesce(t.subscribed, false)          as subscribed,
       coalesce(t.form_active, false)         as subscription_form,
       e.family_id                            as enrolled_family_id,
       e.kind                                 as enrolment_kind,
       e.assigned_by                          as enrolled_by,
       (c.prospect_id is not null)            as has_lead_contact,
       greatest(coalesce(p.last_activity_at, p.created_at), lz.last_created, lz.last_ends) as idle_since,
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
    select se.family_id, se.kind, se.assigned_by
      from chat.lesson l join chat.student_enrolment se on se.lesson_id = l.id
     where l.prospect_id = p.id order by se.assigned_at, se.id limit 1) e on true
  left join lateral (
    select max(l.created_at) as last_created, max(l.ends_at) as last_ends from chat.lesson l where l.prospect_id = p.id) lz on true
  left join chat.sales_lead_contact c on c.prospect_id = p.id
),
-- A prospect nobody owns, with who recorded it. The label rules are those of Part 2.
pd059_unowned as (
select ls.*, s.role as creator_role,
       (s.organization_id = ls.organization_id and s.is_active and s.left_at is null and s.role <> 'super_admin'
        and chat.sales_department_role(s.id) is not null)                  as auto_eligible,
       coalesce((select string_agg(distinct d.kind, '+' order by d.kind)
                   from chat.department d
                  where d.manager_id = s.id
                     or exists (select 1 from chat.department_member m where m.department_id = d.id and m.staff_id = s.id)), 'none') as creator_departments,
       case when s.left_at is not null or not s.is_active then 'departed' else 'live' end as creator_status,
       case
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
       (ls.state not like '1 %')                                          as is_customer,
       (ls.idle_since < now() - interval '12 months')                     as idle_over_12m
  from pd059_lead_state ls join chat.staff s on s.id = ls.created_by
 where ls.owner_staff_id is null
)
$q$ as base \gset

\echo '== PART 1: leads by state (a state 2-4 or 6 holds a lead contact copy until someone links it)'
:base
select state, count(*) as leads, count(*) filter (where has_lead_contact) as with_lead_contact_copy,
       min(created_at)::date as oldest, count(*) filter (where owner_staff_id is null) as unowned
  from pd059_lead_state group by state order by state;

\echo '== PART 1b: the actionable ones (enrolled but not linked, or subscribed and waiting), oldest first'
:base
select prospect_id, state, owner_staff_id, enrolled_family_id, has_lead_contact,
       (now() - created_at)::interval(0) as age
  from pd059_lead_state
 where state like '2 %' or state like '3 %' or state like '4 %' or state like '6 %'
 order by created_at, prospect_id;

\echo '== PART 2: prospects with no owner, by who recorded them'
:base
select recorded_by,
       count(*) as prospects,
       count(*) filter (where trials > 0) as with_trial,
       count(*) filter (where subscribed) as subscribed,
       count(*) filter (where state not like '1 %') as customers_or_nearly,
       count(*) filter (where has_lead_contact) as with_lead_contact,
       min(created_at)::date as oldest
  from pd059_unowned
 group by 1 order by 2 desc;

\echo '== PART 3: what a retention pass would list right now (a dry run; nothing is changed)'
select count(*) as would_be_listed from chat.expired_sales_leads(1000000);

\echo
\echo '== PART 4: UNASSIGNED PROSPECTS (owner_staff_id is null). Nothing below is applied; no bulk reassignment exists.'
\echo '-- 4a. total, per organization'
:base
select u.organization_id, count(*) as unassigned,
       (select count(*) from chat.trial_prospect p where p.organization_id = u.organization_id) as all_prospects
  from pd059_unowned u group by 1 order by 1;
:base
select count(*) as total_unassigned,
       (select count(*) from chat.trial_prospect) as all_prospects
  from pd059_unowned;

\echo '-- 4b. by the creator''s role and department (the original creator of the prospect), live or departed'
:base
select creator_role, creator_departments, creator_status,
       count(*) as prospects,
       count(*) filter (where not is_customer) as open_leads,
       count(*) filter (where is_customer) as customers,
       count(*) filter (where idle_over_12m) as idle_over_12m
  from pd059_unowned
 group by 1, 2, 3 order by 4 desc, 1, 2, 3;

\echo '-- 4c. ELIGIBLE for automatic ownership assignment: creator is live Sales staff (member or manager, not the super admin) of the prospect''s organization,'
\echo '--     i.e. exactly the migration backfill''s rule, and the prospect is an open lead (not a customer). If this prints 0 rows, there are none.'
:base
select prospect_id, organization_id, state, creator_role, (now() - created_at)::interval(0) as age, idle_over_12m
  from pd059_unowned
 where auto_eligible and not is_customer
 order by created_at, prospect_id
 limit :id_limit;
:base
select count(*) filter (where auto_eligible and not is_customer) as eligible_open_leads,
       count(*) filter (where auto_eligible and not is_customer and idle_over_12m) as of_which_idle_over_12m,
       count(*) filter (where auto_eligible and is_customer) as eligible_but_customer_leave_unowned
  from pd059_unowned;

\echo '-- 4d. REQUIRING MANUAL reassignment, by reason bucket (one bucket per prospect, first rule wins:'
\echo '--     customer, then who recorded it; "older than 12 months" is a column and is also summed in 4e)'
:base
select case when is_customer then 'customer: ownership not needed, the service refuses to reassign a Converted lead'
            when recorded_by = 'Operations'          then 'created by Operations'
            when recorded_by = 'Teachers department' then 'created by the Teachers department'
            when recorded_by = 'super admin'         then 'created by the super admin'
            when recorded_by = 'departed staff'      then 'created by departed staff'
            else 'created by other staff (no Sales role, no department)' end as reason_bucket,
       count(*) as prospects,
       count(*) filter (where idle_over_12m) as idle_over_12m,
       count(*) filter (where has_lead_contact) as with_lead_contact_copy
  from pd059_unowned
 where not (auto_eligible and not is_customer)
 group by 1 order by 2 desc;

\echo '-- 4e. cross-check and the cross-cutting bucket'
:base
select count(*) filter (where auto_eligible and not is_customer) as eligible,
       count(*) filter (where not (auto_eligible and not is_customer)) as manual,
       count(*) as total_unassigned,
       (count(*) filter (where auto_eligible and not is_customer)
        + count(*) filter (where not (auto_eligible and not is_customer)) = count(*)) as adds_up,
       count(*) filter (where not is_customer and idle_over_12m) as open_and_older_than_12_months
  from pd059_unowned;

\echo '-- 4f. the manual ones, ids only (capped by id_limit): open leads first, oldest first'
:base
select prospect_id, organization_id,
       case when is_customer then 'customer'
            when recorded_by = 'Operations' then 'Operations'
            when recorded_by = 'Teachers department' then 'Teachers dept'
            when recorded_by = 'super admin' then 'super admin'
            when recorded_by = 'departed staff' then 'departed staff'
            else 'other staff' end as reason, state, idle_over_12m, (now() - created_at)::interval(0) as age
  from pd059_unowned
 where not (auto_eligible and not is_customer)
 order by is_customer, created_at, prospect_id
 limit :id_limit;

\echo
\echo '== PART 5: CONVERTED-BUT-NOT-LINKED (converted_at is null) by the numbered states of docs/admin/pd059-stabilization.md section 2'
\echo '--     state 3 = enrolled, lead still holds a contact copy   | state 7 = enrolled, no contact copy (every pre-PD-59 prospect)'
\echo '--     state 6 = learner linked by Core, not enrolled         | awaiting = subscribed, not yet enrolled (states 1, 2: not a hand-over yet)'
:base
, pd059_unlinked as (
select ls.*,
       case when ls.enrolled_family_id is not null and ls.has_lead_contact     then '3 enrolled, contact copy kept'
            when ls.enrolled_family_id is not null                             then '7 enrolled, no contact copy'
            when ls.learner_id is not null                                     then '6 learner linked by Core'
            when ls.subscribed                                                 then 'awaiting: subscribed, not enrolled (states 1-2)'
       end as doc_state
  from pd059_lead_state ls
 where ls.converted_at is null
   and (ls.enrolled_family_id is not null or ls.learner_id is not null or ls.subscribed)
)
select doc_state, count(*) as leads,
       count(*) filter (where learner_id is not null) as also_learner_linked,
       count(*) filter (where owner_staff_id is null) as unowned,
       count(*) filter (where has_lead_contact) as with_contact_copy,
       min(created_at)::date as oldest
  from pd059_unlinked group by 1 order by 1;

\echo '-- 5b. the enrolled ones (states 3 and 7) by how they were enrolled and by whom (role of the enrolling staff member)'
:base
, pd059_unlinked as (
select ls.*,
       case when s.id is null then 'unknown'
            when s.role = 'super_admin' then 'super admin'
            when chat.sales_department_role(s.id) is not null then 'Sales'
            when exists (select 1 from chat.department_member m join chat.department d on d.id = m.department_id
                          where m.staff_id = s.id and d.kind = 'operations')
                 or chat.is_operations_manager(s.id, s.organization_id) then 'Operations'
            else 'other staff' end as enrolled_by_bucket
  from pd059_lead_state ls left join chat.staff s on s.id = ls.enrolled_by
 where ls.converted_at is null and ls.enrolled_family_id is not null
)
select enrolment_kind, enrolled_by_bucket, count(*) as leads,
       count(*) filter (where has_lead_contact) as with_contact_copy
  from pd059_unlinked group by 1, 2 order by 3 desc, 1, 2;

\echo '-- 5c. ids of states 3, 6 and 7 (capped by id_limit), oldest first; ids and states only'
:base
select prospect_id, organization_id,
       case when enrolled_family_id is not null and has_lead_contact then '3' when enrolled_family_id is not null then '7' else '6' end as doc_state,
       enrolled_family_id, owner_staff_id, (now() - created_at)::interval(0) as age
  from pd059_lead_state
 where converted_at is null and (enrolled_family_id is not null or learner_id is not null)
 order by created_at, prospect_id
 limit :id_limit;

rollback;
