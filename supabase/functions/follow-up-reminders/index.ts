// Follow-up reminder job.
//
// Runs daily on a schedule (see supabase/cron.sql). Sends one digest per
// recipient covering every follow-up channel still outstanding, prompts for a
// decision once all 5 weeks are done, and auto-marks a lead Lost when the grace
// period expires with no decision.
//
// Mail goes out over Transcure's own SMTP server — no Gmail/Outlook account and
// no third-party email API involved. Credentials come from Edge Function
// secrets, never from the database (app_settings is readable by every signed-in
// user, so a password there would be exposed to the whole team).
//
// Required secrets:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Optional:
//   SMTP_TLS ("true" for implicit TLS on 465; default STARTTLS on 587)
//   APP_URL   (used for links back into the tracker)
//   CRON_SECRET (if set, callers must present it — see the auth check below)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

// denomailer is imported lazily inside sendMail rather than at the top level.
// A top-level import that fails to resolve crashes the whole function on boot,
// and the platform then answers without CORS headers — which surfaces in the
// browser as the opaque "Failed to send a request to the Edge Function" with no
// way to see the real cause. Loading it on demand keeps the function bootable
// and turns a dependency problem into a readable JSON error.
type SMTPClientCtor = new (opts: unknown) => {
  send(opts: unknown): Promise<unknown>
  close(): Promise<void>
}
let SMTPClientRef: SMTPClientCtor | null = null

async function loadSMTPClient(): Promise<SMTPClientCtor> {
  if (SMTPClientRef) return SMTPClientRef
  try {
    const mod = await import('https://deno.land/x/denomailer@1.6.0/mod.ts')
    SMTPClientRef = (mod as { SMTPClient: SMTPClientCtor }).SMTPClient
    return SMTPClientRef
  } catch (e) {
    throw new Error(
      'Could not load the SMTP library (denomailer). This is a dependency/network problem inside the Edge Function, not a credentials problem. Underlying error: ' +
      (e instanceof Error ? e.message : String(e)),
    )
  }
}

// ── config ───────────────────────────────────────────────────────────────────

const env = (k: string, fallback = ''): string => Deno.env.get(k) ?? fallback

const SUPABASE_URL = env('SUPABASE_URL')
const APP_URL = env('APP_URL', 'https://transcure-leads.vercel.app').replace(/\/+$/, '')
const CRON_SECRET = env('CRON_SECRET')

// Supabase is migrating from SUPABASE_SERVICE_ROLE_KEY to SUPABASE_SECRET_KEYS
// (a JSON dictionary of keys, issued via JWT Signing Keys). The old variable is
// deprecated and is not populated on projects that have moved over, so accept
// either — preferring the new one where both exist.
function resolveServiceKey(): string {
  const raw = env('SUPABASE_SECRET_KEYS')
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'string' && parsed) return parsed
      if (parsed && typeof parsed === 'object') {
        // Prefer a conventionally-named entry, else take the first usable string.
        for (const k of ['service_role', 'secret', 'default']) {
          const v = (parsed as Record<string, unknown>)[k]
          if (typeof v === 'string' && v) return v
        }
        for (const v of Object.values(parsed as Record<string, unknown>)) {
          if (typeof v === 'string' && v) return v
        }
      }
    } catch {
      // Not JSON — some projects expose it as a bare key string.
      return raw
    }
  }
  return env('SUPABASE_SERVICE_ROLE_KEY')
}

const SERVICE_KEY = resolveServiceKey()

interface Automation {
  enabled: boolean
  digestHour: number
  timezone: string
  graceDays: number
  remindOverdueDaily: boolean
}
const DEFAULT_AUTOMATION: Automation = {
  enabled: true,
  digestHour: 9,
  timezone: 'Asia/Karachi',
  graceDays: 7,
  remindOverdueDaily: true,
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Today's date in the configured zone, as YYYY-MM-DD. Scheduling is done in the
// team's local calendar, not UTC, so a step due "today" means today in Karachi.
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + 'T00:00:00Z')
  const b = Date.parse(toIso + 'T00:00:00Z')
  return Math.round((b - a) / 86_400_000)
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Channels for a step that have not been ticked off yet.
function pendingChannels(step: Step): string[] {
  const done = new Set(step.completed_channels ?? [])
  return (step.channels ?? []).filter((c) => !done.has(c))
}

