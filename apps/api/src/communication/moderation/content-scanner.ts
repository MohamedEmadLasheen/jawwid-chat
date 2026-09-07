import {
  MatchType,
  ModerationCategory,
  ModerationSeverity,
  ScanStatus,
  SEVERITY_RANK,
} from '../contracts/vocab';

/**
 * THE CONTENT SCANNER.
 *
 * Pure: no database, no clock beyond a duration budget, no Nest. It takes text
 * and a set of rules and says what it found. Everything that makes moderation
 * a decision -- who may override it, what happens to a flagged message, who is
 * told -- lives elsewhere. That separation is why this file can be tested
 * exhaustively without a database.
 *
 * ## It never returns a boolean
 *
 * `scan()` returns matches, categories, severities and excerpts. A boolean
 * would answer "hold this?" and destroy the only information the moderator
 * actually needs: WHY. A message that shares a phone number inside a
 * cancellation request is two different problems, and a queue card that says
 * "flagged" tells its reader nothing they can act on.
 *
 * ## Arabic is a first-class input, not an edge case
 *
 * This is an Arabic-first product. Three normalisations follow from that, and
 * without them the detectors are decorative:
 *
 *   DIGITS      A phone number written ٠١٠١٢٣٤٥٦٧٨ is a phone number. Arabic
 *               Indic (U+0660..) and Extended Arabic Indic (U+06F0..) digits
 *               fold to ASCII before anything is matched.
 *   DIACRITICS  Harakat and tatweel are optional in writing, so a forbidden
 *               word with them and one without are the same word. Folded for
 *               `word` and `phrase` rules.
 *   ORTHOGRAPHY أ إ آ are written for ا, ة for ه and ى for ي, inconsistently,
 *               by everybody. Folded for `word` and `phrase` rules.
 *
 * A `regex` rule is matched against the DIGIT-folded text only. The other two
 * foldings are not applied to it, because the author of a regex wrote the
 * pattern they meant and silently rewriting their haystack would make the
 * pattern they tested stop matching what they tested it on.
 *
 * ## Offsets survive every folding
 *
 * Folding changes the length of the string (a diacritic is removed, a digit is
 * replaced). If the excerpt were sliced out of the FOLDED text, the moderator
 * would be shown text nobody wrote. Every folding therefore carries an index
 * map back to the original, and every excerpt is sliced from the original body.
 *
 * ## Failure is closed, and it is visible
 *
 * A rule that will not compile, or a scan that exceeds its time budget, does
 * NOT produce `safe`. A moderation control that did not finish has not decided
 * anything, and reporting "safe" would be reporting our own optimism. The scan
 * comes back FLAGGED with an explicit `rule_error` match, so the message waits
 * for a human and the queue says exactly why.
 */

export interface ScanRule {
  /** Null for a synthetic rule the engine itself raised. */
  readonly id: string | null;
  readonly name: string;
  readonly category: string;
  readonly severity: string;
  readonly matchType: string;
  readonly pattern: string;
}

export interface ScanMatch {
  readonly ruleId: string | null;
  readonly ruleName: string;
  readonly category: string;
  readonly severity: string;
  /** Sliced from the ORIGINAL body, bounded, so it is safe for a text column. */
  readonly excerpt: string | null;
}

export interface ScanError {
  readonly ruleId: string | null;
  readonly ruleName: string;
  readonly reason: string;
}

export interface ModerationScan {
  readonly status: ScanStatus;
  readonly matches: readonly ScanMatch[];
  /** Null exactly when nothing matched. */
  readonly highestSeverity: string | null;
  /** The distinct categories that matched, for a one-line queue summary. */
  readonly reasons: readonly string[];
  /** Rules that could not be evaluated. Non-empty implies `flagged`. */
  readonly errors: readonly ScanError[];
}

