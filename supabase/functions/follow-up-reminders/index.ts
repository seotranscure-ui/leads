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
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

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

async function sendMail(to: string, subject: string, html: string, text: string): Promise<void> {
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
  try {
    await client.send({
      from: env('SMTP_FROM') || env('SMTP_USER'),
      to,
      subject,
      content: text,
      html,
    })
  } finally {
    await client.close()
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

Deno.serve(async (req: Request) => {
  // The function is deployed with --no-verify-jwt so pg_cron can reach it, so
  // gate it on a shared secret instead when one is configured.
  if (CRON_SECRET) {
    const given = req.headers.get('x-cron-secret') ?? new URL(req.url).searchParams.get('secret')
    if (given !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
  }

  if (!SERVICE_KEY) {
    return Response.json({
      ok: false,
      error: 'No service key available. Neither SUPABASE_SECRET_KEYS nor SUPABASE_SERVICE_ROLE_KEY is set — both are normally injected automatically, so check the function is deployed to the right project.',
    }, { status: 500 })
  }
  if (!env('SMTP_HOST')) {
    return Response.json({
      ok: false,
      error: 'SMTP_HOST is not set. Add the SMTP_* secrets under Project Settings -> Edge Functions -> Secrets, then redeploy.',
    }, { status: 500 })
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY)
  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dry') === 'true'
  const testTo = url.searchParams.get('test')

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
      return Response.json({ ok: true, tested: testTo })
    }

    if (!cfg.enabled) return Response.json({ ok: true, skipped: 'automation disabled' })

    const today = todayIn(cfg.timezone)

    // Load everything active in three reads.
    const { data: seqs, error: se } = await db.from('follow_up_sequences').select('*').eq('status', 'active')
    if (se) throw se
    const sequences = (seqs ?? []) as Sequence[]
    if (!sequences.length) return Response.json({ ok: true, today, note: 'no active sequences' })

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

    for (const [to, items] of byRecipient) {
      const { html, text, subject } = digestBody(items, today)
      if (dryRun) { sent.push(`${to} (dry, ${items.length} items)`); continue }
      try {
        await sendMail(to, subject, html, text)
        // Unique index makes a second run the same day a no-op rather than a duplicate.
        const { error } = await db.from('follow_up_reminders')
          .insert({ sent_on: today, recipient: to, kind: 'digest', subject, step_count: items.length, status: 'sent' })
        if (error && !String(error.message).includes('duplicate')) throw error
        sent.push(to)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failed.push({ to, error: msg })
        await db.from('follow_up_reminders')
          .insert({ sent_on: today, recipient: to, kind: 'digest', subject, step_count: items.length, status: 'failed', error: msg })
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

      const { html, text, subject } = promptBody(lead, cfg.graceDays)
      try {
        await sendMail(to, subject, html, text)
        await db.from('follow_up_sequences').update({ prompt_sent_at: new Date().toISOString() }).eq('id', seq.id)
        await db.from('follow_up_reminders').insert({ sent_on: today, recipient: to, kind: 'resolution_prompt', subject, step_count: 5, status: 'sent' })
        prompted++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failed.push({ to, error: msg })
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

      await db.from('follow_up_sequences')
        .update({ status: 'lost', resolved_at: new Date().toISOString(), resolved_auto: true })
        .eq('id', seq.id).eq('status', 'active')
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

    return Response.json({ ok: true, today, dryRun, digestsSent: sent, prompted, autoLost, failed })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('follow-up-reminders failed:', msg)
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
})
