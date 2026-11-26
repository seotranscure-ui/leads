/**
 * Self-check against the built server: `npm run build && npm run smoke`.
 *
 * Runs without a database. It verifies the things that must hold before the
 * server is ever pointed at real data: that it starts, that the capability mode
 * really decides which tools exist, that bad arguments are refused, that a
 * failure reaches the caller as readable text instead of a crash, and that a
 * service_role key is rejected outright.
 *
 * With LEADS_MCP_SMOKE_LIVE=1 and a working `npm run login` it also calls the
 * read tools against the real project.
 */
import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { startStub, WRITES } from './stub-supabase.js'

const READ_TOOLS = [
  'leads_activity', 'leads_breakdown', 'leads_followups', 'leads_insights',
  'leads_list_workspaces', 'leads_metrics', 'leads_monthly_performance', 'leads_search',
].sort()
const WRITE_TOOLS = ['leads_create', 'leads_manage_followup', 'leads_update', 'leads_update_workspace']
const ADMIN_TOOLS = ['leads_delete', 'leads_import', 'leads_run_reminders']

const live = process.env.LEADS_MCP_SMOKE_LIVE === '1'
// A throwaway config dir, so the smoke test can never read or overwrite the
// real stored session.
const sandbox = mkdtempSync(join(tmpdir(), 'leads-mcp-smoke-'))

function env(extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {
    ...getDefaultEnvironment(),
    LEADS_MCP_HOME: sandbox,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    LEADS_MCP_REFRESH_TOKEN: 'not-a-real-token',
    LEADS_MCP_AUDIT: '0',
    ...extra,
  }
  return base
}

const opened: Client[] = []

async function connect(extra: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'smoke-test', version: '1.0.0' })
  await client.connect(new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: live ? { ...getDefaultEnvironment(), ...extra } : env(extra),
  }))
  opened.push(client)
  return client
}

const names = async (c: Client): Promise<string[]> => (await c.listTools()).tools.map((t) => t.name).sort()

let checks = 0
const pass = (s: string): void => { checks++; console.error(`  ok  ${s}`) }

