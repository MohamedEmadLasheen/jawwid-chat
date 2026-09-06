-- Jawwid Chat -- tenant isolation in row level security.
--
-- 095000 made a cross-organization *reference* unrepresentable. This makes a
-- cross-organization *read or write* impossible as well: every policy now
-- carries `organization_id = chat.current_organization_id()` in both its USING
-- and its WITH CHECK.
--
-- Both halves matter, and for different attacks:
--   USING       stops organization A reading or updating organization B's rows.
--   WITH CHECK  stops organization A writing a row stamped as organization B's.
--
-- The predicate is added mechanically to every existing policy rather than
-- rewritten by hand, so no policy is left behind and none of the authorization
-- logic already reviewed is altered. Each policy is dropped and recreated with
-- its original expression intact and the tenant predicate conjoined.

drop policy absence_managed_by_manager on chat.absence;
create policy absence_managed_by_manager on chat.absence
  for all to authenticated
  using ((chat.is_manager()) and organization_id = chat.current_organization_id())
  with check ((chat.is_manager()) and organization_id = chat.current_organization_id());

drop policy absence_readable_by_staff on chat.absence;
create policy absence_readable_by_staff on chat.absence
  for select to authenticated
  using (((chat.current_staff_id() IS NOT NULL)) and organization_id = chat.current_organization_id());

drop policy audit_log_manager_only on chat.audit_log;
create policy audit_log_manager_only on chat.audit_log
  for select to authenticated
  using ((chat.is_manager()) and organization_id = chat.current_organization_id());

drop policy config_managed_by_manager on chat.config;
create policy config_managed_by_manager on chat.config
  for all to authenticated
  using ((chat.is_manager()) and organization_id = chat.current_organization_id())
  with check ((chat.is_manager()) and organization_id = chat.current_organization_id());

drop policy config_readable_by_staff on chat.config;
create policy config_readable_by_staff on chat.config
  for select to authenticated
  using (((chat.current_staff_id() IS NOT NULL)) and organization_id = chat.current_organization_id());

drop policy contact_edited_by_admins on chat.contact;
create policy contact_edited_by_admins on chat.contact
  for all to authenticated
  using ((((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text])) AND chat.staff_can_see_family(family_id))) and organization_id = chat.current_organization_id())
  with check (((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text]))) and organization_id = chat.current_organization_id());

drop policy contact_visible_to_staff on chat.contact;
create policy contact_visible_to_staff on chat.contact
  for select to authenticated
  using ((chat.staff_can_see_family(family_id)) and organization_id = chat.current_organization_id());

drop policy core_event_manager_only on chat.core_event;
create policy core_event_manager_only on chat.core_event
  for select to authenticated
  using ((chat.is_manager()) and organization_id = chat.current_organization_id());

drop policy core_parent_inbox_manager_only on chat.core_parent_inbox;
create policy core_parent_inbox_manager_only on chat.core_parent_inbox
  for select to authenticated
  using ((chat.is_manager()) and organization_id = chat.current_organization_id());

drop policy coverage_rule_managed_by_manager on chat.coverage_rule;
create policy coverage_rule_managed_by_manager on chat.coverage_rule
  for all to authenticated
  using ((chat.is_manager()) and organization_id = chat.current_organization_id())
  with check ((chat.is_manager()) and organization_id = chat.current_organization_id());

drop policy coverage_rule_readable_by_staff on chat.coverage_rule;
create policy coverage_rule_readable_by_staff on chat.coverage_rule
  for select to authenticated
  using (((chat.current_staff_id() IS NOT NULL)) and organization_id = chat.current_organization_id());

drop policy event_log_visible_to_staff on chat.event_log;
create policy event_log_visible_to_staff on chat.event_log
  for select to authenticated
  using ((((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text])) AND ((family_id IS NULL) OR chat.staff_can_see_family(family_id)))) and organization_id = chat.current_organization_id());

drop policy event_log_written_by_staff on chat.event_log;
create policy event_log_written_by_staff on chat.event_log
  for insert to authenticated
  with check (((chat.current_staff_id() IS NOT NULL)) and organization_id = chat.current_organization_id());

drop policy family_created_by_manager on chat.family;
create policy family_created_by_manager on chat.family
  for insert to authenticated
  with check ((chat.is_manager()) and organization_id = chat.current_organization_id());

drop policy family_edited_by_admins on chat.family;
create policy family_edited_by_admins on chat.family
  for update to authenticated
  using ((((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text])) AND chat.staff_can_see_family(id))) and organization_id = chat.current_organization_id())
  with check (((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text]))) and organization_id = chat.current_organization_id());

drop policy family_visible_to_staff on chat.family;
create policy family_visible_to_staff on chat.family
  for select to authenticated
  using ((chat.staff_can_see_family(id)) and organization_id = chat.current_organization_id());

drop policy family_note_visible_to_staff on chat.family_note;
create policy family_note_visible_to_staff on chat.family_note
  for select to authenticated
  using (((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text]))) and organization_id = chat.current_organization_id());

drop policy family_note_written_by_admins on chat.family_note;
create policy family_note_written_by_admins on chat.family_note
  for insert to authenticated
  with check ((((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text])) AND (author_id = chat.current_staff_id()))) and organization_id = chat.current_organization_id());

drop policy family_state_visible_to_staff on chat.family_state_cache;
create policy family_state_visible_to_staff on chat.family_state_cache
  for select to authenticated
  using ((chat.staff_can_see_family(family_id)) and organization_id = chat.current_organization_id());

