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
import { isDeno, readEnv } from './env.js'

export const SERVER_NAME = 'leads-tracker-mcp-server'
export const SERVER_VERSION = '2.0.0'
export const CHARACTER_LIMIT = 25_000

/** Capability tiers. Each includes the ones before it. */
export type Mode = 'read' | 'write' | 'admin'
const MODES: Mode[] = ['read', 'write', 'admin']

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
 * Where a stored session comes from, when there is one.
 *
 * The local server installs a filesystem-backed store (credentials.ts); the
 * hosted connector installs nothing and is configured purely from secrets.
 * Injecting it this way is what keeps filesystem code out of the deployed
 * bundle entirely.
 */
export interface CredentialStore {
  load: () => StoredCredentials | null
  /** Supabase rotates refresh tokens; this persists the new one. */
  onTokenRotated: (token: string) => void
}

let store: CredentialStore | null = null

export function setCredentialStore(s: CredentialStore | null): void {
  store = s
}

/**
 * The stored session, or null when nothing is stored.
 *
 * Errors propagate on purpose: a credentials file with loosened permissions
 * must reach the user as that, not be flattened into "not signed in".
 */
export function loadStoredCredentials(): StoredCredentials | null {
  return store?.load() ?? null
}

export function persistRotatedToken(token: string): void {
  try { store?.onTokenRotated(token) } catch { /* read-only config dir */ }
}

/**
 * Does this key grant more than a signed-in user?
 *
 * Covers both key formats: the new `sb_secret_...` prefix, and a legacy JWT
 * whose payload claims the `service_role`. Checking the key itself, rather than
 * which environment variable it arrived in, is what makes the guard hold on a
 * runtime that injects a service key of its own.
 */
export function looksLikeSecretKey(key: string): boolean {
  const k = key.trim()
  if (!k) return false
  if (/^sb_secret_/i.test(k)) return true
  const parts = k.split('.')
  if (parts.length !== 3) return false
  try {
    const pad = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(pad + '='.repeat((4 - (pad.length % 4)) % 4))) as { role?: string }
    return payload.role === 'service_role'
  } catch {
    return false
  }
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
  const stored = loadStoredCredentials()
  const url = (readEnv('SUPABASE_URL') ?? stored?.url ?? '').trim()
  const anonKey = (
    readEnv('LEADS_MCP_ANON_KEY') ??
    readEnv('SUPABASE_ANON_KEY') ??
    readEnv('SUPABASE_PUBLISHABLE_KEY') ??
    stored?.anonKey ??
    ''
  ).trim()
  const email = (readEnv('LEADS_MCP_EMAIL') ?? '').trim() || undefined
  const password = readEnv('LEADS_MCP_PASSWORD') || undefined
  const refreshToken = (readEnv('LEADS_MCP_REFRESH_TOKEN') ?? stored?.refreshToken ?? '').trim() || undefined

  // Two separate guards, because they catch different mistakes.
  //
  // The first is about what this server will actually authenticate with. It is
  // the one that matters: a secret key here would disable Row Level Security
  // for every tool and make writes untraceable to a person.
  if (looksLikeSecretKey(anonKey)) {
    throw new Error(
      'Refusing to use a Supabase service_role / secret key to connect. ' +
      'This server signs in as a tracker user so Row Level Security stays on and writes are attributed. ' +
      'Use the publishable (anon) key instead — it is public by design.',
    )
  }
  // The second catches a local install configured with one by mistake. It is
  // skipped on the hosted runtime, where Supabase injects
  // SUPABASE_SERVICE_ROLE_KEY into every Edge Function whether you want it or
  // not; the guard above already proves it is not the key being used.
  if (!isDeno && (readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SECRET_KEY'))) {
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

  const maxBatch = Number(readEnv('LEADS_MCP_MAX_BATCH') ?? 200)
  return {
    url,
    anonKey,
    email,
    password,
    refreshToken,
    mode: parseMode(readEnv('LEADS_MCP_MODE')),
    defaultProject: (readEnv('LEADS_MCP_DEFAULT_PROJECT') ?? 'transcure').trim(),
    maxBatch: Number.isFinite(maxBatch) && maxBatch > 0 ? Math.min(maxBatch, 1000) : 200,
    // Nothing to write to on the hosted runtime; Supabase keeps the request log.
    auditEnabled: !isDeno && (readEnv('LEADS_MCP_AUDIT') ?? '1') !== '0',
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

