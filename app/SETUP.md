# Transcure Lead Tracker — Setup

Production app: **Vite + React + TypeScript + Supabase**.

## 1. Database (one time)
1. In Supabase → **SQL Editor** → paste the contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   This creates `leads`, `import_batches`, `app_settings` and the Row-Level-Security policies.

## 2. Connect the app
1. Copy `.env.example` to `.env.local`.
2. Fill in (Supabase → Project Settings → API):
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...   # the "anon public" key
   ```

## 3. Create team logins (no public sign-up)
Supabase → **Authentication → Users → Add user** → enter email + password for each of the
3–8 team members. (Or Invite by email.) They sign in on the app's login screen.

## 4. Run locally
```
cd app
npm install      # first time only
npm run dev      # http://localhost:5173
```

## 5. Use
- **Upload** tab → drop the Zoho `Lead_*.csv`. Re-uploads upsert by Record Id; manual edits are kept.
- **Dashboard** → click any KPI / monthly cell / specialty or source row to drill into those leads.
- **Leads** → resize columns/rows, edit Ticket / High-ticket / Notes (saved to the shared DB).
- **SEO Funnel** → stage funnel, ratios, top landing pages, monthly ratios.

## 6. Deploy (later)
- Push to GitHub, import into **Vercel**, set the two `VITE_` env vars in Vercel project settings.
- Add your Vercel URL to Supabase → Authentication → URL Configuration (redirect/site URL).

## Notes
- All times stored as UTC; shown in **PK (Karachi)** and **US (Chicago)** with correct DST.
- High-ticket = Monthly Collections ≥ threshold (set on Dashboard) OR the manual ⭐ override.
- Funnel/status mapping lives in `src/lib/funnel.ts`.
