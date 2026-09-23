-- Jawwid Chat -- make the retention purge bounded.
--
-- chat.purge_notification_history() deleted every eligible row in one
-- statement. That is correct and unusable: on a table with a million
-- notifications the first real run takes a lock long enough to stall every
-- insert queued behind it, which turns a housekeeping job into an outage that
-- stops parents being told things. A retention sweep must never be able to do
-- more damage than the storage it reclaims.
--
-- So it now deletes at most p_batch rows per call and reports whether more
-- remain. The worker calls it on a schedule; a large backlog drains over
-- several passes instead of one long lock.

create or replace function chat.purge_notification_history(
  p_now   timestamptz default now(),
  p_batch integer     default 5000
)
returns table (
  notifications_deleted bigint,
  deliveries_deleted    bigint,
  more_remaining        boolean
)
language plpgsql
as $$
declare
  v_notifications bigint;
  v_deliveries    bigint;
  v_days          integer := chat.config_int('notification.retention_days');
  v_ann_days      integer := chat.config_int('notification.announcement_retention_days');
  v_del_days      integer := chat.config_int('notification.delivery_retention_days');
  v_ids           uuid[];
begin
  -- Select the batch ONCE, by id, and then act on exactly those rows. Re-running
  -- the predicate for the orphan step and again for the delete would let a row
  -- that became eligible in between slip into one step and not the other.
  select array_agg(id) into v_ids
  from (
    select n.id
      from chat.notification n
     where n.read_at is not null
       and n.created_at < p_now - make_interval(days => v_days)
       and (n.announcement_id is null
            or n.created_at < p_now - make_interval(days => v_ann_days))
     order by n.created_at
     limit p_batch
  ) eligible;

  v_ids := coalesce(v_ids, '{}'::uuid[]);

  -- Orphan the deliveries first so they survive their notification. They are
  -- the operational record; losing them with the notification is how "we can
  -- see it was created but not whether it ever left the building" happens.
  update chat.notification_delivery d
     set notification_id = null
   where d.notification_id = any (v_ids);

  delete from chat.notification n where n.id = any (v_ids);
  get diagnostics v_notifications = row_count;

  -- Deliveries age out on their own, longer clock, same bound.
  with gone as (
    delete from chat.notification_delivery d
     where d.id in (
       select id from chat.notification_delivery
        where created_at < p_now - make_interval(days => v_del_days)
        order by created_at
        limit p_batch
     )
    returning 1
  )
  select count(*) into v_deliveries from gone;

  return query select
    v_notifications,
    v_deliveries,
    (v_notifications >= p_batch or v_deliveries >= p_batch);
end;
$$;

comment on function chat.purge_notification_history(timestamptz, integer) is
  'User-facing retention, bounded. Never touches an UNREAD notification at any '
  'age -- an unread notification is an unmet obligation, not stale data -- and '
  'orphans delivery records rather than cascading them, so the operational '
  'trail outlives the notification it describes. Returns more_remaining so a '
  'backlog drains over several passes instead of one long lock.';

-- The single-argument form the earlier migration created would otherwise remain
-- as a second overload, and a caller would get whichever one PostgreSQL chose.
drop function if exists chat.purge_notification_history(timestamptz);