export interface ScanOptions {
  /**
   * Wall-clock budget for the WHOLE scan, in milliseconds.
   *
   * JavaScript cannot interrupt a regular expression mid-execution, so this is
   * not a guarantee that any single rule terminates -- the defences against
   * that are the shape check at write time (assertSafePattern) and the bounded
   * body. What it does guarantee is that a slow rule set cannot cascade: the
   * budget is checked between rules, and the scan stops and fails closed.
   */
  readonly budgetMs?: number;
  /** Bodies longer than this are refused rather than scanned. */
  readonly maxLength?: number;
  readonly now?: () => number;
}

const DEFAULT_BUDGET_MS = 250;
const DEFAULT_MAX_LENGTH = 4000;
const EXCERPT_MAX = 200;

/** The synthetic rule the engine raises when a real rule cannot be evaluated. */
const RULE_ERROR_NAME = 'Unevaluable moderation rule';

export const SAFE: ModerationScan = {
  status: ScanStatus.SAFE,
  matches: [],
  highestSeverity: null,
  reasons: [],
  errors: [],
};

export function scan(
  body: string | null | undefined,
  rules: readonly ScanRule[],
  options: ScanOptions = {},
): ModerationScan {
  const text = body ?? '';
  if (text.trim() === '') return SAFE;

  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const clock = options.now ?? Date.now;
  const startedAt = clock();

  // A body longer than the composer's own cap did not come from the composer.
  // Truncating it would scan part of a message and call the whole one safe, so
  // the scan is refused instead -- which fails closed, below.
  const errors: ScanError[] = [];
  if (text.length > maxLength) {
    errors.push({
      ruleId: null,
      ruleName: RULE_ERROR_NAME,
      reason: `body of ${text.length} characters exceeds the ${maxLength}-character scan limit`,
    });
    return failClosed(errors);
  }

  // Built once and shared by every rule: folding per rule would be the same
  // work repeated for each of them.
  const digits = foldDigits(text);
  const loose = foldLoosely(digits.text, digits.map);
  const compact = compactDigitRuns(digits.text, digits.map);

  const matches: ScanMatch[] = [];

  for (const rule of rules) {
    if (clock() - startedAt > budgetMs) {
      errors.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: `the scan exceeded its ${budgetMs}ms budget before this rule ran`,
      });
      break;
    }

    let hit: Hit | null;
    try {
      hit = applyRule(rule, { digits, loose, compact });
    } catch (err) {
      errors.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: err instanceof Error ? err.message : 'the rule could not be evaluated',
      });
      continue;
    }
    if (!hit) continue;

    matches.push({
      ruleId: rule.id,
      ruleName: rule.name,
      category: rule.category,
      severity: rule.severity,
      excerpt: excerptOf(text, hit.start, hit.end),
    });
  }

  if (errors.length > 0) return failClosed(errors, matches);
  if (matches.length === 0) return SAFE;

  return {
    status: ScanStatus.FLAGGED,
    matches,
    highestSeverity: highestOf(matches),
    reasons: distinctCategories(matches),
    errors: [],
  };
}

/**
 * A scan that could not finish is held, not sent.
 *
 * The synthetic match is what makes the failure OPERABLE rather than merely
 * logged: it puts the message in the queue with a reason a moderator can read,
 * at CRITICAL, so somebody notices that a control is broken instead of the
 * academy quietly moderating nothing.
 */
function failClosed(errors: ScanError[], matches: ScanMatch[] = []): ModerationScan {
  const synthetic: ScanMatch = {
    ruleId: null,
    ruleName: RULE_ERROR_NAME,
    category: ModerationCategory.CUSTOM,
    severity: ModerationSeverity.CRITICAL,
    excerpt: null,
  };
  const all = [...matches, synthetic];
  return {
    status: ScanStatus.FLAGGED,
    matches: all,
    highestSeverity: ModerationSeverity.CRITICAL,
    reasons: distinctCategories(all),
    errors,
  };
}

interface Hit {
  readonly start: number;
  readonly end: number;
}

