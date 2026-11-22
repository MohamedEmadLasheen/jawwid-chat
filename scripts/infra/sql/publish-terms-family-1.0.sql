-- PD-58: record Terms of Use version 1.0 (family) and name it as the version in force.
-- Owner approval: 2026-11-23 (version 1.0, effective 2026-11-17, requires_reacceptance = true).
-- Values are those printed by scripts/legal/publication-manifest.py (committed pages; ledger docs/legal/published-versions.json).
-- One transaction. chat.publish_legal_version is idempotent for an identical retry and refuses a changed version.
begin;

select chat.publish_legal_version(
  'terms_family', '1.0',
  'https://admin.chat.jawwid.com/legal/ar/terms/1.0',
  'https://admin.chat.jawwid.com/legal/en/terms/1.0',
  '41f366d2eae85ac9a5750cbbeec25a935d02dee00ca3627742e98f766f18bace',
  '907d5f65b9e158a2d59f837ad7d3810df690c1e27d6cd1ba2335919c69979c4c',
  true,
  timestamptz '2026-11-17 00:00:00+00',
  null);

insert into chat.config (key, value, scope, description)
values ('legal.current.terms_family', to_jsonb('1.0'::text), 'global',
        'PD-58: the Terms of Use version in force for families')
on conflict (key) do nothing;

-- A row that already named something else is never overwritten: refuse and roll back.
do $$
begin
  if (select value from chat.config where key = 'legal.current.terms_family') is distinct from to_jsonb('1.0'::text) then
    raise exception 'legal.current.terms_family already names a different version; nothing was changed';
  end if;
end $$;

commit;
