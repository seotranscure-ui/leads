#!/usr/bin/env node
/**
 * Transcure Leads MCP Server
 *
 * Exposes read-only tools over the Transcure SEO lead database (Supabase) so
 * Claude can answer questions about leads, funnel performance, collections and
 * revenue. Runs locally over stdio.
 *
 * Requires env vars:
 *   SUPABASE_URL               — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service_role key (kept local; bypasses RLS for read access)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

const CHARACTER_LIMIT = 25000
const PK_ZONE = 'Asia/Karachi'
const DEFAULT_CHARGE_PCT = 5
const FUNNEL_ORDER = ['Lead', 'Engaged', 'Demo', 'Audit', 'Negotiation', 'Won', 'Lost'] as const

// ---------- domain types & helpers (mirror the web app) ----------
interface Lead {
  record_id: string
  lead_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  source: string
  status: string
  stage: string
  specialty: string | null
  practice: string | null
  physicians: string | null
  monthly_collections: number | null
  created_utc: string | null
  manual_ticket: number | null
  manual_high: boolean | null
  manual_charge_pct: number | null
  manual_revenue_month: string | null
  manual_notes: string | null
  comments: string | null
}

const isWon = (s: string): boolean => s === 'Won'
const isDemo = (s: string): boolean => { const i = FUNNEL_ORDER.indexOf(s as (typeof FUNNEL_ORDER)[number]); return i >= 2 && i <= 5 }
const num = (v: unknown): number | null => { if (v == null) return null; const n = Number(v); return isNaN(n) ? null : n }
const ticketValue = (l: Lead): number | null => (l.manual_ticket != null ? num(l.manual_ticket) : l.monthly_collections != null ? num(l.monthly_collections) : null)
const chargePct = (l: Lead): number => (l.manual_charge_pct != null ? Number(l.manual_charge_pct) : DEFAULT_CHARGE_PCT)
const leadRevenue = (l: Lead): number => { const t = ticketValue(l); return t == null ? 0 : (t * chargePct(l)) / 100 }
const displayName = (l: Lead): string => l.lead_name || `${l.first_name || ''} ${l.last_name || ''}`.trim() || '(no name)'
const fmtMoney = (n: number): string => '$' + Math.round(n).toLocaleString('en-US')
const pctStr = (a: number, b: number): string => (b ? ((a / b) * 100).toFixed(1) + '%' : '—')

function monthKeyOf(iso: string | null): { key: string; label: string } {
  if (!iso) return { key: 'unknown', label: 'Unknown date' }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return { key: 'unknown', label: 'Unknown date' }
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: PK_ZONE, year: 'numeric', month: '2-digit' }).formatToParts(d)) p[x.type] = x.value
  return { key: `${p.year}-${p.month}`, label: new Intl.DateTimeFormat('en-US', { timeZone: PK_ZONE, year: 'numeric', month: 'long' }).format(d) }
}
function pkDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: PK_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)) p[x.type] = x.value
  return `${p.year}-${p.month}-${p.day}`
}
function labelForKey(key: string): string {
  if (key === 'unknown') return 'Unknown date'
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(new Date(Date.UTC(y, m - 1, 1)))
}

// ---------- Supabase access ----------
let _client: SupabaseClient | null = null
function client(): SupabaseClient {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables.')
  _client = createClient(url, key, { auth: { persistSession: false } })
  return _client
}

async function fetchLeads(): Promise<Lead[]> {
  const all: Lead[] = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await client()
      .from('leads')
      .select('record_id, lead_name, first_name, last_name, email, phone, source, status, stage, specialty, practice, physicians, monthly_collections, created_utc, manual_ticket, manual_high, manual_charge_pct, manual_revenue_month, manual_notes, comments')
      .order('created_utc', { ascending: false, nullsFirst: false })
      .range(from, from + size - 1)
    if (error) throw new Error(error.message)
    all.push(...((data as unknown as Lead[]) || []))
    if (!data || data.length < size) break
  }
  return all
}

// ---------- shared filtering ----------
interface Filters {
  query?: string
  source?: string[]
  stage?: string[]
  status?: string[]
  specialty?: string
  high_ticket?: 'any' | 'yes' | 'no'
  won_only?: boolean
  date_from?: string
  date_to?: string
}
function applyFilters(leads: Lead[], f: Filters): Lead[] {
  return leads.filter((l) => {
    if (f.won_only && !isWon(l.stage)) return false
    if (f.source?.length && !f.source.includes(l.source)) return false
    if (f.stage?.length && !f.stage.includes(l.stage)) return false
    if (f.status?.length && !f.status.map((s) => s.toLowerCase()).includes((l.status || '').toLowerCase())) return false
    if (f.specialty && !(l.specialty || '').toLowerCase().includes(f.specialty.toLowerCase())) return false
    if (f.high_ticket === 'yes' && l.manual_high !== true) return false
    if (f.high_ticket === 'no' && l.manual_high === true) return false
    if (f.date_from || f.date_to) { const d = pkDate(l.created_utc); if (f.date_from && (!d || d < f.date_from)) return false; if (f.date_to && (!d || d > f.date_to)) return false }
    if (f.query) { const hay = `${displayName(l)} ${l.practice || ''} ${l.email || ''} ${l.specialty || ''} ${l.manual_notes || ''} ${l.comments || ''}`.toLowerCase(); if (!hay.includes(f.query.toLowerCase())) return false }
    return true
  })
}

const filterShape = {
  query: z.string().optional().describe('Free-text match on name, practice, email, specialty, notes.'),
  source: z.array(z.string()).optional().describe('Only these lead sources (e.g. ["SEO"]).'),
  stage: z.array(z.enum(FUNNEL_ORDER)).optional().describe('Only these funnel stages.'),
  status: z.array(z.string()).optional().describe('Only these raw Zoho statuses (e.g. ["Won Lead","Demo Scheduled"]).'),
  specialty: z.string().optional().describe('Specialty contains this text (e.g. "Dental").'),
  high_ticket: z.enum(['any', 'yes', 'no']).default('any').describe('Filter by manual high-ticket flag.'),
  won_only: z.boolean().default(false).describe('Only won/closed leads.'),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Created on/after this PK date, YYYY-MM-DD.'),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Created on/before this PK date, YYYY-MM-DD.'),
}
const RESP = { response_format: z.enum(['markdown', 'json']).default('markdown').describe("Output format: 'markdown' (human-readable) or 'json'.") }

function textResult(text: string) { return { content: [{ type: 'text' as const, text }] } }
function errResult(e: unknown) { return { content: [{ type: 'text' as const, text: 'Error: ' + (e instanceof Error ? e.message : String(e)) }], isError: true } }

// ---------- server ----------
const server = new McpServer({ name: 'transcure-leads-mcp-server', version: '1.0.0' })

server.registerTool(
  'transcure_search_leads',
  {
    title: 'Search leads',
    description: `Search/list Transcure SEO leads with filters. Read-only.

Args: query, source[], stage[] (Lead|Engaged|Demo|Audit|Negotiation|Won|Lost), status[], specialty, high_ticket (any|yes|no), won_only, date_from, date_to (YYYY-MM-DD PK), limit (1-200, default 50), offset, response_format.

Returns each lead's name, email, practice, specialty, source, status, stage, monthly collection, charge %, revenue, and created date (PK). Use for "list/find" questions; use transcure_lead_metrics for aggregate counts.`,
    inputSchema: { ...filterShape, limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0), ...RESP },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (p) => {
    try {
      const filtered = applyFilters(await fetchLeads(), p)
      const total = filtered.length
      const page = filtered.slice(p.offset, p.offset + p.limit)
      const rows = page.map((l) => ({
        name: displayName(l), email: l.email, practice: l.practice, specialty: l.specialty,
        source: l.source, status: l.status, stage: l.stage,
        monthly_collections: ticketValue(l), charge_pct: chargePct(l), revenue: Math.round(leadRevenue(l)),
        created_pk: monthKeyOf(l.created_utc).key === 'unknown' ? null : pkDate(l.created_utc),
      }))
      const hasMore = total > p.offset + page.length
      if (p.response_format === 'json') {
        const out = JSON.stringify({ total, count: page.length, offset: p.offset, has_more: hasMore, leads: rows }, null, 2)
        return textResult(out.length > CHARACTER_LIMIT ? JSON.stringify({ total, count: page.length, offset: p.offset, has_more: true, truncated: true, note: 'Response too large — narrow filters or lower limit.', leads: rows.slice(0, 20) }, null, 2) : out)
      }
      if (!total) return textResult('No leads match those filters.')
      const lines = [`# Leads — ${total} match(es), showing ${page.length}${hasMore ? ` (offset ${p.offset}; more available)` : ''}`, '']
      for (const r of rows) {
        lines.push(`## ${r.name}${r.practice ? ` — ${r.practice}` : ''}`)
        lines.push(`- Stage: ${r.stage} · Status: ${r.status} · Source: ${r.source}${r.specialty ? ` · ${r.specialty}` : ''}`)
        lines.push(`- Collection: ${r.monthly_collections != null ? fmtMoney(r.monthly_collections) + '/mo' : '—'} · Charge ${r.charge_pct}% · Revenue ${fmtMoney(r.revenue)}/mo`)
        lines.push(`- ${r.email || 'no email'} · created ${r.created_pk || '—'} (PK)`)
        lines.push('')
      }
      let text = lines.join('\n')
      if (text.length > CHARACTER_LIMIT) text = text.slice(0, CHARACTER_LIMIT) + '\n\n… truncated — narrow filters or lower limit.'
      return textResult(text)
    } catch (e) { return errResult(e) }
  },
)

server.registerTool(
  'transcure_lead_metrics',
  {
    title: 'Lead metrics & conversion',
    description: `Aggregate funnel + money metrics over leads (optionally filtered). Read-only.

Args: query, source[], stage[], status[], specialty, high_ticket, won_only, date_from, date_to, response_format.

Returns: total leads, demos (reached demo+), sales (won), Leads→Demos %, Demos→Sales %, high-ticket count, total won collections, revenue (won, our charge %), and lost revenue (charge % of non-won leads that have a collection). Use for "how many / what % / how much" questions.`,
    inputSchema: { ...filterShape, ...RESP },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (p) => {
    try {
      const leads = applyFilters(await fetchLeads(), p)
      const demos = leads.filter((l) => isDemo(l.stage)).length
      const sales = leads.filter((l) => isWon(l.stage)).length
      const highTicket = leads.filter((l) => l.manual_high === true).length
      const wonCollections = leads.filter((l) => isWon(l.stage)).reduce((s, l) => s + (ticketValue(l) || 0), 0)
      const revenueWon = leads.filter((l) => isWon(l.stage)).reduce((s, l) => s + leadRevenue(l), 0)
      const lostRevenue = leads.filter((l) => !isWon(l.stage) && ticketValue(l) != null).reduce((s, l) => s + leadRevenue(l), 0)
      const m = {
        total_leads: leads.length, demos, sales, high_ticket: highTicket,
        leads_to_demos_pct: pctStr(demos, leads.length), demos_to_sales_pct: pctStr(sales, demos),
        won_collections: Math.round(wonCollections), revenue_won: Math.round(revenueWon), lost_revenue: Math.round(lostRevenue),
      }
      if (p.response_format === 'json') return textResult(JSON.stringify(m, null, 2))
      return textResult([
        '# Lead metrics',
        `- Total leads: **${m.total_leads}**`,
        `- Demos (reached demo+): **${demos}** (${m.leads_to_demos_pct} of leads)`,
        `- Sales (won): **${sales}** (${m.demos_to_sales_pct} of demos)`,
        `- High-ticket: **${highTicket}**`,
        `- Won collections: **${fmtMoney(wonCollections)}/mo**`,
        `- Revenue (won, our charge %): **${fmtMoney(revenueWon)}/mo**`,
        `- Lost revenue (non-won w/ collection): **${fmtMoney(lostRevenue)}/mo**`,
      ].join('\n'))
    } catch (e) { return errResult(e) }
  },
)

server.registerTool(
  'transcure_monthly_performance',
  {
    title: 'Monthly performance',
    description: `Per-month table: leads (by CRM arrival month), demos, sales, collections and revenue (recognized in each won lead's revenue month, default its arrival month). Read-only. Args: response_format. Newest month first.`,
    inputSchema: { ...RESP },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (p) => {
    try {
      const leads = await fetchLeads()
      const map: Record<string, { key: string; label: string; leads: number; demos: number; sales: number; coll: number; rev: number }> = {}
      const bucket = (key: string, label: string) => (map[key] ||= { key, label, leads: 0, demos: 0, sales: 0, coll: 0, rev: 0 })
      for (const l of leads) {
        const created = monthKeyOf(l.created_utc)
        const cb = bucket(created.key, created.label); cb.leads++; if (isDemo(l.stage)) cb.demos++
        if (isWon(l.stage)) { const k = l.manual_revenue_month || created.key; const ab = bucket(k, k === created.key ? created.label : labelForKey(k)); ab.sales++; ab.coll += ticketValue(l) || 0; ab.rev += leadRevenue(l) }
      }
      const rows = Object.values(map).sort((a, b) => (a.key < b.key ? 1 : -1))
      if (p.response_format === 'json') return textResult(JSON.stringify(rows.map((r) => ({ month: r.label, leads: r.leads, demos: r.demos, sales: r.sales, collections: Math.round(r.coll), revenue: Math.round(r.rev), leads_to_demos: pctStr(r.demos, r.leads), demos_to_sales: pctStr(r.sales, r.demos) })), null, 2))
      const lines = ['# Monthly performance', '', '| Month | Leads | Demos | Sales | Collections | Revenue | L→D | D→S |', '|---|--:|--:|--:|--:|--:|--:|--:|']
      for (const r of rows) lines.push(`| ${r.label} | ${r.leads} | ${r.demos} | ${r.sales} | ${fmtMoney(r.coll)} | ${fmtMoney(r.rev)} | ${pctStr(r.demos, r.leads)} | ${pctStr(r.sales, r.demos)} |`)
      return textResult(lines.join('\n'))
    } catch (e) { return errResult(e) }
  },
)

server.registerTool(
  'transcure_breakdown',
  {
    title: 'Breakdown by source or specialty',
    description: `Group leads by "source" or "specialty" with counts and money. Read-only. Args: dimension ('source'|'specialty'), response_format. Returns leads, demos, sales, collections, revenue per group, sorted by leads desc.`,
    inputSchema: { dimension: z.enum(['source', 'specialty']).describe("Group by 'source' or 'specialty'."), ...RESP },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (p) => {
    try {
      const leads = await fetchLeads()
      const map: Record<string, { leads: number; demos: number; sales: number; coll: number; rev: number }> = {}
      for (const l of leads) {
        const key = (p.dimension === 'source' ? l.source : (l.specialty || '').trim() || '(unspecified)') || '(blank)'
        const g = (map[key] ||= { leads: 0, demos: 0, sales: 0, coll: 0, rev: 0 })
        g.leads++; if (isDemo(l.stage)) g.demos++
        if (isWon(l.stage)) { g.sales++; g.coll += ticketValue(l) || 0; g.rev += leadRevenue(l) }
      }
      const rows = Object.entries(map).sort((a, b) => b[1].leads - a[1].leads)
      if (p.response_format === 'json') return textResult(JSON.stringify(rows.map(([k, v]) => ({ [p.dimension]: k, leads: v.leads, demos: v.demos, sales: v.sales, collections: Math.round(v.coll), revenue: Math.round(v.rev) })), null, 2))
      const lines = [`# Breakdown by ${p.dimension}`, '', `| ${p.dimension} | Leads | Demos | Sales | Collections | Revenue |`, '|---|--:|--:|--:|--:|--:|']
      for (const [k, v] of rows) lines.push(`| ${k} | ${v.leads} | ${v.demos} | ${v.sales} | ${fmtMoney(v.coll)} | ${fmtMoney(v.rev)} |`)
      return textResult(lines.join('\n'))
    } catch (e) { return errResult(e) }
  },
)

async function main(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.')
    process.exit(1)
  }
  await server.connect(new StdioServerTransport())
  console.error('transcure-leads-mcp-server running on stdio')
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
