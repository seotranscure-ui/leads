/**
 * Environment access that works in both runtimes.
 *
 * The stdio server runs on Node; the connector runs as a Supabase Edge Function
 * on Deno, where `process.env` is only a shim for npm packages and may be empty
 * for our own code. Everything that reads configuration goes through here so
 * neither runtime needs a special case further up.
 */
interface DenoLike { env: { get(key: string): string | undefined } }

const deno = (globalThis as { Deno?: DenoLike }).Deno

export function readEnv(name: string): string | undefined {
  if (deno?.env) {
    try {
      const v = deno.env.get(name)
      if (v !== undefined) return v
    } catch { /* no env permission; fall through */ }
  }
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env?.[name]
}

/** True when running on Deno — used to skip filesystem-backed features. */
export const isDeno = !!deno

/**
 * Constant-time string comparison, for secrets.
 *
 * A plain `===` returns as soon as two bytes differ, so the time it takes
 * leaks how much of a guess was correct. That matters for a token an attacker
 * can probe over the network.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a)
  const bb = new TextEncoder().encode(b)
  // Compare a fixed number of bytes either way so the loop length does not
  // depend on the secret, then fold the length check into the result.
  let diff = ab.length ^ bb.length
  const n = Math.max(ab.length, bb.length)
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}
