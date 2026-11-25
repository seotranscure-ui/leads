# Adding the tracker as a Claude custom connector

A custom connector is a **remote MCP server**: Claude asks for an HTTPS URL, not a command to run.
The local stdio server in [README.md](./README.md) cannot be added that way — there is nothing to
point a URL at.

There are two places to host it. **Use Vercel unless you have a reason not to.**

| | Vercel | Supabase Edge Function |
|---|---|---|
| URL | `https://transcure-leads.vercel.app/mcp` | `https://<ref>.supabase.co/functions/v1/leads-mcp` |
| Deploying | Automatic on every push to `main` | `supabase functions deploy`, from a terminal |
| You need installed | nothing | Node.js, the repo, the Supabase CLI |
| Where settings live | Vercel → Environment Variables | Supabase → Edge Functions → Secrets |

Both run identical code — `src/http.ts`, the same tools, the same bearer-token gate, the same
confirmation gates. Pick one. The local stdio install can run alongside either.

---

## Before you start, either way

Deploying this puts an internet-reachable endpoint in front of your lead database. It is protected
by one shared secret and it **fails closed**: until `LEADS_MCP_BEARER_TOKEN` is set, every request
is answered 503 and nothing is touched.

Two things to be deliberate about:

- **Writes are attributed to one account**, the one in `LEADS_MCP_EMAIL`. The local server signs in
  as whoever is using it; this one cannot. Create an account for it rather than using your own.
- **Anyone holding the token can do whatever `LEADS_MCP_MODE` allows.** Treat it like a password.

---

# Route A — Vercel (recommended)

## A1. Create a tracker account for the connector

Supabase dashboard → **Authentication → Users → Add user → Create new user**.

- Email: one you control, e.g. `claude-connector@transcure.biz`
- Password: long and random — nobody types it again
- **Turn ON "Auto Confirm User"**

That toggle is the one that bites. Without it the account exists but cannot sign in, and every tool
fails later with a confusing error.

## A2. Generate the bearer token

PowerShell:

```powershell
$b = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
($b | ForEach-Object { '{0:x2}' -f $_ }) -join ''
```

48 hex characters — no punctuation, so nothing can mangle it in a header or a URL.

## A3. Add the environment variables

Vercel → project **transcure-leads** → **Settings → Environment Variables**. Add each for the
**Production** environment:

| Name | Value |
|---|---|
| `LEADS_MCP_BEARER_TOKEN` | The 48 characters from A2 |
| `LEADS_MCP_EMAIL` | The account from A1 |
| `LEADS_MCP_PASSWORD` | Its password |
| `LEADS_MCP_MODE` | `read`, `write` or `admin` |
| `LEADS_MCP_DEFAULT_PROJECT` | `transcure` |

That is all five. The server reuses the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` the web app
already defines, so there are no Supabase connection variables to add.

## A4. Merge to `main`

Vercel builds `main` and serves it at `transcure-leads.vercel.app`. Merge the pull request; the
deploy starts on its own and takes a minute or two.

Preview deployments will not work for this — the project has Vercel Authentication enabled for
everything except custom domains, so preview URLs demand a Vercel login that Claude cannot perform.
Production on `transcure-leads.vercel.app` is public and is the one to use.

## A5. Check it

Open in a browser:

```
https://transcure-leads.vercel.app/mcp/health
```

Expect `{"ok":true,"configured":true,"token_set":true}`.

- `token_set: false` → `LEADS_MCP_BEARER_TOKEN` is missing or under 24 characters
- `configured: false` → the email/password variables are missing or malformed
- The app's HTML instead of JSON → the deploy has not finished, or `vercel.json` did not update

Changing an environment variable does **not** redeploy on its own. After editing one, go to
**Deployments → ⋯ → Redeploy** on the latest production deployment.

## A6. Add the connector in Claude

**Customize → Connectors → Add → Add custom connector.**

- **URL**: `https://transcure-leads.vercel.app/mcp`
- **OAuth**: leave it alone
- **Request headers**: `Authorization` = `Bearer <your token>`

The word `Bearer`, one space, then the token. Pasting the bare token is the usual cause of a 401.

Claude should list 15 tools (8 in `read` mode, 12 in `write`).

---

# Route B — Supabase Edge Function

Only if you would rather keep this off the web app. Needs Node.js, the repo cloned, and a terminal.

1. A1 and A2 above, unchanged.
2. Secrets go in **Supabase → Edge Functions → Secrets** instead of Vercel. Same five names, plus
   nothing else: `SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected by the runtime.
3. Deploy from the repository root:

   ```bash
   cd mcp-server && npm install && npm run bundle    # regenerates the function's server.mjs
   cd ..
   npx supabase login
   npx supabase functions deploy leads-mcp --project-ref tmpndupgmwkalgrztrgp --no-verify-jwt
   ```

   `--no-verify-jwt` is deliberate. Supabase's own check only proves the caller holds the anon key,
   which is published in the website's JavaScript — so it keeps nobody out, while occupying the
   header a real secret needs.
4. Health: `https://tmpndupgmwkalgrztrgp.supabase.co/functions/v1/leads-mcp/health`
5. Connector URL: `https://tmpndupgmwkalgrztrgp.supabase.co/functions/v1/leads-mcp`

---

# Afterwards

**Change what it can do**: edit `LEADS_MCP_MODE` and redeploy. The mode decides which tools are
*registered*, so after switching to `read` the write tools genuinely do not exist and Claude's tool
list shrinks.

**Rotate the token**: new value in Vercel or Supabase, redeploy, update the connector header. The old
token stops working immediately.

**Turn it off**: delete `LEADS_MCP_BEARER_TOKEN`. With no token the server refuses everything.

**Ship code changes**: `cd mcp-server && npm run bundle:all` regenerates both deployments'
bundles — `app/api/mcp.js` and `supabase/functions/leads-mcp/server.mjs`. Commit them. Vercel picks
its copy up on the next push; Supabase needs the deploy command. Never edit either generated file by
hand.

---

# What does not work remotely

`leads_import` with a file path. The hosted server's filesystem is its own, not your computer's, so
there is no CSV there to read — it says so rather than failing obscurely. Use the website's upload
page, or a local install. `action="reapply"` works fine; it re-runs a batch already in the database.

**A funnel re-map may time out on Vercel.** Replacing the funnel re-stages every lead, which is a
few hundred row updates. If `leads_update_workspace` times out, raise the limit by adding this to
`app/vercel.json` — but check your Vercel plan allows it, because a value above the plan maximum
fails the build:

```json
"functions": { "api/mcp.js": { "maxDuration": 60 } }
```

Or just do that one edit in the web app's Admin page, which has no such limit.

---

# Troubleshooting

**503 `not_configured`** — the token is missing or under 24 characters, or the sign-in variables are
wrong. `/mcp/health` tells you which.

**401** — the header is missing or does not match. Check for a stray space and that the value starts
with `Bearer `.

**You get the app's HTML instead of JSON** — the deploy predates `vercel.json`'s `/mcp` rewrite.
Redeploy.

**Claude connects but every tool errors** — authenticated, but the server cannot sign in to
Supabase. Check `LEADS_MCP_EMAIL` and `LEADS_MCP_PASSWORD`, and that the account is confirmed (A1).

**Fewer tools than expected** — that is `LEADS_MCP_MODE` doing its job.
