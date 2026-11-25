/**
 * Logic self-test: `npm run selftest`.
 *
 * Exercises everything that does not need a database — the funnel mapping, the
 * money rules, filtering, the monthly split between arrival month and revenue
 * month, CSV import mapping, the response budget, text sanitising and the
 * confirmation gate. These are the parts where a quiet mistake would produce
 * numbers that look plausible and are wrong.
 */
import { strict as assert } from 'node:assert'
import { confirmPhrase, looksLikeSecretKey } from '../src/config.js'
import { timingSafeEqual } from '../src/env.js'
import { csvRowToLead, parseCSV, rowsToObjects } from '../src/csv.js'
import {
  bareRecordId, defaultDates, displayName, effectiveEmail, fixRange, isDemoIn, isHigh, isLostIn,
  isUnmappedStatus, isWonIn, leadRevenue, monthKeyOf, parseSourceTime, pendingChannels,
  scopedRecordId, stageForIn, stepComplete, stripHtml, ticketValue,
  type FollowUpSequence, type FollowUpStep, type FunnelConfig, type Lead, type Project,
} from '../src/domain.js'
import { applyFilters, describeFilters, dimensionValue } from '../src/filters.js'
import { fitToBudget, safeText, sanitiseForStorage } from '../src/format.js'
import {
  aggregate, change, compareWindows, monthlyStats, ratePct, recentMonthKeys, sumRows, type Ctx,
} from '../src/metrics.js'

