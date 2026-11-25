# Lead Tracker MCP server

Connects Claude to the lead tracker. Claude can read, analyse and — when you let it — change
leads, follow-up sequences and workspace settings, for both Transcure and Macralytics.

It runs on your own machine and talks to Claude over stdio. Nothing is exposed to the internet,
and there is no server to keep running.

---

## What Claude can do with it

**Always (read-only)**

| Tool | What it does |
|---|---|
| `leads_list_workspaces` | Every workspace with its funnel stages, status mapping, high-ticket rule, charge % and reminder settings. |
| `leads_search` | Find and list leads with filters, or fetch one lead in full. |
| `leads_metrics` | Counts, conversion rates, collections, revenue, open pipeline, lost revenue — for any filtered set. |
| `leads_breakdown` | The same figures grouped by source, specialty, stage, status, owner, month, practice, physicians or high-ticket band. |
| `leads_monthly_performance` | Month-by-month table, honouring each won lead's revenue month. |
| `leads_insights` | An analysis rather than an answer: momentum, which segments really convert, ageing pipeline, follow-up health, revenue concentration, data-quality problems. |
| `leads_followups` | The follow-up board — what is overdue, due today, or finished and waiting on a decision. |
| `leads_activity` | Import history and the reminder log. |

**With `LEADS_MCP_MODE=write`**

| Tool | What it does |
|---|---|
| `leads_update` | Edit a lead's ticket, notes, charge %, revenue month, source tracking; move it through the funnel. |
| `leads_create` | Add a lead by hand. |
| `leads_manage_followup` | Start a sequence, enrol everyone in the follow-up stage, tick channels off, reschedule a week, change the reminder address, close a sequence. |
| `leads_update_workspace` | Change a workspace's settings, including its funnel stages (existing leads are re-mapped). |

**With `LEADS_MCP_MODE=admin`**

| Tool | What it does |
|---|---|
| `leads_delete` | Delete one lead. Confirmation required. |
| `leads_import` | Import a Zoho CSV export, or re-apply a previous import. Confirmation required. |
| `leads_run_reminders` | Ping, dry-run, test or actually send the follow-up digest. Sending requires confirmation. |

There is deliberately **no "run SQL" tool**. See [SECURITY.md](./SECURITY.md).

---

## Setup

### 1. Build

```bash
cd mcp-server
npm install
npm run build
```

### 2. Sign in

```bash
npm run login
```

It asks for:

- **Supabase project URL** — `https://tmpndupgmwkalgrztrgp.supabase.co`
- **Publishable / anon key** — Supabase dashboard → Project Settings → API Keys. This is the
  *public* key, the same one already inside the website. If you paste a `service_role` or
  `sb_secret_...` key it will refuse it.
- **Your tracker email and password** — the same login you use on the website.

Your password is **not stored**. What is saved is the refresh token Supabase hands back, in
`~/.config/leads-mcp/credentials.json`, readable only by your account. `npm run logout` revokes it.

### 3. Check it works

```bash
npm run doctor
```

This prints who you are signed in as, the workspaces it can see, how many leads are in each, and
the last few reminder log entries. If this does not pass, Claude will not work either.

### 4. Tell Claude about it

**Claude Desktop** — Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "leads-tracker": {
      "command": "node",
      "args": ["C:/full/path/to/leads/mcp-server/dist/index.js"],
      "env": {
        "LEADS_MCP_MODE": "read"
      }
    }
  }
}
```

Restart Claude Desktop.

**Claude Code** — from the repo root:

```bash
claude mcp add leads-tracker --env LEADS_MCP_MODE=read -- node "/full/path/to/leads/mcp-server/dist/index.js"
```

Use the full absolute path to `dist/index.js`; the launcher does not run from this folder.

### 5. Decide how much it may do

`LEADS_MCP_MODE` controls which tools exist at all:

| Mode | Claude can |
|---|---|
| `read` *(default)* | Look and analyse. Nothing can be changed. |
| `write` | Also edit leads, drive follow-ups, change workspace settings. |
| `admin` | Also delete leads, import CSVs, send reminder emails. |

Start at `read`. Move up when you want Claude doing the work rather than describing it, and change
it back whenever you like — it is one line in the config plus a restart.

---

## Things to ask it

```
What does the pipeline look like for Macralytics?
Which source converts best for Transcure, ignoring anything under 10 leads?
Show me April month by month, SEO only.
Anything I should worry about this month?
What follow-ups are overdue, and who is most overdue?
Which won leads have no collections figure on them?
```

With write access:

```
Mark the Lakeside Dental lead as agreement sent.
Tick the email and SMS off week 2 for that lead.
Enrol everyone sitting in Negotiation into a follow-up sequence.
Set Macralytics' default charge to 8%.
```

---

## Settings

All optional, set in the MCP config's `env` block.

| Variable | Default | Meaning |
|---|---|---|
| `LEADS_MCP_MODE` | `read` | `read`, `write` or `admin`. |
| `LEADS_MCP_DEFAULT_PROJECT` | `transcure` | Workspace used when a question does not name one. |
| `LEADS_MCP_MAX_BATCH` | `200` | Ceiling on how many leads one call may touch. |
| `LEADS_MCP_AUDIT` | `1` | `0` turns off the local write journal. |
| `LEADS_MCP_HOME` | `~/.config/leads-mcp` | Where credentials and the audit log live. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | from `npm run login` | Override the stored values. |
| `LEADS_MCP_EMAIL`, `LEADS_MCP_PASSWORD` | — | Unattended sign-in instead of `npm run login`. |

---

## Maintenance

```bash
npm run build      # after pulling changes
npm run selftest   # 35 logic checks: funnel mapping, money rules, filters, CSV import, budgets
npm run smoke      # 23 end-to-end checks against a stub database: every tool, both output
                   # formats, mode gating, the confirmation gates, text sanitising
npm run doctor     # live connection check
npm run logout     # revoke the stored session
```

`LEADS_MCP_SMOKE_LIVE=1 npm run smoke` also runs the read tools against the real project.

The metric definitions here mirror `app/src/lib/` exactly — same stage mapping, same ticket rule
(manual override, else Monthly Collections), same revenue (ticket × charge %), same Pakistan-time
month boundaries, same revenue-month attribution. If the app's rules change, change them here too;
`npm run selftest` is what catches a drift.

---

## Troubleshooting

**"Not signed in" / "Stored sign-in is no longer valid"** — run `npm run login` again. Refresh
tokens expire if unused for a long time, and `npm run logout` on another machine revokes them.

**"Credentials file is readable by other users"** — `chmod 600 ~/.config/leads-mcp/credentials.json`.

**"Refusing to start with a Supabase service_role key"** — remove `SUPABASE_SERVICE_ROLE_KEY` from
the MCP config. This server does not use one, on purpose.

**Claude says it cannot change anything** — it is in `read` mode. Raise `LEADS_MCP_MODE` and restart
the Claude app.

**A tool is missing from Claude's list** — the mode decides which tools are registered, so a
write tool genuinely does not exist in `read` mode. Check the startup line in the MCP log; it
names the mode.

**"table does not exist"** — the migrations in `app/supabase/migrations/` have not all been applied.
