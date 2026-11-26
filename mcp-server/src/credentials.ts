/**
 * Filesystem-backed credential storage and the write journal.
 *
 * Deliberately split out from config.ts and imported only by the local stdio
 * entry point and the setup scripts. The hosted connector is configured
 * entirely from secrets and has no home directory, so keeping this module off
 * its import graph means the deployed bundle contains no filesystem code at
 * all — nothing to fail at boot, and nothing to reach for if a tool were ever
 * talked into it.
 *
 * Security notes for what is stored here are in SECURITY.md §2.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readEnv } from './env.js'
import { setAuditSink, type AuditEntry } from './audit.js'
import { setCredentialStore, type StoredCredentials } from './config.js'

export function configDir(): string {
  const override = readEnv('LEADS_MCP_HOME')
  if (override && override.trim()) return override.trim()
  return join(homedir(), '.config', 'leads-mcp')
}
export const credentialsPath = (): string => join(configDir(), 'credentials.json')
export const auditPath = (): string => join(configDir(), 'audit.log')

/**
 * Write the credentials file with owner-only permissions.
 *
 * The file is created at 0600 *before* anything is written into it, so the
 * secret is never briefly readable under a laxer default umask.
 */
export function saveCredentials(c: StoredCredentials): void {
  const file = credentialsPath()
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, '', { mode: 0o600 })
  try { chmodSync(file, 0o600) } catch { /* Windows: ACLs, not modes */ }
  writeFileSync(file, JSON.stringify({ ...c, savedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 })
}

export function clearCredentials(): boolean {
  const file = credentialsPath()
  if (!existsSync(file)) return false
  unlinkSync(file)
  return true
}

/**
 * Refuse a credentials file that other accounts on this machine can read.
 *
 * Only enforced on POSIX: Windows reports a synthetic mode that has nothing to
 * do with its real ACLs, so checking it there would reject every valid file.
 */
function assertPrivate(file: string): void {
  if (process.platform === 'win32') return
  const mode = statSync(file).mode & 0o777
  if (mode & 0o077) {
    throw new Error(
      `Credentials file ${file} is readable by other users (mode ${mode.toString(8)}). ` +
      `Run: chmod 600 "${file}"`,
    )
  }
}

export function loadCredentials(): StoredCredentials | null {
  let file: string
  try {
    file = credentialsPath()
    if (!existsSync(file)) return null
  } catch {
    return null
  }
  assertPrivate(file)
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredCredentials>
  if (!parsed.url || !parsed.anonKey || !parsed.refreshToken) return null
  return parsed as StoredCredentials
}

/** Persist a rotated refresh token, leaving the rest of the file untouched. */
export function updateRefreshToken(token: string): void {
  const current = loadCredentials()
  if (!current) return
  saveCredentials({ ...current, refreshToken: token })
}

let warnedAudit = false

/**
 * Append one line to the local write journal.
 *
 * Records what was touched, not what was in it: a journal full of lead contact
 * details would be a second, unprotected copy of the data sitting in a home
 * directory.
 */
function writeAudit(entry: AuditEntry): void {
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
    if (!warnedAudit) {
      warnedAudit = true
      console.error('[audit] could not write the audit log:', e instanceof Error ? e.message : String(e))
    }
  }
}

/**
 * Point config and the audit journal at the local filesystem.
 *
 * Called by the stdio entry point and the setup scripts. The hosted connector
 * never calls it, so neither feature is wired up there.
 */
export function useLocalStorage(): void {
  setCredentialStore({ load: loadCredentials, onTokenRotated: updateRefreshToken })
  setAuditSink(writeAudit)
}