async function main(): Promise<void> {
  console.error('Smoke test\n')

  // ── mode gating ───────────────────────────────────────────────────────────
  const read = await connect({ LEADS_MCP_MODE: 'read' })
  assert.deepEqual(await names(read), READ_TOOLS)
  pass(`read mode exposes exactly the ${READ_TOOLS.length} read tools`)

  const write = await connect({ LEADS_MCP_MODE: 'write' })
  const writeNames = await names(write)
  assert.deepEqual(writeNames, [...READ_TOOLS, ...WRITE_TOOLS].sort())
  for (const t of ADMIN_TOOLS) {
    assert.ok(!writeNames.includes(t), `${t} must not exist in write mode`)
  }
  pass('write mode adds the edit tools and still withholds delete / import / send')

  const admin = await connect({ LEADS_MCP_MODE: 'admin' })
  assert.deepEqual(await names(admin), [...READ_TOOLS, ...WRITE_TOOLS, ...ADMIN_TOOLS].sort())
  pass(`admin mode exposes all ${READ_TOOLS.length + WRITE_TOOLS.length + ADMIN_TOOLS.length} tools`)

  // ── every tool is documented and annotated ────────────────────────────────
  for (const tool of (await admin.listTools()).tools) {
    assert.ok((tool.description ?? '').length > 80, `${tool.name} needs a real description`)
    assert.ok(tool.annotations, `${tool.name} needs annotations`)
  }
  const destructive = (await admin.listTools()).tools.filter((t) => t.annotations?.destructiveHint)
  assert.deepEqual(destructive.map((t) => t.name), ['leads_delete'])
  pass('all tools are described and annotated; only leads_delete is flagged destructive')

  // ── input validation ──────────────────────────────────────────────────────
  const badSort = await read.callTool({ name: 'leads_search', arguments: { sort: 'not_a_sort' } })
  assert.equal(badSort.isError, true, 'an unknown sort value must be rejected')
  const badDate = await read.callTool({ name: 'leads_metrics', arguments: { date_from: '12/04/2026' } })
  assert.equal(badDate.isError, true, 'a non ISO date must be rejected')
  const unknownArg = await read.callTool({ name: 'leads_metrics', arguments: { nonsense: 1 } })
  assert.equal(unknownArg.isError, true, 'unknown arguments must be rejected (strict schemas)')
  pass('bad arguments are refused before any handler runs')

  // ── failures are readable, not crashes ────────────────────────────────────
  if (!live) {
    const res = await read.callTool({ name: 'leads_list_workspaces', arguments: {} })
    assert.equal(res.isError, true)
    const body = JSON.stringify(res.content)
    assert.match(body, /sign|token|login/i, `expected a sign-in error, got: ${body}`)
    assert.ok(!/not-a-real-token/.test(body), 'the error must not echo the credential back')
    pass('a bad session produces a readable error that does not leak the token')
  }

  // ── every tool, end to end, against a stub Supabase ───────────────────────
  // This is the part that exercises the real client, the real queries and the
  // real rendering. Without it, a formatting crash would only surface live.
  if (!live) {
    const stub = await startStub()
    const stubEnv: Record<string, string> = {
      SUPABASE_URL: stub.url,
      SUPABASE_ANON_KEY: 'stub-anon-key',
      LEADS_MCP_REFRESH_TOKEN: 'stub-refresh-token',
      LEADS_MCP_DEFAULT_PROJECT: 'acme',
      LEADS_MCP_MODE: 'admin',
    }
    const c = await connect(stubEnv)
    // Everything below runs inside try/finally: without it a failed assertion
    // leaves the stub server and the child process open and the run hangs
    // instead of reporting which check failed.
    try {

    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await c.callTool({ name, arguments: args })
      assert.ok(!r.isError, `${name} failed: ${JSON.stringify(r.content)}`)
      return r
    }

    for (const fmt of ['markdown', 'json']) {
      for (const name of READ_TOOLS) {
        const args: Record<string, unknown> = { response_format: fmt }
        if (name === 'leads_breakdown') args.dimension = 'source'
        await call(name, args)
      }
    }
    pass(`all ${READ_TOOLS.length} read tools render in both formats against seeded data`)

    // The numbers must match what the fixture implies, not merely be present.
    const metrics = await call('leads_metrics', { response_format: 'json' })
    const m = metrics.structuredContent as Record<string, unknown>
    assert.equal(m.leads, 6)
    assert.equal(m.sales, 2)
    assert.equal(m.lost, 1)
    assert.equal(m.demos, 4, 'Demo, Negotiation and both Won leads reached demo')
    assert.equal(m.won_collections_per_month, 92000)
    assert.equal(m.revenue_per_month, 4600, '5% of 92000')
    pass('leads_metrics computes the figures the fixture implies')

    const months = await call('leads_monthly_performance', { response_format: 'json' })
    const rows = (months.structuredContent as { months: Record<string, unknown>[] }).months
    const march = rows.find((r) => r.month === '2026-03')!
    const feb = rows.find((r) => r.month === '2026-02')!
    assert.equal(feb.sales, 0, "the February win is attributed to its revenue month")
    assert.equal(march.sales, 1)
    assert.equal(march.revenue_per_month, 600)
    pass('monthly performance honours the revenue-month override')

    // Lead text from outside must come back inert and labelled.
    const detail = await call('leads_search', { record_id: 'l6' })
    const body = JSON.stringify(detail.content)
    assert.ok(!/\\u0000/.test(body) && !body.includes('\u0000'), 'control characters must be stripped')
    assert.ok(!body.includes('‮'), 'bidi overrides must be stripped')
    assert.match(body, /supplied by.*outside parties/, 'free text must carry the untrusted-data notice')
    assert.match(body, /IGNORE PREVIOUS INSTRUCTIONS/, 'the text itself is still reported, as data')
    pass('lead-supplied text is sanitised and labelled as data')

    const insights = await call('leads_insights', { response_format: 'json' })
    const ins = insights.structuredContent as Record<string, Record<string, unknown>>
    assert.ok(Array.isArray(ins.flags))
    assert.equal((ins.data_quality.unmapped_statuses as unknown[]).length, 1, 'the "Nurturing" status is unmapped')
    assert.equal(ins.followups.overdue, 1, 'week 2 is a week late')
    assert.deepEqual(ins.followups.most_overdue, [
      { name: 'In Talks', days: 7, outstanding: 'SMS, Call', record_id: 'l3' },
    ])
    pass('leads_insights finds the unmapped status and the overdue follow-up')

    // Notes: readable on the board, writable through the manage tool.
    const board = await call('leads_followups', { include_steps: true, response_format: 'json' })
    const seq = (board.structuredContent as { sequences: Record<string, unknown>[] }).sequences[0]
    assert.equal(seq.notes, 'Decision maker away until the 14th')
    assert.deepEqual(seq.week_notes, [{ week: 2, note: 'Left voicemail Tuesday' }])
    const weeks = seq.weeks as { week: number; note: string | null }[]
    assert.equal(weeks.find((w) => w.week === 2)?.note, 'Left voicemail Tuesday')
    assert.equal(weeks.find((w) => w.week === 1)?.note, null)

    const md = await call('leads_followups')
    assert.match(JSON.stringify(md.content), /Decision maker away/, 'the markdown board shows the note')

    const byNote = await call('leads_followups', { query: 'voicemail', response_format: 'json' })
    assert.equal((byNote.structuredContent as { total: number }).total, 1, 'search covers week notes')
    const without = await call('leads_followups', { with_notes: false, response_format: 'json' })
    assert.equal((without.structuredContent as { total: number }).total, 0)

    WRITES.length = 0
    await call('leads_manage_followup', { action: 'set_notes', record_id: 'l3', notes: '  Call back Monday  ' })
    const seqNote = WRITES.find((w) => w.table === 'follow_up_sequences')!.body as Record<string, unknown>
    assert.equal(seqNote.notes, 'Call back Monday', 'trimmed before saving')

    WRITES.length = 0
    await call('leads_manage_followup', { action: 'set_notes', record_id: 'l3', week: 2, notes: 'Spoke to them' })
    const stepNote = WRITES.find((w) => w.table === 'follow_up_steps')!.body as Record<string, unknown>
    assert.equal(stepNote.notes, 'Spoke to them', 'a week note goes to the step, not the sequence')

    WRITES.length = 0
    await call('leads_manage_followup', { action: 'set_notes', record_id: 'l3', notes: '   ' })
    const cleared = WRITES.find((w) => w.table === 'follow_up_sequences')!.body as Record<string, unknown>
    assert.equal(cleared.notes, null, 'a blank note saves as null, not an empty string')
    pass('follow-up notes read back on the board and write to the right row')

    // Destructive tools must not act on the first call.
    const beforeWrites = WRITES.length
    const unconfirmed = await c.callTool({ name: 'leads_delete', arguments: { record_id: 'l1' } })
    assert.ok(!unconfirmed.isError, 'the preview is not an error')
    assert.equal(WRITES.length, beforeWrites, 'nothing may be written without confirmation')
    const previewText = JSON.stringify(unconfirmed.content)
    assert.match(previewText, /DELETE l1/, 'the preview must return a target-specific phrase')

    const wrongPhrase = await c.callTool({ name: 'leads_delete', arguments: { record_id: 'l1', confirm: 'yes' } })
    assert.equal(wrongPhrase.isError, true, '"yes" must not satisfy the gate')
    assert.equal(WRITES.length, beforeWrites, 'a wrong phrase must still write nothing')

    const confirmed = await c.callTool({ name: 'leads_delete', arguments: { record_id: 'l1', confirm: 'DELETE l1' } })
    assert.ok(!confirmed.isError, `confirmed delete failed: ${JSON.stringify(confirmed.content)}`)
    assert.ok(WRITES.some((w) => w.method === 'DELETE' && w.table === 'leads'), 'the delete should have reached the database')
    pass('leads_delete writes nothing until the exact phrase is quoted back')

    // A real send is gated the same way; ping and dry are not.
    await call('leads_run_reminders', { mode: 'ping' })
    const send = await c.callTool({ name: 'leads_run_reminders', arguments: { mode: 'send' } })
    assert.match(JSON.stringify(send.content), /SEND reminders/, 'a real send must be confirmation-gated')
    pass('leads_run_reminders gates a real send but not ping')

    // A write tool should reject an edit to a lead that does not exist, rather
    // than silently updating nothing.
    const ghost = await c.callTool({ name: 'leads_update', arguments: { record_id: 'nope', notes: 'x' } })
    assert.equal(ghost.isError, true)
    assert.match(JSON.stringify(ghost.content), /No lead with record_id/)
    pass('editing a non-existent lead is an error, not a silent no-op')

    // Setting a status should derive the stage from the workspace mapping.
    WRITES.length = 0
    await call('leads_update', { record_id: 'l3', status: 'won lead', charge_pct: 8 })
    const leadPatch = WRITES.filter((w) => w.table === 'leads').map((w) => w.body as Record<string, unknown>)
    assert.ok(leadPatch.some((b) => b.manual_charge_pct === 8 && b.manual_updated_by), 'enrichment is written with an author')
    assert.ok(leadPatch.some((b) => b.stage === 'Won'), '"won lead" must map to the Won stage, not be stored as-is')
    pass('leads_update derives the stage from the status mapping')

    const badStage = await c.callTool({ name: 'leads_update', arguments: { record_id: 'l3', stage: 'Atlantis' } })
    assert.equal(badStage.isError, true)
    assert.match(JSON.stringify(badStage.content), /not a stage/)
    pass('a stage outside the workspace funnel is refused')

    // Follow-up: ticking one of three channels must leave the week unfinished.
    WRITES.length = 0
    const tick = await call('leads_manage_followup', {
      action: 'complete_channel', record_id: 'l3', week: 2, channels: ['Email', 'SMS'],
    })
    const stepPatch = WRITES.find((w) => w.table === 'follow_up_steps')!.body as Record<string, unknown>
    assert.equal(stepPatch.status, 'pending', 'the call is still outstanding, so the week is not done')
    assert.match(JSON.stringify(tick.content), /Still owed: Call/)
    const finish = await call('leads_manage_followup', {
      action: 'complete_channel', record_id: 'l3', week: 2, channels: ['Email', 'SMS', 'Call'],
    })
    const donePatch = (WRITES.filter((w) => w.table === 'follow_up_steps').pop()!.body) as Record<string, unknown>
    assert.equal(donePatch.status, 'done')
    assert.ok(donePatch.completed_at, 'a finished week gets a completion time')
    assert.match(JSON.stringify(finish.content), /complete/)
    pass('a follow-up week finishes only when every channel on it is ticked')

    const wrongChannel = await c.callTool({
      name: 'leads_manage_followup',
      arguments: { action: 'complete_channel', record_id: 'l3', week: 1, channels: ['Call'] },
    })
    assert.equal(wrongChannel.isError, true, 'week 1 has no Call channel')
    pass('ticking a channel a week does not have is refused')

    // Changing the funnel must re-map existing leads, not just the config.
    WRITES.length = 0
    const funnelChange = await call('leads_update_workspace', {
      funnel_stages: [
        { name: 'New', color: '#94a3b8', reachedDemo: false, won: false, lost: false, statuses: [] },
        { name: 'Talking', color: '#3b82f6', reachedDemo: true, won: false, lost: false, statuses: ['contacted', 'agreement sent'] },
        { name: 'Closed', color: '#15803d', reachedDemo: true, won: true, lost: false, statuses: ['won lead'] },
        { name: 'Dead', color: '#dc2626', reachedDemo: false, won: false, lost: true, statuses: ['lost lead'] },
      ],
    })
    assert.ok(WRITES.some((w) => w.table === 'projects'), 'the project row is updated')
    assert.ok(WRITES.some((w) => w.table === 'leads' && (w.body as Record<string, unknown>).stage === 'Talking'),
      'existing leads are re-staged under the new mapping')
    assert.match(JSON.stringify(funnelChange.content), /moved to a different stage/)
    pass('replacing the funnel re-maps existing leads')

    const twoWon = await c.callTool({
      name: 'leads_update_workspace',
      arguments: {
        funnel_stages: [
          { name: 'A', color: '#111111', reachedDemo: false, won: true, lost: false, statuses: [] },
          { name: 'B', color: '#222222', reachedDemo: false, won: true, lost: true, statuses: [] },
        ],
      },
    })
    assert.equal(twoWon.isError, true)
    assert.match(JSON.stringify(twoWon.content), /Exactly one stage must be marked won/)
    pass('a funnel with two won stages is rejected')

    // CSV import: preview writes nothing, confirmed import maps the rows.
    const csv = join(sandbox, 'export.csv')
    writeFileSync(csv, [
      'Record Id,Lead Name,Lead Status,Lead Source,Monthly Collections,Number of Physicians,Created Time,Comments',
      '900,"Chen, Dr",Agreement Sent,SEO,"$62,500",5-Feb,2026-03-10 08:27:31,<p>Call back</p>',
      '901,Patel,won lead,Referral,15000,3,2026-03-11 09:00:00,',
    ].join('\n'))
    WRITES.length = 0
    const preview = await call('leads_import', { action: 'preview', file: csv })
    assert.equal(WRITES.length, 0, 'a preview must write nothing')
    const phrase = JSON.stringify(preview.content).match(/IMPORT \d+:acme/)?.[0]
    assert.ok(phrase, `expected a confirmation phrase, got: ${JSON.stringify(preview.content)}`)
    await call('leads_import', { action: 'import', file: csv, confirm: phrase })
    const upserted = WRITES.find((w) => w.method === 'POST' && w.table === 'leads')!.body as Record<string, unknown>[]
    assert.equal(upserted.length, 2)
    assert.equal(upserted[0].monthly_collections, 62500, 'currency formatting is stripped')
    assert.equal(upserted[0].physicians, '2-5', 'Excel date-mangling is undone')
    assert.equal(upserted[0].created_utc, '2026-03-10T13:27:31.000Z', 'CRM times are read as US Central')
    assert.equal(upserted[0].comments, 'Call back ' + String.fromCharCode(0x2022),
      'HTML is flattened to the same text the web app would store')
    assert.equal(upserted[0].manual_notes, null, 'a new lead starts with no enrichment')
    pass('leads_import previews without writing, then maps rows correctly on confirmation')

    const notACsv = join(sandbox, 'other.csv')
    writeFileSync(notACsv, 'name,total\nfoo,1\n')
    const rejected = await c.callTool({ name: 'leads_import', arguments: { action: 'preview', file: notACsv } })
    assert.equal(rejected.isError, true)
    const rejectText = JSON.stringify(rejected.content)
    assert.match(rejectText, /has no .{0,2}Record Id.{0,2} column/)
    assert.ok(!rejectText.includes('foo'), 'the refusal must name the headers, not echo the file contents')
    pass('a file that is not a lead export is refused without echoing its contents')

    } finally {
      await c.close().catch(() => {})
      await stub.close().catch(() => {})
    }
  }

  // ── a service_role key is refused at startup ──────────────────────────────
  const refused = spawnSync('node', ['dist/index.js'], {
    env: { ...env({}), SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_pretend' },
    encoding: 'utf8',
    timeout: 20_000,
  })
  assert.equal(refused.status, 1, 'the server must exit non-zero')
  assert.match(refused.stderr, /service_role/i)
  pass('a service_role key in the environment stops the server starting')

  // ── optional live pass ────────────────────────────────────────────────────
  if (live) {
    const ws = await read.callTool({ name: 'leads_list_workspaces', arguments: { response_format: 'json' } })
    assert.ok(!ws.isError, `leads_list_workspaces failed: ${JSON.stringify(ws.content)}`)
    const payload = ws.structuredContent as { workspaces: { id: string }[] }
    assert.ok(payload.workspaces.length > 0, 'expected at least one workspace')
    pass(`live: ${payload.workspaces.length} workspace(s): ${payload.workspaces.map((w) => w.id).join(', ')}`)

    for (const name of ['leads_metrics', 'leads_monthly_performance', 'leads_followups', 'leads_activity', 'leads_insights']) {
      const r = await read.callTool({ name, arguments: {} })
      assert.ok(!r.isError, `${name} failed: ${JSON.stringify(r.content)}`)
      pass(`live: ${name} returned a result`)
    }

    const search = await read.callTool({ name: 'leads_search', arguments: { limit: 5, response_format: 'json' } })
    assert.ok(!search.isError, `leads_search failed: ${JSON.stringify(search.content)}`)
    const page = search.structuredContent as { total: number; leads: unknown[] }
    assert.ok(Array.isArray(page.leads))
    pass(`live: leads_search sees ${page.total} lead(s)`)
  }

  console.error(`\nSmoke test passed (${checks} checks${live ? ', live' : ', offline'}).`)
}

main()
  .catch((e: unknown) => {
    console.error('\nSMOKE TEST FAILED:', e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  })
  .finally(async () => {
    // Close every child process, or a failed assertion hangs the run instead
    // of printing which check failed.
    await Promise.all(opened.map((c) => c.close().catch(() => {})))
    rmSync(sandbox, { recursive: true, force: true })
  })
