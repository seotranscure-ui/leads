/**
 * The 5-week follow-up sequence: reading the board, and acting on it.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import {
  ALL_CHANNELS, STEP_CHANNELS, daysBetween, defaultDates, displayName, effectiveEmail,
  fmtMoney, leadRevenue, lostStageName, lostStatusFor, nextPending, pendingChannels,
  stepComplete, ticketValue, todayIso,
  type FollowUpSequence, type FollowUpStep, type Lead,
} from '../domain.js'
import { WORKSPACE } from '../filters.js'
import {
  ResponseFormat, RESPONSE_FORMAT, UNTRUSTED_NOTE, fitToBudget, json, safeText,
  sanitiseForStorage, table, text,
} from '../format.js'
import {
  createSequence, fetchLeads, fetchSequences, fetchStepsFor, markSequenceStatus,
  provisionSequences, setStepChannels, updateLeadStageAndStatus, updateSequenceEmail,
  updateSequenceNotes, updateStepDate, updateStepNotes,
} from '../repo.js'
import { guard, guardWrite, workspace } from './common.js'
import { settings } from '../supabase.js'

interface Row {
  seq: FollowUpSequence
  lead: Lead | undefined
  steps: FollowUpStep[]
  next: FollowUpStep | null
  overdueDays: number
  doneChannels: number
  totalChannels: number
  finished: boolean
  email: string
}

async function board(projectId: string, managerEmail: string): Promise<Row[]> {
  const [seqs, leads] = await Promise.all([fetchSequences(projectId), fetchLeads(projectId)])
  const steps = await fetchStepsFor(seqs.map((s) => s.id))
  const bySeq = new Map<string, FollowUpStep[]>()
  for (const s of steps) {
    const arr = bySeq.get(s.sequence_id) ?? []
    arr.push(s)
    bySeq.set(s.sequence_id, arr)
  }
  const byId = new Map(leads.map((l) => [l.record_id, l]))
  const today = todayIso()

  return seqs.map((seq) => {
    const mine = (bySeq.get(seq.id) ?? []).sort((a, b) => a.step_number - b.step_number)
    const next = nextPending(mine)
    const totalChannels = mine.reduce((n, s) => n + (s.channels?.length ?? 0), 0)
    const doneChannels = mine.reduce((n, s) => n + (s.channels?.length ?? 0) - pendingChannels(s).length, 0)
    return {
      seq,
      lead: byId.get(seq.lead_record_id),
      steps: mine,
      next,
      overdueDays: next && next.scheduled_date < today ? daysBetween(next.scheduled_date, today) : 0,
      doneChannels,
      totalChannels,
      finished: mine.length > 0 && !next,
      email: effectiveEmail(seq, managerEmail),
    }
  })
}

const dueState = (r: Row, today: string): string => {
  if (r.seq.status !== 'active') return r.seq.status
  if (r.finished) return 'awaiting_decision'
  if (!r.next) return 'no_steps'
  if (r.next.scheduled_date < today) return 'overdue'
  if (r.next.scheduled_date === today) return 'due_today'
  return 'scheduled'
}

export function registerFollowUpsRead(server: McpServer): void {
  server.registerTool(
    'leads_followups',
    {
      title: 'Follow-up board',
      description: `The 5-week follow-up sequences for a workspace: which week each lead is on, which channels are still owed that week (email / SMS / call / LinkedIn), how overdue it is, and where the reminder for it is sent.

Filter by state to answer the usual questions:
  - "What is overdue?" -> state="overdue"
  - "What do I owe today?" -> state="due_today"
  - "Who finished all five weeks with no reply?" -> state="awaiting_decision"
  - "Everything for one lead" -> record_id="..."

Set include_steps=true to see all five weeks per lead rather than just the next one. Read-only.`,
      inputSchema: z.strictObject({
        workspace: WORKSPACE,
        state: z.enum(['any', 'active', 'overdue', 'due_today', 'scheduled', 'awaiting_decision', 'won', 'lost'])
          .default('active').describe('Which sequences to include.'),
        record_id: z.string().max(200).optional().describe('Only the sequence for this lead.'),
        query: z.string().max(200).optional()
          .describe('Free text matched against lead name, practice, reminder email and the notes.'),
        with_notes: z.boolean().optional()
          .describe('true keeps only sequences that have a note; false keeps only those without.'),
        include_steps: z.boolean().default(false).describe('Include all five weeks per sequence, not just the next one.'),
        sort: z.enum(['urgency', 'due_date', 'name', 'value']).default('urgency')
          .describe('"urgency" puts the most overdue first and resolved sequences last.'),
        limit: z.number().int().min(1).max(200).default(40).describe('Maximum sequences to return.'),
        offset: z.number().int().min(0).default(0).describe('Sequences to skip, for pagination.'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async (a) => {
      const { project, ctx, managerEmail } = await workspace(a.workspace)
      const today = todayIso()
      let rows = await board(project.id, managerEmail)

      if (a.record_id) rows = rows.filter((r) => r.seq.lead_record_id === a.record_id)
      if (a.query) {
        const q = a.query.toLowerCase()
        rows = rows.filter((r) =>
          [r.lead ? displayName(r.lead) : r.seq.lead_record_id, r.lead?.practice ?? '', r.email,
           r.seq.notes ?? '', r.steps.map((s) => s.notes ?? '').join(' ')]
            .join(' ').toLowerCase().includes(q))
      }
      if (a.with_notes !== undefined) {
        const has = (r: Row): boolean =>
          !!(r.seq.notes ?? '').trim() || r.steps.some((s) => (s.notes ?? '').trim())
        rows = rows.filter((r) => has(r) === a.with_notes)
      }
      if (a.state !== 'any') {
        rows = rows.filter((r) => {
          const s = dueState(r, today)
          if (a.state === 'active') return r.seq.status === 'active'
          return s === a.state
        })
      }

      rows.sort((x, y) => {
        switch (a.sort) {
          case 'due_date':
            return (x.next?.scheduled_date ?? '9999-12-31').localeCompare(y.next?.scheduled_date ?? '9999-12-31')
          case 'name':
            return (x.lead ? displayName(x.lead) : x.seq.lead_record_id)
              .localeCompare(y.lead ? displayName(y.lead) : y.seq.lead_record_id)
          case 'value':
            return (y.lead ? leadRevenue(y.lead, ctx.chargePct) : 0) - (x.lead ? leadRevenue(x.lead, ctx.chargePct) : 0)
          default: {
            const xd = x.seq.status !== 'active'
            const yd = y.seq.status !== 'active'
            if (xd !== yd) return xd ? 1 : -1
            if (y.overdueDays !== x.overdueDays) return y.overdueDays - x.overdueDays
            if (x.finished !== y.finished) return x.finished ? -1 : 1
            return (x.next?.scheduled_date ?? '9999-12-31').localeCompare(y.next?.scheduled_date ?? '9999-12-31')
          }
        }
      })

      const total = rows.length
      const page = rows.slice(a.offset, a.offset + a.limit)

      const render = (slice: Row[]) => {
        const nextOffset = a.offset + slice.length
        const hasMore = total > nextOffset
        const payload = {
          workspace: project.id,
          state: a.state,
          reminder_email_default: managerEmail || null,
          total, count: slice.length, offset: a.offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: nextOffset } : {}),
          sequences: slice.map((r) => ({
            sequence_id: r.seq.id,
            record_id: r.seq.lead_record_id,
            lead: r.lead ? safeText(displayName(r.lead), 120) : null,
            practice: r.lead ? safeText(r.lead.practice, 120) : null,
            stage: r.lead?.stage ?? null,
            revenue_per_month: r.lead ? Math.round(leadRevenue(r.lead, ctx.chargePct)) : null,
            sequence_status: r.seq.status,
            state: dueState(r, today),
            next_week: r.next?.step_number ?? null,
            next_due: r.next?.scheduled_date ?? null,
            days_overdue: r.overdueDays,
            outstanding_channels: r.next ? pendingChannels(r.next) : [],
            channels_done: r.doneChannels,
            channels_total: r.totalChannels,
            progress_pct: r.totalChannels ? Math.round((r.doneChannels / r.totalChannels) * 100) : 0,
            reminder_email: r.email || null,
            reminder_email_source: (r.seq.manager_email ?? '').trim() ? 'per-lead override' : 'workspace default',
            notes: safeText(r.seq.notes, 2000) || null,
            week_notes: r.steps
              .filter((s) => (s.notes ?? '').trim())
              .map((s) => ({ week: s.step_number, note: safeText(s.notes, 1000) })),
            started_at: r.seq.started_at,
            ...(a.include_steps ? {
              weeks: r.steps.map((s) => ({
                step_id: s.id,
                week: s.step_number,
                due: s.scheduled_date,
                channels: s.channels,
                completed_channels: s.completed_channels ?? [],
                outstanding: pendingChannels(s),
                done: stepComplete(s),
                note: safeText(s.notes, 1000) || null,
              })),
            } : {}),
          })),
        }
        if (a.response_format === ResponseFormat.JSON) return { payload, text: JSON.stringify(payload, null, 2) }

        const lines = [
          `# Follow-ups — ${project.name}`,
          `${total} sequence(s) in state "${a.state}"; showing ${slice.length} from offset ${a.offset}.`,
          `Default reminder email: ${managerEmail || '**not set**'}`,
          '',
          UNTRUSTED_NOTE,
          '',
          table(
            ['Lead', 'Stage', 'State', 'Week', 'Due', 'Overdue', 'Still owed', 'Progress', 'Notes', 'record_id'],
            slice.map((r) => [
              safeText(r.lead ? displayName(r.lead) : r.seq.lead_record_id, 44),
              r.lead?.stage ?? '-',
              dueState(r, today),
              r.next ? `${r.next.step_number}/5` : '-',
              r.next?.scheduled_date ?? '-',
              r.overdueDays ? `${r.overdueDays}d` : '-',
              r.next ? pendingChannels(r.next).join(', ') || '-' : '-',
              `${r.doneChannels}/${r.totalChannels}`,
              // Newlines would break the row apart, so a multi-line note is
              // flattened here; include_steps shows it in full.
              safeText((r.seq.notes ?? '').replace(/\s*\n\s*/g, ' / '), 90) || '-',
              `\`${r.seq.lead_record_id}\``,
            ]),
            ['l', 'l', 'l', 'r', 'l', 'r', 'l', 'r', 'l', 'l'],
          ),
        ]
        if (a.include_steps) {
          for (const r of slice) {
            lines.push('', `### ${safeText(r.lead ? displayName(r.lead) : r.seq.lead_record_id, 80)} — ${r.email || 'no reminder email'}`)
            if ((r.seq.notes ?? '').trim()) {
              lines.push('', safeText(r.seq.notes, 2000), '')
            }
            lines.push(table(
              ['Week', 'Due', 'Channels', 'Done', 'Outstanding', 'Note', 'step_id'],
              r.steps.map((s) => [
                s.step_number, s.scheduled_date, s.channels.join(', '),
                (s.completed_channels ?? []).join(', ') || '-',
                pendingChannels(s).join(', ') || '-',
                safeText((s.notes ?? '').replace(/\s*\n\s*/g, ' / '), 90) || '-',
                `\`${s.id}\``,
              ]),
              ['r', 'l', 'l', 'l', 'l', 'l', 'l'],
            ))
          }
        }
        if (hasMore) lines.push('', `More: call again with offset=${nextOffset}.`)
        return { payload, text: lines.join('\n') }
      }

      if (!total) {
        // A caller that asked for JSON gets JSON even when nothing matched:
        // returning prose here would break anything parsing the result.
        const why = project.follow_up_stage
          ? `Leads are enrolled when they reach "${project.follow_up_stage}".`
          : 'Follow-ups are disabled for this workspace.'
        if (a.response_format === ResponseFormat.JSON) {
          return json({
            workspace: project.id, state: a.state, reminder_email_default: managerEmail || null,
            total: 0, count: 0, offset: a.offset, has_more: false, sequences: [], note: why,
          })
        }
        return text(`No follow-up sequences in ${project.name} match state "${a.state}". ${why}`)
      }
      const fitted = fitToBudget(page, render)
      if (a.response_format === ResponseFormat.JSON) {
        return { content: [{ type: 'text' as const, text: fitted.text }], structuredContent: fitted.payload }
      }
      return text(fitted.text)
    }),
  )
}

