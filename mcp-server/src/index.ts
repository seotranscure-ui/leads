#!/usr/bin/env node
/**
 * Lead Tracker MCP server — local stdio entry point.
 *
 * Gives Claude the same capabilities a person has in the web tracker — reading,
 * analysing, editing leads and follow-ups, and running the reminder job — over
 * a local stdio connection. Claude Desktop and Claude Code launch this as a
 * child process; there is no network listener.
 *
 * Three things keep that safe rather than reckless:
 *
 *   1. It signs in as an ordinary tracker user, never with a service_role key,
 *      so Row Level Security applies and every write is attributed to a person.
 *   2. LEADS_MCP_MODE decides which tools are registered at all. In the default
 *      'read' mode the write tools do not exist, so nothing in a conversation
 *      can reach them.
 *   3. Anything that destroys data or sends mail has to be called twice: once
 *      to see what would happen, then again quoting a confirmation phrase that
 *      names the specific target.
 *
 * There is no "run SQL" tool, by design.
 *
 * The hosted equivalent, for claude.ai custom connectors, is http.ts.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { SERVER_NAME, SERVER_VERSION, type Mode } from './config.js'
import { useLocalStorage } from './credentials.js'
import { createServer } from './server.js'
import { settings } from './supabase.js'

export { createServer }

function main(): void {
  // Point config and the audit journal at this machine's filesystem. The hosted
  // connector deliberately never does this.
  useLocalStorage()

  let mode: Mode
  try {
    mode = settings().mode
  } catch (e) {
    // stderr only: stdout carries the JSON-RPC stream.
    console.error(`[${SERVER_NAME}] ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }

  serveStdio(() => createServer(mode))
  console.error(
    `[${SERVER_NAME}] v${SERVER_VERSION} on stdio — mode "${mode}"` +
    (mode === 'read' ? ' (read-only; set LEADS_MCP_MODE=write to allow edits)' : ''),
  )
}

main()
