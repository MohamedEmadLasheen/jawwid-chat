-- PD-59 STAGING SCHEMA REVIEW -- READ-ONLY. Run it on the target database BEFORE applying
-- 20261121100000_chat_pd059_sales_pipeline, as the SAME role that scripts/db/apply.sh will connect as.
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/db/reports/pd059-staging-schema-review.sql
--
-- It runs in `begin read only` (the server refuses any write), changes nothing, and prints NO personal value:
-- role names, object names, migration names, counts, booleans, hashes of function bodies. Every row has an
-- expected value, the actual value and PASS / FAIL / WARN / INFO. The last row is the verdict.
--   FAIL = do not apply; fix it or ask the lead.   WARN = read it, decide, record the decision.   INFO = recorded, no rule.
--
-- STATUS OF THIS FILE: tested ONLY on a throwaway postgres:17 built from the 182 migrations older than PD-59 (see
-- docs/admin/pd059-stabilization.md section 4A). It has NOT been run on real staging or production. What staging
-- really looks like (the owner role, default privileges, pooler behaviour, ledger contents) is exactly what a first run
-- will tell us; treat the first run's output as the finding, not as a re-test.
--
-- If psql stops with `relation "chat...." does not exist`, this is not a migrated Jawwid Chat database: stop.
--
-- The list of 182 expected migrations below is the set of files in supabase/migrations older than PD-59 on the
-- commit this file was written from. If main has gained migrations since, regenerate it:
--   ls supabase/migrations | grep -v 20261121100000 | sed "s/\.sql$//"
\pset format wrapped
\pset columns 200
begin read only;

\echo '== PD-59 staging schema review (read-only; NOT yet run on real staging) =='