let passed = 0
const check = (name: string, fn: () => void): void => {
  try { fn(); passed++ } catch (e) {
    console.error(`FAIL  ${name}\n      ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const funnel: FunnelConfig = {
  stages: [
    { name: 'Lead', color: '#94a3b8', reachedDemo: false, won: false, lost: false, statuses: [] },
    { name: 'Engaged', color: '#3b82f6', reachedDemo: false, won: false, lost: false, statuses: ['contacted'] },
    { name: 'Demo', color: '#6366f1', reachedDemo: true, won: false, lost: false, statuses: ['demo scheduled'] },
    { name: 'Negotiation', color: '#0891b2', reachedDemo: true, won: false, lost: false, statuses: ['agreement sent'] },
    { name: 'Won', color: '#15803d', reachedDemo: true, won: true, lost: false, statuses: ['won lead'] },
    { name: 'Lost', color: '#dc2626', reachedDemo: false, won: false, lost: true, statuses: ['lost lead'] },
  ],
}

const project: Project = {
  id: 'macralytics', name: 'Macralytics', sort_order: 20, record_id_prefix: 'mac',
  logo_data_url: null, high_ticket_rule: { op: 'gte', value: 50000 }, default_charge_pct: 5,
  follow_up_manager_email: 'ops@example.com',
  follow_up_automation: { enabled: true, digestHour: 9, timezone: 'Asia/Karachi', graceDays: 7, remindOverdueDaily: true },
  funnel, follow_up_stage: 'Negotiation', created_at: '2026-01-01T00:00:00Z',
}

const ctx: Ctx = { funnel, rule: { op: 'gte', value: 50000 }, chargePct: 5 }

const lead = (over: Partial<Lead>): Lead => ({
  record_id: 'r1', project_id: 'p', lead_owner: null, company: null, first_name: null, last_name: null,
  lead_name: 'Test Lead', email: null, phone: null, source: 'SEO', status: '', stage: 'Lead', tag: null,
  specialty: null, practice: null, physicians: null, monthly_collections: null, first_page: null,
  referrer: null, message: null, comments: null, phase: null, created_utc: '2026-03-10T08:00:00Z',
  modified_utc: null, manual_ticket: null, manual_high: null, manual_notes: null,
  manual_source_medium: null, manual_first_landing: null, manual_second_page: null,
  manual_submit_page: null, manual_search_query: null, manual_recording: null,
  manual_charge_pct: null, manual_revenue_month: null, ...over,
})

// ── funnel mapping ───────────────────────────────────────────────────────────

check('status maps to its stage, case-insensitively', () => {
  assert.equal(stageForIn(funnel, 'Agreement Sent'), 'Negotiation')
  assert.equal(stageForIn(funnel, '  WON LEAD '), 'Won')
})

check('an unknown status falls back to the first stage and is reported as unmapped', () => {
  assert.equal(stageForIn(funnel, 'Nurturing'), 'Lead')
  assert.equal(isUnmappedStatus(funnel, 'Nurturing'), true)
  assert.equal(isUnmappedStatus(funnel, 'Won Lead'), false)
  // A blank status is simply unset, not a mapping gap worth flagging.
  assert.equal(isUnmappedStatus(funnel, ''), false)
})

check('stage flags drive demo / won / lost rather than position', () => {
  assert.equal(isDemoIn(funnel, 'Demo'), true)
  assert.equal(isDemoIn(funnel, 'Engaged'), false)
  assert.equal(isWonIn(funnel, 'Won'), true)
  assert.equal(isLostIn(funnel, 'Lost'), true)
  assert.equal(isLostIn(funnel, 'Won'), false)
})

// ── money ────────────────────────────────────────────────────────────────────

check('manual ticket overrides the CRM collection', () => {
  assert.equal(ticketValue(lead({ monthly_collections: 10000 })), 10000)
  assert.equal(ticketValue(lead({ monthly_collections: 10000, manual_ticket: 42000 })), 42000)
  assert.equal(ticketValue(lead({})), null)
})

check('revenue is charge % of the ticket, per-lead override winning', () => {
  assert.equal(leadRevenue(lead({ monthly_collections: 20000 }), 5), 1000)
  assert.equal(leadRevenue(lead({ monthly_collections: 20000, manual_charge_pct: 8 }), 5), 1600)
  assert.equal(leadRevenue(lead({}), 5), 0)
})

check('high-ticket honours every operator and the manual override', () => {
  const l = lead({ monthly_collections: 50000 })
  assert.equal(isHigh(l, { op: 'gte', value: 50000 }), true)
  assert.equal(isHigh(l, { op: 'gt', value: 50000 }), false)
  assert.equal(isHigh(l, { op: 'lte', value: 50000 }), true)
  assert.equal(isHigh(l, { op: 'lt', value: 50000 }), false)
  assert.equal(isHigh(l, { op: 'between', value: 40000, value2: 60000 }), true)
  assert.equal(isHigh(l, { op: 'between', value: 10000, value2: 20000 }), false)
  // Overrides beat the rule in both directions.
  assert.equal(isHigh(lead({ monthly_collections: 1, manual_high: true }), { op: 'gte', value: 50000 }), true)
  assert.equal(isHigh(lead({ monthly_collections: 999999, manual_high: false }), { op: 'gte', value: 50000 }), false)
  // No ticket at all is never high.
  assert.equal(isHigh(lead({}), { op: 'gte', value: 0 }), false)
})

// ── aggregation ──────────────────────────────────────────────────────────────

const population: Lead[] = [
  lead({ record_id: 'a', stage: 'Won', monthly_collections: 60000, created_utc: '2026-01-15T08:00:00Z' }),
  lead({ record_id: 'b', stage: 'Won', monthly_collections: 20000, created_utc: '2026-02-15T08:00:00Z', manual_revenue_month: '2026-03' }),
  lead({ record_id: 'c', stage: 'Demo', monthly_collections: 30000, created_utc: '2026-02-20T08:00:00Z' }),
  lead({ record_id: 'd', stage: 'Lost', monthly_collections: 10000, created_utc: '2026-02-25T08:00:00Z' }),
  lead({ record_id: 'e', stage: 'Lead', created_utc: '2026-03-01T08:00:00Z', source: 'Referral' }),
]

check('aggregate splits won / lost / open and never double-counts a lead', () => {
  const a = aggregate(population, ctx)
  assert.equal(a.leads, 5)
  assert.equal(a.demos, 3, 'Won and Demo are demo-reached; Lead and Lost are not')
  assert.equal(a.sales, 2)
  assert.equal(a.lost, 1)
  assert.equal(a.open, 2, 'Demo and Lead are still open')
  assert.equal(a.sales + a.lost + a.open, a.leads)
  assert.equal(a.wonCollections, 80000)
  assert.equal(a.revenue, 4000)
  assert.equal(a.lostRevenue, 500)
  assert.equal(a.pipelineValue, 1500, 'Demo 30000 * 5% = 1500; the Lead has no ticket')
  assert.equal(a.highTicket, 1)
})

check('monthly stats recognise revenue in the override month, not the arrival month', () => {
  const rows = monthlyStats(population, ctx)
  const by = new Map(rows.map((r) => [r.key, r]))
  // Lead "b" arrived in February but is attributed to March.
  assert.equal(by.get('2026-02')!.leads, 3)
  assert.equal(by.get('2026-02')!.sales, 0, 'its sale moved to March')
  assert.equal(by.get('2026-03')!.sales, 1)
  assert.equal(by.get('2026-03')!.revenue, 1000)
  assert.equal(by.get('2026-03')!.leads, 1, 'only lead "e" arrived in March')
  assert.equal(by.get('2026-01')!.sales, 1)
  // Newest month first.
  assert.equal(rows[0].key, '2026-03')
})

check('month totals reconcile with the flat aggregate', () => {
  const rows = monthlyStats(population, ctx)
  const summed = sumRows(rows)
  const flat = aggregate(population, ctx)
  assert.equal(summed.leads, flat.leads)
  assert.equal(summed.sales, flat.sales)
  assert.equal(summed.revenue, flat.revenue)
  assert.equal(summed.wonCollections, flat.wonCollections)
})

check('rates guard against dividing by zero', () => {
  assert.equal(ratePct(3, 10), '30.0%')
  assert.equal(ratePct(0, 0), '-')
  assert.equal(change(10, 0), null, 'growth from nothing is undefined, not infinite')
  assert.equal(change(15, 10), 50)
})

check('recentMonthKeys walks backwards across a year boundary', () => {
  assert.deepEqual(recentMonthKeys('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02'])
})

check('period-on-period windows are adjacent and do not overlap', () => {
  const { older, recent } = compareWindows('2026-03', 3)
  assert.deepEqual(recent, ['2026-01', '2026-02', '2026-03'])
  assert.deepEqual(older, ['2025-10', '2025-11', '2025-12'], 'the previous window must end where the recent one begins')
  assert.equal(older.filter((k) => recent.includes(k)).length, 0, 'no month may be counted twice')
  // Single-month comparison is just last month against the one before it.
  const one = compareWindows('2026-01', 1)
  assert.deepEqual(one.recent, ['2026-01'])
  assert.deepEqual(one.older, ['2025-12'])
})

// ── filtering ────────────────────────────────────────────────────────────────

check('outcome filters use the workspace terminal stages', () => {
  const rule = ctx.rule
  assert.equal(applyFilters(population, { outcome: 'won' }, funnel, rule).length, 2)
  assert.equal(applyFilters(population, { outcome: 'lost' }, funnel, rule).length, 1)
  assert.equal(applyFilters(population, { outcome: 'open' }, funnel, rule).length, 2)
  assert.equal(applyFilters(population, { outcome: 'reached_demo' }, funnel, rule).length, 3)
  assert.equal(applyFilters(population, { outcome: 'any' }, funnel, rule).length, 5)
})

check('source and stage filters are exact but case-insensitive', () => {
  assert.equal(applyFilters(population, { source: ['seo'] }, funnel, ctx.rule).length, 4)
  assert.equal(applyFilters(population, { stage: ['WON'] }, funnel, ctx.rule).length, 2)
  assert.equal(applyFilters(population, { source: ['SE'] }, funnel, ctx.rule).length, 0, 'not a substring match')
})

check('month is shorthand for a date range, in Pakistan time', () => {
  const byMonth = applyFilters(population, { month: '2026-02' }, funnel, ctx.rule)
  const byRange = applyFilters(population, { date_from: '2026-02-01', date_to: '2026-02-28' }, funnel, ctx.rule)
  assert.equal(byMonth.length, 3)
  assert.deepEqual(byMonth.map((l) => l.record_id), byRange.map((l) => l.record_id))
})

check('collection bounds exclude leads with no ticket at all', () => {
  const out = applyFilters(population, { min_collections: 1 }, funnel, ctx.rule)
  assert.equal(out.length, 4)
  assert.equal(out.some((l) => l.record_id === 'e'), false)
  assert.equal(applyFilters(population, { min_collections: 25000, max_collections: 60000 }, funnel, ctx.rule).length, 2)
})

check('free text searches across the fields a person would try', () => {
  const pop = [lead({ record_id: 'x', practice: 'Lakeside Dental', comments: 'wants a call back' })]
  assert.equal(applyFilters(pop, { query: 'lakeside' }, funnel, ctx.rule).length, 1)
  assert.equal(applyFilters(pop, { query: 'call back' }, funnel, ctx.rule).length, 1)
  assert.equal(applyFilters(pop, { query: 'nonsense' }, funnel, ctx.rule).length, 0)
})

check('manual notes shadow CRM comments in search, as they do on screen', () => {
  const pop = [lead({ comments: 'old crm text', manual_notes: 'corrected note' })]
  assert.equal(applyFilters(pop, { query: 'corrected' }, funnel, ctx.rule).length, 1)
  assert.equal(applyFilters(pop, { query: 'old crm' }, funnel, ctx.rule).length, 0)
})

check('has_email distinguishes blank from whitespace', () => {
  const pop = [lead({ record_id: '1', email: 'a@b.com' }), lead({ record_id: '2', email: '   ' }), lead({ record_id: '3', email: null })]
  assert.equal(applyFilters(pop, { has_email: true }, funnel, ctx.rule).length, 1)
  assert.equal(applyFilters(pop, { has_email: false }, funnel, ctx.rule).length, 2)
})

check('describeFilters reports what was actually applied', () => {
  assert.equal(describeFilters({}), 'no filters')
  assert.match(describeFilters({ source: ['SEO'], outcome: 'won' }), /source SEO.*won/)
})

check('dimension values bucket blanks explicitly', () => {
  assert.equal(dimensionValue(lead({ specialty: null }), 'specialty', ctx.rule), '(unspecified)')
  assert.equal(dimensionValue(lead({ lead_owner: '  ' }), 'owner', ctx.rule), '(unassigned)')
  assert.equal(dimensionValue(lead({ monthly_collections: 60000 }), 'high_ticket', ctx.rule), 'High ticket')
  assert.equal(dimensionValue(lead({ created_utc: '2026-03-10T08:00:00Z' }), 'month', ctx.rule), '2026-03')
})

// ── record ids ───────────────────────────────────────────────────────────────

check('record ids are namespaced per workspace, idempotently', () => {
  assert.equal(scopedRecordId(project, '12345'), 'mac:12345')
  assert.equal(scopedRecordId(project, 'mac:12345'), 'mac:12345', 'already prefixed ids are left alone')
  assert.equal(scopedRecordId({ record_id_prefix: null }, '12345'), '12345', 'the original workspace keeps bare ids')
  assert.equal(bareRecordId('mac:12345'), '12345')
  assert.equal(bareRecordId('12345'), '12345')
})

// ── follow-ups ───────────────────────────────────────────────────────────────

const step = (over: Partial<FollowUpStep>): FollowUpStep => ({
  id: 's1', sequence_id: 'q1', step_number: 1, scheduled_date: '2026-03-01',
  channels: ['Email', 'SMS'], completed_channels: [], status: 'pending', completed_at: null, notes: null, ...over,
})

check('a week is done only when every one of its channels is', () => {
  assert.deepEqual(pendingChannels(step({})), ['Email', 'SMS'])
  assert.deepEqual(pendingChannels(step({ completed_channels: ['Email'] })), ['SMS'])
  assert.equal(stepComplete(step({ completed_channels: ['Email'] })), false)
  assert.equal(stepComplete(step({ completed_channels: ['Email', 'SMS'] })), true)
  // A null completed list (pre-migration row) must not crash or read as done.
  assert.equal(stepComplete(step({ completed_channels: null })), false)
})

check('default dates are five weeks, seven days apart', () => {
  const d = defaultDates('2026-03-02')
  assert.equal(d.length, 5)
  assert.equal(d[0], '2026-03-02')
  assert.equal(d[4], '2026-03-30')
})

check('the reminder address falls back to the workspace default', () => {
  const seq = (email: string | null): FollowUpSequence => ({
    id: 'q', project_id: 'p', lead_record_id: 'r', manager_email: email,
    started_at: '', started_by: null, status: 'active', created_at: '',
  })
  assert.equal(effectiveEmail(seq('me@example.com'), 'ops@example.com'), 'me@example.com')
  assert.equal(effectiveEmail(seq(null), 'ops@example.com'), 'ops@example.com')
  assert.equal(effectiveEmail(seq('   '), 'ops@example.com'), 'ops@example.com', 'a blank override is not an address')
})

// ── CSV import ───────────────────────────────────────────────────────────────

check('the CSV parser handles quotes, embedded commas and newlines', () => {
  const rows = parseCSV('a,b\n"x,1","line1\nline2"\n"say ""hi""",z\n')
  assert.deepEqual(rows[1], ['x,1', 'line1\nline2'])
  assert.deepEqual(rows[2], ['say "hi"', 'z'])
})

check('rowsToObjects skips fully blank rows and pads short ones', () => {
  const objs = rowsToObjects(parseCSV('a,b,c\n1,2\n\n,,\n4,5,6\n'))
  assert.equal(objs.length, 2)
  assert.deepEqual(objs[0], { a: '1', b: '2', c: '' })
})

check('a CRM row maps to the right stage, ticket, id and cleaned comments', () => {
  const row = {
    'Record Id': '999', 'Lead Name': 'Dr Chen', 'Lead Status': 'Agreement Sent',
    'Lead Source': 'SEO', 'Monthly Collections': '$62,500', 'Number of Physicians': '5-Feb',
    'Comments': '<p>Wants a call</p><br>next week', 'Created Time': '2026-03-10 08:27:31',
  }
  const out = csvRowToLead(row, project)
  assert.equal(out.record_id, 'mac:999', 'namespaced for this workspace')
  assert.equal(out.stage, 'Negotiation')
  assert.equal(out.monthly_collections, 62500, 'currency formatting stripped')
  assert.equal(out.physicians, '2-5', 'Excel date-mangling undone')
  assert.equal(out.comments, 'Wants a call ' + String.fromCharCode(0x2022) + ' next week',
    'block tags flatten to the same bullet separator the web app uses')
  // 08:27 US Central in March is CDT (UTC-5), so 13:27 UTC.
  assert.equal(out.created_utc, '2026-03-10T13:27:31.000Z')
})

check('CRM timestamps are read as US Central, not as local or UTC', () => {
  // January is CST (UTC-6); July is CDT (UTC-5). Getting this wrong shifts
  // leads near midnight into the wrong month.
  assert.equal(parseSourceTime('2026-01-15 10:00:00')!.toISOString(), '2026-01-15T16:00:00.000Z')
  assert.equal(parseSourceTime('2026-07-15 10:00:00')!.toISOString(), '2026-07-15T15:00:00.000Z')
  assert.equal(parseSourceTime('7/15/2026 10:00 PM')!.toISOString(), '2026-07-16T03:00:00.000Z')
  assert.equal(parseSourceTime(''), null)
  assert.equal(parseSourceTime('not a date'), null)
})

check('month keys are computed in Pakistan time', () => {
  // 2026-03-31 20:00 UTC is 2026-04-01 01:00 in Karachi.
  assert.equal(monthKeyOf('2026-03-31T20:00:00Z').key, '2026-04')
  assert.equal(monthKeyOf(null).key, 'unknown')
})

check('helpers degrade gracefully on missing values', () => {
  assert.equal(displayName(lead({ lead_name: null, first_name: 'A', last_name: 'B' })), 'A B')
  assert.equal(displayName(lead({ lead_name: null, first_name: null, last_name: null })), '(no name)')
  assert.equal(fixRange(null), '')
  assert.equal(stripHtml(null), '')
})

// ── output safety ────────────────────────────────────────────────────────────

check('safeText removes control characters that could fake structure', () => {
  assert.equal(safeText('hello\u0000‮world'), 'hello world')
  assert.equal(safeText('a'.repeat(50), 10).length, 11, 'truncated plus the ellipsis')
  assert.equal(safeText(null), '')
  assert.equal(sanitiseForStorage('ok\u0007text'), 'ok text')
})

check('fitToBudget drops items rather than cutting text', () => {
  const items = Array.from({ length: 64 }, (_, i) => i)
  const render = (slice: number[]) => ({
    text: slice.map((n) => `item ${n} `.repeat(20)).join('\n'),
    payload: { count: slice.length },
  })
  const out = fitToBudget(items, render, 2000)
  assert.ok(out.text.length <= 2000, `expected <=2000 chars, got ${out.text.length}`)
  assert.ok(out.dropped > 0, 'some items should have been dropped')
  assert.equal(out.payload.count, items.length - out.dropped, 'the payload reports what was actually included')
})

check('fitToBudget keeps at least one item even when it alone is oversized', () => {
  const out = fitToBudget([1], () => ({ text: 'x'.repeat(5000), payload: {} }), 100)
  assert.equal(out.dropped, 0)
})

// ── confirmation gate ────────────────────────────────────────────────────────

check('confirmation phrases name the specific target', () => {
  assert.equal(confirmPhrase('delete', 'mac:999'), 'DELETE mac:999')
  assert.notEqual(confirmPhrase('DELETE', 'a'), confirmPhrase('DELETE', 'b'))
})

check('a Supabase secret key is recognised whatever variable it arrived in', () => {
  // The new prefixed format.
  assert.equal(looksLikeSecretKey('sb_secret_abc123'), true)
  assert.equal(looksLikeSecretKey('SB_SECRET_ABC'), true)
  assert.equal(looksLikeSecretKey('sb_publishable_abc123'), false)
  // A legacy JWT is judged by its role claim, not its shape.
  const jwt = (payload: object): string =>
    ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.')
  assert.equal(looksLikeSecretKey(jwt({ role: 'service_role' })), true)
  assert.equal(looksLikeSecretKey(jwt({ role: 'anon' })), false)
  assert.equal(looksLikeSecretKey(jwt({})), false)
  // Nothing here may throw on junk: it runs before anything else is validated.
  assert.equal(looksLikeSecretKey(''), false)
  assert.equal(looksLikeSecretKey('not.a.jwt'), false)
  assert.equal(looksLikeSecretKey('a.b'), false)
})

check('token comparison is length-independent and still correct', () => {
  assert.equal(timingSafeEqual('secret', 'secret'), true)
  assert.equal(timingSafeEqual('secret', 'secreu'), false)
  assert.equal(timingSafeEqual('secret', 'secre'), false, 'a prefix must not pass')
  assert.equal(timingSafeEqual('secret', 'secretx'), false, 'an extension must not pass')
  assert.equal(timingSafeEqual('', ''), true)
  assert.equal(timingSafeEqual('', 'x'), false)
  // Multi-byte characters compare by their encoded bytes, not by code unit.
  assert.equal(timingSafeEqual('tokén', 'tokén'), true)
  assert.equal(timingSafeEqual('tokén', 'token'), false)
})

if (process.exitCode) console.error(`\n${passed} check(s) passed, some failed.`)
else console.log(`All ${passed} checks passed.`)
