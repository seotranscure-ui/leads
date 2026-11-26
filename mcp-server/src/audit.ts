/**
 * The write journal — an interface, not an implementation.
 *
 * The local server wires this to an append-only file (see credentials.ts); the
 * hosted connector leaves it unset, because it has nowhere durable to write and
 * Supabase already logs every request. Keeping the sink pluggable is what lets
 * the deployed bundle contain no filesystem code.
 */
export interface AuditEntry {
  tool: string
  action: string
  workspace?: string
  /** Ids, not contents. */
  targets?: string[]
  count?: number
  ok: boolean
  error?: string
}

export type AuditSink = (entry: AuditEntry) => void

let sink: AuditSink | null = null

export function setAuditSink(fn: AuditSink | null): void {
  sink = fn
}

export function audit(entry: AuditEntry, enabled: boolean): void {
  if (!enabled || !sink) return
  try {
    sink(entry)
  } catch {
    // Journalling must never fail the work it is recording.
  }
}