// ── types ────────────────────────────────────────────────────────────────────

interface Lead { record_id: string; lead_name: string | null; first_name: string | null; last_name: string | null; practice: string | null; email: string | null; phone: string | null }
interface Sequence { id: string; lead_record_id: string; manager_email: string | null; status: string; completed_at: string | null; prompt_sent_at: string | null }
interface Step { id: string; sequence_id: string; step_number: number; scheduled_date: string; channels: string[]; completed_channels: string[]; status: string }

interface DueItem { lead: Lead; step: Step; pending: string[]; overdueDays: number }

// ── mail ─────────────────────────────────────────────────────────────────────

// Can we even open a TCP socket to the mail server? Distinguishes a blocked or
// filtered port (hangs, then times out) from a refused one (fails immediately)
// from a reachable one. A hang is what makes the function get killed mid-request,
// which the browser can only report as an opaque fetch failure.
async function probeTcp(hostname: string, port: number, ms = 8000): Promise<string> {
  const t0 = Date.now()
  let timer: number | undefined
  try {
    const conn = await Promise.race([
      Deno.connect({ hostname, port }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no response within ${ms}ms — port looks blocked or filtered`)), ms)
      }),
    ])
    ;(conn as Deno.Conn).close()
    return `reachable (connected in ${Date.now() - t0}ms)`
  } catch (e) {
    return `UNREACHABLE after ${Date.now() - t0}ms — ${e instanceof Error ? e.message : String(e)}`
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// Hard ceiling on a send. Without this a hanging SMTP connection runs until the
// platform kills the whole invocation, and the caller gets no usable error.
const SEND_TIMEOUT_MS = 20_000

async function sendMail(to: string, subject: string, html: string, text: string): Promise<void> {
  const SMTPClient = await loadSMTPClient()
  const port = Number(env('SMTP_PORT', '587'))
  const client = new SMTPClient({
    connection: {
      hostname: env('SMTP_HOST'),
      port,
      // Port 465 is implicit TLS; 587 negotiates STARTTLS after connecting.
      tls: env('SMTP_TLS') === 'true' || port === 465,
      auth: { username: env('SMTP_USER'), password: env('SMTP_PASS') },
    },
  })
  let timer: number | undefined
  try {
    await Promise.race([
      client.send({
        from: env('SMTP_FROM') || env('SMTP_USER'),
        to,
        subject,
        content: text,
        html,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `SMTP send timed out after ${SEND_TIMEOUT_MS / 1000}s talking to ${env('SMTP_HOST')}:${port}. ` +
          'The connection hung rather than being refused, which usually means the port is blocked between ' +
          'Supabase and the mail server. Run Diagnose to see the TCP probe result.',
        )), SEND_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    try { await client.close() } catch { /* already dead */ }
  }
}

// ── email bodies ─────────────────────────────────────────────────────────────

function digestBody(items: DueItem[], today: string): { html: string; text: string; subject: string } {
  const overdue = items.filter((i) => i.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays)
  const dueToday = items.filter((i) => i.overdueDays === 0)

  const leadName = (l: Lead) =>
    l.lead_name || `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || l.record_id

  const subject = overdue.length
    ? `Follow-ups: ${overdue.length} overdue, ${dueToday.length} due today`
    : `Follow-ups: ${dueToday.length} due today`

  const section = (title: string, list: DueItem[], color: string): string => {
    if (!list.length) return ''
    const rows = list.map((i) => {
      const done = (i.step.completed_channels ?? []).filter((c) => i.step.channels.includes(c))
      return `
        <tr>
          <td style="padding:12px 14px;border-bottom:1px solid #e8e3ef;">
            <div style="font-weight:700;font-size:14px;color:#241f2b;">${esc(leadName(i.lead))}</div>
            ${i.lead.practice ? `<div style="font-size:12px;color:#6e6878;">${esc(i.lead.practice)}</div>` : ''}
            <div style="font-size:12px;color:#6e6878;margin-top:4px;">
              Week ${i.step.step_number} of 5 · due ${i.step.scheduled_date}${i.overdueDays > 0 ? ` · <b style="color:#b91c1c;">${i.overdueDays} day${i.overdueDays > 1 ? 's' : ''} overdue</b>` : ''}
            </div>
            <div style="font-size:13px;margin-top:6px;">
              <b>Still to do:</b> ${i.pending.map((c) => `<span style="display:inline-block;background:#f4ebf2;color:#5c2050;border-radius:12px;padding:2px 9px;font-size:12px;font-weight:600;margin-right:4px;">${esc(c)}</span>`).join('')}
            </div>
            ${done.length ? `<div style="font-size:12px;color:#6a9e25;margin-top:4px;">Done: ${done.map(esc).join(', ')}</div>` : ''}
            ${i.lead.email || i.lead.phone ? `<div style="font-size:12px;color:#6e6878;margin-top:4px;">${i.lead.email ? esc(i.lead.email) : ''}${i.lead.email && i.lead.phone ? ' · ' : ''}${i.lead.phone ? esc(i.lead.phone) : ''}</div>` : ''}
          </td>
        </tr>`
    }).join('')
    return `
      <h2 style="font-size:14px;margin:22px 0 8px;color:${color};text-transform:uppercase;letter-spacing:.5px;">${title} (${list.length})</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e8e3ef;border-radius:10px;overflow:hidden;">${rows}</table>`
  }

  const html = `
  <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f3f8;padding:24px;color:#241f2b;">
    <div style="max-width:640px;margin:0 auto;">
      <div style="border-bottom:3px solid #7b2d6b;padding-bottom:10px;margin-bottom:4px;">
        <span style="font-size:19px;font-weight:700;color:#5c2050;">Follow-ups for ${today}</span>
      </div>
      <p style="font-size:13px;color:#6e6878;">Each lead below still has outreach outstanding for that week. A week stops appearing here once every one of its channels is ticked off in the tracker.</p>
      ${section('Overdue', overdue, '#b91c1c')}
      ${section('Due today', dueToday, '#5c2050')}
      <p style="margin-top:24px;">
        <a href="${APP_URL}/follow-ups" style="background:#7b2d6b;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">Open Follow-Ups</a>
      </p>
      <p style="font-size:11px;color:#6e6878;margin-top:24px;border-top:1px solid #e8e3ef;padding-top:12px;">
        Sent automatically by the Transcure SEO Lead Tracker. Reminders repeat daily until every channel for the week is marked done.
      </p>
    </div>
  </div>`

  const line = (i: DueItem) =>
    `- ${leadName(i.lead)}${i.lead.practice ? ` (${i.lead.practice})` : ''} — Week ${i.step.step_number}, due ${i.step.scheduled_date}` +
    `${i.overdueDays > 0 ? ` [${i.overdueDays} day(s) overdue]` : ''}\n  Still to do: ${i.pending.join(', ')}`

  const text = [
    `Follow-ups for ${today}`,
    '',
    overdue.length ? `OVERDUE (${overdue.length})\n${overdue.map(line).join('\n')}` : '',
    dueToday.length ? `DUE TODAY (${dueToday.length})\n${dueToday.map(line).join('\n')}` : '',
    '',
    `Open: ${APP_URL}/follow-ups`,
  ].filter(Boolean).join('\n')

  return { html, text, subject }
}

function promptBody(lead: Lead, graceDays: number): { html: string; text: string; subject: string } {
  const name = lead.lead_name || `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || lead.record_id
  const subject = `Decision needed: ${name} — all 5 follow-ups complete`
  const html = `
  <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f3f8;padding:24px;color:#241f2b;">
    <div style="max-width:600px;margin:0 auto;">
      <div style="border-bottom:3px solid #7b2d6b;padding-bottom:10px;">
        <span style="font-size:19px;font-weight:700;color:#5c2050;">All 5 follow-ups completed</span>
      </div>
      <p style="font-size:14px;">Every follow-up for <b>${esc(name)}</b>${lead.practice ? ` (${esc(lead.practice)})` : ''} has now been carried out.</p>
      <p style="font-size:14px;">Did they respond? Record the outcome in the tracker.</p>
      <p style="background:#fff9e6;border:1px solid #f5d978;border-radius:9px;padding:12px 14px;font-size:13px;">
        If no outcome is recorded within <b>${graceDays} days</b>, this lead will be marked <b>Lost</b> automatically.
      </p>
      <p style="margin-top:20px;">
        <a href="${APP_URL}/follow-ups" style="background:#7b2d6b;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">Record the outcome</a>
      </p>
    </div>
  </div>`
  const text = `All 5 follow-ups completed for ${name}${lead.practice ? ` (${lead.practice})` : ''}.\n\n` +
    `Did they respond? Record the outcome at ${APP_URL}/follow-ups\n\n` +
    `If nothing is recorded within ${graceDays} days, the lead will be marked Lost automatically.`
  return { html, text, subject }
}

function autoLostBody(leads: Lead[]): { html: string; text: string; subject: string } {
  const nameOf = (l: Lead) => l.lead_name || `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || l.record_id
  const subject = `${leads.length} lead${leads.length > 1 ? 's' : ''} marked Lost — no response after 5 follow-ups`
  const items = leads.map((l) => `<li style="margin-bottom:6px;"><b>${esc(nameOf(l))}</b>${l.practice ? ` — ${esc(l.practice)}` : ''}</li>`).join('')
  const html = `
  <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f3f8;padding:24px;color:#241f2b;">
    <div style="max-width:600px;margin:0 auto;">
      <div style="border-bottom:3px solid #b91c1c;padding-bottom:10px;">
        <span style="font-size:19px;font-weight:700;color:#b91c1c;">Marked Lost automatically</span>
      </div>
      <p style="font-size:14px;">The grace period elapsed with no outcome recorded, so these leads were marked <b>Lost</b>:</p>
      <ul style="font-size:14px;">${items}</ul>
      <p style="font-size:13px;color:#6e6878;">Remember to update Zoho CRM so both systems agree.</p>
      <p style="margin-top:20px;">
        <a href="${APP_URL}/follow-ups" style="background:#7b2d6b;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">Open Follow-Ups</a>
      </p>
    </div>
  </div>`
  const text = `Marked Lost automatically (grace period elapsed with no outcome recorded):\n\n` +
    leads.map((l) => `- ${nameOf(l)}${l.practice ? ` — ${l.practice}` : ''}`).join('\n') +
    `\n\nRemember to update Zoho CRM.\n${APP_URL}/follow-ups`
  return { html, text, subject }
}

// ── main ─────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)

  // Parameters may arrive as query string (browser / pg_net) or JSON body
  // (supabase.functions.invoke from the app).
  let body: Record<string, unknown> = {}
  if (req.method === 'POST') {
    try { body = await req.json() } catch { /* empty or non-JSON body is fine */ }
  }
  const param = (k: string): string | null => {
    const v = body[k]
    if (typeof v === 'string' && v) return v
    if (v === true) return 'true'
    return url.searchParams.get(k)
  }

  // Two ways in:
  //   1. the scheduled job, proving itself with the shared cron secret
  //   2. a signed-in team member using the Admin test button, proving itself
  //      with a real user JWT (the anon key alone is NOT enough — it is public)
  const givenSecret = req.headers.get('x-cron-secret') ?? url.searchParams.get('secret')

  // The shared secret lives in Supabase Vault, so the cron job and this function
  // use one copy and there is nothing to keep in sync. The vault schema is not
  // exposed through PostgREST, so the comparison happens inside the database via
  // verify_cron_secret() — the secret never leaves Postgres. An env var of the
  // same name short-circuits this if one is set.
  let isCron = false
  if (givenSecret) {
    if (CRON_SECRET) {
      isCron = givenSecret === CRON_SECRET
    } else if (SERVICE_KEY) {
      try {
        const { data } = await createClient(SUPABASE_URL, SERVICE_KEY)
          .rpc('verify_cron_secret', { candidate: givenSecret })
        isCron = data === true
      } catch { /* fall through to the user-JWT path */ }
    }
  }

  let isUser = false
  if (!isCron && SERVICE_KEY) {
    const auth = req.headers.get('Authorization') ?? ''
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
    if (token) {
      try {
        const { data } = await createClient(SUPABASE_URL, SERVICE_KEY).auth.getUser(token)
        isUser = !!data?.user
      } catch { /* not a user token */ }
    }
  }

  if (!isCron && !isUser) {
    return Response.json({
      ok: false,
      error: 'unauthorized — send a matching x-cron-secret, or call this while signed in to the tracker',
    }, { status: 401, headers: CORS })
  }

  if (!SERVICE_KEY) {
    return Response.json({
      ok: false,
      error: 'No service key available. Neither SUPABASE_SECRET_KEYS nor SUPABASE_SERVICE_ROLE_KEY is set — both are normally injected automatically, so check the function is deployed to the right project.',
    }, { status: 500, headers: CORS })
  }

  // Diagnostic: prove the function booted, auth worked, and report which config
  // is present — without importing the mail library or opening any connection.
  // If this succeeds but a send fails, the problem is SMTP, not the deployment.
  if (param('ping') === 'true') {
    let smtpLib = 'not tested'
    try { await loadSMTPClient(); smtpLib = 'loaded ok' }
    catch (e) { smtpLib = 'FAILED: ' + (e instanceof Error ? e.message : String(e)) }

    // Probe the configured port, plus the other common SMTP port, so the answer
    // includes whether switching ports would help.
    const host = env('SMTP_HOST')
    const configuredPort = Number(env('SMTP_PORT', '587'))
    const alt = configuredPort === 465 ? 587 : 465
    const tcp: Record<string, string> = {}
    if (host) {
      tcp[`${host}:${configuredPort} (configured)`] = await probeTcp(host, configuredPort)
      tcp[`${host}:${alt}`] = await probeTcp(host, alt)
    }

    return Response.json({
      ok: true,
      boot: 'ok',
      authedAs: isCron ? 'cron' : 'user',
      smtpLib,
      tcp,
      secretsPresent: {
        SMTP_HOST: !!env('SMTP_HOST'),
        SMTP_PORT: env('SMTP_PORT') || '(default 587)',
        SMTP_USER: !!env('SMTP_USER'),
        SMTP_PASS: !!env('SMTP_PASS'),
        SMTP_FROM: !!env('SMTP_FROM'),
        APP_URL: APP_URL,
      },
    }, { headers: CORS })
  }

  // Report exactly which SMTP secrets are missing — the common setup failure.
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter((k) => !env(k))
  if (missing.length) {
    return Response.json({
      ok: false,
      error: `Missing SMTP secret(s): ${missing.join(', ')}. Add them under Project Settings -> Edge Functions -> Secrets, then redeploy the function.`,
      missingSecrets: missing,
    }, { status: 400, headers: CORS })
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY)
  const dryRun = param('dry') === 'true'
  const testTo = param('test')

  try {
    // Settings
    const { data: settingRow } = await db.from('app_settings').select('value').eq('key', 'follow_up_automation').maybeSingle()
    const cfg: Automation = { ...DEFAULT_AUTOMATION, ...((settingRow?.value ?? {}) as Partial<Automation>) }

    const { data: emailRow } = await db.from('app_settings').select('value').eq('key', 'follow_up_manager_email').maybeSingle()
    const defaultEmail = typeof emailRow?.value === 'string' ? emailRow.value.trim() : ''

    // One-off deliverability check.
    if (testTo) {
      const { html, text, subject } = digestBody([], todayIn(cfg.timezone))
      await sendMail(testTo, '[TEST] ' + subject, html, text)
      await db.from('follow_up_reminders').insert({ sent_on: todayIn(cfg.timezone), recipient: testTo, kind: 'test', subject, step_count: 0, status: 'sent' })
      return Response.json({ ok: true, tested: testTo }, { headers: CORS })
    }

    if (!cfg.enabled) return Response.json({ ok: true, skipped: 'automation disabled' }, { headers: CORS })

    const today = todayIn(cfg.timezone)

    // Load everything active in three reads.
    const { data: seqs, error: se } = await db.from('follow_up_sequences').select('*').eq('status', 'active')
    if (se) throw se
    const sequences = (seqs ?? []) as Sequence[]
    if (!sequences.length) return Response.json({ ok: true, today, note: 'no active sequences' }, { headers: CORS })

    const seqIds = sequences.map((s) => s.id)
    const { data: stepRows, error: ste } = await db.from('follow_up_steps').select('*').in('sequence_id', seqIds)
    if (ste) throw ste
    const allSteps = (stepRows ?? []) as Step[]

    const leadIds = [...new Set(sequences.map((s) => s.lead_record_id))]
    const { data: leadRows, error: le } = await db
      .from('leads').select('record_id, lead_name, first_name, last_name, practice, email, phone').in('record_id', leadIds)
    if (le) throw le
    const leadById = new Map((leadRows ?? []).map((l) => [(l as Lead).record_id, l as Lead]))

    const stepsBySeq = new Map<string, Step[]>()
    for (const s of allSteps) {
      const arr = stepsBySeq.get(s.sequence_id) ?? []
      arr.push(s)
      stepsBySeq.set(s.sequence_id, arr)
    }

    // ── 1. Digest of everything still outstanding ──
    const byRecipient = new Map<string, DueItem[]>()

    for (const seq of sequences) {
      const lead = leadById.get(seq.lead_record_id)
      if (!lead) continue
      const to = (seq.manager_email ?? '').trim() || defaultEmail
      if (!to) continue

      for (const step of stepsBySeq.get(seq.id) ?? []) {
        if (step.scheduled_date > today) continue          // not yet due
        const pending = pendingChannels(step)
        if (!pending.length) continue                       // every channel done
        const overdueDays = daysBetween(step.scheduled_date, today)
        if (overdueDays > 0 && !cfg.remindOverdueDaily) continue
        const arr = byRecipient.get(to) ?? []
        arr.push({ lead, step, pending, overdueDays })
        byRecipient.set(to, arr)
      }
    }

    const sent: string[] = []
    const failed: { to: string; error: string }[] = []

    const skipped: string[] = []

    for (const [to, items] of byRecipient) {
      const { html, text, subject } = digestBody(items, today)
      if (dryRun) { sent.push(`${to} (dry, ${items.length} items)`); continue }

      // Claim today's slot BEFORE sending. The unique index on
      // (sent_on, recipient, kind) where status='sent' means a second run on the
      // same day loses the race here and skips the send entirely — so a retried
      // cron or a manual "Run digest now" cannot deliver a duplicate. Sending
      // first would only have de-duplicated the log row, not the email.
      const { data: claim, error: claimErr } = await db.from('follow_up_reminders')
        .insert({ sent_on: today, recipient: to, kind: 'digest', subject, step_count: items.length, status: 'sent' })
        .select('id').single()

      if (claimErr) {
        if (/duplicate|unique/i.test(String(claimErr.message))) { skipped.push(to); continue }
        failed.push({ to, error: claimErr.message })
        continue
      }

      const rowId = (claim as { id: string }).id
      try {
        await sendMail(to, subject, html, text)
        sent.push(to)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failed.push({ to, error: msg })
        // Flip the claim to failed so it no longer blocks a later retry.
        await db.from('follow_up_reminders').update({ status: 'failed', error: msg }).eq('id', rowId)
      }
    }

    // ── 2. Sequences whose 5 weeks are all finished: stamp, then prompt once ──
    let prompted = 0
    for (const seq of sequences) {
      const steps = stepsBySeq.get(seq.id) ?? []
      if (steps.length < 5) continue
      const finished = steps.every((s) => pendingChannels(s).length === 0)
      if (!finished) continue

      if (!seq.completed_at && !dryRun) {
        await db.from('follow_up_sequences').update({ completed_at: new Date().toISOString() }).eq('id', seq.id)
        seq.completed_at = new Date().toISOString()
      }
      if (seq.prompt_sent_at) continue

      const lead = leadById.get(seq.lead_record_id)
      const to = (seq.manager_email ?? '').trim() || defaultEmail
      if (!lead || !to) continue
      if (dryRun) { prompted++; continue }

      // Claim the prompt before sending, conditional on it still being unclaimed.
      // If a concurrent run got there first this affects no rows and we skip,
      // rather than both runs emailing the same decision request.
      const { data: claimed } = await db.from('follow_up_sequences')
        .update({ prompt_sent_at: new Date().toISOString() })
        .eq('id', seq.id).is('prompt_sent_at', null)
        .select('id')
      if (!claimed?.length) continue

      const { html, text, subject } = promptBody(lead, cfg.graceDays)
      try {
        await sendMail(to, subject, html, text)
        await db.from('follow_up_reminders').insert({ sent_on: today, recipient: to, kind: 'resolution_prompt', subject, step_count: 5, status: 'sent' })
        prompted++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failed.push({ to, error: msg })
        // Release the claim so the next run retries instead of silently never prompting.
        await db.from('follow_up_sequences').update({ prompt_sent_at: null }).eq('id', seq.id)
        await db.from('follow_up_reminders').insert({ sent_on: today, recipient: to, kind: 'resolution_prompt', subject, step_count: 5, status: 'failed', error: msg })
      }
    }

    // ── 3. Grace period expired with no decision: mark Lost ──
    const lostByRecipient = new Map<string, Lead[]>()
    let autoLost = 0
    for (const seq of sequences) {
      if (!seq.completed_at) continue
      const dueSince = new Date(Date.parse(seq.completed_at) + cfg.graceDays * 86_400_000)
      if (dueSince > new Date()) continue

      const lead = leadById.get(seq.lead_record_id)
      if (!lead) continue
      if (dryRun) { autoLost++; continue }

      // Conditional on the sequence still being active, and check it actually
      // took effect — otherwise a concurrent run would double-count and send a
      // second "marked Lost" notice for the same lead.
      const { data: lostRows } = await db.from('follow_up_sequences')
        .update({ status: 'lost', resolved_at: new Date().toISOString(), resolved_auto: true })
        .eq('id', seq.id).eq('status', 'active')
        .select('id')
      if (!lostRows?.length) continue

      await db.from('leads').update({ status: 'Lost Lead', stage: 'Lost' }).eq('record_id', seq.lead_record_id)
      autoLost++

      const to = (seq.manager_email ?? '').trim() || defaultEmail
      if (to) lostByRecipient.set(to, [...(lostByRecipient.get(to) ?? []), lead])
    }

    for (const [to, lost] of lostByRecipient) {
      const { html, text, subject } = autoLostBody(lost)
      try {
        await sendMail(to, subject, html, text)
        await db.from('follow_up_reminders').insert({ sent_on: today, recipient: to, kind: 'auto_lost', subject, step_count: lost.length, status: 'sent' })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failed.push({ to, error: msg })
        await db.from('follow_up_reminders').insert({ sent_on: today, recipient: to, kind: 'auto_lost', subject, step_count: lost.length, status: 'failed', error: msg })
      }
    }

    return Response.json({ ok: true, today, dryRun, digestsSent: sent, alreadySentToday: skipped, prompted, autoLost, failed }, { headers: CORS })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('follow-up-reminders failed:', msg)
    return Response.json({ ok: false, error: msg }, { status: 500, headers: CORS })
  }
})
