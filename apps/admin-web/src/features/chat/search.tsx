import { Fragment, useEffect, useState, type ReactNode } from 'react'

/*
 * The client's copy of chat.search_fold (migration 20261020140000), used only
 * to HIGHLIGHT what the server matched -- the server decides what matches.
 * Lower case; Arabic harakat (U+064B-U+065F), superscript alef (U+0670) and
 * tatweel (U+0640) ignored; hamza/madda alef forms read as bare alef, alef
 * maqsura as yeh, teh marbuta as heh. Built from code points so the source
 * carries no invisible characters.
 */
const IGNORED = new Set<number>([...Array.from({ length: 0x65f - 0x64b + 1 }, (_, i) => 0x64b + i), 0x670, 0x640])
const SAME_AS: Record<number, number> = { 0x623: 0x627, 0x625: 0x627, 0x622: 0x627, 0x671: 0x627, 0x649: 0x64a, 0x629: 0x647 }

/** The folded text, and for each folded character the offset it came from. */
function fold(text: string): { folded: string; from: number[] } {
  let folded = ''
  const from: number[] = []
  let offset = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (!IGNORED.has(cp)) {
      const lowered = String.fromCodePoint(SAME_AS[cp] ?? cp).toLowerCase()
      for (const unit of lowered) {
        folded += unit
        from.push(offset)
      }
    }
    offset += ch.length
  }
  from.push(offset)
  return { folded, from }
}

/** Where `query` occurs in `text`, as [start, end) offsets into the ORIGINAL text. */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const needle = fold(query.trim().replace(/\s+/g, ' ')).folded
  if (!needle) return []
  const { folded, from } = fold(text)
  const out: Array<[number, number]> = []
  for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + needle.length)) {
    // The end runs on past any ignored marks that follow the last matched letter.
    let end = from[at + needle.length]!
    while (end < text.length && IGNORED.has(text.codePointAt(end)!)) end += 1
    out.push([from[at]!, end])
  }
  return out
}

/** The text with every match wrapped in <mark>. */
export function Highlighted({ text, query }: { text: string; query: string }) {
  const ranges = matchRanges(text, query)
  if (ranges.length === 0) return <>{text}</>
  const parts: ReactNode[] = []
  let last = 0
  ranges.forEach(([start, end], i) => {
    if (start > last) parts.push(<Fragment key={`t${i}`}>{text.slice(last, start)}</Fragment>)
    parts.push(
      <mark key={`m${i}`} className="cw-hit">
        {text.slice(start, end)}
      </mark>,
    )
    last = end
  })
  if (last < text.length) parts.push(<Fragment key="tail">{text.slice(last)}</Fragment>)
  return <>{parts}</>
}

/** A long message cut to the part around its first match. */
export function snippetAround(text: string, query: string, before = 32): string {
  const first = matchRanges(text, query)[0]
  if (!first || first[0] <= before) return text
  const start = text.lastIndexOf(' ', first[0] - before)
  return `…${text.slice(start > 0 ? start + 1 : first[0] - before)}`
}

/** A search term worth sending: two characters that are not only marks. */
export function searchable(q: string): boolean {
  return fold(q.trim()).folded.replace(/\s/g, '').length >= 2
}

/** The value, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}
