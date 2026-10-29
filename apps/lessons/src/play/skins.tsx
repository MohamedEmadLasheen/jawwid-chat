/**
 * PD-49 game skins (plan §C.2): garden, sea, stars and the desert caravan. A skin is DECORATION
 * ONLY -- the header's picture and the colours around the game -- never the mechanic. It carries
 * no text and no Quran, and no living figure: plants, water, sky and sand, drawn here (no
 * third-party art). Each surah gets one, in turn, so two surahs feel different with the same games.
 * The pictures are hidden from screen readers; the page's title is the heading. Their colours
 * are the skin's tokens in play.css (an SVG attribute cannot read a CSS variable; a class can).
 */
export const SKINS = ['garden', 'sea', 'stars', 'caravan'] as const;
export type Skin = (typeof SKINS)[number];

/** The skin for a surah: they rotate, 1 garden, 2 sea, 3 stars, 4 caravan, 5 garden... */
export function skinFor(surah: number): Skin {
  return SKINS[(((surah - 1) % SKINS.length) + SKINS.length) % SKINS.length]!;
}

function Garden() {
  return (
    <>
      <circle cx="300" cy="34" r="18" className="skf-3" />
      <path d="M0 96 Q90 64 180 92 T360 86 V120 H0 Z" className="skf-1" />
      <path d="M0 106 Q120 84 240 104 T360 100 V120 H0 Z" className="skf-line" />
      {[40, 118, 196, 262].map((x, i) => (
        <g key={x} transform={`translate(${x} ${78 + (i % 2) * 8})`}>
          <path d="M0 0 V22" className="sks-1" strokeWidth="3" />
          <ellipse cx="-7" cy="14" rx="7" ry="3.5" className="skf-1" transform="rotate(-30 -7 14)" />
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} cx="0" cy="-7" rx="4.5" ry="7" className={i % 2 ? 'skf-2' : 'skf-4'} transform={`rotate(${a})`} />
          ))}
          <circle r="4" className="skf-3" />
        </g>
      ))}
    </>
  );
}

function Sea() {
  return (
    <>
      <circle cx="300" cy="34" r="18" className="skf-3" />
      {[24, 40, 56].map((r, i) => (
        <circle key={r} cx={160 + i * 30} cy={30 + i * 12} r={3 + i} className="sks-line" strokeWidth="2" />
      ))}
      <path d="M0 78 Q30 66 60 78 T120 78 T180 78 T240 78 T300 78 T360 78 V120 H0 Z" className="skf-2" />
      <path d="M0 92 Q30 80 60 92 T120 92 T180 92 T240 92 T300 92 T360 92 V120 H0 Z" className="skf-1" />
      <path d="M0 106 Q30 96 60 106 T120 106 T180 106 T240 106 T300 106 T360 106 V120 H0 Z" className="skf-4" />
    </>
  );
}

/** A five-pointed star of radius r at (x, y). */
const star = (x: number, y: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const d = i % 2 ? r * 0.45 : r;
    return `${(x + d * Math.cos(a)).toFixed(1)},${(y + d * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

function Stars() {
  return (
    <>
      <rect width="360" height="120" className="skf-sky" />
      <circle cx="292" cy="44" r="22" className="skf-2" />
      <circle cx="303" cy="38" r="20" className="skf-sky" />
      {[
        [40, 30, 7],
        [96, 64, 5],
        [150, 26, 8],
        [206, 70, 5],
        [236, 22, 4],
        [70, 96, 4],
        [176, 100, 6],
        [330, 96, 5],
      ].map(([x, y, r]) => (
        <polygon key={`${x}-${y}`} points={star(x!, y!, r!)} className="skf-1" />
      ))}
      <path d="M0 112 Q180 98 360 112 V120 H0 Z" className="skf-4" />
    </>
  );
}

function Caravan() {
  return (
    <>
      <circle cx="290" cy="40" r="20" className="skf-3" />
      <path d="M0 92 Q70 62 150 90 T300 84 T360 90 V120 H0 Z" className="skf-2" />
      <path d="M0 104 Q110 80 220 102 T360 98 V120 H0 Z" className="skf-1" />
      <g transform="translate(200 96)">
        <path d="M0 0 Q4 -28 2 -52" className="sks-5" strokeWidth="5" />
        {[-150, -110, -70, -30, 10].map((a) => (
          <ellipse key={a} cx="16" cy="0" rx="18" ry="5" className="skf-4" transform={`translate(2 -52) rotate(${a})`} />
        ))}
      </g>
    </>
  );
}

const PICTURES: Readonly<Record<Skin, () => JSX.Element>> = { garden: Garden, sea: Sea, stars: Stars, caravan: Caravan };

/** The page's header: the skin's picture (decoration, hidden from screen readers), then the title. */
export function SkinHeader({ skin, title }: { skin: Skin; title: string }) {
  const Picture = PICTURES[skin];
  return (
    <header className="play-hero">
      <svg className="play-hero__art" viewBox="0 0 360 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-skin={skin}>
        <rect width="360" height="120" className="skf-sky" />
        <Picture />
      </svg>
      <h1 className="play__title">{title}</h1>
    </header>
  );
}
