import { useMemo } from 'react'

/**
 * The brand side of the sign-in page: an academy's working day, drawn the way
 * the Schedule draws it. Teachers are lanes, lessons are bars, the gold line is
 * now; the day flows with the reading direction. It is generated from a fixed
 * seed (no real data) and is decorative: hidden from assistive technology.
 */

const LANES = 9
const START = 13 * 60
const END = 22 * 60
const NOW = 17 * 60 + 20

/** A small deterministic generator, so the picture is the same on every visit. */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

interface Bar {
  lane: number
  from: number
  to: number
  trial: boolean
}

function lessons(): Bar[] {
  const rand = seeded(20261127)
  const out: Bar[] = []
  for (let lane = 0; lane < LANES; lane++) {
    let t = START + Math.floor(rand() * 4) * 15
    while (t < END - 30) {
      if (rand() < 0.66) {
        const len = [30, 30, 45, 60][Math.floor(rand() * 4)]!
        if (t + len > END) break
        out.push({ lane, from: t, to: t + len, trial: rand() < 0.08 })
        t += len
      }
      t += [0, 15, 15, 30, 60][Math.floor(rand() * 5)]!
    }
  }
  return out
}

export function DayRuler({ rtl, ar }: { rtl: boolean; ar: boolean }) {
  const bars = useMemo(lessons, [])
  const W = 560
  const laneH = 34
  const top = 30
  const H = top + LANES * laneH + 10
  // Minutes to x, with the day flowing in the reading direction.
  const PAD = 14
  const x = (m: number) => {
    const f = (m - START) / (END - START)
    return rtl ? W - PAD - f * (W - 2 * PAD) : PAD + f * (W - 2 * PAD)
  }
  const hours = Array.from({ length: (END - START) / 60 + 1 }, (_, i) => START + i * 60)
  const nowX = x(NOW)
  return (
    <svg className="auth__ruler" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      {/* Hour ticks */}
      {hours.map((h) => (
        <g key={h}>
          <line x1={x(h)} x2={x(h)} y1={top - 6} y2={H - 6} stroke="#e9f1f1" strokeOpacity={0.09} />
          <text x={x(h)} y={top - 14} fill="#b9d3d6" fillOpacity={0.7} fontSize={11} textAnchor="middle" fontFamily="Readex Pro, sans-serif">
            {/* The academy's clock: "1 PM" / "1 م". */}
            {`${((h / 60 - 1) % 12) + 1} ${ar ? 'م' : 'PM'}`}
          </text>
        </g>
      ))}
      {/* Lanes */}
      {Array.from({ length: LANES }, (_, i) => (
        <rect key={i} x={0} y={top + i * laneH + 4} width={W} height={laneH - 8} rx={6} fill="#e9f1f1" fillOpacity={0.04} />
      ))}
      {/* Lessons: past ones quieter, trials outlined */}
      {bars.map((b, i) => {
        const x1 = Math.min(x(b.from), x(b.to))
        const w = Math.abs(x(b.to) - x(b.from)) - 3
        const past = b.to <= NOW
        const y = top + b.lane * laneH + 7
        return b.trial ? (
          <rect key={i} x={x1 + 1.5} y={y} width={w} height={laneH - 14} rx={5} fill="none" stroke="#e9f1f1" strokeOpacity={past ? 0.3 : 0.75} strokeDasharray="4 3" />
        ) : (
          <rect key={i} x={x1 + 1.5} y={y} width={w} height={laneH - 14} rx={5} fill="#e9f1f1" fillOpacity={past ? 0.22 : 0.78} />
        )
      })}
      {/* Now */}
      <line x1={nowX} x2={nowX} y1={top - 6} y2={H - 4} stroke="#dea854" strokeWidth={2} />
      <circle cx={nowX} cy={top - 6} r={4} fill="#dea854" />
    </svg>
  )
}
