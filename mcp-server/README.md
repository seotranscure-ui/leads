# Transcure Leads MCP Server

A local [MCP](https://modelcontextprotocol.io) server that lets **Claude** (Claude Desktop or Claude Code) answer questions about your Transcure SEO leads — read-only, straight from your Supabase database.

Ask things like:
- *"How many SEO leads became demos in April, and what was the revenue?"*
- *"List won leads in Dental with monthly collections over $20k."*
- *"Show the monthly performance table and my lost revenue."*

## Tools exposed
| Tool | What it does |
|---|---|
| `transcure_search_leads` | Search/list leads with filters (source, stage, status, specialty, high-ticket, date range, text). |
| `transcure_lead_metrics` | Aggregate funnel + money: leads, demos, sales, conversion %, collections, revenue, lost revenue. |
| `transcure_monthly_performance` | Per-month leads / demos / sales / collections / revenue (honors each won lead's revenue month). |
| `transcure_breakdown` | Group by `source` or `specialty` with counts, collections and revenue. |

All tools are **read-only** — the server never writes to your database.

## Setup

### 1. Install & build
```bash
cd mcp-server
npm install
npm run build
```

### 2. Get your Supabase keys
In Supabase → **Project Settings → API**, copy:
- **Project URL** → `SUPABASE_URL`
- **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

> The **service_role** key is required to read leads past Row-Level Security. It is **secret** — it stays only on your machine in this MCP config. Never put it in the web app or commit it.

### 3. Register the server with Claude

**Claude Desktop** — edit `claude_desktop_config.json` (Settings → Developer → Edit Config):
```json
{
  "mcpServers": {
    "transcure-leads": {
      "command": "node",
      "args": ["D:/Danish/Claude/Projects/Transcure/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://tmpndupgmwkalgrztrgp.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key"
      }
    }
  }
}
```
Restart Claude Desktop. You'll see the `transcure-leads` tools available.

**Claude Code** — from the repo root:
```bash
claude mcp add transcure-leads --env SUPABASE_URL=https://tmpndupgmwkalgrztrgp.supabase.co --env SUPABASE_SERVICE_ROLE_KEY=your-service-role-key -- node "D:/Danish/Claude/Projects/Transcure/mcp-server/dist/index.js"
```

### 4. (Optional) Test locally
```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx @modelcontextprotocol/inspector node dist/index.js
```

## Notes
- Metrics mirror the web dashboard exactly (same stage mapping, ticket = manual override else Monthly Collections, revenue = collection × charge% default 5%, times in PK / Asia-Karachi, revenue-month attribution).
- Re-run `npm run build` after pulling changes.