drop policy handoff_visible_to_staff on chat.handoff;
create policy handoff_visible_to_staff on chat.handoff
  for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM chat.thread t
  WHERE ((t.id = handoff.thread_id) AND chat.staff_can_see_family(t.family_id))))) and organization_id = chat.current_organization_id());

drop policy handoff_written_by_admins on chat.handoff;
create policy handoff_written_by_admins on chat.handoff
  for insert to authenticated
  with check (((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text]))) and organization_id = chat.current_organization_id());

drop policy learner_edited_by_admins on chat.learner;
create policy learner_edited_by_admins on chat.learner
  for all to authenticated
  using ((((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text])) AND chat.staff_can_see_family(family_id))) and organization_id = chat.current_organization_id())
  with check (((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text]))) and organization_id = chat.current_organization_id());

drop policy learner_visible_to_staff on chat.learner;
create policy learner_visible_to_staff on chat.learner
  for select to authenticated
  using ((chat.staff_can_see_family(family_id)) and organization_id = chat.current_organization_id());

drop policy message_visible_to_staff on chat.message;
create policy message_visible_to_staff on chat.message
  for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM chat.thread t
  WHERE ((t.id = message.thread_id) AND chat.staff_can_see_family(t.family_id))))) and organization_id = chat.current_organization_id());

drop policy message_written_by_staff on chat.message;
create policy message_written_by_staff on chat.message
  for insert to authenticated
  with check ((((author_type = 'staff'::text) AND (author_id = chat.current_staff_id()) AND (((visibility = 'internal'::text) AND (chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text]))) OR ((visibility = 'customer'::text) AND chat.staff_may_send(chat.current_staff_id(), ( SELECT t.family_id
   FROM chat.thread t
  WHERE (t.id = message.thread_id)), on_behalf_mode))))) and organization_id = chat.current_organization_id());

drop policy shift_managed_by_manager on chat.shift;
create policy shift_managed_by_manager on chat.shift
  for all to authenticated
  using ((chat.is_manager()) and organization_id = chat.current_organization_id())
  with check ((chat.is_manager()) and organization_id = chat.current_organization_id());

drop policy shift_readable_by_staff on chat.shift;
create policy shift_readable_by_staff on chat.shift
  for select to authenticated
  using (((chat.current_staff_id() IS NOT NULL)) and organization_id = chat.current_organization_id());

drop policy staff_managed_by_manager on chat.staff;
create policy staff_managed_by_manager on chat.staff
  for update to authenticated
  using (((chat.is_manager() OR (id = chat.current_staff_id()))) and organization_id = chat.current_organization_id())
  with check (((chat.is_manager() OR (id = chat.current_staff_id()))) and organization_id = chat.current_organization_id());

drop policy staff_readable_by_staff on chat.staff;
create policy staff_readable_by_staff on chat.staff
  for select to authenticated
  using (((chat.current_staff_id() IS NOT NULL)) and organization_id = chat.current_organization_id());

drop policy subscription_visible_to_staff on chat.subscription;
create policy subscription_visible_to_staff on chat.subscription
  for select to authenticated
  using ((chat.staff_can_see_family(family_id)) and organization_id = chat.current_organization_id());

drop policy case_edited_by_admins on chat.support_case;
create policy case_edited_by_admins on chat.support_case
  for all to authenticated
  using ((((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text])) AND chat.staff_can_see_family(family_id))) and organization_id = chat.current_organization_id())
  with check (((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text]))) and organization_id = chat.current_organization_id());

drop policy case_visible_to_staff on chat.support_case;
create policy case_visible_to_staff on chat.support_case
  for select to authenticated
  using ((chat.staff_can_see_family(family_id)) and organization_id = chat.current_organization_id());

drop policy sync_state_manager_only on chat.sync_state;
create policy sync_state_manager_only on chat.sync_state
  for select to authenticated
  using ((chat.is_manager()) and organization_id = chat.current_organization_id());

drop policy task_created_by_admins on chat.task;
create policy task_created_by_admins on chat.task
  for insert to authenticated
  with check ((((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text])) AND chat.staff_can_see_family(family_id))) and organization_id = chat.current_organization_id());

drop policy task_updated_by_assignee_or_admins on chat.task;
create policy task_updated_by_assignee_or_admins on chat.task
  for update to authenticated
  using ((((owner_id = chat.current_staff_id()) OR ((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text])) AND chat.staff_can_see_family(family_id)))) and organization_id = chat.current_organization_id())
  with check ((((owner_id = chat.current_staff_id()) OR (chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text])))) and organization_id = chat.current_organization_id());

drop policy task_visible_to_assignee_or_admins on chat.task;
create policy task_visible_to_assignee_or_admins on chat.task
  for select to authenticated
  using ((((owner_id = chat.current_staff_id()) OR chat.staff_can_see_family(family_id))) and organization_id = chat.current_organization_id());

drop policy thread_edited_by_admins on chat.thread;
create policy thread_edited_by_admins on chat.thread
  for update to authenticated
  using ((((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text])) AND chat.staff_can_see_family(family_id))) and organization_id = chat.current_organization_id())
  with check (((chat.current_staff_role() = ANY (ARRAY['admin'::text, 'coverage'::text, 'manager'::text]))) and organization_id = chat.current_organization_id());

drop policy thread_visible_to_staff on chat.thread;
create policy thread_visible_to_staff on chat.thread
  for select to authenticated
  using ((chat.staff_can_see_family(family_id)) and organization_id = chat.current_organization_id());

-- 38 policies carried forward with tenant isolation.
