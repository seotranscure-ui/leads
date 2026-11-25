#!/usr/bin/env node
/**
 * Lead Tracker MCP server.
 *
 * Gives Claude the same capabilities a person has in the web tracker — reading,
 * analysing, editing leads and follow-ups, and running the reminder job —
 * over a local stdio connection.
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
 */
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { allows, SERVER_NAME, SERVER_VERSION, type Mode } from './config.js'
import { settings } from './supabase.js'
import { registerActivity } from './tools/activity.js'
import { registerAdmin } from './tools/admin.js'
import { registerAnalyze } from './tools/analyze.js'
import { registerFollowUpsRead, registerFollowUpsWrite } from './tools/followups.js'
import { registerInsights } from './tools/insights.js'
import { registerSearch } from './tools/search.js'
import { registerWrite } from './tools/write.js'
import { registerWorkspaceRead, registerWorkspaceWrite } from './tools/workspace.js'

export function createServer(mode: Mode): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  // Always available.
  registerWorkspaceRead(server)
  registerSearch(server)
  registerAnalyze(server)
  registerInsights(server)
  registerFollowUpsRead(server)
  registerActivity(server)

  if (allows(mode, 'write')) {
    registerWrite(server)
    registerFollowUpsWrite(server)
    registerWorkspaceWrite(server)
  }

  if (allows(mode, 'admin')) {
    registerAdmin(server)
  }

  return server
}

function main(): void {
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
