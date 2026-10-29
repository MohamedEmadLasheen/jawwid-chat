-- PD-41 "Their manager" (owner decision, 2026-10-29; docs/product/pd041-certificates-design.md §15.3).
--
-- The case: the requester of record took the design themself (they also hold
-- certificates.design), uploaded it, and nobody else answers for the
-- certificate -- no active PD-33 cover, no other supervisor of the learner.
-- Owner safeguard 1 keeps the uploader from approving, so until now nobody
-- could. In exactly that case the category's overseer approves: the Operations
-- Manager for a student certificate, the Teachers Manager for a teacher one,
-- else the super admin (who holds every key). The uploader still never does.
--
-- No table changes. Two functions are replaced, each with its body word for
-- word apart from one branch (apps/api/test/unit/migrations/
-- pd041-overseer-approval-guard.spec.ts proves it):
--   chat.guard_appreciation_certificate (20261029110000): the approval condition;
--   chat.work_task_certificate_assignee (20261029235900): who reviews such a design.
-- Jawwid Core is untouched.

-- Is this the "Their manager" case for the certificate as it stands? The current
-- revision was uploaded by the requester of record, who still answers for it
-- (chat.certificate_responsible), and nobody else who answers for it could
-- approve it: the learner's other supervisor, or an active PD-33 cover of
-- whoever answers -- live, holding the category's request permission. Evaluated
-- at the moment of the act, by the trigger, on the locked row.
create or replace function chat.certificate_overseer_approves(p_certificate uuid)
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select coalesce((
    select c.requested_by_staff is not null
       and f.uploaded_by is not distinct from c.requested_by_staff
       and chat.certificate_responsible(c.requested_by_staff, c.id)
       and not exists (
         select 1
           from (select case when c.category = 'student' and ls.supervisor_id is not null then ls.supervisor_id
                             else c.requested_by_staff end as id) p
           cross join lateral (
             select p.id as staff_id
             union
             select b.backup_id from chat.supervisor_backup b
              where b.primary_id = p.id and chat.backup_is_active(b.primary_id, b.backup_id, now())) cand
          where cand.staff_id <> c.requested_by_staff
            and chat.certificate_live_staff(cand.staff_id, c.organization_id)
            and chat.certificate_responsible(cand.staff_id, c.id)
            and chat.staff_has_permission(cand.staff_id, chat.certificate_request_key(c.category)))
      from chat.appreciation_certificate c
      join chat.appreciation_certificate_file f on f.id = c.current_file_id
      left join chat.learner_supervision ls on ls.learner_id = c.learner_id
     where c.id = p_certificate), false);
$$;

create or replace function chat.guard_appreciation_certificate()
returns trigger
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  a        text := new.last_action;
  actor    uuid := new.last_actor_staff;
  v_learner chat.learner%rowtype;
  v_teacher chat.teacher%rowtype;
  v_type   chat.certificate_type%rowtype;
  v_file   chat.appreciation_certificate_file%rowtype;
  v_conv   record;
  v_super  uuid;
