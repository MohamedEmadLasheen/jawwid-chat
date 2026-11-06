# Child-safety escalation process

**DRAFT — requires owner and qualified legal review before adoption.**
Nothing in this document is legal advice. Where it says **OWNER / LEGAL COUNSEL TO CONFIRM**, nobody
may act on an assumption: the owner and qualified legal counsel decide.

- Written 2026-11-06 for PD-57 (closure plan `docs/release/pd57-closure-plan-2026-11-06.md`, D-1 and
  D-4). Compliance matrix: `docs/release/pd57-ugc-compliance.md` (rows R7, R10–R14).
- The software parts it relies on are **not merged yet** (PR-1, PR-2, PR-4, PR-6, PR-7). Until they are,
  a child-safety concern arrives through the family's direct conversation with the academy or a staff
  member, and this process is followed by hand.

## 1. What counts as a child-safety report

Any report filed with reason `child_safety`, and any concern about a child's safety that reaches staff
another way (a message to the academy, a call, a complaint, something a staff member sees). Examples:
sexual content involving a child; an adult seeking sexual or private contact with a child (grooming);
threats, blackmail or sextortion; a child saying they are being harmed; a request to move a child to
private contact outside the academy's channels.

## 2. Roles

| Role | Who | Notes |
|---|---|---|
| Child-safety point of contact | **[NAME, ROLE, E-MAIL, PHONE — OWNER TO SUPPLY]** | Declared in Google Play Console. Speaks for the academy on child-safety practice. Decides the report to authorities (§7) with legal counsel. |
| Deputy | **[NAME — OWNER TO SUPPLY]** | Covers absence, nights, weekends and holidays. |
| Child-safety reviewers | The Super Admin and staff holding `moderation.child_safety` (D-4) | Non-delegable; in no role template; granted one person at a time by the Super Admin. Keep the list short. |
| Legal counsel | **[FIRM / PERSON — OWNER TO SUPPLY]** | Confirms the duties in §7. |

Nobody else sees a child-safety report: not department managers, supervisors, teachers, or the
reported person (closure plan §3; any other caller gets 404).

## 3. Intake

1. Reason `child_safety` makes the report **urgent** (`priority = urgent`, enforced by the database).
   A duplicate report of the same target with `child_safety` raises the open report to urgent.
2. The report never enters a department queue. Only §2's reviewers can list, open, take or resolve it.
3. A concern that arrives another way is entered by the staff member who received it, as a report or
   by telling the point of contact at once. The staff member keeps no copy, screenshot or forward.

## 4. Immediate notification

- At filing, every Super Admin and every holder of `moderation.child_safety` gets an in-app item and a
  push. It **bypasses quiet hours** (22:00–08:00) and the hourly notification cap, and is never
  coalesced. (PR-2 and PR-4; tested by the planned quiet-hours case in `pd057-reports.spec.ts`.)
- The notification says only that an urgent child-safety report exists and links to it. It carries no
  message text, no media and no names.
- If nobody takes the report within **1 hour**, the point of contact and the deputy are phoned.
  **[Escalation phone tree — OWNER TO SUPPLY]**

## 5. Triage (target: within hours; never later than the 24 h report clock)

The reviewer who takes the report:
1. Opens the report in Admin Web. Every view is audited (`report.viewed`).
2. Views only what is needed to judge it. Media is opened through a **5-minute signed link** minted for
   that reviewer; every link is audited (`report.attachment_viewed`).
3. Decides which case it is:

```
Is a child in immediate danger (harm happening now or threatened)?
├─ YES → call local emergency services for the child's location FIRST, then tell the point of contact.
└─ NO
   Does the report involve sexual content of a child (suspected CSAM)?
   ├─ YES → §6 (CSAM) and §7 (authorities).
   └─ NO
      Is it grooming, sextortion, sexual contact-seeking, or abuse disclosed by a child?
      ├─ YES → §7 (authorities) with the point of contact; protect the child (§8).
      └─ NO → an ordinary serious conduct case: act under the Code of Conduct (§8);
              the point of contact reviews the decision.
```

4. Records the decision and its reasons in the report's resolution note (never the content itself).

## 6. Evidence preservation and suspected CSAM

Rules for everyone, always:
- **Never delete** the evidence. Removing content for users (`message_removed`, delete-for-everyone)
  hides it from users; the report keeps its evidence snapshot and the stored file.
- **Never forward, copy, screenshot, download or save** the content, to any device, chat, e-mail or
  cloud folder. Never to a personal device. Never send it to the family, the teacher or a colleague.
