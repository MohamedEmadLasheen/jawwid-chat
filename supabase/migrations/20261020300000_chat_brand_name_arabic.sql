-- Jawwid Chat — the Arabic brand name.
--
-- Originally written 2026-09-08 as 20260908110000_chat_brand_name_arabic.sql,
-- on the phase7 lineage, and never committed. Ported to the integration line
-- 2026-10-20 under this later version so it applies AFTER every migration that
-- seeded the misspelling, and widened to cover the templates seeded since.
--
-- The canonical Arabic spelling of the product name is جَوِّد: the imperative of
-- جوَّد, the root the academy is named for, and the spelling `appName` in
-- lib/l10n/app_ar.arb and the Admin Web already use. Several migrations seeded
-- Arabic notification templates with جوّيد instead — an inserted ي, which breaks
-- the morphology and is not a word. It is the TITLE line of most Arabic pushes
-- the academy sends, so it is the most-read Arabic string in the product, and
-- it is wrong everywhere a family sees the brand outside the app.
--
-- Where it came from (every one of them already applied somewhere):
--   20260905093100_chat_communication_config  title of class_reminder,
--       schedule_change, renewal_reminder, payment_reminder, pending_approval,
--       approval_decision, group_call_started
--   20261014160000_chat_push_privacy_templates  title of new_message and
--       group_call_started; BODY of incoming_call and missed_call
--       («مكالمة واردة على جوّيد.», «فاتتك مكالمة على جوّيد.»)
--   20261018140000_chat_pd011_scheduling  title of lesson_reminder_tomorrow,
--       lesson_reminder_soon, lesson_reminder_teacher
--
-- WHY A NEW MIGRATION RATHER THAN AN EDIT
--
-- Those migrations are applied, and scripts/db/apply.sh skips any version
-- recorded in chat.schema_migrations. Correcting a seed in place would fix
-- nothing that already exists and leave the repository asserting something the
-- database does not say. The correction is forward-only; the seeds keep their
-- original text as history.
--
-- WHY AN UPDATE RATHER THAN A NEW TEMPLATE VERSION
--
-- A content change gets a new version (20261014160000's convention), so the old
-- text comes back if the new version is deactivated. A misspelling is not
-- content anybody would want back: correcting EVERY version, active or not,
-- means no rollback that reactivates an earlier version can resurrect it. The
-- 20261014160000 rollback matches its rows on either spelling for this reason.
--
-- SCOPE
--
-- Replaces the misspelt token, and only it, in the title and body of every
-- template row that contains it. English rows cannot match (the token is
-- Arabic). Placeholders, other words and the version history are untouched; no
-- schema changes. Re-running it matches nothing, so it is idempotent.

do $pre$
begin
  if to_regclass('chat.notification_template') is null then
    raise exception 'brand name precondition failed: chat.notification_template missing';
  end if;
end
$pre$;

update chat.notification_template
   set title = replace(title, 'جوّيد', 'جَوِّد'),
       body  = replace(body,  'جوّيد', 'جَوِّد')
 where strpos(title, 'جوّيد') > 0
    or strpos(body,  'جوّيد') > 0;

-- Prove it: no template, in any version, still carries the misspelling.
do $assert$
declare
  v_bad text;
begin
  select string_agg(key || '/' || locale || '/v' || version, ', ') into v_bad
    from chat.notification_template
   where strpos(title, 'جوّيد') > 0 or strpos(body, 'جوّيد') > 0;
  if v_bad is not null then
    raise exception 'brand name: template still misspells جَوِّد: %', v_bad;
  end if;
end
$assert$;
