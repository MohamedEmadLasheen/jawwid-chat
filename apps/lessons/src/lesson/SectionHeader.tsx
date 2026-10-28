import type { SectionId } from './stars';
import { SECTIONS } from './stars';

/** #14: the same section header on every surah, always visible, every section reachable. */
export const SECTION_LABEL: Record<SectionId, string> = {
  listen: 'الاستماع',
  verses: 'الآيات',
  order: 'رتّب الآيات',
};

export function SectionHeader({
  current,
  done,
  onSelect,
}: {
  current: SectionId;
  done: (s: SectionId) => boolean;
  onSelect: (s: SectionId) => void;
}) {
  return (
    <nav className="sections" aria-label="أقسام الدرس">
      {SECTIONS.map((s) => (
        <button
          key={s}
          type="button"
          className={s === current ? 'section section--current' : 'section'}
          aria-current={s === current ? 'step' : undefined}
          onClick={() => onSelect(s)}
        >
          {SECTION_LABEL[s]}
          {done(s) ? <span className="section__star" aria-label="نجمة"> ★</span> : null}
        </button>
      ))}
    </nav>
  );
}