- **Minimal viewing**: open media only if the decision needs it; the fewest people possible; stop as
  soon as the category is clear.
- Viewing happens only through the audited, 5-minute signed links in Admin Web.

For suspected CSAM, in addition:
- **Do not view more than necessary** to recognise it. Do not try to "confirm" it by viewing it again.
- **Do not redistribute it**, even to the authorities by e-mail; the authority's own channel says how to
  submit (§7).
- **Preserve it**: keep the report, the evidence snapshot, the object in storage and the audit trail.
  Engineering places a hold on the object so retention or erasure jobs cannot remove it.
  **[Retention period and storage hold procedure — OWNER / LEGAL COUNSEL TO CONFIRM]**
- **Remove it for users** at once (`message_removed`).
- **Report it** as in §7.

## 7. Escalation to authorities where legally required

**OWNER / LEGAL COUNSEL TO CONFIRM.** This section lists typical channels. It does not state any legal
duty as fact. Which duties apply depends on where the academy is established, where the child, the
family, the teacher and the staff are, and where the data is stored.

**Jurisdictions the academy operates in** (fill in; one row each):

| Jurisdiction | Legal duty to report? To whom? Deadline? | Channel | Confirmed by (counsel, date) |
|---|---|---|---|
| [Country where the academy is established] | [TO CONFIRM] | [TO CONFIRM] | |
| [Countries of the families] | [TO CONFIRM] | [TO CONFIRM] | |
| [Countries of the teachers] | [TO CONFIRM] | [TO CONFIRM] | |
| [Country where data is hosted] | [TO CONFIRM] | [TO CONFIRM] | |

**Typical channels (for counsel to confirm per case):**
- **NCMEC CyberTipline** (United States): for cases with a US connection. Google Play's Child
  Endangerment policy refers to reporting confirmed CSAM to NCMEC or a relevant regional authority.
- **National police** and **national child-protection hotlines** in the child's country.
- **INHOPE member hotlines** (the international network of CSAM reporting hotlines), for the relevant
  country.
- **Local emergency services** when a child is in immediate danger (§5).

**Decision tree**

```
Suspected CSAM, grooming, sextortion or disclosed abuse
│
├─ 1. Point of contact informed (always), within the hour.
├─ 2. Which jurisdictions are involved? (child, adult, academy, data) → table above.
├─ 3. For each: is reporting legally required? → counsel answers. [TO CONFIRM]
│     ├─ Required → report through that channel within its deadline; record the reference number.
│     └─ Not required → counsel and owner decide whether to report voluntarily; record the decision.
├─ 4. Do not tell the reported person about the report to authorities (it may harm an investigation)
│     unless counsel says otherwise.
└─ 5. Answer the reporter in the app with a neutral text ("We have acted on your report."); never the
      details of the action.
```

Records kept outside the app (in a restricted place the owner chooses): date, who decided, the channel,
the reference number. Never the content.

## 8. Account actions

- **Suspend the subject** at once when the report is credible (`account_suspended`, which calls PD-21's
  `AccountAdminService.suspend`: sessions revoked immediately). The reviewer must also hold
  `accounts.administer`; otherwise the Super Admin does it.
- A teacher who is the subject: no lessons until the case is closed. **[HR / contract step — OWNER]**
- **Protect the child**: the family's supervisor or the department manager reassigns the lessons; the
  family's direct conversation with the academy stays open.
- Do not tell the subject who reported them. A warning (`warned`) never mentions a report.
- Ask authorities, where a report was made, before deleting or reinstating anything.

## 9. Post-incident review

Within **[N] working days — OWNER TO SET** after closing, the point of contact and the Super Admin
review: the timeline (filed, notified, taken, decided, reported); whether the 1-hour and 24-hour targets
were met; whether any rule in §6 was broken; what to change in the app, the training or this document.
The review records no content. Changes to this document go through the owner and counsel.

## 10. Open items before adoption

1. Point of contact, deputy and phone tree (§2, §4). **OWNER**
2. Jurisdictions and legal duties (§7). **OWNER / LEGAL COUNSEL**
3. Evidence retention period and storage hold (§6). **OWNER / LEGAL COUNSEL**
4. HR step for staff and teachers (§8). **OWNER**
5. Engineering: `moderation.child_safety` key, restricted visibility, quiet-hours bypass, 5-minute
   audited links (PR-1, PR-2, PR-4, PR-6; not merged). The evidence hold of §6 is **not planned in any
   PR yet**: until it exists, the Super Admin asks engineering by hand to exclude the object from
   retention and erasure.
