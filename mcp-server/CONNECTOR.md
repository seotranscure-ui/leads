# Adding the tracker as a Claude custom connector

A custom connector is a **remote MCP server**: Claude asks for an HTTPS URL, not a command to run.
The local stdio server in [README.md](./README.md) cannot be added that way — there is nothing to
point a URL at. This deploys the same tools as a Supabase Edge Function instead.

Both can coexist. A sensible split is the connector for reading on your phone and the local install
for heavy edits, but the connector can do everything if you want it to.

---

## Before you start

Deploying this puts an internet-reachable endpoint in front of your lead database. It is protected
by one shared secret, and it fails closed — until `LEADS_MCP_BEARER_TOKEN` is set it answers every
request with 503 and touches nothing.

Two consequences worth being deliberate about:

- **Writes are attributed to one account**, the one in `LEADS_MCP_EMAIL`. The local server signs in
  as whoever is using it; this one cannot. Create an account for it rather than using your own.
- **Anyone holding the token can do whatever `LEADS_MCP_MODE` allows.** Treat it like a password.
  Rotating it is one dashboard edit plus one connector edit.

---

## 1. Create an account for the connector

In Supabase → Authentication → Users → **Add user**, with a real address you control, for example
`claude-connector@yourdomain.com`. Give it a long random password — nobody has to type it again.

Using a separate account means the audit trail says "the connector did this", and you can disable it
without affecting anyone's own login.

## 2. Deploy the function

The function lives at `supabase/functions/leads-mcp/`. `server.mjs` is generated from
`mcp-server/src/` — rebuild it after pulling changes:

```bash
cd mcp-server
npm install
npm run bundle          # regenerates supabase/functions/leads-mcp/server.mjs
```

Then deploy from the repository root:

```bash
supabase link --project-ref tmpndupgmwkalgrztrgp     # once per machine
supabase functions deploy leads-mcp --no-verify-jwt
```

`--no-verify-jwt` is deliberate. Supabase's own check only proves the caller holds the anon key,
which is published in the website's JavaScript — so it keeps nobody out, while preventing you from
using the Authorization header for a secret that does. Authentication is the bearer token below,
compared in constant time, with the server refusing all requests until it is set.

## 3. Set the secrets

Supabase dashboard → **Edge Functions → Secrets**. Add:

| Secret | Value |
|---|---|
| `LEADS_MCP_BEARER_TOKEN` | A long random string, 24 characters minimum. Generate with `openssl rand -base64 32`. |
| `LEADS_MCP_EMAIL` | The account from step 1. |
| `LEADS_MCP_PASSWORD` | Its password. |
| `LEADS_MCP_MODE` | `read`, `write` or `admin`. |
| `LEADS_MCP_DEFAULT_PROJECT` | `transcure` or `macralytics`. |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically — do not add them.
`SUPABASE_SERVICE_ROLE_KEY` is injected too, and this server never reads it: it signs in as the
account above so Row Level Security still applies.

Generate the token somewhere it will not be logged, and paste it straight into the dashboard. Do not
send it over chat or email, and do not commit it.

## 4. Check it is live

Open this in a browser — it needs no token:

```
https://tmpndupgmwkalgrztrgp.supabase.co/functions/v1/leads-mcp/health
```

Expect `{"ok":true,"configured":true,"token_set":true}`. If `token_set` is false the secret has not
landed; if `configured` is false the sign-in secrets are missing or wrong.

## 5. Add the connector in Claude

**Customize → Connectors → Add → Add custom connector.**

- **URL**: `https://tmpndupgmwkalgrztrgp.supabase.co/functions/v1/leads-mcp`
- **Authentication**: no OAuth. Under **Request headers**, add:

  | Header | Value |
  |---|---|
  | `Authorization` | `Bearer <your LEADS_MCP_BEARER_TOKEN>` |

Claude should list 15 tools (8 in `read` mode, 12 in `write`). Ask it "what workspaces are in the
lead tracker?" to confirm.

If your setup keeps Supabase's JWT check on instead, send the anon key in `Authorization` and put
the secret in an `x-mcp-token` header — the server accepts either.

---

## Changing things later

**Rotate the token**: change `LEADS_MCP_BEARER_TOKEN` in Supabase, then update the connector's
header. The old token stops working the moment the function picks up the new secret.

**Change what it can do**: edit `LEADS_MCP_MODE` and redeploy. The mode decides which tools are
*registered*, so after a change to `read` the write tools genuinely do not exist — Claude's tool
list shrinks.

**Turn it off**: delete the secret, or delete the function. With no token it refuses everything.

**Ship code changes**: `npm run bundle` then `supabase functions deploy leads-mcp --no-verify-jwt`.
Never edit `server.mjs` by hand; it is overwritten.

---

## What does not work over the connector

`leads_import` with a file path. The hosted function's filesystem is its own, not your computer's,
so there is no CSV there to read — it says so rather than failing obscurely. Use the website's
upload page, or a local install. `action="reapply"` works fine, because it re-runs a batch already
in the database.

## Troubleshooting

**503 `not_configured`** — `LEADS_MCP_BEARER_TOKEN` is missing or under 24 characters, or the
sign-in secrets are wrong. `/health` distinguishes the two.

**401** — the header is missing or does not match. Check for a stray space, and that the value is
`Bearer <token>`, not the bare token.

**Claude connects but every tool errors** — the connector is authenticated but the server cannot
sign in to Supabase. Check `LEADS_MCP_EMAIL` and `LEADS_MCP_PASSWORD`, and that the account exists
and is confirmed.

**Fewer tools than expected** — that is `LEADS_MCP_MODE` doing its job.

**Checking from SQL**, when a browser is not to hand:

```sql
select net.http_get(
  url := 'https://tmpndupgmwkalgrztrgp.supabase.co/functions/v1/leads-mcp/health'
);
-- then, a moment later:
select status_code, content from net._http_response order by id desc limit 1;
```
