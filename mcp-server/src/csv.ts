/**
 * CSV parsing and the CRM-row mapping, matching the web app's uploader so an
 * import run from Claude produces byte-identical rows to one run in the browser.
 */
import { fixRange, num, parseSourceTime, scopedRecordId, stageForIn, stripHtml, type Project } from './domain.js'

/** Minimal RFC4180 parser: quoted fields, escaped quotes, embedded newlines. */
export function parseCSV(input: string): string[][] {
  let text = input
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
  return rows.slice(1)
    .filter((r) => r.some((c) => c && c.trim() !== ''))
    .map((r) => {
      const o: Record<string, string> = {}
      head.forEach((h, i) => (o[h] = r[i] !== undefined ? r[i] : ''))
      return o
    })
}

const g = (row: Record<string, string>, k: string): string | null => (row[k] ?? '').trim() || null

/**
 * Map one Zoho export row to the CRM-owned lead columns.
 *
 * Timestamps are parsed as US-Central wall clock, which is what the export
 * contains; reading them as local or UTC time would shift leads near midnight
 * into the wrong month and quietly change every monthly report.
 */
export function csvRowToLead(row: Record<string, string>, project: Project): Record<string, unknown> {
  const status = row['Lead Status'] || ''
  const name = (row['Lead Name'] || `${row['First Name'] || ''} ${row['Last Name'] || ''}`).trim() || null
  const created = parseSourceTime(row['Created Time'])
  const modified = parseSourceTime(row['Modified Time'])
  return {
    record_id: scopedRecordId(project, (row['Record Id'] || '').trim()),
    project_id: project.id,
    lead_owner: g(row, 'Lead Owner'),
    company: g(row, 'Company'),
    first_name: g(row, 'First Name'),
    last_name: g(row, 'Last Name'),
    lead_name: name,
    email: g(row, 'Email') || g(row, 'Secondary Email'),
    phone: g(row, 'Phone') || g(row, 'Mobile'),
    source: (row['Lead Source'] || '').trim() || '(blank)',
    status,
    stage: stageForIn(project.funnel, status),
    tag: g(row, 'Tag'),
    specialty: g(row, 'Specialty') || g(row, 'Industry'),
    practice: g(row, 'Practice Name') || g(row, 'Company'),
    physicians: fixRange(row['Number of Physicians']),
    monthly_collections: num(row['Monthly Collections']),
    first_page: g(row, 'First Page Visited'),
    referrer: g(row, 'Referrer'),
    message: g(row, 'Message') || g(row, 'Description'),
    comments: stripHtml(row['Comments']),
    phase: g(row, 'Lead Phases'),
    created_utc: created ? created.toISOString() : null,
    modified_utc: modified ? modified.toISOString() : null,
    raw: row,
  }
}
