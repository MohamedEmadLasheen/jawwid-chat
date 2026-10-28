/**
 * Deterministic shuffling for games (#16). The old games shuffled inside render,
 * so the choices moved under the child's finger after every tap. Here a round's
 * order is computed ONCE (into state) from a seed, and answers are compared by
 * ayah number, never by position or text.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy (Fisher-Yates); never the original order when the items allow another. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const next = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  if (out.length > 1 && out.every((x, i) => x === items[i])) [out[0], out[1]] = [out[1]!, out[0]!];
  return out;
}

/** A fresh seed for each visit, so a child does not learn one fixed order. */
export function visitSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/**
 * The ayat a game asks about, round by round: consecutive windows that together
 * cover EVERY ayah of the surah (the old games only ever used the first few).
 */
export function rounds(ayahCount: number, size = 5): number[][] {
  const out: number[][] = [];
  for (let start = 1; start <= ayahCount; start += size) {
    const window: number[] = [];
    for (let a = start; a < start + size && a <= ayahCount; a++) window.push(a);
    out.push(window);
  }
  // A last window of one ayah cannot be ordered: join it to the one before.
  if (out.length > 1 && out[out.length - 1]!.length === 1) out[out.length - 2]!.push(...out.pop()!);
  return out;
}
