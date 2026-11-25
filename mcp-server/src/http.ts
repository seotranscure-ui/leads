/**
 * Hosted entry point — Streamable HTTP, for use as a claude.ai custom connector.
 *
 * Same tools, same rules, same code as the local stdio server. The differences
 * are all about being reachable from the internet:
 *
 *   - Every request must carry a bearer token this deployment alone knows.
 *     Without it the server answers 401 and does nothing else. It fails closed:
 *     if no token is configured, it refuses every request rather than serving
 *     an open endpoint.
 *   - It signs in as a dedicated tracker account from secrets, so Row Level
 *     Security still applies. It still refuses to run with a service_role key.
 *   - It is stateless. `createMcpHandler` builds a fresh McpServer per request,
 *     so nothing leaks between callers and the function scales as-is.
 *
 * The token is a shared secret, not per-person sign-in: every write is
 * attributed to the one account in `LEADS_MCP_EMAIL`. Use an account created
 * for this, not somebody's own.
 */
import { createMcpHandler } from '@modelcontextprotocol/server'
import { SERVER_NAME, SERVER_VERSION } from './config.js'
import { readEnv, timingSafeEqual } from './env.js'
import { createServer } from './server.js'
import { settings } from './supabase.js'

/** Shortest token accepted. Anything briefer is guessable at network speed. */
const MIN_TOKEN_LENGTH = 24

const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  })

/**
 * The configured bearer token.
 *
 * Returns null when none is set or it is too short — both of which must stop
 * the server answering, not be waved through.
 */
function expectedToken(): string | null {
  const raw = (readEnv('LEADS_MCP_BEARER_TOKEN') ?? '').trim()
  return raw.length >= MIN_TOKEN_LENGTH ? raw : null
}

/**
 * Pull the presented token out of the request.
 *
 * `Authorization: Bearer …` is what Claude's connector sends when the
 * Authorization header is set directly. `x-mcp-token` is the fallback for a
 * deployment that keeps Supabase's own JWT check on, because then Authorization
 * is already carrying the anon key.
 */
function presentedToken(req: Request): string {
  const auth = req.headers.get('authorization') ?? ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (m) return m[1].trim()
  return (req.headers.get('x-mcp-token') ?? '').trim()
}

export function createHandler(): (req: Request) => Promise<Response> {
  // Resolved once per isolate. A configuration mistake should be one clear
  // answer on every request, not an intermittent crash.
  let configError: string | null = null
  let mode: 'read' | 'write' | 'admin' = 'read'
  try {
    mode = settings().mode
  } catch (e) {
    configError = e instanceof Error ? e.message : String(e)
  }

  const mcp = createMcpHandler(() => createServer(mode))

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)

    // Unauthenticated liveness probe. Says the function is deployed and whether
    // it is configured — never what the configuration is.
    if (req.method === 'GET' && url.pathname.endsWith('/health')) {
      return json(200, {
        ok: !configError && !!expectedToken(),
        name: SERVER_NAME,
        version: SERVER_VERSION,
        configured: !configError,
        token_set: !!expectedToken(),
      })
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
          'access-control-allow-headers': 'authorization, x-mcp-token, content-type, mcp-session-id, mcp-protocol-version',
          'access-control-max-age': '86400',
        },
      })
    }

    const expected = expectedToken()
    if (!expected) {
      // Fail closed. An endpoint that served data because its secret was
      // missing would be worse than one that is simply broken.
      return json(503, {
        error: 'not_configured',
        message:
          `LEADS_MCP_BEARER_TOKEN is not set, or is shorter than ${MIN_TOKEN_LENGTH} characters. ` +
          'This server refuses every request until it has one.',
      })
    }

    if (!timingSafeEqual(presentedToken(req), expected)) {
      return json(401, { error: 'unauthorized', message: 'Missing or invalid bearer token.' }, {
        'www-authenticate': 'Bearer',
      })
    }

    if (configError) {
      return json(503, { error: 'not_configured', message: configError })
    }

    return mcp.fetch(req)
  }
}

export default createHandler
