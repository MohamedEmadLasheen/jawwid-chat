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

export function SectionHeader<S extends string = SectionId>({
  sections,
  current,
  done,
  onSelect,
  labels = SECTION_LABEL as Record<string, string>,
}: {
  sections: readonly S[];
  current: S;
  done: (s: S) => boolean;
  onSelect: (s: S) => void;
  /** The section names; the Quran lessons' by default. */
  labels?: Record<string, string>;
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
          {labels[s]}
          {done(s) ? <span className="section__star" aria-label="نجمة"> ★</span> : null}
        </button>
      ))}
    </nav>
  );
}
