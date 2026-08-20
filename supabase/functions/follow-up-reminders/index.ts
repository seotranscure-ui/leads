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

// Collapse the indentation whitespace left by the HTML template literals.
// Long runs of spaces and newlines get quoted-printable encoded on the way out,
// and a trailing space before a line break becomes a literal "=20" in clients
// that do not decode it — which is what showed up in the body instead of content.
// Word spacing is preserved; only the padding between tags and the indentation
// after newlines is removed.
const compactHtml = (s: string): string =>
  s.replace(/\r?\n\s*/g, ' ')
   .replace(/>\s+</g, '><')
   .replace(/\s{2,}/g, ' ')
   .trim()

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

// Only the fields of `projects` this job needs.
interface FunnelStageCfg { name: string; won: boolean; lost: boolean; statuses: string[] }
interface ProjectCfg {
  id: string
  name: string
  follow_up_manager_email: string | null
  follow_up_automation: Partial<Automation> | null
  funnel: { stages: FunnelStageCfg[] } | null
}

/** The stage/status a lead moves to when auto-marked Lost, per that project's funnel. */
function lostFor(p: ProjectCfg): { stage: string; status: string } {
  const s = p.funnel?.stages?.find((x) => x.lost)
  return { stage: s?.name ?? 'Lost', status: s?.statuses?.[0] ?? 'Lost Lead' }
}

// ── mail ─────────────────────────────────────────────────────────────────────

