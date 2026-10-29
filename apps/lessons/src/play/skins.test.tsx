import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SKINS, SkinHeader, skinFor } from './skins';

describe('skins: decoration only (plan §C.2)', () => {
  it('rotate per surah, all four in turn', () => {
    expect([1, 2, 3, 4, 5, 112, 114].map(skinFor)).toEqual(['garden', 'sea', 'stars', 'caravan', 'garden', 'caravan', 'sea']);
    expect(new Set(Array.from({ length: 114 }, (_, i) => skinFor(i + 1)))).toEqual(new Set(SKINS));
  });

  it.each(SKINS)('%s: a picture with no text, no image, no link, hidden from screen readers; the title is the heading', (skin) => {
    const { container, getByRole } = render(<SkinHeader skin={skin} title="ألعاب سورة الإخلاص" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.textContent).toBe('');
    expect(svg.querySelectorAll('text, image, use, a, foreignObject')).toHaveLength(0);
    // Every colour comes from the skin's tokens (play.css), never a picture from elsewhere.
    for (const el of svg.querySelectorAll('*')) {
      expect(el.getAttribute('href')).toBeNull();
      expect(el.getAttribute('fill')).toBeNull();
    }
    expect(getByRole('heading', { level: 1 }).textContent).toBe('ألعاب سورة الإخلاص');
  });
});
