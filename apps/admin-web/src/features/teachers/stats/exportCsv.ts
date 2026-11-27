/**
 * The visible list as a CSV file, from the rows already loaded: no request,
 * nothing recounted. A byte-order mark first, so a spreadsheet opens the
 * Arabic names as Arabic.
 */
export function toCsv(head: string[], rows: Array<Array<string | number>>): string {
  const cell = (v: string | number) => {
    const s = String(v)
    // A leading = + - @ would be read as a formula by a spreadsheet.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return `﻿${[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`
}

export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