begin
  if (new.last_actor_staff is null) = (new.last_actor_teacher is null) then
    raise exception 'a certificate act names exactly one actor' using errcode = 'check_violation';
  end if;
  if actor is not null and not chat.certificate_live_staff(actor, new.organization_id) then
    raise exception 'a certificate act is done by live staff of its organization' using errcode = 'insufficient_privilege';
  end if;
  if a in ('returned', 'redesign_requested', 'approval_withdrawn', 'declined', 'cancelled', 'consent_withdrawn')
     and length(btrim(coalesce(new.last_note, ''))) < 10 then
    raise exception 'this act says why, in at least 10 characters' using errcode = 'check_violation';
  end if;

  -- -------------------------------------------------------------------------
  if tg_op = 'INSERT' then
    if new.action_seq <> 1 or new.state is distinct from a or a not in ('proposed', 'requested') then
      raise exception 'a certificate is born proposed or requested, by its first act' using errcode = 'check_violation';
    end if;
    if (new.assigned_designer_id, new.current_file_id, new.approved_file_id, new.sent_at, new.story_id, new.cancelled_at,
        new.decided_by, new.conversation_id, new.sent_message_id)
       is distinct from (null::uuid, null::uuid, null::uuid, null::timestamptz, null::uuid, null::timestamptz,
                         null::uuid, null::uuid, null::uuid) then
      raise exception 'a new certificate has no design, file, delivery or decision yet' using errcode = 'check_violation';
    end if;
    if new.type_id is not null then
      select * into v_type from chat.certificate_type where id = new.type_id;
      if v_type.organization_id is distinct from new.organization_id or v_type.category is distinct from new.category then
        raise exception 'a certificate''s type is one of its organization and category' using errcode = 'check_violation';
      end if;
      if not v_type.is_active then
        raise exception 'this certificate type is disabled' using errcode = 'check_violation';
      end if;
      if v_type.needs_juz and new.juz is null then
        raise exception 'this certificate type needs the Juz''' using errcode = 'check_violation';
      end if;
      if v_type.needs_period is not null and new.period_start is null then
        raise exception 'this certificate type needs its period' using errcode = 'check_violation';
      end if;
    elsif a = 'requested' then
      raise exception 'a staff request names its certificate type' using errcode = 'check_violation';
    end if;
    if a = 'requested' and new.request_key is null then
      raise exception 'a staff request carries its request key' using errcode = 'check_violation';
    end if;

    if new.category = 'student' then
      select * into v_learner from chat.learner where id = new.learner_id;
      if v_learner.organization_id is distinct from new.organization_id then
        raise exception 'a certificate and its learner share one organization' using errcode = 'insufficient_privilege';
      end if;
      if new.signatory_teacher_id is distinct from v_learner.teacher_id then
        raise exception 'a student certificate is signed by the learner''s teacher' using errcode = 'check_violation';
      end if;
    else
      select * into v_teacher from chat.teacher where id = new.recipient_teacher_id;
      if v_teacher.organization_id is distinct from new.organization_id or not v_teacher.is_active then
        raise exception 'a teacher certificate is for a live teacher of its organization' using errcode = 'check_violation';
      end if;
    end if;

    if a = 'proposed' then
      -- PD-12: the learner's assigned teacher suggests it.
      select * into v_teacher from chat.teacher where id = new.last_actor_teacher;
      if new.category <> 'student' or new.suggested_by_teacher is distinct from new.last_actor_teacher
         or v_learner.teacher_id is distinct from new.suggested_by_teacher
         or v_teacher.organization_id is distinct from new.organization_id or not v_teacher.is_active or v_teacher.left_at is not null then
        raise exception 'a certificate is suggested by the learner''s live, assigned teacher' using errcode = 'insufficient_privilege';
      end if;
    else
      if new.requested_by_staff is distinct from actor or new.suggested_by_teacher is not null
         or not chat.staff_has_permission(actor, chat.certificate_request_key(new.category)) then
        raise exception 'a certificate is requested by staff holding its category''s request permission' using errcode = 'insufficient_privilege';
      end if;
      -- PD-8 reach: a student certificate is requested by staff who act for the child's supervisor
      -- (or an overseer). PD-35's teacher scope is a runtime switch, so the API applies it.
      if new.category = 'student'
         and chat.staff_acts_for(actor, (select ls.supervisor_id from chat.learner_supervision ls where ls.learner_id = new.learner_id), now()) is null
         and not chat.staff_has_permission(actor, 'certificates.oversee') then
        raise exception 'a student certificate is requested by staff who reach the learner' using errcode = 'insufficient_privilege';
      end if;
    end if;
    new.requested_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- -------------------------------------------------------------------------
  -- UPDATE: exactly one new act.
  if new.action_seq <> old.action_seq + 1 then
    raise exception 'every certificate write is one act (action_seq + 1)' using errcode = 'check_violation';
  end if;
  if not chat.certificate_transition_ok(a, old.state, new.state) then
    raise exception 'a certificate does not move from % to % by %', old.state, new.state, a using errcode = 'check_violation';
  end if;
  if (new.id, new.organization_id, new.category, new.learner_id, new.recipient_teacher_id, new.suggested_by_teacher,
      new.signatory_teacher_id, new.request_key, new.requested_at)
     is distinct from
     (old.id, old.organization_id, old.category, old.learner_id, old.recipient_teacher_id, old.suggested_by_teacher,
      old.signatory_teacher_id, old.request_key, old.requested_at) then
    raise exception 'who a certificate is for, and who asked, is written once' using errcode = 'check_violation';
  end if;
  if new.request_message_id is distinct from old.request_message_id then
    raise exception 'a suggestion is born with its request card' using errcode = 'check_violation';
  end if;
  -- The request's words change only by an edit (owner safeguard 2's history keeps them).
  if a not in ('edited', 'accepted') and (new.type_id, new.title, new.achievement, new.achieved_on, new.grade, new.printed_name, new.internal_note,
      new.designer_note, new.juz, new.period_start, new.period_end, new.publish_story)
     is distinct from (old.type_id, old.title, old.achievement, old.achieved_on, old.grade, old.printed_name, old.internal_note,
      old.designer_note, old.juz, old.period_start, old.period_end, old.publish_story) then
    raise exception 'what a certificate request says changes only by an edit' using errcode = 'check_violation';
  end if;
  if a in ('edited', 'accepted') then
    if new.publish_story is distinct from old.publish_story and old.story_id is not null then
      raise exception 'a certificate that had its Story keeps its Story choice' using errcode = 'check_violation';
    end if;
    select * into v_type from chat.certificate_type where id = new.type_id;
    if new.type_id is distinct from old.type_id
       and (v_type.organization_id is distinct from new.organization_id or v_type.category is distinct from new.category or not v_type.is_active) then
      raise exception 'a certificate''s type is an active one of its organization and category' using errcode = 'check_violation';
    end if;
    if v_type.id is not null and ((v_type.needs_juz and new.juz is null) or (v_type.needs_period is not null and new.period_start is null)) then
      raise exception 'this certificate type needs its Juz'' or period' using errcode = 'check_violation';
    end if;
  end if;
  if new.requested_by_staff is distinct from old.requested_by_staff and not (a = 'accepted' and old.requested_by_staff is null) then
    raise exception 'a certificate''s requester is set once, when a suggestion is accepted' using errcode = 'check_violation';
  end if;
  if (new.decided_by, new.decided_at, new.decline_reason) is distinct from (old.decided_by, old.decided_at, old.decline_reason)
     and a not in ('accepted', 'declined') then
    raise exception 'a suggestion is decided once' using errcode = 'check_violation';
  end if;
  if (new.assigned_designer_id, new.design_started_at) is distinct from (old.assigned_designer_id, old.design_started_at)
     and a not in ('started', 'released') then
    raise exception 'the designer is set by start and cleared by release' using errcode = 'check_violation';
  end if;
  if new.current_file_id is distinct from old.current_file_id and a <> 'file_uploaded' then
    raise exception 'the current file changes only by an upload' using errcode = 'check_violation';
  end if;
  if (new.approved_file_id, new.approved_by, new.approved_at) is distinct from (old.approved_file_id, old.approved_by, old.approved_at)
     and a not in ('approved', 'approval_withdrawn') then
    raise exception 'an approval is given or withdrawn, never edited' using errcode = 'check_violation';
  end if;
  if (new.sent_at, new.sent_by, new.conversation_id, new.sent_message_id, new.type_label_en, new.type_label_ar) is distinct from
     (old.sent_at, old.sent_by, old.conversation_id, old.sent_message_id, old.type_label_en, old.type_label_ar) and a <> 'sent' then
    raise exception 'a certificate is sent once' using errcode = 'check_violation';
  end if;
  if (new.story_id, new.story_published_at, new.story_published_by) is distinct from
     (old.story_id, old.story_published_at, old.story_published_by) and not (a = 'story_published' and old.story_id is null) then
    raise exception 'a certificate''s Story is published once' using errcode = 'check_violation';
  end if;
  if new.story_withdrawn_at is distinct from old.story_withdrawn_at and not (a = 'story_withdrawn' and old.story_withdrawn_at is null) then
    raise exception 'a certificate''s Story is withdrawn once' using errcode = 'check_violation';
  end if;
  if (new.cancelled_by, new.cancelled_at, new.cancel_reason) is distinct from (old.cancelled_by, old.cancelled_at, old.cancel_reason)
     and a <> 'cancelled' then
    raise exception 'a certificate is cancelled once' using errcode = 'check_violation';
  end if;
  if new.return_message is distinct from old.return_message and a not in ('returned', 'redesign_requested', 'approval_withdrawn') then
    raise exception 'the return message is written by a return' using errcode = 'check_violation';
  end if;
  if a <> 'proposed' and new.last_actor_teacher is not null then
    raise exception 'after the suggestion, a certificate is acted on by staff' using errcode = 'insufficient_privilege';
  end if;

  -- Who may do each act, and what it must leave behind.
  case a
    when 'accepted', 'declined' then
      -- Owner safeguard 5: the learner's assigned Operations supervisor, or their active cover.
      -- A learner nobody supervises: the Operations manager (an overseer) decides.
      select ls.supervisor_id into v_super from chat.learner_supervision ls where ls.learner_id = new.learner_id;
      if not chat.staff_has_permission(actor, 'certificates.request.student')
         or not (case when v_super is null then chat.staff_has_permission(actor, 'certificates.oversee')
                      else chat.certificate_acts_as(actor, v_super) end) then
        raise exception 'a teacher''s suggestion is decided by the learner''s Operations supervisor' using errcode = 'insufficient_privilege';
      end if;
      if new.decided_by is distinct from actor or new.decided_at is null then
        raise exception 'the decision names who made it' using errcode = 'check_violation';
      end if;
      if a = 'accepted' and (new.requested_by_staff is distinct from actor or new.type_id is null) then
        raise exception 'an accepted suggestion is owned by who accepted it, with its type' using errcode = 'check_violation';
      end if;
      if a = 'declined' and new.decline_reason is null then
        raise exception 'a declined suggestion has its reason' using errcode = 'check_violation';
      end if;
    when 'started', 'returned', 'file_uploaded' then
      if not chat.staff_has_permission(actor, 'certificates.design') then
        raise exception 'only a designer designs, uploads and returns a certificate' using errcode = 'insufficient_privilege';
      end if;
      if a = 'started' and (new.assigned_designer_id is distinct from actor or new.design_started_at is null) then
        raise exception 'a design is started by the designer who takes it' using errcode = 'check_violation';
      end if;
      if a = 'returned' then
        if old.state = 'in_design' and old.assigned_designer_id is distinct from actor then
          raise exception 'a design is returned by the designer working on it' using errcode = 'insufficient_privilege';
        end if;
        if new.return_message is distinct from new.last_note then
          raise exception 'a return keeps its message' using errcode = 'check_violation';
        end if;
      end if;
      if a = 'file_uploaded' then
        if old.assigned_designer_id is distinct from actor then
          raise exception 'a file is uploaded by the designer working on it' using errcode = 'insufficient_privilege';
        end if;
        select * into v_file from chat.appreciation_certificate_file where id = new.current_file_id;
        if v_file.certificate_id is distinct from new.id or v_file.uploaded_by is distinct from actor
           or v_file.revision <= coalesce((select revision from chat.appreciation_certificate_file where id = old.current_file_id), 0) then
          raise exception 'an upload is a newer revision of this certificate, by its designer' using errcode = 'check_violation';
        end if;
      end if;
    when 'released' then
      if not ((old.assigned_designer_id is not distinct from actor and chat.staff_has_permission(actor, 'certificates.design'))
              or chat.staff_has_permission(actor, 'certificates.oversee')) then
        raise exception 'a design is released by its designer or an overseer' using errcode = 'insufficient_privilege';
      end if;
      if new.assigned_designer_id is not null then
        raise exception 'a released design has no designer' using errcode = 'check_violation';
      end if;
    when 'edited', 'resubmitted', 'approved', 'redesign_requested', 'approval_withdrawn' then
      if not (chat.certificate_responsible(actor, new.id)
              -- PD-41 "Their manager" (owner, 2026-10-29): when the requester uploaded the design
              -- themself and nobody else answers for it, the category's overseer approves.
              or (a = 'approved' and chat.staff_has_permission(actor, 'certificates.oversee')
                  and chat.certificate_overseer_approves(new.id)))
         or not chat.staff_has_permission(actor, chat.certificate_request_key(new.category)) then
        raise exception 'only the requester of record does this' using errcode = 'insufficient_privilege';
      end if;
      if a = 'approved' then
        -- Owner safeguard 1: the reviewer approves THIS revision, and is not who uploaded it.
        select * into v_file from chat.appreciation_certificate_file where id = new.current_file_id;
        if new.approved_file_id is distinct from new.current_file_id or new.approved_by is distinct from actor or new.approved_at is null then
          raise exception 'an approval names the revision and the reviewer' using errcode = 'check_violation';
        end if;
        if v_file.uploaded_by is not distinct from actor then
          raise exception 'the person who uploaded a design does not approve it' using errcode = 'insufficient_privilege';
        end if;
      end if;
      if a = 'approval_withdrawn' and (new.approved_file_id, new.approved_by, new.approved_at) is distinct from (null::uuid, null::uuid, null::timestamptz) then
        raise exception 'a withdrawn approval is cleared' using errcode = 'check_violation';
      end if;
      if a in ('redesign_requested', 'approval_withdrawn') and new.return_message is distinct from new.last_note then
        raise exception 'a redesign keeps its message' using errcode = 'check_violation';
      end if;
    when 'sent' then
      if not chat.certificate_responsible(actor, new.id) or not chat.staff_has_permission(actor, 'certificates.deliver') then
        raise exception 'only the requester of record sends a certificate' using errcode = 'insufficient_privilege';
      end if;
      if new.sent_by is distinct from actor or new.approved_file_id is distinct from new.current_file_id then
        raise exception 'the approved revision is sent, by its sender' using errcode = 'check_violation';
      end if;
      select id, type, learner_id, supervised_teacher_id, organization_id, archived_at into v_conv
        from chat.conversation where id = new.conversation_id;
      if v_conv.id is null or v_conv.organization_id <> new.organization_id or v_conv.archived_at is not null
         or not (
           (new.category = 'student' and ((v_conv.type = 'student_group' and v_conv.learner_id = new.learner_id)
             or (v_conv.type = 'family_group' and exists (
                   select 1 from chat.conversation_learner cl where cl.conversation_id = v_conv.id and cl.learner_id = new.learner_id))))
           or (new.category = 'teacher' and v_conv.type = 'teacher_supervision' and v_conv.supervised_teacher_id = new.recipient_teacher_id)) then
        raise exception 'a certificate is sent into a live group of its recipient' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from chat.message msg where msg.id = new.sent_message_id and msg.conversation_id = new.conversation_id) then
        raise exception 'a sent certificate points at its card in that group' using errcode = 'check_violation';
      end if;
      if new.type_id is not null and not exists (select 1 from chat.certificate_type t where t.id = new.type_id
                                                    and t.label_en = new.type_label_en and t.label_ar = new.type_label_ar) then
        raise exception 'a sent certificate keeps its type''s labels as they read when it was sent' using errcode = 'check_violation';
      end if;
    when 'consent_granted', 'consent_withdrawn' then
      if not chat.certificate_responsible(actor, new.id) or not chat.staff_has_permission(actor, 'certificates.story') then
        raise exception 'only the requester of record records consent' using errcode = 'insufficient_privilege';
      end if;
      if not exists (select 1 from chat.certificate_story_consent sc where sc.certificate_id = new.id and sc.recorded_by = actor
                        and sc.kind = substr(a, 9) and sc.action_seq = new.action_seq) then
        raise exception 'a consent act records its consent row, written first under the same act' using errcode = 'check_violation';
      end if;
    when 'story_published', 'story_withdrawn' then
      if not chat.certificate_responsible(actor, new.id) or not chat.staff_has_permission(actor, 'certificates.story') then
        raise exception 'only the requester of record publishes a Story' using errcode = 'insufficient_privilege';
      end if;
      if a = 'story_published' then
        -- Owner safeguards 3 and 4: opted in, approved, and (for a student) consented.
        if not new.publish_story or new.story_published_by is distinct from actor then
          raise exception 'a Story is published only for a request that opted in, by its publisher' using errcode = 'check_violation';
        end if;
        if (select story_needs_consent from chat.certificate_category where key = new.category)
           and not chat.certificate_consent_granted(new.id) then
          raise exception 'a student certificate''s Story needs the family''s recorded consent' using errcode = 'check_violation';
        end if;
      end if;
    when 'cancelled' then
      -- An undecided suggestion is cancelled only by an overseer (it has no requester yet).
      if not ((old.state <> 'proposed' and chat.certificate_responsible(actor, new.id)
               and chat.staff_has_permission(actor, chat.certificate_request_key(new.category)))
              or chat.staff_has_permission(actor, 'certificates.oversee')) then
        raise exception 'a certificate is cancelled by its requester or an overseer' using errcode = 'insufficient_privilege';
      end if;
      if new.cancelled_by is distinct from actor or new.cancel_reason is distinct from new.last_note then
        raise exception 'a cancellation names who and why' using errcode = 'check_violation';
      end if;
    else
      raise exception 'unknown certificate act %', a using errcode = 'check_violation';
  end case;

  new.updated_at := now();
  return new;
