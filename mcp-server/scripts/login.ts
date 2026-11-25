/**
 * Interactive sign-in.
 *
 *   npm run login     sign in and store the session
 *   npm run logout    revoke the session and delete the stored file
 *
 * The password is read without echoing and is never written anywhere: what is
 * stored is the refresh token Supabase hands back, in a file only the owner can
 * read. Revoke it at any time with `npm run logout`, or from the Supabase
 * dashboard, without changing the password.
 */
import { createInterface } from 'node:readline'
import { createClient } from '@supabase/supabase-js'
import { clearCredentials, credentialsPath, loadCredentials, saveCredentials } from '../src/config.js'

const rl = createInterface({ input: process.stdin, output: process.stdout })

function ask(question: string, fallback?: string): Promise<string> {
  const prompt = fallback ? `${question} [${fallback}]: ` : `${question}: `
  return new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim() || fallback || '')))
}

/** Read a line without echoing it, so the password never reaches the scrollback. */
function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    process.stdout.write(`${question}: `)
    const wasRaw = stdin.isRaw
    if (stdin.isTTY) stdin.setRawMode(true)
    let value = ''
    const onData = (buf: Buffer): void => {
      const s = buf.toString('utf8')
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') {
          stdin.off('data', onData)
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false)
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (ch === '\u0003') { // Ctrl-C
          stdin.off('data', onData)
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); continue }
        value += ch
      }
    }
    stdin.on('data', onData)
    stdin.resume()
  })
}

async function logout(): Promise<void> {
  const current = loadCredentials()
  if (current) {
    try {
      const sb = createClient(current.url, current.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
      await sb.auth.refreshSession({ refresh_token: current.refreshToken })
      await sb.auth.signOut()
      console.log('Revoked the stored session with Supabase.')
    } catch {
      console.log('Could not reach Supabase to revoke the session; deleting the local file anyway.')
    }
  }
  console.log(clearCredentials() ? `Deleted ${credentialsPath()}.` : 'Nothing stored — already signed out.')
}

async function login(): Promise<void> {
  const existing = loadCredentials()
  console.log('Sign in to the lead tracker. Use the same account you use on the website.\n')

  const url = await ask('Supabase project URL', existing?.url ?? process.env.SUPABASE_URL)
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) {
    console.error(`"${url}" does not look like a Supabase project URL (https://xxxx.supabase.co).`)
    process.exit(1)
  }
  console.log('\nThe publishable ("anon") key — Supabase dashboard → Project Settings → API Keys.')
  console.log('This one is public by design: it is already in the website bundle. Do NOT paste a service_role or secret key.')
  const anonKey = await ask('Publishable / anon key', existing?.anonKey)
  if (!anonKey) { console.error('A key is required.'); process.exit(1) }
  if (/^sb_secret_/i.test(anonKey) || /service_role/i.test(anonKey)) {
    console.error('\nThat is a secret key. This server deliberately does not accept one — it signs in as a user so')
    console.error('Row Level Security stays on and edits are attributed. Use the publishable / anon key instead.')
    process.exit(1)
  }

  const email = await ask('\nEmail', existing?.email)
  // Close readline first: it also listens on stdin and would echo the password
  // back to the terminal while askSecret reads it in raw mode.
  rl.close()
  const password = await askSecret('Password (not shown, not stored)')
  if (!email || !password) { console.error('Email and password are required.'); process.exit(1) }

  const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) {
    console.error(`\nSign-in failed: ${error.message}`)
    process.exit(1)
  }
  const refresh = data.session?.refresh_token
  if (!refresh) { console.error('\nSigned in but got no refresh token back.'); process.exit(1) }

  saveCredentials({ url, anonKey, refreshToken: refresh, email })
  console.log(`\nSigned in as ${data.user?.email}.`)
  console.log(`Session stored in ${credentialsPath()} (owner-only).`)
  console.log('Your password was not stored. Run `npm run logout` to revoke this session.')
  console.log('\nNext: `npm run doctor` to check the connection, then add the server to Claude (see README).')
}

const run = process.argv.includes('--logout') ? logout() : login()
run
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  })
  .finally(() => {
    rl.close()
    // askSecret resumes stdin; without this the process would hang on it.
    process.stdin.pause()
  })