interface Views {
  readonly digits: Folded;
  readonly loose: Folded;
  readonly compact: Folded;
}

function applyRule(rule: ScanRule, views: Views): Hit | null {
  switch (rule.matchType) {
    case MatchType.WORD:
      return matchIn(views.loose, wordRegex(rule.pattern));
    case MatchType.PHRASE:
      return matchIn(views.loose, phraseRegex(rule.pattern));
    case MatchType.REGEX: {
      // No `g` flag, so the compiled expression carries no lastIndex and can
      // safely be run against both views.
      const re = compile(rule.pattern);
      const direct = matchIn(views.digits, re);
      if (direct) return direct;
      // A phone number is routinely written with the digits spaced out --
      // "010 123 4567", "+20-10-1234-5678" -- which defeats a pattern written
      // against a run of digits. The second pass looks at the same text with
      // separators BETWEEN DIGITS removed, and only for phone rules: doing it
      // for every rule would double the work and would let an e-mail rule
      // match across a line break.
      if (rule.category === ModerationCategory.PHONE_NUMBER) {
        return matchIn(views.compact, re);
      }
      return null;
    }
    default:
      throw new Error(`unknown match type '${rule.matchType}'`);
  }
}

/** Run a regex over a folded view and map the hit back to original offsets. */
function matchIn(view: Folded, re: RegExp): Hit | null {
  const m = re.exec(view.text);
  if (!m) return null;
  const start = view.map[m.index] ?? 0;
  // The folded match's last character, mapped back, plus one -- rather than
  // mapping the end index, which points one past the end and may be off the
  // map entirely.
  const lastFolded = m.index + Math.max(m[0].length - 1, 0);
  const end = (view.map[lastFolded] ?? start) + 1;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Pattern compilation
// ---------------------------------------------------------------------------

/**
 * Compile an author-supplied pattern.
 *
 * `u` is deliberately NOT set. The Unicode flag makes several constructs that
 * are legal in a non-unicode regex into syntax errors, and the patterns here
 * are written by operations staff against a UI, not by people who will read a
 * "lone quantifier bracket" error. The engine-built patterns below DO use `u`,
 * because they need `\p{L}` and this file wrote them.
 */
function compile(pattern: string): RegExp {
  return new RegExp(pattern, 'i');
}

/**
 * A whole word, with boundaries that understand Arabic.
 *
 * `\b` is ASCII-based: in "المعلم" every position is a non-boundary to it, so a
 * `\b`-delimited Arabic token matches nothing. The lookarounds below ask the
 * real question -- "is the neighbouring character a letter or a digit in ANY
 * script" -- which is what a word boundary means.
 */
function wordRegex(token: string): RegExp {
  const t = escapeRegex(foldText(token));
  return new RegExp(`(?<![\\p{L}\\p{N}_])${t}(?![\\p{L}\\p{N}_])`, 'iu');
}

/**
 * A phrase, tolerant of how it was spaced.
 *
 * "الغاء   الاشتراك" across a line break is the same phrase as "الغاء
 * الاشتراك", and a moderation rule that missed it because somebody pressed
 * Enter would be worthless. Runs of whitespace in the pattern become "one or
 * more whitespace characters".
 */
function phraseRegex(phrase: string): RegExp {
  const parts = foldText(phrase)
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .map(escapeRegex);
  if (parts.length === 0) throw new Error('a phrase rule needs at least one word');
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${parts.join('\\s+')}(?![\\p{L}\\p{N}_])`,
    'iu',
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

/** A transformed view of the body, plus the way back to the original offsets. */
interface Folded {
  readonly text: string;
  /** map[i] = the index in the ORIGINAL string that folded character i came from. */
  readonly map: readonly number[];
}

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/**
 * Arabic Indic and Extended Arabic Indic digits to ASCII, one character for
 * one character, so this folding alone could not shift an offset -- the map is
 * built anyway so every view has the same shape.
 */
function foldDigits(text: string): Folded {
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let ch = text[i];
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      ch = String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      ch = String(code - EXTENDED_ARABIC_INDIC_ZERO);
    }
    out += ch;
    map.push(i);
  }
  return { text: out, map };
}

/**
 * Harakat (U+064B..U+0652), superscript alef (U+0670) and tatweel (U+0640).
 *
 * Written as escapes rather than as the characters themselves: these are
 * combining marks and an invisible joiner, and a literal range of them in
 * source is unreadable and easy to corrupt in an editor.
 */
const ARABIC_DIACRITIC = /[ً-ْٰـ]/;

const ORTHOGRAPHIC_FOLD: Readonly<Record<string, string>> = {
  'أ': 'ا', // أ -> ا
  'إ': 'ا', // إ -> ا
  'آ': 'ا', // آ -> ا
  'ٱ': 'ا', // ٱ -> ا
  'ة': 'ه', // ة -> ه
  'ى': 'ي', // ى -> ي
};

/**
 * The folding `word` and `phrase` rules match against: digits already folded,
 * plus diacritics dropped and the common orthographic variants unified.
 *
 * Dropping a character shifts every offset after it, which is exactly why the
 * map is carried through from the previous view rather than rebuilt.
 */
function foldLoosely(text: string, priorMap: readonly number[]): Folded {
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ARABIC_DIACRITIC.test(ch)) continue;
    out += ORTHOGRAPHIC_FOLD[ch] ?? ch;
    map.push(priorMap[i] ?? i);
  }
  return { text: out, map };
}

/** Applies the same folding to a rule's own pattern text. */
function foldText(s: string): string {
  const digits = foldDigits(s);
  return foldLoosely(digits.text, digits.map).text;
}

/** Separators that people put between the digits of a phone number. */
const DIGIT_SEPARATOR =
  /[\s\-‐-―().​-‏‪-‮⁦-⁩]/;

/**
 * Remove separators that sit BETWEEN two digits.
 *
 * "+20 10 1234 5678" becomes "+201012345678", so a pattern written against a
 * run of digits finds it. The "between two digits" condition is what keeps
 * this from mangling ordinary text: the space in "Yusuf did well" is not
 * between digits and survives, and so does the one in "surah 2 verse 5",
 * because a single digit on each side still leaves too few for any phone rule
 * to match.
 */
function compactDigitRuns(text: string, priorMap: readonly number[]): Folded {
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (
      DIGIT_SEPARATOR.test(ch) &&
      previousNonSeparatorIsDigit(text, i) &&
      nextNonSeparatorIsDigit(text, i)
    ) {
      continue;
    }
    out += ch;
    map.push(priorMap[i] ?? i);
  }
  return { text: out, map };
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/**
 * Both neighbours are found by looking PAST any run of separators, not just at
 * the adjacent character.
 *
 * "010 - 1234" is the case that makes this necessary: the dash's immediate
 * neighbours are both spaces, so an adjacent-character test would keep the dash
 * and the number would survive compaction in two pieces -- which is exactly how
 * a phone number written the way people actually write one slipped through.
 */
function previousNonSeparatorIsDigit(text: string, from: number): boolean {
  for (let j = from - 1; j >= 0; j--) {
    if (DIGIT_SEPARATOR.test(text[j])) continue;
    return isDigit(text[j]);
  }
  return false;
}

function nextNonSeparatorIsDigit(text: string, from: number): boolean {
  for (let j = from + 1; j < text.length; j++) {
    if (DIGIT_SEPARATOR.test(text[j])) continue;
    return isDigit(text[j]);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------------

/**
 * The matched text, with a little of what surrounds it.
 *
 * Bounded to 200 characters to match the CHECK on
 * chat.message_moderation_flag.matched_excerpt: a value the database would
 * refuse must never reach it.
 */
function excerptOf(original: string, start: number, end: number): string | null {
  const pad = 20;
  const from = Math.max(0, start - pad);
  const to = Math.min(original.length, end + pad);
  const slice = original.slice(from, to).trim();
  if (slice === '') return null;
  return slice.length > EXCERPT_MAX ? `${slice.slice(0, EXCERPT_MAX - 1)}…` : slice;
}

export function highestOf(matches: readonly ScanMatch[]): string | null {
  let best: string | null = null;
  for (const m of matches) {
    if (best === null || (SEVERITY_RANK[m.severity] ?? -1) > (SEVERITY_RANK[best] ?? -1)) {
      best = m.severity;
    }
  }
  return best;
}

function distinctCategories(matches: readonly ScanMatch[]): string[] {
  return [...new Set(matches.map((m) => m.category))];
}

// ---------------------------------------------------------------------------
// Pattern validation -- run when a rule is WRITTEN, never when it is applied
// ---------------------------------------------------------------------------

/**
 * The maximum a `word` or `phrase` rule may be, and the shape a `regex` rule
 * may not have.
 *
 * ON ReDoS. A pattern like `(a+)+$` takes exponential time on a non-matching
 * input, and JavaScript cannot interrupt a running regex, so a time budget
 * checked between rules is not a defence against one pathological rule. The
 * defences that actually work are, in order:
 *
 *   1. the body is bounded (communication.message_max_length, 4000), which
 *      bounds the base of the exponent;
 *   2. the pattern is bounded (512 characters, enforced by the database);
 *   3. the SHAPE check below refuses the nested-quantifier constructions that
 *      cause catastrophic backtracking, at the moment the rule is written --
 *      where a human is present to be told why;
 *   4. only manager and super_admin may write a rule at all, so the input is
 *      privileged rather than public.
 *
 * This is not a proof of termination, and it is not presented as one. It
 * refuses the constructions that cause the problem in practice and it refuses
 * them where refusing is cheap.
 */
const NESTED_QUANTIFIER = /\([^()]*[+*][^()]*\)\s*[+*{]/;
const NESTED_GROUP_QUANTIFIER = /\((?:[^()]|\([^()]*\))*\{\d+,\d*\}[^()]*\)\s*[+*{]/;
const ALTERNATION_OVERLAP = /\(([^()|]+)\|\1\)\s*[+*{]/;

export class InvalidPatternError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = 'InvalidPatternError';
  }
}

/**
 * Throws InvalidPatternError if this rule could not be applied, or should not
 * be. Called by ModerationRuleService before a rule is stored -- so a rule that
 * reaches the scanner has already been proven to compile.
 */
export function assertUsablePattern(
  matchType: string,
  pattern: string,
  maxLength: number,
): void {
  const trimmed = pattern.trim();
  if (trimmed === '') {
    throw new InvalidPatternError('a pattern cannot be empty: it would match every message');
  }
  if (pattern.length > maxLength) {
    throw new InvalidPatternError(
      `a pattern may be at most ${maxLength} characters; this one is ${pattern.length}`,
    );
  }

  if (matchType === MatchType.WORD) {
    if (/\s/.test(trimmed)) {
      throw new InvalidPatternError(
        'a word rule matches a single token; use a phrase rule for several words',
      );
    }
    wordRegex(trimmed);
    return;
  }

  if (matchType === MatchType.PHRASE) {
    phraseRegex(trimmed);
    return;
  }

  if (matchType !== MatchType.REGEX) {
    throw new InvalidPatternError(`unknown match type '${matchType}'`);
  }

  for (const shape of [NESTED_QUANTIFIER, NESTED_GROUP_QUANTIFIER, ALTERNATION_OVERLAP]) {
    if (shape.test(pattern)) {
      throw new InvalidPatternError(
        'this pattern nests one quantifier inside another, which can take ' +
          'exponential time on an input that does not match. Rewrite it without ' +
          'a repeated group inside a repeated group.',
      );
    }
  }

  try {
    compile(pattern);
  } catch (err) {
    throw new InvalidPatternError(
      `this is not a valid regular expression: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
}
