// Minimal RFC4180 CSV parser — handles quoted fields, escaped quotes,
// embedded commas and newlines (the Zoho export has multi-line fields).
export function parseCSV(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // strip BOM
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQ = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQ = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQ = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (!rows.length) return []
  const head = rows[0].map((h) => h.trim())
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c && c.trim() !== ''))
    .map((r) => {
      const o: Record<string, string> = {}
      head.forEach((h, i) => (o[h] = r[i] !== undefined ? r[i] : ''))
      return o
    })
}

// Serialize rows of objects back to a CSV string (for the enriched export).
export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const head = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [head.join(',')].concat(rows.map((r) => head.map((h) => esc(r[h])).join(','))).join('\n')
}
