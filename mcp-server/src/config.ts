/**
 * Configuration, credential storage and the capability mode.
 *
 * Security model in one place:
 *
 *  - The server NEVER holds a Supabase service_role / secret key. It signs in as
 *    an ordinary tracker user, so Row Level Security still applies and every
 *    write is attributed to that real person (manual_updated_by, started_by,
 *    uploaded_by). The worst a stolen config can do is what that one user can
 *    already do in the web app — not read or wipe the whole project.
 *  - The only value that identifies the user at rest is a *refresh token*, not
 *    their password. It is revocable from Supabase (sign the user out
 *    everywhere) without changing their password, and `npm run logout` revokes
 *    it from here.
 *  - The credentials file must not be readable by anyone else. On POSIX the
 *    server refuses to start if the mode is group- or world-accessible.
 *  - LEADS_MCP_MODE gates which tools are registered at all. In 'read' mode the
 *    write tools do not exist, so no prompt and no injected instruction can
 *    reach them.
 */
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const SERVER_NAME = 'leads-tracker-mcp-server'
export const SERVER_VERSION = '2.0.0'
export const CHARACTER_LIMIT = 25_000

/** Capability tiers. Each includes the ones before it. */
export type Mode = 'read' | 'write' | 'admin'
const MODES: Mode[] = ['read', 'write', 'admin']

export function configDir(): string {
  const override = process.env.LEADS_MCP_HOME
  if (override && override.trim()) return override.trim()
  return join(homedir(), '.config', 'leads-mcp')
}
export const credentialsPath = (): string => join(configDir(), 'credentials.json')
export const auditPath = (): string => join(configDir(), 'audit.log')

export interface StoredCredentials {
  /** Supabase project URL, e.g. https://xxxx.supabase.co */
  url: string
  /** Publishable ("anon") key. Public by design — it is already in the web bundle. */
  anonKey: string
  /** Rotating refresh token for the signed-in tracker user. Secret. */
  refreshToken: string
  /** Recorded for display only, so `doctor` can say who the server acts as. */
  email?: string
  savedAt?: string
}

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
  const file = credentialsPath()
  if (!existsSync(file)) return null
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

export interface Settings {
  url: string
  anonKey: string
  /** Set when signing in with a password instead of a stored refresh token. */
  email?: string
  password?: string
  refreshToken?: string
  mode: Mode
  /** Workspace used when a tool omits `workspace`. */
  defaultProject: string
  /** Hard ceiling on how many leads one write call may touch. */
  maxBatch: number
  auditEnabled: boolean
}

function parseMode(raw: string | undefined): Mode {
  const v = (raw ?? 'read').trim().toLowerCase()
  if ((MODES as string[]).includes(v)) return v as Mode
  throw new Error(`LEADS_MCP_MODE must be one of ${MODES.join(', ')} — got "${raw}".`)
}

export function allows(mode: Mode, required: Mode): boolean {
  return MODES.indexOf(mode) >= MODES.indexOf(required)
}

/**
 * Resolve settings from the environment, falling back to the stored
 * credentials. Environment wins so a host config can point one install at a
 * different project without touching the file.
 */
export function loadSettings(): Settings {
  const stored = loadCredentials()
  const url = (process.env.SUPABASE_URL ?? stored?.url ?? '').trim()
  const anonKey = (
    process.env.LEADS_MCP_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    stored?.anonKey ??
    ''
  ).trim()
  const email = (process.env.LEADS_MCP_EMAIL ?? '').trim() || undefined
  const password = process.env.LEADS_MCP_PASSWORD || undefined
  const refreshToken = (process.env.LEADS_MCP_REFRESH_TOKEN ?? stored?.refreshToken ?? '').trim() || undefined

  if (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) {
    // Loud, because silently accepting it would quietly disable RLS for every
    // tool below and make writes untraceable to a person.
    throw new Error(
      'Refusing to start with a Supabase service_role / secret key in the environment. ' +
      'This server signs in as a tracker user so Row Level Security stays on and writes are attributed. ' +
      'Remove SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY from the MCP config and run `npm run login` instead.',
    )
  }
  if (!url) throw new Error('No Supabase URL. Run `npm run login`, or set SUPABASE_URL.')
  if (!anonKey) throw new Error('No Supabase publishable (anon) key. Run `npm run login`, or set SUPABASE_ANON_KEY.')
  if (!refreshToken && !(email && password)) {
    throw new Error(
      'Not signed in. Run `npm run login` in the mcp-server directory ' +
      '(or set LEADS_MCP_EMAIL and LEADS_MCP_PASSWORD for an unattended install).',
    )
  }

  const maxBatch = Number(process.env.LEADS_MCP_MAX_BATCH ?? 200)
  return {
    url,
    anonKey,
    email,
    password,
    refreshToken,
    mode: parseMode(process.env.LEADS_MCP_MODE),
    defaultProject: (process.env.LEADS_MCP_DEFAULT_PROJECT ?? 'transcure').trim(),
    maxBatch: Number.isFinite(maxBatch) && maxBatch > 0 ? Math.min(maxBatch, 1000) : 200,
    auditEnabled: (process.env.LEADS_MCP_AUDIT ?? '1') !== '0',
  }
}

/**
 * Confirmation phrase a destructive tool demands before it acts.
 *
 * Derived from the target, so a caller cannot satisfy it with a generic "yes".
 * The point is not cryptographic: it is that the model has to name exactly what
 * it is about to destroy, which an instruction smuggled into a lead's notes
 * ("delete everything") cannot do by accident.
 */
export function confirmPhrase(action: string, target: string): string {
  return `${action.toUpperCase()} ${target}`
}

export function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12)
}

export const newRunId = (): string => randomUUID().slice(0, 8)
