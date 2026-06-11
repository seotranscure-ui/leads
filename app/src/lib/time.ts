// Timezone handling — CRM times are US Central (DST-aware); we display PK too.
export const SRC_ZONE = 'America/Chicago' // CST/CDT
export const PK_ZONE = 'Asia/Karachi' // UTC+5, no DST

// Offset (ms) of `timeZone` at the given instant, via the IANA database in Intl.
function zoneOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return asUTC - date.getTime()
}

// Interpret a CRM time string (ISO "2025-10-10 08:27:31" OR US "10/10/2025 8:27")
// as wall-clock time in SRC_ZONE, returning the correct UTC instant.
export function parseSourceTime(str: string | null | undefined): Date | null {
  if (!str) return null
  const s = String(str).trim()
  let Y: number, Mo: number, D: number, H: number, Mi: number, S = 0
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
  if (m) {
    Y = +m[1]; Mo = +m[2]; D = +m[3]; H = +m[4]; Mi = +m[5]; S = +(m[6] || 0)
  } else {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ T,]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*([AP]M)?/i)
    if (!m) return null
    Mo = +m[1]; D = +m[2]; Y = +m[3]; H = +m[4]; Mi = +m[5]; S = +(m[6] || 0)
    if (Y < 100) Y += 2000
    const ap = m[7]
    if (ap) { const pm = /p/i.test(ap); if (pm && H < 12) H += 12; if (!pm && H === 12) H = 0 }
  }
  const naive = Date.UTC(Y, Mo - 1, D, H, Mi, S)
  let off = zoneOffsetMs(SRC_ZONE, new Date(naive))
  let utc = naive - off
  off = zoneOffsetMs(SRC_ZONE, new Date(utc)) // refine across DST edges
  utc = naive - off
  return new Date(utc)
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

export function fmtInZone(value: Date | string | null | undefined, timeZone: string, withTime = true): string {
  const date = toDate(value)
  if (!date) return ''
  const opt: Intl.DateTimeFormatOptions = { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }
  if (withTime) { opt.hour = '2-digit'; opt.minute = '2-digit'; opt.hourCycle = 'h23' }
  const p: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('en-GB', opt).formatToParts(date)) p[part.type] = part.value
  let s = `${p.year}-${p.month}-${p.day}`
  if (withTime) s += ` ${p.hour}:${p.minute}`
  return s
}

export function monthKeyOf(value: Date | string | null | undefined, timeZone = PK_ZONE): { key: string; label: string } {
  const date = toDate(value)
  if (!date) return { key: 'unknown', label: 'Unknown date' }
  const p: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(date)) p[part.type] = part.value
  return {
    key: `${p.year}-${p.month}`,
    label: new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'long' }).format(date),
  }
}
