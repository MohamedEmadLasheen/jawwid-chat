import type { SectionId } from './stars';

/** #14: the same section header on every surah, always visible, every section reachable. */
export const SECTION_LABEL: Record<SectionId, string> = {
  listen: 'الاستماع',
  verses: 'الآيات',
  meanings: 'المعاني',
  complete: 'أكمل الآية',
  order: 'رتّب الآيات',
  quiz: 'الاختبار',
  benefits: 'الفوائد',
};

export function SectionHeader({
  sections,
  current,
  done,
  onSelect,
}: {
  sections: readonly SectionId[];
  current: SectionId;
  done: (s: SectionId) => boolean;
  onSelect: (s: SectionId) => void;
}) {
  return (
    <nav className="sections" aria-label="أقسام الدرس">
      {sections.map((s) => (
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
