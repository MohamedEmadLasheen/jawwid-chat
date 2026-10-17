/**
 * Stories — the authorization decisions, exercised directly.
 *
 * These are the PRIMARY control. RLS on the story tables is defence in depth and
 * is inert on the API path today (docs/security/RLS-STRATEGY.md section 1), so if
 * a verdict here is wrong, nothing downstream catches it. That is why publishing,
 * reading and viewer-list access each get their own decision function and their
 * own tests, rather than one `canUseStories`.
 *
 * Pure: no database, no fixtures on disk, no clock. They pass or fail on the
 * decision alone, which is what makes them meaningful as a role matrix.
 */
import { CommErrorCode } from '@platform/errors';
import { StoryAudienceKind, UNSCOPED_STORY_AUDIENCE_KINDS } from '@communication/contracts/vocab';
import { familyMatchesSegment, parseSegmentFilter } from '@communication/stories/story-audience.resolver';
import {
  academicStaff,
  admin,
  authzWithOnDuty,
  financeStaff,
  manager,
  parent,
  teacher,
} from '../../support/fixtures';

const authz = authzWithOnDuty();

/** `coverage` is a family-facing role; the fixtures build one from admin(). */
const coverageAdmin = () => admin('coverage-1', 'coverage');

describe('who may publish a story', () => {
  it('admin, coverage and manager may — the family-facing roles, and exactly them', () => {
    for (const actor of [admin(), coverageAdmin(), manager()]) {
      expect(authz.canPublishStory(actor).allowed).toBe(true);
    }
  });

  it('department staff may not, even though they are real staff', () => {
    for (const actor of [financeStaff(), academicStaff()]) {
      const d = authz.canPublishStory(actor);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_CANNOT_PUBLISH);
    }
  });

  it('a parent may not', () => {
    const d = authz.canPublishStory(parent());
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_CANNOT_PUBLISH);
  });

  it('a teacher may not', () => {
    const d = authz.canPublishStory(teacher());
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_CANNOT_PUBLISH);
  });

  it('a DEACTIVATED admin may not — checked before the role, so a stale row cannot publish', () => {
    const d = authz.canPublishStory({ ...admin(), isActive: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('an admin with NO organization may not publish — an unscoped audience is not a narrow one', () => {
    // `orgScope()` omits its WHERE clause for an actor with no organization,
    // which would turn `all_families` into every contact in the database. No real
    // actor is in that state (IdentityService requires the column), so this
    // refuses a state the identity layer does not produce -- because the
    // alternative shape, a filter that silently disappears, fails OPEN.
    const d = authz.canPublishStory({ ...admin(), organizationId: undefined });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_CANNOT_PUBLISH);
  });

  it('the super admin may (owner decision 2026-10-17: the Admin Portal publishes)', () => {
    // super_admin is a real role since PD-5 and has full write since PD-8; the
    // Admin Portal's Stories page is its publishing surface.
    expect(authz.canPublishStory(admin('x', 'super_admin')).allowed).toBe(true);
    const d = authz.canPublishStory({ ...admin('x', 'super_admin'), isActive: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('there is no staff role named coverage_admin to grant it to', () => {
    // The ABANDONED Phase 5 lineage's role name. If it ever resolves to a
    // publisher, somebody has reintroduced a second role vocabulary that no
    // other part of this product knows about.
    expect(authz.canPublishStory(admin('x', 'coverage_admin')).allowed).toBe(false);
  });
});

describe('who may manage family audience data (country, plan)', () => {
  it('the super admin and managers may', () => {
    for (const actor of [admin('x', 'super_admin'), manager()]) {
      expect(authz.canManageStoryAudienceData(actor).allowed).toBe(true);
    }
  });

  it('a supervisor publishes by it but may not edit it; nobody else may either', () => {
    for (const actor of [admin(), coverageAdmin(), financeStaff(), parent(), teacher()]) {
      const d = authz.canManageStoryAudienceData(actor);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_AUDIENCE_DATA_DENIED);
    }
    expect(authz.canPublishStory(admin()).allowed).toBe(true);
  });

  it('a deactivated manager may not', () => {
    const d = authz.canManageStoryAudienceData({ ...manager(), isActive: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });
});

describe('the segment audience filter', () => {
  it('accepts the three user types with no narrowing', () => {
    for (const who of ['everyone', 'families', 'teachers']) {
      expect(parseSegmentFilter({ who })).toEqual({ who, planMonths: [], children: [], countries: [] });
    }
  });

  it('accepts and de-duplicates the family dimensions', () => {
    expect(
      parseSegmentFilter({ who: 'families', planMonths: [6, 6, 12], children: [1, 4], countries: ['AE', 'KW'] }),
    ).toEqual({ who: 'families', planMonths: [6, 12], children: [1, 4], countries: ['AE', 'KW'] });
  });

  it('refuses a family dimension on "everyone" or "teachers" -- it would silently drop every teacher', () => {
    expect(() => parseSegmentFilter({ who: 'everyone', countries: ['AE'] })).toThrow(/families only/);
    expect(() => parseSegmentFilter({ who: 'teachers', planMonths: [1] })).toThrow(/families only/);
  });

  it('refuses unknown values and unknown fields, loudly', () => {
    const bad: unknown[] = [
      null, [], 'families', { who: 'students' }, { who: 'families', planMonths: [2] },
      { who: 'families', children: [0] }, { who: 'families', children: [5] },
      { who: 'families', countries: ['uae'] }, { who: 'families', countries: ['ae'] },
      { who: 'families', region: 'gcc' },
    ];
    for (const raw of bad) {
      try {
        parseSegmentFilter(raw);
        throw new Error(`accepted ${JSON.stringify(raw)}`);
      } catch (e) {
        expect((e as { code?: string }).code).toBe(CommErrorCode.STORY_AUDIENCE_INVALID);
      }
    }
  });

  it('matches a family on every dimension at once, and an unrecorded fact matches no filter on it', () => {
    const f = parseSegmentFilter({ who: 'families', planMonths: [6], children: [2, 4], countries: ['AE'] });
    expect(familyMatchesSegment(f, { countryCode: 'AE', subscriptionPlanMonths: 6, childCount: 2 })).toBe(true);
    expect(familyMatchesSegment(f, { countryCode: 'AE', subscriptionPlanMonths: 6, childCount: 7 })).toBe(true);
    expect(familyMatchesSegment(f, { countryCode: 'KW', subscriptionPlanMonths: 6, childCount: 2 })).toBe(false);
    expect(familyMatchesSegment(f, { countryCode: 'AE', subscriptionPlanMonths: 3, childCount: 2 })).toBe(false);
    expect(familyMatchesSegment(f, { countryCode: 'AE', subscriptionPlanMonths: 6, childCount: 3 })).toBe(false);
    expect(familyMatchesSegment(f, { countryCode: null, subscriptionPlanMonths: 6, childCount: 2 })).toBe(false);
    expect(familyMatchesSegment(f, { countryCode: 'AE', subscriptionPlanMonths: null, childCount: 2 })).toBe(false);
    expect(familyMatchesSegment(f, { countryCode: 'AE', subscriptionPlanMonths: 6, childCount: 0 })).toBe(false);
  });

  it('an empty filter matches every family, including ones with no recorded facts', () => {
    const f = parseSegmentFilter({ who: 'families' });
    expect(familyMatchesSegment(f, { countryCode: null, subscriptionPlanMonths: null, childCount: 0 })).toBe(true);
  });
});

describe('who may read a story feed', () => {
  it('a parent, a teacher and staff all may — WHICH stories is a different question', () => {
    for (const actor of [parent(), teacher(), admin(), financeStaff()]) {
      expect(authz.canReadStories(actor).allowed).toBe(true);
    }
  });

  it('a contact who may not communicate has no feed', () => {
    const d = authz.canReadStories({ ...parent(), canMessage: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_CANNOT_READ);
  });

  it('a deactivated actor has no feed', () => {
    const d = authz.canReadStories({ ...parent(), isActive: false });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('reading is NOT permission to publish — the two verdicts are independent', () => {
    // The bug this guards: collapsing the two into one "stories" permission,
    // after which anybody who can see a story can post one.
    expect(authz.canReadStories(parent()).allowed).toBe(true);
    expect(authz.canPublishStory(parent()).allowed).toBe(false);
  });
});

describe('who may see WHO viewed a story', () => {
  it('a publisher may', () => {
    for (const actor of [admin(), coverageAdmin(), manager(), admin('x', 'super_admin')]) {
      expect(authz.canReadStoryViewers(actor).allowed).toBe(true);
    }
  });

  it('a RECIPIENT may not — a parent is not the owner of an academy publication', () => {
    const d = authz.canReadStoryViewers(parent());
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe(CommErrorCode.STORY_CANNOT_PUBLISH);
  });

  it('a teacher may not', () => {
    expect(authz.canReadStoryViewers(teacher()).allowed).toBe(false);
  });

  it('department staff may not', () => {
    expect(authz.canReadStoryViewers(financeStaff()).allowed).toBe(false);
  });

  it('being able to READ a feed never implies seeing a viewer list', () => {
    expect(authz.canReadStories(teacher()).allowed).toBe(true);
    expect(authz.canReadStoryViewers(teacher()).allowed).toBe(false);
  });
});

describe('the audience vocabulary matches this schema, not the abandoned lineage', () => {
  it('has no `label` kind — chat.family_label does not exist here (Phase 2)', () => {
    expect(Object.values(StoryAudienceKind)).not.toContain('label');
  });

  it('has no `group` kind — a group IS a conversation on this schema', () => {
    expect(Object.values(StoryAudienceKind)).not.toContain('group');
    expect(Object.values(StoryAudienceKind)).toContain('conversation');
  });

  it('marks exactly the four record-less kinds as unscoped', () => {
    expect([...UNSCOPED_STORY_AUDIENCE_KINDS].sort()).toEqual(
      ['all_families', 'all_teachers', 'assigned_families', 'segment'].sort(),
    );
  });

  it('every scoped kind is one the resolver can validate against a real table', () => {
    const scoped = Object.values(StoryAudienceKind).filter(
      (k) => !UNSCOPED_STORY_AUDIENCE_KINDS.has(k),
    );
    expect(scoped.sort()).toEqual(['contact', 'conversation', 'family', 'teacher'].sort());
  });
});
