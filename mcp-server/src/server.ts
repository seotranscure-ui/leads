/**
 * The server factory, shared by both transports.
 *
 * `serveStdio` calls it once per connection; `createMcpHandler` calls it once
 * per HTTP request, so it must build a fresh McpServer every time and keep no
 * state of its own. Shared clients and caches live at module scope in
 * supabase.ts and repo.ts.
 */
import { McpServer } from '@modelcontextprotocol/server'
import { allows, SERVER_NAME, SERVER_VERSION, type Mode } from './config.js'
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
