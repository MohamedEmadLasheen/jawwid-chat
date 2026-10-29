/**
 * PD-44: one Dashboard figure, and the section that carries it.
 *
 * A tile is a COUNT, never a list of people: the page it links to already
 * shows the rows, to the same person, under the same scope. Each count is
 * computed inside the service that owns that page, with the same scope
 * helper, so the tile and the page cannot disagree.
 *
 * Absent is not zero. A tile the caller's department or scope does not cover
 * is left out of `tiles`; a covered, empty one is `count: 0`.
 *
 *   oldestAt  the oldest item behind the count ("oldest since ..."), or null
 *   capped    the count is a lower bound (the page's own list limit was hit)
 */
export interface DashboardTile {
  key: string;
  count: number;
  oldestAt: string | null;
  capped: boolean;
}

export interface DashboardSection {
  generatedAt: string;
  tiles: DashboardTile[];
}

export function dashboardTile(key: string, count: number, oldest: Date | null = null, capped = false): DashboardTile {
  return { key, count, oldestAt: oldest ? oldest.toISOString() : null, capped };
}

export function dashboardSection(tiles: DashboardTile[], now: Date): DashboardSection {
  return { generatedAt: now.toISOString(), tiles };
}