with expected_ledger(version) as (
  values
      ('20260905090000_chat_foundation'),
      ('20260905090050_chat_identity'),
      ('20260905090100_chat_config_defaults'),
      ('20260905090200_chat_staff_and_coverage_config'),
      ('20260905090300_chat_family_domain'),
      ('20260905090400_chat_conversation_domain'),
      ('20260905090500_chat_logs_and_state_cache'),
      ('20260905090600_chat_coverage_engine'),
      ('20260905090700_chat_ownership_invariants'),
      ('20260905090800_chat_attention_and_workload'),
      ('20260905090900_chat_core_integration'),
      ('20260905091000_chat_message_idempotency'),
      ('20260905091100_chat_authorization'),
      ('20260905091150_chat_application_roles'),
      ('20260905091200_chat_rls'),
      ('20260905091300_chat_policy_helper_privileges'),
      ('20260905093000_chat_communication'),
      ('20260905093100_chat_communication_config'),
      ('20260905093200_chat_shared_logs'),
      ('20260905093300_chat_br1_structural_backstop'),
      ('20260905094000_chat_od01_conversation_reconciliation'),
      ('20260906120000_chat_organization'),
      ('20260910120000_chat_teacher_identity'),
      ('20260910120100_chat_authentication'),
      ('20260910120200_chat_connection_roles'),
      ('20260912090000_chat_auth_event_types'),
      ('20260923120000_chat_teacher_parent_relationship'),
      ('20260923130000_chat_learner_assignment_authority'),
      ('20260923140000_chat_pd006_authorization_switch'),
      ('20260924120000_chat_call_ring_timeout_index'),
      ('20260927120000_chat_call_media_presence'),
      ('20260928120000_chat_stories'),
      ('20261005140000_chat_profile_avatars'),
      ('20261005160000_chat_staff_teacher_avatars'),
      ('20261013120000_chat_super_admin_role'),
      ('20261013150000_chat_staff_profile'),
      ('20261013160000_chat_staff_column_privileges'),
      ('20261014090000_chat_ownership_actor_boundary'),
      ('20261014090100_chat_ownership_event_logging_repair'),
      ('20261014100000_chat_request_role_write_boundaries'),
      ('20261014100100_chat_definer_function_hardening'),
      ('20261014100200_chat_single_super_admin'),
      ('20261014100300_chat_identity_binding_and_engine_writers'),
      ('20261014100400_chat_offboard_target_rules'),
      ('20261014110000_chat_ownership_policy_split'),
      ('20261014110100_chat_staff_profile_app_runtime'),
      ('20261014120000_chat_pd007_restore_br1_direct'),
      ('20261014130000_chat_avatar_key_format'),
      ('20261014140000_chat_rt031_call_notification_tenant'),
      ('20261014150000_chat_rt032_revocation_journal'),
      ('20261014160000_chat_push_privacy_templates'),
      ('20261015120000_chat_pd008_org_structure'),
      ('20261017120000_chat_stories_v2'),
      ('20261018120000_chat_pd011_lessons'),
      ('20261018140000_chat_pd011_scheduling'),
      ('20261018160000_chat_pd011_transfers_suspensions'),
      ('20261018170000_chat_pd010_teacher_file'),
      ('20261019090000_chat_pd012_s1'),
      ('20261019100000_chat_pd011_statistics'),
      ('20261019120000_chat_pd011_trials'),
      ('20261019130000_chat_pd011_trial_group'),
      ('20261019140000_chat_pd012_s2_discipline'),
      ('20261019180000_chat_pd012_s3_billing'),
      ('20261019200000_chat_core_boundary'),
      ('20261020090000_chat_scheduled_call'),
      ('20261020091000_chat_message_star_pin'),
      ('20261020100000_chat_message_forward'),
      ('20261020110000_chat_labels_quick_replies'),
      ('20261020130000_chat_edit_favorites'),
      ('20261020140000_chat_message_search'),
      ('20261020150000_chat_themes'),
      ('20261020160000_chat_wallpaper_pending'),
      ('20261020300000_chat_brand_name_arabic'),
      ('20261020400000_chat_pd014_no_preapproval'),
      ('20261021000000_chat_teacher_professional_profile'),
      ('20261021000100_chat_teacher_profile_v2_immediate_save'),
      ('20261021010000_chat_parent_profile'),
      ('20261021020000_chat_abuse_limits'),
      ('20261021100000_chat_trial_journey'),
      ('20261021120000_chat_pd015_student_journey'),
      ('20261021130000_chat_trial_booking_students'),
      ('20261021140000_chat_new_student_enrolment'),
      ('20261021150000_chat_pd017_parent_student_profiles'),
      ('20261021160000_chat_pd018_teacher_payroll'),
      ('20261022100000_chat_pd021_password_reset'),
      ('20261022110000_chat_pd021_account_suspension'),
      ('20261022120000_chat_pd021_impersonation'),
      ('20261022130000_chat_pd022_account_time_zone'),
      ('20261022140000_chat_pd023_session_policy'),
      ('20261022150000_chat_pd026_teacher_supervision'),
      ('20261022160000_chat_pd025_parent_self_recovery'),
      ('20261022163000_chat_pd022_clock_shift_warning'),
      ('20261022170000_chat_pd027_payments'),
      ('20261022180000_chat_pd029_materials'),
      ('20261026110000_chat_pd031_scheduling'),
      ('20261026120000_chat_pd032_parent_feedback_signup_code'),
      ('20261026130000_chat_pd033_supervisor_cover'),
      ('20261026140000_chat_pd030_subscription_lock'),
      ('20261026160000_chat_pd035_conversation_seat'),
      ('20261026160003_chat_pd035_seat_security_fixes'),
      ('20261026160004_chat_pd035_teacher_supervisor'),
      ('20261026160005_chat_pd035_reports_evaluations'),
      ('20261026160006_chat_pd035_scope_hardening'),
      ('20261026160007_chat_pd035_supervision_cases'),
      ('20261026170000_chat_pd036_mentions'),
      ('20261026180000_chat_pd037_read_cursors'),
      ('20261026180001_chat_pd037_presence'),
      ('20261026190000_chat_pd034_notifications'),
      ('20261026190001_chat_pd034_chat_push_policy'),
      ('20261026200000_chat_pd029_material_opens'),
      ('20261026210000_chat_pd038_schedule_calendar'),
      ('20261027100000_chat_pd035_department_rooms'),
      ('20261027110000_chat_pd034_center_render_fix'),
      ('20261027160000_chat_pd026_operations_access'),
      ('20261027170000_chat_pd029_quran_dataset'),
      ('20261027190000_chat_pd040_access_roles'),
      ('20261028100000_chat_pd043_teacher_onboarding'),
      ('20261028110000_chat_pd042_direct_enrolment'),
      ('20261028120000_chat_pd040_shadow_qa_bundles'),
      ('20261028160000_chat_pd043_give_sign_in'),
      ('20261028170000_chat_pd043_reissue_by_current_supervisor'),
      ('20261028200000_chat_pd043_offboarding_and_setup'),
      ('20261028210000_chat_pd042_intake_scope'),
      ('20261029100000_chat_pd040_staff_accounts'),
      ('20261029110000_chat_pd041_certificates'),
      ('20261029120000_chat_pd042_ops_side'),
      ('20261029130000_chat_pd043_change_sign_in'),
      ('20261029150000_chat_pd043_manager_notifications'),
      ('20261029160000_chat_pd047_work_tasks'),
      ('20261029180000_chat_pd035_case_notifications'),
      ('20261029190000_chat_pd040_designer_template'),
      ('20261029200000_chat_pd047_task_priority'),
      ('20261029210000_chat_pd047_task_sources'),
      ('20261029220000_chat_pd040_template_followups'),
      ('20261029230000_chat_pd048_lesson_audio'),
      ('20261029233000_chat_pd047_financial_task_sources'),
      ('20261029234000_chat_pd047_task_delivery'),
      ('20261029235000_chat_pd049_lesson_content_review'),
      ('20261029235500_chat_pd035_case_notification_rules'),
      ('20261029235700_chat_pd048_parent_notice_ack'),
      ('20261029235800_chat_pd047_phase_b_sources'),
      ('20261029235900_chat_pd047_phase_b_handovers'),
      ('20261030000000_chat_pd047_phase_b_decisions'),
      ('20261030010000_chat_pd041_overseer_approval'),
      ('20261030020000_chat_pd039_whiteboards'),
      ('20261030030000_chat_pd045_parent_location'),
      ('20261030040000_chat_pd050_excuse_category'),
      ('20261030050000_chat_pd045_contact_key_rekey'),
      ('20261030060000_chat_pd039_asset_claims'),
      ('20261031150000_chat_admin002_family_access_grant'),
      ('20261031160000_chat_pd053_call_connection_grace'),
      ('20261031170000_chat_pd052_teacher_records_keys'),
      ('20261031180000_chat_pd052_teacher_records_entries'),
      ('20261031190000_chat_pd052_sales_basis'),
      ('20261102120000_chat_pd055_board_dotted_layout'),
      ('20261102130000_chat_pd055_learner_rewards'),
      ('20261102140000_chat_teacher_profile_reviewer_mirror'),
      ('20261102150000_chat_pd046_lesson_revision_and_events'),
      ('20261102160000_chat_pd052_records_notifications'),
      ('20261102190000_chat_pd052_share_praise'),
      ('20261102200000_chat_teacher005_unpaid_leave'),
      ('20261102210000_chat_account_erasure'),
      ('20261102220000_chat_amb9_group_admin_absent'),
      ('20261102230000_chat_pd055_page_shape'),
      ('20261102240000_chat_pd046_card_key_and_scheduled_card'),
      ('20261102250000_chat_teacher008_cancel_cause'),
      ('20261102260000_chat_pd046_transfer_keeps_occurrences'),
      ('20261102270000_chat_pd046_lesson_create_key'),
      ('20261104100000_chat_pd057_moderation'),
      ('20261106100000_chat_pd027_lesson_package_link'),
      ('20261106130000_chat_pd057_report_effects'),
      ('20261106140000_chat_pd057_block_notices'),
      ('20261106150000_chat_pd057_report_escalation'),
      ('20261106160000_chat_pd030_lock_lesson_instalments'),
      ('20261106170000_chat_pd030_d3_push_wording'),
      ('20261107110000_chat_pd058_terms'),
      ('20261107120000_chat_pd027_stripe_lifecycle'),
      ('20261107140000_chat_teacher_deletion_request'),
      ('20261107150000_chat_pd032_feedback_reply_notices'),
      ('20261110100000_chat_call_live_partial_index'),
      ('20261117100000_chat_pd027_card_pause_seed'),
      ('20261117110000_chat_pd058_publish_order')
),
me as (select r.rolname, r.rolsuper from pg_roles r where r.rolname = current_user),
ledger as (select version from chat.schema_migrations),
checks(n, area, what, expected, actual, status) as (
  -- ---------------------------------------------------------------- environment
  select 10, 'env', 'server major version', '17 (CI and rehearsal)',
         (current_setting('server_version_num')::int / 10000)::text,
         case when current_setting('server_version_num')::int / 10000 = 17 then 'PASS' else 'WARN' end
  union all
  select 11, 'env', 'this transaction is read only', 'on', current_setting('transaction_read_only'),
         case when current_setting('transaction_read_only') = 'on' then 'PASS' else 'FAIL' end
  union all
  select 12, 'env', 'connected role (the one apply.sh would use)', 'informational',
         (select rolname || case when rolsuper then ' (superuser)' else ' (not superuser)' end from me), 'INFO'
  union all
  select 13, 'env', 'lock_timeout in this session', 'non-zero (set PGOPTIONS before apply; a pooler may drop it)',
         current_setting('lock_timeout'),
         case when current_setting('lock_timeout') = '0' then 'WARN' else 'PASS' end
  union all
  select 14, 'env', 'statement_timeout in this session (apply.sh sets it to 0 locally)', 'informational',
         current_setting('statement_timeout'), 'INFO'
  -- ---------------------------------------------------------------- roles
  union all
  select 20, 'roles', 'roles the migration names exist: chat_app, anon, authenticated', '3',
         (select count(*) from pg_roles where rolname in ('chat_app','anon','authenticated'))::text,
         case when (select count(*) from pg_roles where rolname in ('chat_app','anon','authenticated')) = 3 then 'PASS' else 'FAIL' end
  union all
  select 21, 'roles', 'service_role and chat_service exist (not named by PD-59, but the chain defines them)', '2',
         (select count(*) from pg_roles where rolname in ('service_role','chat_service'))::text,
         case when (select count(*) from pg_roles where rolname in ('service_role','chat_service')) = 2 then 'PASS' else 'WARN' end
  union all
  select 22, 'roles', 'bypassrls: service_role and chat_service true, chat_app false', 'chat_app=f chat_service=t service_role=t',
         (select string_agg(rolname || '=' || case when rolbypassrls then 't' else 'f' end, ' ' order by rolname)
            from pg_roles where rolname in ('chat_app','service_role','chat_service')),
         case when (select bool_and(rolbypassrls = (rolname in ('service_role','chat_service')))
                      from pg_roles where rolname in ('chat_app','service_role','chat_service')) then 'PASS' else 'WARN' end
  -- ---------------------------------------------------------------- ownership and privilege
  union all
  select 30, 'owner', 'the connected role has the privileges of the OWNER of guard_trial_prospect and guard_trial_student (create or replace needs it)',
         '2 of 2',
         (select count(*) filter (where pg_has_role(current_user, p.proowner, 'USAGE'))::text || ' of ' || count(*)::text
            || ' (owner: ' || coalesce(string_agg(distinct pg_get_userbyid(p.proowner), ','), 'none') || ')'
            from pg_proc p where p.pronamespace = 'chat'::regnamespace and p.proname in ('guard_trial_prospect','guard_trial_student')),
         case when (select count(*) = 2 and bool_and(pg_has_role(current_user, p.proowner, 'USAGE'))
                      from pg_proc p where p.pronamespace = 'chat'::regnamespace and p.proname in ('guard_trial_prospect','guard_trial_student'))
              then 'PASS' else 'FAIL' end
  union all
  select 31, 'owner', 'owner of chat.trial_prospect is the connected role or one it holds (alter table needs it)', 'true',
         (select pg_has_role(current_user, c.relowner, 'USAGE')::text || ' (owner: ' || pg_get_userbyid(c.relowner) || ')'
            from pg_class c where c.oid = 'chat.trial_prospect'::regclass),
         case when (select pg_has_role(current_user, c.relowner, 'USAGE') from pg_class c where c.oid = 'chat.trial_prospect'::regclass)
              then 'PASS' else 'FAIL' end
  union all
  select 32, 'owner', 'CREATE on schema chat (new table and functions)', 'true',
         has_schema_privilege(current_user, 'chat', 'CREATE')::text,
         case when has_schema_privilege(current_user, 'chat', 'CREATE') then 'PASS' else 'FAIL' end
  union all
  select 33, 'owner', 'REFERENCES on chat.family, chat.staff, chat.organization, chat.trial_prospect (new foreign keys)', 'true true true true',
         (select string_agg(has_table_privilege(current_user, t, 'REFERENCES')::text, ' ' order by t)
            from unnest(array['chat.family','chat.staff','chat.organization','chat.trial_prospect']) t),
         case when (select bool_and(has_table_privilege(current_user, t, 'REFERENCES'))
                      from unnest(array['chat.family','chat.staff','chat.organization','chat.trial_prospect']) t) then 'PASS' else 'FAIL' end
  union all
  select 34, 'owner', 'owner of chat.family (chat.caller_is_server_side tests membership of it; the purge needs a server-side caller)', 'informational',
         (select pg_get_userbyid(relowner) from pg_class where oid = 'chat.family'::regclass), 'INFO'
  -- ---------------------------------------------------------------- ledger
  union all
  select 40, 'ledger', 'older migrations (of 182 expected) MISSING from chat.schema_migrations', '0',
         (select count(*) from expected_ledger e where e.version not in (select version from ledger))::text,
         case when (select count(*) from expected_ledger e where e.version not in (select version from ledger)) = 0 then 'PASS' else 'FAIL' end
  union all
  select 41, 'ledger', 'PD-59 not yet applied', '0',
         (select count(*) from ledger where version = '20261121100000_chat_pd059_sales_pipeline')::text,
         case when (select count(*) from ledger where version = '20261121100000_chat_pd059_sales_pipeline') = 0 then 'PASS' else 'WARN' end
  union all
  select 42, 'ledger', 'ledger rows NOT in the expected list (newer, or from another branch); names listed, at most 8', '0',
         (select count(*) from ledger where version not in (select version from expected_ledger) and version <> '20261121100000_chat_pd059_sales_pipeline')::text
           || coalesce(' : ' || (select string_agg(version, ', ' order by version) from (select version from ledger
                where version not in (select version from expected_ledger) and version <> '20261121100000_chat_pd059_sales_pipeline' order by version limit 8) x), ''),
         case when (select count(*) from ledger where version not in (select version from expected_ledger) and version <> '20261121100000_chat_pd059_sales_pipeline') = 0 then 'PASS' else 'WARN' end
  union all
  select 43, 'ledger', 'ledger rows in total and the latest', 'informational',
         (select count(*) || ' rows, latest ' || coalesce(max(version), '-') from ledger), 'INFO'
  -- ---------------------------------------------------------------- what PD-59 builds on
  union all
  select 50, 'schema', 'tables the migration and the purge read exist (trial_prospect, trial_student, trial_outcome, trial_subscription, lesson, student_enrolment, family, staff, learner, audit_log, organization)', '11',
         (select count(*) from unnest(array['chat.trial_prospect','chat.trial_student','chat.trial_outcome','chat.trial_subscription','chat.lesson','chat.student_enrolment','chat.family','chat.staff','chat.learner','chat.audit_log','chat.organization']) t where to_regclass(t) is not null)::text,
         case when (select count(*) from unnest(array['chat.trial_prospect','chat.trial_student','chat.trial_outcome','chat.trial_subscription','chat.lesson','chat.student_enrolment','chat.family','chat.staff','chat.learner','chat.audit_log','chat.organization']) t where to_regclass(t) is not null) = 11 then 'PASS' else 'FAIL' end
  union all
  select 51, 'schema', 'chat.trial_prospect has the 8 columns the guard and the purge name', '8',
         (select count(*) from information_schema.columns where table_schema = 'chat' and table_name = 'trial_prospect'
             and column_name in ('id','organization_id','display_name','level','created_by','created_at','note','learner_id'))::text,
         case when (select count(*) from information_schema.columns where table_schema = 'chat' and table_name = 'trial_prospect'
             and column_name in ('id','organization_id','display_name','level','created_by','created_at','note','learner_id')) = 8 then 'PASS' else 'FAIL' end
  union all
  select 52, 'schema', 'helper functions exist: sales_department_role(uuid), is_operations_manager(uuid,uuid), caller_is_server_side()', '3',
         (select count(*) from pg_proc p where p.pronamespace = 'chat'::regnamespace
              and ((p.proname = 'sales_department_role' and pg_get_function_identity_arguments(p.oid) = 'p_staff uuid')
                or (p.proname = 'is_operations_manager' and pg_get_function_identity_arguments(p.oid) = 'p_staff uuid, p_org uuid')
                or (p.proname = 'caller_is_server_side' and pg_get_function_identity_arguments(p.oid) = '')))::text,
         case when (select count(*) from pg_proc p where p.pronamespace = 'chat'::regnamespace
              and ((p.proname = 'sales_department_role' and pg_get_function_identity_arguments(p.oid) = 'p_staff uuid')
                or (p.proname = 'is_operations_manager' and pg_get_function_identity_arguments(p.oid) = 'p_staff uuid, p_org uuid')
                or (p.proname = 'caller_is_server_side' and pg_get_function_identity_arguments(p.oid) = ''))) = 3 then 'PASS' else 'FAIL' end
  union all
  select 53, 'schema', 'guard_trial_prospect body is the pre-PD-59 one (md5 of prosrc; create or replace would overwrite anything else)', 'd4ee4aedd27eab2716b2a2c1e941285d',
         coalesce((select string_agg(md5(p.prosrc), ',') from pg_proc p where p.pronamespace = 'chat'::regnamespace and p.proname = 'guard_trial_prospect'), 'missing'),
         case when (select count(*) from pg_proc p where p.pronamespace = 'chat'::regnamespace and p.proname = 'guard_trial_prospect' and md5(p.prosrc) = 'd4ee4aedd27eab2716b2a2c1e941285d') = 1 then 'PASS' else 'FAIL' end
  union all
  select 54, 'schema', 'guard_trial_student body is the pre-PD-59 one (md5 of prosrc)', '3fc3a3004a48801ceeabe0a913f139a8',
         coalesce((select string_agg(md5(p.prosrc), ',') from pg_proc p where p.pronamespace = 'chat'::regnamespace and p.proname = 'guard_trial_student'), 'missing'),
         case when (select count(*) from pg_proc p where p.pronamespace = 'chat'::regnamespace and p.proname = 'guard_trial_student' and md5(p.prosrc) = '3fc3a3004a48801ceeabe0a913f139a8') = 1 then 'PASS' else 'FAIL' end
  union all
  select 55, 'schema', 'the guards are attached: triggers that call guard_trial_prospect / guard_trial_student', '>= 2',
         (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
            where not t.tgisinternal and p.pronamespace = 'chat'::regnamespace
              and p.proname in ('guard_trial_prospect','guard_trial_student'))::text,
         case when (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
            where not t.tgisinternal and p.pronamespace = 'chat'::regnamespace
              and p.proname in ('guard_trial_prospect','guard_trial_student')) >= 2 then 'PASS' else 'FAIL' end
  union all
  select 56, 'schema', 'audit_log has the columns the purge writes and actor_id is nullable (the purge writes a null actor)', '6 columns, actor_id nullable=yes',
         (select count(*) from information_schema.columns where table_schema = 'chat' and table_name = 'audit_log'
             and column_name in ('actor_id','action','entity','entity_id','after','reason'))::text
         || ' columns, actor_id nullable=' || coalesce((select lower(is_nullable) from information_schema.columns where table_schema = 'chat' and table_name = 'audit_log' and column_name = 'actor_id'), 'missing'),
         case when (select count(*) from information_schema.columns where table_schema = 'chat' and table_name = 'audit_log'
             and column_name in ('actor_id','action','entity','entity_id','after','reason')) = 6
              and coalesce((select is_nullable from information_schema.columns where table_schema = 'chat' and table_name = 'audit_log' and column_name = 'actor_id'), 'NO') = 'YES'
              then 'PASS' else 'FAIL' end
  union all
  select 57, 'schema', 'extensions btree_gist and pg_trgm (earlier migrations need them)', '2',
         (select count(*) from pg_extension where extname in ('btree_gist','pg_trgm'))::text,
         case when (select count(*) from pg_extension where extname in ('btree_gist','pg_trgm')) = 2 then 'PASS' else 'WARN' end
  -- ---------------------------------------------------------------- PD-59 must not be partly there
  union all
  select 60, 'absent', 'none of the 9 new trial_prospect columns exists yet', '0',
         (select count(*) from information_schema.columns where table_schema = 'chat' and table_name = 'trial_prospect'
             and column_name in ('pipeline_stage','lost_reason','last_contacted_at','next_follow_up_on','follow_up_note','converted_at','converted_family_id','owner_staff_id','last_activity_at'))::text,
         case when (select count(*) from information_schema.columns where table_schema = 'chat' and table_name = 'trial_prospect'
             and column_name in ('pipeline_stage','lost_reason','last_contacted_at','next_follow_up_on','follow_up_note','converted_at','converted_family_id','owner_staff_id','last_activity_at')) = 0 then 'PASS' else 'WARN' end
  union all
  select 61, 'absent', 'chat.sales_lead_contact and the six PD-59 functions do not exist yet', '0',
         ((select count(*) from pg_class where relnamespace = 'chat'::regnamespace and relname = 'sales_lead_contact')
          + (select count(*) from pg_proc where pronamespace = 'chat'::regnamespace
               and proname in ('sales_lead_owner_eligible','sales_lead_purging','sales_lead_expired','expired_sales_leads','purge_expired_sales_leads','guard_sales_lead_contact')))::text,
         case when ((select count(*) from pg_class where relnamespace = 'chat'::regnamespace and relname = 'sales_lead_contact')
          + (select count(*) from pg_proc where pronamespace = 'chat'::regnamespace
               and proname in ('sales_lead_owner_eligible','sales_lead_purging','sales_lead_expired','expired_sales_leads','purge_expired_sales_leads','guard_sales_lead_contact'))) = 0 then 'PASS' else 'WARN' end
  -- ---------------------------------------------------------------- default privileges
  union all
  select 70, 'privileges', 'default ACLs that would hand a NEW chat table or function to service_role or chat_service (the migration''s revoke list does not name them)', '0',
         (select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
           where d.defaclnamespace in (0, 'chat'::regnamespace) and d.defaclobjtype in ('r','f')
             and pg_has_role(current_user, d.defaclrole, 'USAGE')
             and a.grantee in (select oid from pg_roles where rolname in ('service_role','chat_service')))::text,
         case when (select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
           where d.defaclnamespace in (0, 'chat'::regnamespace) and d.defaclobjtype in ('r','f')
             and pg_has_role(current_user, d.defaclrole, 'USAGE')
             and a.grantee in (select oid from pg_roles where rolname in ('service_role','chat_service'))) = 0 then 'PASS' else 'FAIL' end
  union all
  select 71, 'privileges', 'default ACLs naming PUBLIC, anon, authenticated or chat_app on new chat tables or functions (the migration revokes them; worth knowing)', '0',
         (select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
           where d.defaclnamespace in (0, 'chat'::regnamespace) and d.defaclobjtype in ('r','f')
             and pg_has_role(current_user, d.defaclrole, 'USAGE')
             and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated','chat_app'))))::text,
         case when (select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
           where d.defaclnamespace in (0, 'chat'::regnamespace) and d.defaclobjtype in ('r','f')
             and pg_has_role(current_user, d.defaclrole, 'USAGE')
             and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated','chat_app')))) = 0 then 'PASS' else 'WARN' end
  union all
  select 72, 'privileges', 'pattern: the existing confined table chat.trial_subscription is closed to every request role', 'all false',
         (select string_agg(r.rolname || '=' || has_table_privilege(r.rolname, 'chat.trial_subscription', 'select,insert,update,delete')::text, ' ' order by r.rolname)
            from pg_roles r where r.rolname in ('chat_app','anon','authenticated','service_role','chat_service')),
         case when (select bool_or(has_table_privilege(r.rolname, 'chat.trial_subscription', 'select,insert,update,delete'))
            from pg_roles r where r.rolname in ('chat_app','anon','authenticated','service_role','chat_service')) then 'WARN' else 'PASS' end
  union all
  select 73, 'privileges', 'all default ACL rows in the database (count only)', 'informational',
         (select count(*) from pg_default_acl)::text, 'INFO'
  -- ---------------------------------------------------------------- activity and locks
  union all
  select 80, 'activity', 'can this role see other sessions (superuser or pg_read_all_stats)? Without it checks 81, 82 and 84 are blind', 'true',
         (select (rolsuper or pg_has_role(current_user, 'pg_read_all_stats', 'USAGE'))::text from me),
         case when (select rolsuper or pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') from me) then 'PASS' else 'WARN' end
  union all
  select 81, 'activity', 'other sessions in an open transaction older than 60 s', '0',
         (select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
             and xact_start is not null and now() - xact_start > interval '60 seconds')::text,
         case when (select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
             and xact_start is not null and now() - xact_start > interval '60 seconds') = 0 then 'PASS' else 'WARN' end
  union all
  select 82, 'activity', 'other sessions holding or awaiting a lock on trial_prospect, family, staff or organization (the migration takes ACCESS EXCLUSIVE / SHARE ROW EXCLUSIVE on them)', '0',
         (select count(distinct l.pid) from pg_locks l
            where l.pid <> pg_backend_pid() and l.database = (select oid from pg_database where datname = current_database()) and l.relation in ('chat.trial_prospect'::regclass, 'chat.family'::regclass, 'chat.staff'::regclass, 'chat.organization'::regclass))::text,
         case when (select count(distinct l.pid) from pg_locks l
            where l.pid <> pg_backend_pid() and l.database = (select oid from pg_database where datname = current_database()) and l.relation in ('chat.trial_prospect'::regclass, 'chat.family'::regclass, 'chat.staff'::regclass, 'chat.organization'::regclass)) = 0 then 'PASS' else 'WARN' end
  union all
  select 83, 'activity', 'prepared (two-phase) transactions, which can hold locks indefinitely', '0',
         (select count(*) from pg_prepared_xacts)::text,
         case when (select count(*) from pg_prepared_xacts) = 0 then 'PASS' else 'FAIL' end
  union all
  select 84, 'activity', 'other sessions idle in transaction (any age)', '0',
         (select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state like 'idle in transaction%')::text,
         case when (select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state like 'idle in transaction%') = 0 then 'PASS' else 'WARN' end
  -- ---------------------------------------------------------------- sizes (counts only)
  union all
  select 90, 'counts', 'chat.trial_prospect rows (the backfill scans them; rehearsal: 2.6 s at 50 000). WARN above 200 000', 'informational',
         (select count(*) from chat.trial_prospect)::text,
         case when (select count(*) from chat.trial_prospect) > 200000 then 'WARN' else 'INFO' end
  union all
  select 91, 'counts', 'chat.family / chat.staff / chat.lesson rows (the migration locks family and staff)', 'informational',
         (select count(*) from chat.family) || ' / ' || (select count(*) from chat.staff) || ' / ' || (select count(*) from chat.lesson), 'INFO'
  union all
  select 92, 'counts', 'trial_outcome / trial_subscription / student_enrolment / trial_student / learner rows (the migration must leave every one unchanged: record these, compare after)', 'informational',
         (select count(*) from chat.trial_outcome) || ' / ' || (select count(*) from chat.trial_subscription) || ' / '
         || (select count(*) from chat.student_enrolment) || ' / ' || (select count(*) from chat.trial_student) || ' / ' || (select count(*) from chat.learner), 'INFO'
  union all
  select 93, 'counts', 'Sales department present (departments of kind sales) and staff holding a Sales role', 'informational',
         (select count(*) from chat.department where kind = 'sales') || ' departments / '
         || (select count(*) from chat.staff s where chat.sales_department_role(s.id) is not null) || ' staff', 'INFO'
  -- ---------------------------------------------------------------- what the apply would do to data
  union all
  select 94, 'predict', 'prospects the migration''s BACKFILL will assign an owner (creator is live Sales staff of the same org, not the super admin)', 'informational',
         (select count(*) from chat.trial_prospect p
           where exists (select 1 from chat.staff s where s.id = p.created_by and s.organization_id = p.organization_id
                           and s.is_active and s.left_at is null and s.role <> 'super_admin'
                           and chat.sales_department_role(s.id) is not null))::text
         || ' of ' || (select count(*) from chat.trial_prospect)::text, 'INFO'
  union all
  select 95, 'predict', 'F3: prospects the FIRST retention dry run would list after apply (pre-PD-59 clock = created_at / latest lesson; has a free-text note; never subscribed, enrolled or learner-linked)', 'informational',
         (select count(*) from chat.trial_prospect p
           where p.learner_id is null
             and not exists (select 1 from chat.lesson l join chat.trial_outcome o on o.lesson_id = l.id where l.prospect_id = p.id and o.result = 'subscribed')
             and not exists (select 1 from chat.lesson l join chat.student_enrolment e on e.lesson_id = l.id where l.prospect_id = p.id)
             and greatest(p.created_at, (select max(l.created_at) from chat.lesson l where l.prospect_id = p.id),
                          (select max(l.ends_at) from chat.lesson l where l.prospect_id = p.id)) < now() - interval '12 months'
             and (p.note is not null or exists (select 1 from chat.trial_student t where t.prospect_id = p.id and t.note is not null)))::text, 'INFO'
  union all
  select 96, 'predict', 'F3: of those, how many have at least one trial (a not-subscribed trial; an outcome other than subscribed)', 'informational',
         (select count(*) from chat.trial_prospect p
           where p.learner_id is null
             and exists (select 1 from chat.lesson l where l.prospect_id = p.id and l.kind = 'trial')
             and not exists (select 1 from chat.lesson l join chat.trial_outcome o on o.lesson_id = l.id where l.prospect_id = p.id and o.result = 'subscribed')
             and not exists (select 1 from chat.lesson l join chat.student_enrolment e on e.lesson_id = l.id where l.prospect_id = p.id)
             and greatest(p.created_at, (select max(l.created_at) from chat.lesson l where l.prospect_id = p.id),
                          (select max(l.ends_at) from chat.lesson l where l.prospect_id = p.id)) < now() - interval '12 months'
             and (p.note is not null or exists (select 1 from chat.trial_student t where t.prospect_id = p.id and t.note is not null)))::text, 'INFO'
  union all
  select 97, 'flags', 'retention flags live in the API/worker environment, not in the database: SALES_LEAD_RETENTION_ENABLED must stay unset or false', 'unset', 'cannot be read from SQL: check the App Platform spec', 'INFO'
)
select n, area, what, expected, actual, status from checks
union all
select 999, 'VERDICT', 'FAIL / WARN / PASS counts; apply only on 0 FAIL and every WARN explained',
       '0 FAIL',
       (select count(*) filter (where status = 'FAIL') || ' FAIL, ' || count(*) filter (where status = 'WARN') || ' WARN, '
               || count(*) filter (where status = 'PASS') || ' PASS, ' || count(*) filter (where status = 'INFO') || ' INFO' from checks),
       case when (select count(*) from checks where status = 'FAIL') > 0 then 'FAIL'
            when (select count(*) from checks where status = 'WARN') > 0 then 'WARN' else 'PASS' end
order by 1;

rollback;
