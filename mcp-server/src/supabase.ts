/**
 * The authenticated Supabase client.
 *
 * One client at module scope, shared by every server instance and tool. It acts
 * as a real tracker user: RLS applies exactly as it does in the browser, and
 * `auth.getUser()` returns a person, so writes land with a real author id.
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { loadSettings, persistRotatedToken, type Settings } from './config.js'

let settingsCache: Settings | null = null
export function settings(): Settings {
  if (!settingsCache) settingsCache = loadSettings()
  return settingsCache
}

let clientCache: SupabaseClient | null = null
let signedInUser: User | null = null
let signInPromise: Promise<void> | null = null

function rawClient(): SupabaseClient {
  if (clientCache) return clientCache
  const s = settings()
  clientCache = createClient(s.url, s.anonKey, {
    auth: {
      // Nothing is written to disk by the SDK; the only persisted secret is the
      // refresh token we store ourselves, with owner-only permissions.
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: { headers: { 'x-client-info': 'leads-tracker-mcp-server/2.0.0' } },
  })
  // Supabase rotates refresh tokens. Persisting each new one keeps the next
  // start-up working; without this the stored token goes stale and the server
  // would demand a fresh `npm run login` every time.
  clientCache.auth.onAuthStateChange((event, session) => {
    if (session?.refresh_token && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) {
      persistRotatedToken(session.refresh_token)
    }
  })
  return clientCache
}

async function doSignIn(): Promise<void> {
  const s = settings()
  const sb = rawClient()

  if (s.refreshToken) {
    const { data, error } = await sb.auth.refreshSession({ refresh_token: s.refreshToken })
    if (!error && data.user) {
      signedInUser = data.user
      if (data.session?.refresh_token) {
        persistRotatedToken(data.session.refresh_token)
      }
      return
    }
    // Fall through to a password sign-in if one is configured; otherwise this
    // is the error the user needs to see.
    if (!(s.email && s.password)) {
      throw new Error(
        `Stored sign-in is no longer valid (${error?.message ?? 'refresh failed'}). ` +
        'Run `npm run login` in the mcp-server directory to sign in again.',
      )
    }
  }

  if (s.email && s.password) {
    const { data, error } = await sb.auth.signInWithPassword({ email: s.email, password: s.password })
    if (error) throw new Error(`Sign-in failed for ${s.email}: ${error.message}`)
    signedInUser = data.user
    return
  }

  throw new Error('Not signed in. Run `npm run login` in the mcp-server directory.')
}

/** Sign in once; concurrent callers await the same attempt. */
export async function client(): Promise<SupabaseClient> {
  if (!signedInUser) {
    signInPromise ??= doSignIn().finally(() => { signInPromise = null })
    await signInPromise
  }
  return rawClient()
}

export async function currentUser(): Promise<User | null> {
  await client()
  return signedInUser
}

export async function currentUserId(): Promise<string | null> {
  return (await currentUser())?.id ?? null
}

/** Reset cached state — used by the diagnostics script. */
export function resetAuth(): void {
  signedInUser = null
  clientCache = null
  settingsCache = null
}