end;
$$;

-- PD-47's step routing follows: the review of a design its requester uploaded,
-- with nobody else to answer for it, is the overseer's step (it was the
-- uploader's, who could only ask for a redesign or cancel). The sweep reroutes
-- the steps already open. Replaced with its 20261029235900 body word for word,
-- apart from that branch (the same spec proves it).
create or replace function chat.work_task_certificate_assignee(p_certificate uuid)
returns uuid
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  c          chat.appreciation_certificate;
  v_sup      uuid;
  v_overseer uuid;
  v_req      uuid;
  v_uploader uuid;
begin
  select * into c from chat.appreciation_certificate where id = p_certificate;
  if c.id is null then
    return null;
  end if;
  select ls.supervisor_id into v_sup from chat.learner_supervision ls where ls.learner_id = c.learner_id;
  if chat.task_principal_kind(v_sup, c.organization_id) is distinct from 'staff' then
    v_sup := null;
  end if;
  v_overseer := chat.work_task_certificate_overseer(c.id);
  if c.state = 'proposed' then
    return coalesce(v_sup, v_overseer);
  elsif c.state = 'requested' then
    return coalesce(chat.work_task_sole_designer(c.organization_id), v_overseer);
  elsif c.state = 'in_design' then
    return coalesce(case when chat.task_principal_kind(c.assigned_designer_id, c.organization_id) = 'staff' then c.assigned_designer_id end,
                    v_overseer);
  elsif c.state in ('changes_requested', 'uploaded', 'approved') then
    v_req := coalesce(case when c.category = 'student' then v_sup end,
                      case when chat.task_principal_kind(c.requested_by_staff, c.organization_id) = 'staff' then c.requested_by_staff end,
                      v_overseer);
    if c.state = 'uploaded' then
      -- PD-41: whoever uploaded a design never approves it. A requester who
      -- uploaded it themselves is reviewed by their active PD-33 cover, who
      -- acts as them (chat.certificate_acts_as). With none, PD-41 "Their
      -- manager" (owner, 2026-10-29): the category's overseer reviews it.
      select f.uploaded_by into v_uploader from chat.appreciation_certificate_file f where f.id = c.current_file_id;
      if v_uploader is not distinct from v_req then
        if chat.certificate_overseer_approves(c.id) then
          -- An overseer who uploaded it themself does not review it either: the super admin does.
          return coalesce(nullif(v_overseer, v_uploader), nullif(chat.work_task_super_admin(c.organization_id), v_uploader), v_req);
        end if;
        return coalesce(
          (select s.id from chat.staff s
            where s.organization_id = c.organization_id and s.id <> v_req and s.is_active and s.left_at is null
              and chat.backup_is_active(v_req, s.id, now())
            order by s.id
            limit 1),
          v_req);
      end if;
    end if;
    return v_req;
  end if;
  return null;
end;
$$;

revoke all on function chat.certificate_overseer_approves(uuid) from public;
