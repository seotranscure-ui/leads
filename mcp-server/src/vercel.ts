/**
 * Vercel entry point — bundled to app/api/mcp.js by `npm run bundle:vercel`.
 *
 * Vercel's Node runtime accepts a web `fetch` handler, which is exactly what
 * http.ts already produces, so this is only the shape adapter. Everything that
 * matters — the bearer token, failing closed, the capability mode, the
 * confirmation gates — lives in http.ts and is shared with the Supabase
 * deployment.
 *
 * Served at https://<app>/mcp via the rewrite in app/vercel.json.
 */
import { createHandler } from './http.js'

// Built once per cold start, not per request: signing in to Supabase on every
// call would add a round trip to each one.
const handler = createHandler()

export default {
  fetch: (request: Request): Promise<Response> => handler(request),
}
