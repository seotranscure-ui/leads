/**
 * Lead Tracker MCP server — hosted entry point.
 *
 * This is the endpoint a claude.ai custom connector points at:
 *
 *   https://<project-ref>.supabase.co/functions/v1/leads-mcp
 *
 * The tools, the capability mode and the confirmation gates are the same code
 * as the local stdio server. `server.mjs` beside this file is generated — build
 * it with `npm run bundle` in mcp-server/, never edit it by hand.
 *
 * Deployed with verify_jwt OFF on purpose. Supabase's own check only proves the
 * caller holds the anon key, which is published in the website's JavaScript and
 * so proves nothing. Authentication here is the bearer token in
 * LEADS_MCP_BEARER_TOKEN, checked in constant time, and the server answers
 * every request with 503 until that secret exists.
 *
 * Required secrets (Supabase dashboard -> Edge Functions -> Secrets):
 *   LEADS_MCP_BEARER_TOKEN   the connector's shared secret, 24+ characters
 *   LEADS_MCP_EMAIL          a tracker account created for this server
 *   LEADS_MCP_PASSWORD       its password
 *   LEADS_MCP_MODE           read | write | admin
 *   LEADS_MCP_DEFAULT_PROJECT  workspace used when a question names none
 *
 * SUPABASE_URL and SUPABASE_ANON_KEY are injected by the runtime. So is
 * SUPABASE_SERVICE_ROLE_KEY, which this server never reads: it signs in as the
 * account above so Row Level Security still applies.
 */
import { createHandler } from './server.mjs'

const handler = createHandler()

Deno.serve((req: Request) => handler(req))
