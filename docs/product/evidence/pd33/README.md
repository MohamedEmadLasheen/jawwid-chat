# PD-33 evidence: Hand over to backup

Rendered 2026-10-26 without a simulator. Every person here is synthetic (G-20).

- **Admin Web (01-08).** These are the real components and stylesheets, in a
  throwaway gallery page with the API answered in the page and realtime stubbed
  as connected. They were captured in the built-in browser at 1280x800, and the
  gallery was not committed. The behaviour behind them is proven by the specs
  listed below.
- **App (09-10).** These are widget-test renders of the real `ChatScreenRoute`,
  with the bundled IBM Plex Sans Arabic loaded. They show a parent's student
  group whose supervisor is away.

| # | What it shows |
|---|---|
| 01 / 07 | "I'm away" opens the hand-over dialog. The linked backup is pre-filled, and From, Until (quick picks) and Note follow. EN / AR. |
| 02 / 08 | The confirm summary: "12 families, 9 groups and 4 open items move to Amira Samir until 2 Nov 2026", the breakdown below it, and the away-supervisor rule. EN / AR. |
| 03 | The supervisor's home after the hand-over: an Away banner with Extend and End cover now. |
| 04 / 06 | The backup's chat. The banner reads "You're covering Noura Hassan's families", each covered row has a Covering badge, the header has the cover line, and the group has a system line. EN / AR. |
| 05 | Organization, Departments: the Operations Manager sees "Away until 3 Nov 2026" and "Amira Samir covering" with Extend and End cover now. The backup's row reads "Covering Noura Hassan until 3 Nov 2026", and the other supervisors have "Hand over to backup". |
| 09 / 10 | The parent's group. The header reads "Amira Samir is covering until Nov 3", and the thread line reads "... is covering for Noura Hassan until Nov 3". EN / AR. |

The rules behind these screens are tested in:

- `apps/api/test/integration/supervisor-cover-pd033.spec.ts`
- `apps/api/test/integration/supervisor-cover-pd033-http.spec.ts`
- `apps/admin-web/src/features/organization/HandOver.test.tsx`
- `test/features/messages/supervisor_cover_test.dart`