export function registerFollowUpsWrite(server: McpServer): void {
  server.registerTool(
    'leads_manage_followup',
    {
      title: 'Manage a follow-up sequence',
      description: `Act on the 5-week follow-up sequences.

Actions:
  - "start" — begin a sequence for one lead. Weeks default to 7 days apart from today (week 1 email+SMS, weeks 2-4 add a call, week 5 adds LinkedIn); pass \`dates\` to choose them.
  - "provision" — enrol every lead currently sitting in the workspace's follow-up stage that has no sequence yet. Safe to repeat: leads that already have one are skipped.
  - "complete_channel" — tick channels off a week. Pass \`channels\` as the complete list done so far for that week, not just the new one. The week counts as finished only when every channel on it is ticked.
  - "reschedule" — move one week's due date.
  - "set_email" — override the reminder recipient for this lead, or clear it back to the workspace default.
  - "set_notes" — write the note shown in the Follow-Ups table's Notes column. Without \`week\` it is the note for the whole follow-up ("decision maker away until the 14th"); with \`week\` it is the note against that one week ("left voicemail"). Pass an empty string to clear it. The note replaces what is there, so include anything worth keeping.
  - "close" — mark the sequence won or lost. With \`update_lead=true\` a "lost" close also moves the lead to the workspace's lost stage.

Identify the sequence by \`record_id\` (the lead) and the week by \`week\` (1-5). Use leads_followups first to see the current state.`,
      inputSchema: z.strictObject({
        workspace: WORKSPACE,
        action: z.enum(['start', 'provision', 'complete_channel', 'reschedule', 'set_email', 'set_notes', 'close'])
          .describe('What to do.'),
        record_id: z.string().max(200).optional()
          .describe('The lead. Required for every action except "provision".'),
        week: z.number().int().min(1).max(5).optional()
          .describe('Week number, for "complete_channel" and "reschedule", and optionally for "set_notes".'),
        notes: z.string().max(4000).optional()
          .describe('For "set_notes": the note text. An empty string clears it.'),
        channels: z.array(z.enum(ALL_CHANNELS)).max(4).optional()
          .describe('For "complete_channel": every channel completed for that week so far. An empty array un-ticks the week.'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
          .describe('For "reschedule": the new due date, YYYY-MM-DD.'),
        dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).length(5).optional()
          .describe('For "start": the five due dates. Defaults to weekly from today.'),
        email: z.string().max(200).nullish()
          .describe('For "set_email" and "start": the reminder recipient. null clears the override.'),
        status: z.enum(['won', 'lost', 'active']).optional().describe('For "close": the outcome.'),
        update_lead: z.boolean().default(false)
          .describe('For "close" with status="lost": also move the lead to the workspace lost stage.'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guardWrite(
      (a) => ({
        tool: 'leads_manage_followup', action: a.action, workspace: a.workspace,
        targets: a.record_id ? [a.record_id] : undefined,
      }),
      async (a) => {
        const { project, managerEmail } = await workspace(a.workspace)
        const today = todayIso()
        const rows = await board(project.id, managerEmail)
        const find = (): Row => {
          if (!a.record_id) throw new Error(`action "${a.action}" needs record_id.`)
          const r = rows.find((x) => x.seq.lead_record_id === a.record_id)
          if (!r) throw new Error(`No follow-up sequence for "${a.record_id}". Use action="start" to create one.`)
          return r
        }
        const say = (payload: Record<string, unknown>, line: string) =>
          a.response_format === ResponseFormat.JSON ? json({ ok: true, ...payload }) : text(line)

        switch (a.action) {
          case 'start': {
            if (!a.record_id) throw new Error('action "start" needs record_id.')
            if (rows.some((r) => r.seq.lead_record_id === a.record_id)) {
              throw new Error(`"${a.record_id}" already has a sequence. Use "reschedule" or "complete_channel" instead.`)
            }
            const leads = await fetchLeads(project.id)
            const lead = leads.find((l) => l.record_id === a.record_id)
            if (!lead) throw new Error(`No lead "${a.record_id}" in workspace ${project.id}.`)
            const dates = a.dates ?? defaultDates(today)
            const steps = dates.map((d, i) => ({ scheduled_date: d, channels: [...STEP_CHANNELS[i]] }))
            const email = a.email === undefined ? null : a.email === null ? null : sanitiseForStorage(a.email).trim() || null
            const seq = await createSequence(a.record_id, email, steps, project.id)
            return say(
              { sequence_id: seq.id, record_id: a.record_id, dates, reminder_email: email ?? managerEmail },
              `Started a 5-week sequence for **${safeText(displayName(lead), 80)}**.\nWeeks due: ${dates.join(', ')}.\nReminders go to ${email || managerEmail || '(no email set — set one in the workspace)'}.`,
            )
          }

          case 'provision': {
            const stage = project.follow_up_stage
            if (!stage) throw new Error(`Follow-ups are disabled for ${project.name} (no follow-up stage set).`)
            const leads = await fetchLeads(project.id)
            const have = new Set(rows.map((r) => r.seq.lead_record_id))
            const todo = leads.filter((l) => l.stage === stage && !have.has(l.record_id)).map((l) => l.record_id)
            const cap = settings().maxBatch
            if (todo.length > cap) {
              throw new Error(`${todo.length} leads would be enrolled, over the ${cap} limit for one call. Raise LEADS_MCP_MAX_BATCH if that is intended.`)
            }
            const created = await provisionSequences(todo, () =>
              defaultDates(today).map((d, i) => ({ scheduled_date: d, channels: [...STEP_CHANNELS[i]] })), project.id)
            return say(
              { stage, candidates: todo.length, created },
              created
                ? `Enrolled **${created}** lead(s) sitting in "${stage}" into a 5-week sequence starting today.`
                : `Every lead in "${stage}" already has a sequence — nothing to do.`,
            )
          }

          case 'complete_channel': {
            const r = find()
            if (!a.week) throw new Error('action "complete_channel" needs week (1-5).')
            if (!a.channels) throw new Error('action "complete_channel" needs channels — the full list done for that week.')
            const step = r.steps.find((s) => s.step_number === a.week)
            if (!step) throw new Error(`That sequence has no week ${a.week}.`)
            const unknown = a.channels.filter((c) => !step.channels.includes(c))
            if (unknown.length) {
              throw new Error(`Week ${a.week} has channels ${step.channels.join(', ')} — not ${unknown.join(', ')}.`)
            }
            await setStepChannels(step.id, a.channels, step.channels)
            const done: string[] = a.channels
            const left = step.channels.filter((c) => !done.includes(c))
            return say(
              { record_id: r.seq.lead_record_id, week: a.week, completed: a.channels, outstanding: left, week_done: !left.length },
              left.length
                ? `Week ${a.week} for **${safeText(r.lead ? displayName(r.lead) : r.seq.lead_record_id, 60)}**: ticked ${a.channels.join(', ') || 'nothing'}. Still owed: ${left.join(', ')}.`
                : `Week ${a.week} for **${safeText(r.lead ? displayName(r.lead) : r.seq.lead_record_id, 60)}** is complete — reminders for it stop.`,
            )
          }

          case 'reschedule': {
            const r = find()
            if (!a.week) throw new Error('action "reschedule" needs week (1-5).')
            if (!a.date) throw new Error('action "reschedule" needs date (YYYY-MM-DD).')
            const step = r.steps.find((s) => s.step_number === a.week)
            if (!step) throw new Error(`That sequence has no week ${a.week}.`)
            await updateStepDate(step.id, a.date)
            return say(
              { record_id: r.seq.lead_record_id, week: a.week, from: step.scheduled_date, to: a.date },
              `Moved week ${a.week} for **${safeText(r.lead ? displayName(r.lead) : r.seq.lead_record_id, 60)}** from ${step.scheduled_date} to ${a.date}.`,
            )
          }

          case 'set_email': {
            const r = find()
            if (a.email === undefined) throw new Error('action "set_email" needs email (or null to clear the override).')
            const value = a.email === null ? null : sanitiseForStorage(a.email).trim()
            if (value !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
              throw new Error(`"${value}" is not an email address.`)
            }
            await updateSequenceEmail(r.seq.id, value)
            return say(
              { record_id: r.seq.lead_record_id, reminder_email: value ?? managerEmail, source: value ? 'per-lead override' : 'workspace default' },
              value
                ? `Reminders for **${safeText(r.lead ? displayName(r.lead) : r.seq.lead_record_id, 60)}** now go to ${value}.`
                : `Cleared the override — reminders fall back to the workspace default (${managerEmail || 'not set'}).`,
            )
          }

          case 'set_notes': {
            const r = find()
            if (a.notes === undefined) throw new Error('action "set_notes" needs notes (an empty string clears it).')
            // Empty saves as null, so "no note" is one value in the database
            // rather than two that look identical on screen.
            const value = sanitiseForStorage(a.notes).trim() || null
            const who = safeText(r.lead ? displayName(r.lead) : r.seq.lead_record_id, 60)

            if (a.week !== undefined) {
              const step = r.steps.find((s) => s.step_number === a.week)
              if (!step) throw new Error(`That sequence has no week ${a.week}.`)
              await updateStepNotes(step.id, value)
              return say(
                { record_id: r.seq.lead_record_id, week: a.week, notes: value },
                value
                  ? `Week ${a.week} note for **${who}**: ${safeText(value, 300)}`
                  : `Cleared the week ${a.week} note for **${who}**.`,
              )
            }

            await updateSequenceNotes(r.seq.id, value)
            return say(
              { record_id: r.seq.lead_record_id, notes: value },
              value
                ? `Note for **${who}**: ${safeText(value, 300)}`
                : `Cleared the follow-up note for **${who}**.`,
            )
          }

          case 'close': {
            const r = find()
            if (!a.status) throw new Error('action "close" needs status ("won", "lost" or "active").')
            await markSequenceStatus(r.seq.id, a.status)
            let moved: string | null = null
            if (a.update_lead && a.status === 'lost') {
              const stage = lostStageName(project.funnel)
              await updateLeadStageAndStatus(r.seq.lead_record_id, lostStatusFor(project.funnel), stage)
              moved = stage
            }
            return say(
              { record_id: r.seq.lead_record_id, sequence_status: a.status, lead_moved_to: moved },
              `Sequence for **${safeText(r.lead ? displayName(r.lead) : r.seq.lead_record_id, 60)}** marked **${a.status}**.` +
              (moved ? ` The lead was moved to "${moved}".` : ''),
            )
          }
        }
      },
    ),
  )
}
