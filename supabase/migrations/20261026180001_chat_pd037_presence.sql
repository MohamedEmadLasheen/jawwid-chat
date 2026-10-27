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

-- GET /presence answers for up to 100 people a question; bound how often one
-- actor may ask (docs/security/ABUSE-LIMITS.md).
insert into chat.config (key, value, scope, description) values
('abuse.throttle.presence_read_actor', '60'::jsonb, 'abuse',
 '[hypothesis] PD-37: presence questions (GET /presence) one actor may ask per window. A client asks on opening a chat or the team list; one a second sustained is far above that.')
on conflict (key) do nothing;