// Can we even open a TCP socket to the mail server? Distinguishes a blocked or
// filtered port (hangs, then times out) from a refused one (fails immediately)
// from a reachable one. A hang is what makes the function get killed mid-request,
// which the browser can only report as an opaque fetch failure.
async function probeTcp(hostname: string, port: number, ms = 8000): Promise<string> {
  const t0 = Date.now()
  let timer: number | undefined
  let conn: Deno.Conn | null = null
  try {
    conn = await Promise.race([
      Deno.connect({ hostname, port }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no response within ${ms}ms — port looks blocked or filtered`)), ms)
      }),
    ]) as Deno.Conn
    if (timer !== undefined) { clearTimeout(timer); timer = undefined }
    const connectedMs = Date.now() - t0

    // On 465 the server expects TLS immediately, so a plaintext read would hang —
    // the successful connect is all we can learn without doing a TLS handshake.
    if (port === 465) return `reachable (connected in ${connectedMs}ms, implicit TLS — greeting not read)`

    // On a plaintext port the server should greet with "220 ..." unprompted.
    // Whether that arrives tells us if it is speaking SMTP at all.
    const buf = new Uint8Array(512)
    const read = await Promise.race([
      conn.read(buf),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 6000) }),
    ])
    if (read === null) {
      return `connected in ${connectedMs}ms but NO SMTP GREETING within 6s — the port accepts connections without answering`
    }
    const greeting = new TextDecoder().decode(buf.subarray(0, read as number)).trim().split('\n')[0]
    return `reachable (${connectedMs}ms) — greeting: ${greeting.slice(0, 120)}`
  } catch (e) {
    return `UNREACHABLE after ${Date.now() - t0}ms — ${e instanceof Error ? e.message : String(e)}`
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    try { conn?.close() } catch { /* already closed */ }
  }
}

// Hard ceiling on a send. Kept well inside the platform's own wall-clock limit,
// so a stalled SMTP conversation returns a readable error rather than having the
// whole invocation killed — which reaches the browser only as an opaque
// "failed to send a request".
const SEND_TIMEOUT_MS = 12_000

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
          `SMTP send timed out after ${SEND_TIMEOUT_MS / 1000}s talking to ${env('SMTP_HOST')}:${port}` +
          (port === 465 ? ' (implicit TLS)' : ' (STARTTLS)') + '. ' +
          'The socket opened but the conversation stalled. ' +
          (port !== 465
            ? 'STARTTLS on this port is the usual culprit — try SMTP_PORT=465, which uses TLS from the first byte and skips the negotiation.'
            : 'Since implicit TLS also stalls, check whether the server requires a client certificate or restricts which hosts may authenticate.'),
        )), SEND_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    try { await client.close() } catch { /* already dead */ }
  }
}

// ── email bodies ─────────────────────────────────────────────────────────────

function digestBody(items: DueItem[], today: string, projectName?: string): { html: string; text: string; subject: string } {
  const tag = projectName ? `[${projectName}] ` : ''
  const overdue = items.filter((i) => i.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays)
  const dueToday = items.filter((i) => i.overdueDays === 0)

  const leadName = (l: Lead) =>
    l.lead_name || `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || l.record_id

  const subject = overdue.length
    ? `${tag}Follow-ups: ${overdue.length} overdue, ${dueToday.length} due today`
    : `${tag}Follow-ups: ${dueToday.length} due today`

  // With nothing due there is no lead content at all, which previously produced a
  // near-empty body. Say so explicitly instead.
  const emptyNote = items.length
    ? ''
    : '<p style="font-size:14px;background:#eef7df;border:1px solid #cfe8a6;color:#4a6b1a;padding:12px 14px;border-radius:9px;">Nothing is outstanding right now — no follow-up is due or overdue today.</p>'

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
        <span style="font-size:19px;font-weight:700;color:#5c2050;">${projectName ? esc(projectName) + " \u00b7 " : ""}Follow-ups for ${today}</span>
      </div>
      <p style="font-size:13px;color:#6e6878;">Each lead below still has outreach outstanding for that week. A week stops appearing here once every one of its channels is ticked off in the tracker.</p>
      ${emptyNote}
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

  return { html: compactHtml(html), text, subject }
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
  return { html: compactHtml(html), text, subject }
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
  return { html: compactHtml(html), text, subject }
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
    // Each workspace carries its own reminder settings, recipient and funnel, so
    // the job runs once per project rather than once globally. Falls back to the
    // legacy app_settings rows if migration 006 has not been applied yet.
    const { data: projectRows } = await db.from('projects').select('*').order('sort_order')
    let projects: ProjectCfg[] = (projectRows ?? []) as ProjectCfg[]

    if (!projects.length) {
      const { data: settingRow } = await db.from('app_settings').select('value').eq('key', 'follow_up_automation').maybeSingle()
      const { data: emailRow } = await db.from('app_settings').select('value').eq('key', 'follow_up_manager_email').maybeSingle()
      projects = [{
        id: 'transcure',
        name: 'Transcure',
        follow_up_manager_email: typeof emailRow?.value === 'string' ? emailRow.value : null,
        follow_up_automation: { ...DEFAULT_AUTOMATION, ...((settingRow?.value ?? {}) as Partial<Automation>) },
        funnel: null,
      }]
    }

    const cfgFor = (p: ProjectCfg): Automation => ({ ...DEFAULT_AUTOMATION, ...(p.follow_up_automation ?? {}) })
    const cfg = cfgFor(projects[0])
    const today = todayIn(cfg.timezone)

    // One-off deliverability check. Uses a representative sample rather than an
    // empty digest, so the recipient can actually judge the formatting — an empty
    // digest has no lead content in it at all.
    if (testTo) {
      const sampleLead: Lead = {
        record_id: 'sample', lead_name: 'Sample Lead (test)', first_name: null, last_name: null,
        practice: 'Sample Family Practice', email: 'lead@example.com', phone: '+1 555 0100',
      }
      const sampleItems: DueItem[] = [
        {
          lead: sampleLead,
          step: { id: 's1', sequence_id: 'x', step_number: 2, scheduled_date: today, channels: ['Email', 'SMS', 'Call'], completed_channels: ['Email'], status: 'pending' },
          pending: ['SMS', 'Call'],
          overdueDays: 3,
        },
        {
          lead: { ...sampleLead, lead_name: 'Another Sample Lead (test)', practice: 'Sample Cardiology' },
          step: { id: 's2', sequence_id: 'y', step_number: 1, scheduled_date: today, channels: ['Email', 'SMS'], completed_channels: [], status: 'pending' },
          pending: ['Email', 'SMS'],
          overdueDays: 0,
        },
      ]
      const { html, text, subject } = digestBody(sampleItems, today, projects[0]?.name)
      const testSubject = '[TEST] ' + subject
      const banner = '<p style="font-size:13px;background:#f4ebf2;border:1px solid #ede2eb;color:#5c2050;padding:11px 14px;border-radius:9px;"><b>This is a test.</b> The two leads below are made up, to show the layout. Real reminders list your actual leads.</p>'
      await sendMail(testTo, testSubject, html.replace('<p style="font-size:13px;color:#6e6878;">', banner + '<p style="font-size:13px;color:#6e6878;">'), 'THIS IS A TEST — the leads below are samples.\n\n' + text)
      await db.from('follow_up_reminders').insert({ sent_on: today, recipient: testTo, kind: 'test', subject: testSubject, step_count: 0, status: 'sent' })
      return Response.json({ ok: true, tested: testTo }, { headers: CORS })
    }

    // ── Run the whole job once per workspace ──
    const perProject: Record<string, unknown>[] = []
    const sentAll: string[] = []
    const skippedAll: string[] = []
    const failedAll: { to: string; error: string }[] = []
    let promptedAll = 0
    let autoLostAll = 0

    for (const proj of projects) {
      const cfg = cfgFor(proj)
      const defaultEmail = (proj.follow_up_manager_email ?? '').trim()
      const today = todayIn(cfg.timezone)

      if (!cfg.enabled) { perProject.push({ project: proj.name, skipped: 'automation disabled' }); continue }

      // Load this project's active sequences and their steps.
      const { data: seqs, error: se } = await db.from('follow_up_sequences')
        .select('*').eq('status', 'active').eq('project_id', proj.id)
      if (se) throw se
      const sequences = (seqs ?? []) as Sequence[]
      if (!sequences.length) { perProject.push({ project: proj.name, note: 'no active sequences' }); continue }

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
      const { html, text, subject } = digestBody(items, today, proj.name)
      if (dryRun) { sent.push(`${to} (dry, ${items.length} items)`); continue }

      // Claim today's slot BEFORE sending. The unique index on
      // (sent_on, recipient, kind) where status='sent' means a second run on the
      // same day loses the race here and skips the send entirely — so a retried
      // cron or a manual "Run digest now" cannot deliver a duplicate. Sending
      // first would only have de-duplicated the log row, not the email.
      const { data: claim, error: claimErr } = await db.from('follow_up_reminders')
        .insert({ sent_on: today, recipient: to, kind: 'digest', project_id: proj.id, subject, step_count: items.length, status: 'sent' })
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
        await db.from('follow_up_reminders').insert({ sent_on: today, recipient: to, kind: 'resolution_prompt', project_id: proj.id, subject, step_count: 5, status: 'sent' })
        prompted++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failed.push({ to, error: msg })
        // Release the claim so the next run retries instead of silently never prompting.
        await db.from('follow_up_sequences').update({ prompt_sent_at: null }).eq('id', seq.id)
        await db.from('follow_up_reminders').insert({ sent_on: today, recipient: to, kind: 'resolution_prompt', project_id: proj.id, subject, step_count: 5, status: 'failed', error: msg })
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

      // This project's own Lost stage — another workspace need not have one named "Lost".
      const lostTarget = lostFor(proj)
      await db.from('leads').update({ status: lostTarget.status, stage: lostTarget.stage }).eq('record_id', seq.lead_record_id)
      autoLost++

      const to = (seq.manager_email ?? '').trim() || defaultEmail
      if (to) lostByRecipient.set(to, [...(lostByRecipient.get(to) ?? []), lead])
    }

    for (const [to, lost] of lostByRecipient) {
      const { html, text, subject } = autoLostBody(lost)
      try {
        await sendMail(to, subject, html, text)
        await db.from('follow_up_reminders').insert({ sent_on: today, recipient: to, kind: 'auto_lost', project_id: proj.id, subject, step_count: lost.length, status: 'sent' })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failed.push({ to, error: msg })
        await db.from('follow_up_reminders').insert({ sent_on: today, recipient: to, kind: 'auto_lost', project_id: proj.id, subject, step_count: lost.length, status: 'failed', error: msg })
      }
    }

      perProject.push({
        project: proj.name, today, digestsSent: sent, alreadySentToday: skipped, prompted, autoLost,
        failed: failed.length ? failed : undefined,
      })
      sentAll.push(...sent.map((t) => `${t} (${proj.name})`))
      skippedAll.push(...skipped)
      failedAll.push(...failed)
      promptedAll += prompted
      autoLostAll += autoLost
    }

    return Response.json({
      ok: true, today, dryRun, projects: perProject,
      digestsSent: sentAll, alreadySentToday: skippedAll,
      prompted: promptedAll, autoLost: autoLostAll, failed: failedAll,
    }, { headers: CORS })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('follow-up-reminders failed:', msg)
    return Response.json({ ok: false, error: msg }, { status: 500, headers: CORS })
  }
})
