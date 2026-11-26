/**
 * Workspace (project) tools: read the configuration that every other tool
 * depends on, and change it.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { ResponseFormat, RESPONSE_FORMAT, bullet, json, table, text } from '../format.js'
import { ruleLabel, stageForIn, type FunnelConfig, type FunnelStage } from '../domain.js'
import { listProjects, remapStages, updateProject } from '../repo.js'
import { WORKSPACE } from '../filters.js'
import { guard, guardWrite, workspace } from './common.js'
import { settings } from '../supabase.js'

const StageSchema = z.object({
  name: z.string().min(1).max(60).describe('Stage name as it appears in the app.'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('Hex colour for bars and badges, e.g. "#0891b2".'),
  reachedDemo: z.boolean().describe('Counts toward the Leads to Demos ratio.'),
  won: z.boolean().describe('The terminal won stage. Exactly one stage must have this.'),
  lost: z.boolean().describe('The terminal lost stage. Exactly one stage must have this.'),
  statuses: z.array(z.string().max(100)).max(60)
    .describe('CRM status values that map onto this stage. Lower-cased on save.'),
})

/** The same rules the in-app funnel editor enforces, so both paths agree. */
function validateFunnel(stages: FunnelStage[]): string | null {
  const names = stages.map((s) => s.name.trim())
  if (stages.length < 2) return 'A funnel needs at least two stages.'
  if (names.some((n) => !n)) return 'Every stage needs a name.'
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return 'Stage names must be unique.'
  if (stages.filter((s) => s.won).length !== 1) return 'Exactly one stage must be marked won.'
  if (stages.filter((s) => s.lost).length !== 1) return 'Exactly one stage must be marked lost.'
  const seen = new Map<string, string>()
  for (const s of stages) {
    for (const raw of s.statuses) {
      const st = raw.trim().toLowerCase()
      if (!st) continue
      const owner = seen.get(st)
      if (owner) return `Status "${st}" is mapped to both ${owner} and ${s.name.trim()}.`
      seen.set(st, s.name.trim())
    }
  }
  return null
}

export function registerWorkspaceRead(server: McpServer): void {
  server.registerTool(
    'leads_list_workspaces',
    {
      title: 'List workspaces',
      description: `List every workspace (business) in the lead tracker with its full configuration: funnel stages and the CRM statuses mapped to each, the high-ticket rule, default charge %, follow-up manager email, reminder automation settings, and which stage enrols a lead in the 5-week follow-up sequence.

Call this first when you do not know the workspace ids, when a stage or status name needs checking, or before interpreting money figures — the charge % and high-ticket rule differ per workspace.

Returns one entry per workspace. Read-only.`,
      inputSchema: z.strictObject({ response_format: RESPONSE_FORMAT }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ response_format }) => {
      const projects = await listProjects(true)
      const def = settings().defaultProject
      const payload = {
        default_workspace: def,
        server_mode: settings().mode,
        count: projects.length,
        workspaces: projects.map((p) => ({
          id: p.id,
          name: p.name,
          is_default: p.id === def,
          record_id_prefix: p.record_id_prefix,
          high_ticket_rule: p.high_ticket_rule,
          high_ticket_rule_label: ruleLabel(p.high_ticket_rule),
          default_charge_pct: Number(p.default_charge_pct),
          follow_up_manager_email: p.follow_up_manager_email,
          follow_up_stage: p.follow_up_stage,
          follow_up_automation: p.follow_up_automation,
          stages: p.funnel.stages.map((s) => ({
            name: s.name, reached_demo: s.reachedDemo, won: s.won, lost: s.lost,
            color: s.color, statuses: s.statuses,
          })),
        })),
      }
      if (response_format === ResponseFormat.JSON) return json(payload)

      const lines: string[] = [`# Workspaces (${projects.length})`, '', `Server mode: **${settings().mode}** · default workspace: **${def}**`, '']
      for (const p of projects) {
        lines.push(`## ${p.name} (\`${p.id}\`)${p.id === def ? ' — default' : ''}`)
        lines.push(bullet('High-ticket rule', ruleLabel(p.high_ticket_rule)))
        lines.push(bullet('Default charge', `${Number(p.default_charge_pct)}%`))
        lines.push(bullet('Follow-up stage', p.follow_up_stage ?? 'disabled'))
        lines.push(bullet('Reminder email', p.follow_up_manager_email || '(not set)'))
        const a = p.follow_up_automation
        lines.push(bullet('Automation', a?.enabled
          ? `on, digest ${a.digestHour}:00 ${a.timezone}, grace ${a.graceDays}d, overdue daily: ${a.remindOverdueDaily ? 'yes' : 'no'}`
          : 'off'))
        if (p.record_id_prefix) lines.push(bullet('Record id prefix', `${p.record_id_prefix}:`))
        lines.push('')
        lines.push(table(
          ['Stage', 'Demo?', 'Won', 'Lost', 'CRM statuses'],
          p.funnel.stages.map((s) => [
            s.name, s.reachedDemo ? 'yes' : '', s.won ? 'yes' : '', s.lost ? 'yes' : '',
            s.statuses.length ? s.statuses.join(', ') : '(none)',
          ]),
        ))
        lines.push('')
      }
      return text(lines.join('\n'))
    }),
  )
}

