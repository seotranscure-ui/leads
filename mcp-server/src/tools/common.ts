/**
 * Shared plumbing for tool modules: workspace resolution, the capability gate,
 * and the wrapper that turns thrown errors into readable tool errors and
 * journals every write.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { allows, type Mode } from '../config.js'
import { audit, type AuditEntry } from '../audit.js'
import { errorResult } from '../format.js'
import { DEFAULT_RULE, type Project } from '../domain.js'
import { getProject, managerEmailFor } from '../repo.js'
import type { Ctx } from '../metrics.js'
import { settings } from '../supabase.js'

export interface Workspace {
  project: Project
  ctx: Ctx
  managerEmail: string
}

/** Resolve the workspace a tool call applies to, with its funnel and money rules. */
export async function workspace(id?: string): Promise<Workspace> {
  const project = await getProject(id)
  return {
    project,
    ctx: {
      funnel: project.funnel,
      rule: project.high_ticket_rule ?? DEFAULT_RULE,
      chargePct: Number(project.default_charge_pct ?? 5),
    },
    managerEmail: await managerEmailFor(project),
  }
}

type Handler<A> = (args: A) => Promise<unknown>

/**
 * Wrap a handler so a failure reaches the model as readable text with a next
 * step, rather than as a protocol error it cannot see or react to.
 */
export function guard<A>(handler: Handler<A>): (args: A) => Promise<never> {
  return (async (args: A) => {
    try {
      return await handler(args)
    } catch (e) {
      return errorResult(e)
    }
  }) as (args: A) => Promise<never>
}

/** Same, plus a line in the local write journal. */
export function guardWrite<A>(
  describe: (args: A) => Omit<AuditEntry, 'ok' | 'error'>,
  handler: Handler<A>,
): (args: A) => Promise<never> {
  return (async (args: A) => {
    const base = describe(args)
    try {
      const out = await handler(args)
      audit({ ...base, ok: true }, settings().auditEnabled)
      return out
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      audit({ ...base, ok: false, error: msg }, settings().auditEnabled)
      return errorResult(e)
    }
  }) as (args: A) => Promise<never>
}

/** Register a tool only when the server's mode allows it. */
export function ifMode(mode: Mode, required: Mode, register: (s: McpServer) => void): (s: McpServer) => void {
  return (s: McpServer) => { if (allows(mode, required)) register(s) }
}

/**
 * Enforce a destructive tool's confirmation phrase.
 *
 * The phrase names the exact target, so "yes" or "do it" will not satisfy it,
 * and neither will an instruction that arrived inside somebody's lead notes.
 */
export function requireConfirmation(given: string | undefined, expected: string): void {
  if ((given ?? '').trim() !== expected) {
    throw new Error(
      `This action needs confirmation. Re-send the same call with confirm="${expected}". ` +
      'Check with the person first if they have not asked for exactly this.',
    )
  }
}
