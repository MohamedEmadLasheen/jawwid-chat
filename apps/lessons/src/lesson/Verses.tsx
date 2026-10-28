import type { Ayah } from '../quran/dataset';

const arabicDigits = (n: number) => n.toLocaleString('ar-EG');

/** The verified text, ayah by ayah. The Basmala is drawn on its own line above ayah 1, never numbered. */
export function Verses({
  ayahs,
  selected,
  playing,
  onSelect,
}: {
  ayahs: Ayah[];
  selected: number | null;
  playing: number | null;
  onSelect?: (ayah: number) => void;
}) {
  const basmala = ayahs[0]?.basmala ?? null;
  return (
    <div className="mushaf">
      {basmala ? <p className="basmala">{basmala}</p> : null}
      <ol className="ayat">
        {ayahs.map((a) => (
          <li
            key={a.ayah}
            className={[a.ayah === selected ? 'ayah ayah--selected' : 'ayah', a.ayah === playing ? 'ayah--playing' : ''].join(' ').trim()}
          >
            <button type="button" className="ayah__text" onClick={onSelect ? () => onSelect(a.ayah) : undefined} disabled={!onSelect}>
              {a.text}
              <span className="ayah__number" aria-label={`الآية ${a.ayah}`}>
                {' '}
                ﴿{arabicDigits(a.ayah)}﴾
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