export function registerWorkspaceWrite(server: McpServer): void {
  server.registerTool(
    'leads_update_workspace',
    {
      title: 'Update workspace settings',
      description: `Change one workspace's settings: display name, high-ticket rule, default charge %, follow-up manager email, reminder automation, which stage enrols leads in follow-ups, and the funnel stages themselves.

Replacing \`funnel_stages\` replaces the whole pipeline, so send every stage, in order, not just the changed one. Because each lead's stage is stored when it is written rather than derived on read, saving a new funnel also re-maps existing leads from their CRM status — the result says how many moved.

Examples:
  - "Charge Macralytics at 8%" -> workspace="macralytics", default_charge_pct=8
  - "High ticket means 75k or more" -> high_ticket_rule={op:"gte", value:75000}
  - "Send Transcure reminders to ops@example.com" -> follow_up_manager_email="ops@example.com"

Use leads_list_workspaces first to read the current stages before editing them.`,
      inputSchema: z.strictObject({
        workspace: WORKSPACE,
        name: z.string().min(1).max(80).optional().describe('New display name for the workspace.'),
        high_ticket_rule: z.object({
          op: z.enum(['gte', 'gt', 'lte', 'lt', 'between']),
          value: z.number(),
          value2: z.number().nullish().describe('Upper bound, only for op "between".'),
        }).optional().describe('Rule applied to a lead ticket value to call it high-ticket.'),
        default_charge_pct: z.number().min(0).max(100).optional()
          .describe('Percent of monthly collections billed, used when a lead has no override.'),
        follow_up_manager_email: z.string().max(200).nullish()
          .describe('Default reminder recipient. null clears it.'),
        follow_up_stage: z.string().max(60).nullish()
          .describe('Stage that enrols a lead in the 5-week sequence. null disables follow-ups for this workspace.'),
        follow_up_automation: z.object({
          enabled: z.boolean(),
          digestHour: z.number().int().min(0).max(23),
          timezone: z.string().max(64),
          graceDays: z.number().int().min(0).max(90),
          remindOverdueDaily: z.boolean(),
        }).optional().describe('Daily digest settings for the reminder job.'),
        funnel_stages: z.array(StageSchema).min(2).max(20).optional()
          .describe('Complete ordered replacement for the funnel. Exactly one stage must be won and one lost.'),
        response_format: RESPONSE_FORMAT,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guardWrite(
      (a) => ({ tool: 'leads_update_workspace', action: 'update', workspace: a.workspace, targets: [a.workspace ?? 'default'] }),
      async (a) => {
        const { project } = await workspace(a.workspace)
        const patch: Record<string, unknown> = {}
        if (a.name !== undefined) patch.name = a.name
        if (a.high_ticket_rule !== undefined) patch.high_ticket_rule = a.high_ticket_rule
        if (a.default_charge_pct !== undefined) patch.default_charge_pct = a.default_charge_pct
        if (a.follow_up_manager_email !== undefined) patch.follow_up_manager_email = a.follow_up_manager_email
        if (a.follow_up_automation !== undefined) patch.follow_up_automation = a.follow_up_automation

        let funnel: FunnelConfig | null = null
        if (a.funnel_stages) {
          const bad = validateFunnel(a.funnel_stages)
          if (bad) throw new Error(`Funnel rejected: ${bad}`)
          funnel = {
            stages: a.funnel_stages.map((s) => ({
              ...s,
              name: s.name.trim(),
              statuses: s.statuses.map((x) => x.trim().toLowerCase()).filter(Boolean),
            })),
          }
          patch.funnel = funnel
        }

        if (a.follow_up_stage !== undefined) {
          const stages = (funnel ?? project.funnel).stages.map((s) => s.name)
          if (a.follow_up_stage !== null && !stages.includes(a.follow_up_stage)) {
            throw new Error(`"${a.follow_up_stage}" is not a stage in this workspace. Stages: ${stages.join(', ')}.`)
          }
          patch.follow_up_stage = a.follow_up_stage
        }

        if (!Object.keys(patch).length) throw new Error('Nothing to change — pass at least one setting.')

        await updateProject(project.id, patch as never)

        // Stage is denormalised on each lead, so a new mapping only takes
        // effect once existing rows are recomputed from their stored status.
        let remapped: number | null = null
        if (funnel) remapped = await remapStages(project.id, (status) => stageForIn(funnel, status))

        const payload = {
          ok: true,
          workspace: project.id,
          changed: Object.keys(patch),
          leads_restaged: remapped,
        }
        if (a.response_format === ResponseFormat.JSON) return json(payload)
        const lines = [
          `Updated **${project.name}** (\`${project.id}\`).`,
          `Changed: ${Object.keys(patch).join(', ')}.`,
        ]
        if (remapped !== null) {
          lines.push(remapped
            ? `Re-mapped existing leads from their CRM status: **${remapped}** moved to a different stage.`
            : 'Re-mapped existing leads: none changed stage.')
        }
        return text(lines.join('\n'))
      },
    ),
  )
}
