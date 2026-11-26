/**
 * Self-check for the hosted connector: `npm run smoke:http`.
 *
 * Drives src/http.ts in-process against the stub Supabase, so the thing that
 * will be exposed to the internet is tested before it is deployed: that it
 * fails closed without a token, refuses a wrong one, accepts the right one by
 * either header, and then serves the full tool set.
 *
 * The auth checks matter most. Everything else in this project is reachable
 * only from the user's own machine; this is the one piece anyone can send a
 * request to.
 */
import { strict as assert } from 'node:assert'
import { startStub } from './stub-supabase.js'

const TOKEN = 'a-sufficiently-long-test-token-0123456789'

let checks = 0
const pass = (s: string): void => { checks++; console.error(`  ok  ${s}`) }

async function main(): Promise<void> {
  console.error('HTTP connector smoke test\n')

  const stub = await startStub()
  process.env.SUPABASE_URL = stub.url
  process.env.SUPABASE_ANON_KEY = 'stub-anon-key'
  process.env.LEADS_MCP_REFRESH_TOKEN = 'stub-refresh-token'
  process.env.LEADS_MCP_DEFAULT_PROJECT = 'acme'
  process.env.LEADS_MCP_MODE = 'admin'
  delete process.env.LEADS_MCP_BEARER_TOKEN

  // Imported after the environment is set: config is read when the handler is
  // built, and the module caches it.
  const { createHandler } = await import('../src/http.js')
  const handler = createHandler()

  const url = 'https://example.supabase.co/functions/v1/leads-mcp'
  const rpc = (body: unknown, headers: Record<string, string> = {}): Request =>
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(body),
    })
  const init = {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1.0' } },
  }
  const auth = { authorization: `Bearer ${TOKEN}` }

  try {
    // ── fails closed ────────────────────────────────────────────────────────
    let res = await handler(rpc(init, auth))
    assert.equal(res.status, 503, 'with no token configured the server must refuse everything')
    assert.match(JSON.stringify(await res.json()), /not_configured/)
    pass('with no bearer token configured, every request is refused (503)')

    process.env.LEADS_MCP_BEARER_TOKEN = 'short'
    res = await handler(rpc(init, auth))
    assert.equal(res.status, 503, 'a guessably short token must be treated as unconfigured')
    pass('a token under the minimum length is treated as unconfigured, not accepted')

    // ── rejects wrong credentials ───────────────────────────────────────────
    process.env.LEADS_MCP_BEARER_TOKEN = TOKEN

    res = await handler(rpc(init))
    assert.equal(res.status, 401, 'no credentials must be rejected')
    assert.equal(res.headers.get('www-authenticate'), 'Bearer')

    res = await handler(rpc(init, { authorization: 'Bearer wrong-token-wrong-token-wrong' }))
    assert.equal(res.status, 401, 'a wrong token must be rejected')

    // A prefix of the real token must not pass: that would mean the comparison
    // stops early, which is the leak constant-time comparison exists to avoid.
    res = await handler(rpc(init, { authorization: `Bearer ${TOKEN.slice(0, -1)}` }))
    assert.equal(res.status, 401, 'a near-miss token must be rejected')

    const body = JSON.stringify(await res.json())
    assert.ok(!body.includes(TOKEN), 'a rejection must not echo the expected token')
    pass('missing, wrong and near-miss tokens are all rejected without leaking the real one')

    // ── accepts the right credential, by either header ──────────────────────
    res = await handler(rpc(init, auth))
    assert.equal(res.status, 200, `Bearer auth should succeed, got ${res.status}`)
    const text = await res.text()
    assert.match(text, /"protocolVersion"/)
    assert.match(text, /leads-tracker-mcp-server/)
    pass('the correct token in Authorization completes an MCP initialize')

    res = await handler(rpc(init, { 'x-mcp-token': TOKEN }))
    assert.equal(res.status, 200, 'x-mcp-token is the fallback when Authorization carries a Supabase key')
    pass('x-mcp-token works as the alternative header')

    // ── health is public but says nothing useful ────────────────────────────
    res = await handler(new Request(`${url}/health`))
    assert.equal(res.status, 200)
    const health = await res.json() as Record<string, unknown>
    assert.equal(health.ok, true)
    assert.equal(health.token_set, true)
    const healthBody = JSON.stringify(health)
    assert.ok(!healthBody.includes(TOKEN), 'health must not disclose the token')
    assert.ok(!healthBody.includes('stub-refresh-token'), 'health must not disclose the session')
    pass('the unauthenticated health probe reports readiness without disclosing configuration')

    // ── the full tool set is served ─────────────────────────────────────────
    const listed = await handler(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, auth))
    assert.equal(listed.status, 200)
    const raw = await listed.text()
    const payload = JSON.parse(raw.replace(/^event: message\ndata: /, '').trim()) as {
      result: { tools: { name: string }[] }
    }
    const names = payload.result.tools.map((t) => t.name).sort()
    assert.equal(names.length, 15, `expected 15 tools in admin mode, got ${names.length}`)
    assert.ok(names.includes('leads_delete'), 'admin mode should expose leads_delete')
    pass(`tools/list returns all ${names.length} tools over HTTP`)

    // ── a real tool call goes end to end ────────────────────────────────────
    const called = await handler(rpc({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'leads_metrics', arguments: { response_format: 'json' } },
    }, auth))
    assert.equal(called.status, 200)
    const callText = await called.text()
    assert.ok(!/"isError":true/.test(callText), `leads_metrics failed over HTTP: ${callText.slice(0, 400)}`)
    assert.match(callText, /"leads":6/, 'the fixture has six leads')
    pass('a tool call runs end to end over HTTP and returns the right figures')

    // ── the Vercel entry point ──────────────────────────────────────────────
    // Vercel's Node runtime wants `export default { fetch }`, and its rewrite
    // hands the function /api/mcp rather than the /mcp the caller typed — so
    // the health probe has to be reachable by query string, not only by path.
    const vercel = (await import('../src/vercel.js')).default
    assert.equal(typeof vercel.fetch, 'function', 'Vercel needs a default export with a fetch method')

    let v = await vercel.fetch(new Request('https://transcure-leads.vercel.app/api/mcp?health=1'))
    assert.equal(v.status, 200)
    assert.equal((await v.json() as Record<string, unknown>).ok, true)

    v = await vercel.fetch(new Request('https://transcure-leads.vercel.app/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...auth },
      body: JSON.stringify(init),
    }))
    assert.equal(v.status, 200, 'the Vercel entry must serve MCP at its rewritten path')
    assert.match(await v.text(), /leads-tracker-mcp-server/)

    v = await vercel.fetch(new Request('https://transcure-leads.vercel.app/api/mcp', { method: 'POST' }))
    assert.equal(v.status, 401, 'the Vercel entry enforces the same bearer token')
    pass('the Vercel entry exports a fetch handler, answers ?health=1, and gates on the same token')

    console.error(`\nHTTP smoke test passed (${checks} checks).`)
  } finally {
    await stub.close()
  }
}

main().catch((e: unknown) => {
  console.error('\nHTTP SMOKE TEST FAILED:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
