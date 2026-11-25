/**
 * Connection check: `npm run doctor`.
 *
 * Answers, in order, the questions that actually go wrong — is it configured,
 * can it sign in, who is it, can it see data, and what is it allowed to do.
 * Prints no secrets.
 */
import { existsSync, statSync } from 'node:fs'
import { auditPath, credentialsPath, useLocalStorage } from '../src/credentials.js'
import { client, currentUser, settings } from '../src/supabase.js'
import { fetchLeads, fetchReminderLog, fetchSequences, listProjects } from '../src/repo.js'

const ok = (s: string): void => console.log(`  ok    ${s}`)
const bad = (s: string): void => console.log(`  FAIL  ${s}`)
const info = (s: string): void => console.log(`        ${s}`)

async function main(): Promise<void> {
  useLocalStorage()
  console.log('Lead Tracker MCP server — connection check\n')

  console.log('Configuration')
  const file = credentialsPath()
  if (existsSync(file)) {
    const mode = statSync(file).mode & 0o777
    ok(`credentials file ${file}`)
    if (process.platform !== 'win32') {
      if (mode & 0o077) bad(`permissions are ${mode.toString(8)} — others can read it. Run: chmod 600 "${file}"`)
      else ok(`permissions ${mode.toString(8)} (owner only)`)
    } else {
      info('permission check skipped on Windows — make sure only your account can read that file')
    }
  } else {
    info(`no credentials file at ${file} (using environment variables)`)
  }

  let s: ReturnType<typeof settings>
  try {
    s = settings()
    ok(`project ${s.url}`)
    ok(`mode "${s.mode}" — ${s.mode === 'read' ? 'read-only' : s.mode === 'write' ? 'read and edit' : 'read, edit, delete, import, send mail'}`)
    info(`default workspace "${s.defaultProject}" · max ${s.maxBatch} leads per write · audit log ${s.auditEnabled ? auditPath() : 'off'}`)
  } catch (e) {
    bad(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  console.log('\nSign-in')
  try {
    await client()
    const user = await currentUser()
    ok(`signed in as ${user?.email ?? user?.id ?? 'unknown'}`)
    info('Row Level Security applies to this session, exactly as it does in the browser.')
  } catch (e) {
    bad(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  console.log('\nData')
  try {
    const projects = await listProjects(true)
    ok(`${projects.length} workspace(s): ${projects.map((p) => p.id).join(', ')}`)
    for (const p of projects) {
      const leads = await fetchLeads(p.id, true)
      const seqs = await fetchSequences(p.id).catch(() => [])
      info(`${p.id.padEnd(14)} ${String(leads.length).padStart(5)} leads · ${seqs.length} follow-up sequence(s) · ${p.funnel.stages.length} stages`)
    }
  } catch (e) {
    bad(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  console.log('\nReminders')
  try {
    const log = await fetchReminderLog(3)
    if (!log.length) info('no reminder has been logged yet')
    else for (const r of log) info(`${r.sent_on}  ${r.status.padEnd(7)} ${r.recipient}`)
  } catch (e) {
    info(`reminder log unavailable: ${e instanceof Error ? e.message : String(e)}`)
  }

  console.log('\nAll checks passed.')
}

main().catch((e: unknown) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
