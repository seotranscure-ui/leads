/**
 * Append-only local journal of every write this server performs.
 *
 * Deliberately records *what was touched*, not the values: the file would
 * otherwise become a second, unprotected copy of lead contact details sitting
 * in a home directory. Record ids and tool names are enough to reconstruct a
 * sequence of actions and to notice one nobody asked for.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { auditPath } from './config.js'

export interface AuditEntry {
  tool: string
  action: string
  workspace?: string
  /** Ids, not contents. */
  targets?: string[]
  count?: number
  ok: boolean
  error?: string
}

let warned = false

export function audit(entry: AuditEntry, enabled: boolean): void {
  if (!enabled) return
  const line = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry }) + '\n'
  try {
    const file = auditPath()
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      writeFileSync(file, '', { mode: 0o600 })
    }
    appendFileSync(file, line, { mode: 0o600 })
  } catch (e) {
    // A journal that cannot be written must not block the work, but say so once.
    if (!warned) {
      warned = true
      console.error('[audit] could not write the audit log:', e instanceof Error ? e.message : String(e))
    }
  }
}
