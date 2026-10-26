-- =============================================================================
-- PD-37 P1a-2: presence (online / last seen) -- one per-staff privacy switch
-- =============================================================================
--
-- Presence itself is not a business record and never touches Postgres: it is
-- a TTL'd set of connections per person in Redis (PresenceService). What the
-- database holds is the one choice a person makes about it.
--
-- WHO SEES WHOSE PRESENCE (head decisions 2026-10-26, PresencePolicy):
--   * staff <-> staff         online and last seen, inside one organization;
--   * a teacher's presence    to the super admin and the Teachers department
--                             (narrowed by PD-35's teacher scope when it is on);
--   * families and teachers   see nobody's presence, and nobody sees a family's.
--
-- hide_last_seen (WhatsApp's switch, staff only): when on, nobody sees this
-- person's last seen -- and, reciprocally, they see nobody else's. "Online"
-- stays visible either way.
--
-- Additive and idempotent.

alter table chat.staff
  add column if not exists hide_last_seen boolean not null default false;

comment on column chat.staff.hide_last_seen is
  'PD-37: hide my last seen from other staff (and, reciprocally, do not see theirs). Online stays visible.';
