# Transcure SEO Lead Tracking System — Implementation Plan

**Goal:** Upload the Zoho CRM export into one web app that a 3–8 person team logs into to view
lead → demo → sale performance, with all times shown in both **US (Chicago)** and
**PK (Karachi)** time, and monthly SEO ratios calculated automatically.

**Input:** The Zoho CRM export CSV is the **only** data source. The Source Tracking and Manager
sheets are context for design, not imported.

---

## 1. Architecture (decided)

| Layer | Choice | Why |
|---|---|---|
| Database + Auth | **Supabase** (Postgres) | Live for a team, encrypted at rest/in transit, SOC 2, Row-Level Security, built-in email+password login, auto backups |
| Frontend | **React + Vite + TypeScript**, Tailwind + shadcn/ui | Fast, clean dashboards |
| Charts / Tables | Recharts + TanStack Table | Funnels, trends, filterable lead grid |
| CSV parsing | PapaParse | Handles the multi-line quoted fields in your exports |
| Merge + timezone logic | Supabase **Edge Function** (`import-csv`) | One place owns the rules so manual data is never clobbered |
| Hosting | **Vercel** (frontend) + Supabase cloud | Both have free tiers that cover this volume |
| Login | **Email + password** | You create the 3–8 accounts |

---

## 2. The core rule: upsert by Record Id, never overwrite manual edits

The CRM export has a unique key (`Record Id`). So:

- **CRM export** → upserted by `Record Id`. CRM-owned fields refresh on every upload; new leads
  are inserted; existing leads are updated in place (no duplicates).
- A small set of **manual/enrichment fields** (ticket size, internal notes) live only in the app
  and are **NEVER overwritten by a CRM re-upload** — they persist across uploads and change only
  via in-app editing.

---

## 3. Timezone handling

- CRM `Created Time` (e.g. `2025-10-10 08:27:31`) is interpreted as **America/Chicago** (observes
  daylight saving: UTC−6 winter / UTC−5 summer).
- Pakistan is fixed **UTC+5** (no DST) → the real gap is **+11h in winter, +10h in summer**
  (a hardcoded offset would be wrong half the year — we use a proper tz library).
- Stored as a UTC `timestamptz` (correct absolute instant) + the original raw string.
- Displayed in **both** Chicago and Karachi everywhere a time appears.

---

## 4. Database schema (Postgres)

**`leads`** — one row per CRM lead.
- *Key:* `record_id` (PK)
- *CRM-owned (refresh on upload):* lead_owner, company, first_name, last_name, lead_name, email,
  secondary_email, phone, mobile, website, lead_source, lead_status, tag, industry,
  no_of_employees, annual_revenue, city, state, zip, country, created_time_utc, modified_time_utc,
  last_activity_time_utc, first_page_visited, most_recent_visit, referrer, first_visit,
  days_visited, avg_time_spent, visitor_score, specialty, practice_name, profession,
  no_of_physicians, message, lead_phases, services_interested, ehr_name, biggest_challenge,
  pain_points, npi_number, is_converted, converted_date_time, raw_json (jsonb), crm_updated_at
- *Enrichment (manual — never overwritten by CRM):* manual_ticket_size, ticket_is_high,
  manual_notes, manual_updated_by, manual_updated_at

**`import_batches`** — audit log: file_name, uploaded_by, uploaded_at, rows_inserted, rows_updated.

**`status_funnel_map`** — editable mapping of CRM status/tag → funnel stage (see §5).

**`profiles`** — links Supabase Auth users to a role (admin / editor / viewer); drives RLS.

`monthly_metrics` (SQL view) — leads, demos, sales, high-ticket counts and ratios per month.

---

## 5. Funnel stage mapping (confirmed — Audit split out)

CRM statuses/tags map to ordered funnel stages:

1. **Lead** — all
2. **Engaged** — Contacted, Attempted to Contact
3. **Demo** — Demo Scheduled, Demo Done/Completed, Demo Rescheduled, Ghosted on Demo
4. **Audit** — Audit in process, Post Audit Meeting *(its own stage)*
5. **Negotiation** — Contract Sent, Agreement Sent
6. **Won** — WON
7. **Lost** — Lost, Not Interested, Not Qualified

Assumed order is Demo → Audit → Negotiation → Won (the free billing audit happens before the
contract). The mapping lives in the editable `status_funnel_map` table, so stages and order can be
adjusted in the Admin screen without code changes.

Ratios: **Leads→Demos**, **Demos→Sales**, **High-Ticket %**.

## 5a. High Ticket definition (confirmed — auto + manual override)

A lead is **High Ticket** if **either**:
- *Auto:* a CRM field crosses a threshold (default: `Annual Revenue` ≥ a configurable value;
  `Number of Physicians` used as a fallback signal), **or**
- *Manual:* the in-app **High Ticket** override flag is set (always wins when set).

The threshold is editable in Admin so you can tune it without a rebuild.

---

## 6. Screens

1. **Login** (email + password)
2. **Dashboard** — KPI scorecards (leads, demos, sales, conversion %) + monthly trend chart
3. **Leads / Manager view** — filter by month, source, status, specialty; inline-edit manual fields
4. **SEO Funnel** — funnel chart + keyword→lead→demo→sale table + monthly ratio block
   (uses CRM's `First Page Visited` / `Referrer` for the SEO/keyword angle)
5. **Upload** — drag the CRM CSV, preview, see inserted/updated summary, confirm
6. **Admin** — manage users, edit the status→funnel mapping

---

## 7. Data-quality handling (observed in the CRM export)

- Multi-line quoted fields (Description, Message) → handled by a robust CSV parser.
- Placeholder names like `Customer Customer` and blank names → displayed as-is (the `Record Id`
  still keys them correctly; no merge ambiguity since we key on Record Id, not name/email).
- Phone numbers with leading spaces / inconsistent country codes → normalized for display.
- Blank `Created Time` / malformed dates → flagged, lead still imported.

---

## 8. Milestones

- **M0** — Scaffold + Supabase project + schema + email/password auth
- **M1** — CRM CSV upload → parse → timezone → upsert → Leads table *(core value, end-to-end)*
- **M2** — Dashboard KPIs + monthly ratios + SEO funnel
- **M3** — In-app editing of manual fields (ticket size, notes) + edit audit
- **M4** — Roles/RLS hardening, deploy to Vercel, create the team accounts

I'll build M1 locally against your real CRM export first so you see it working before we wire up
cloud hosting and logins.

---

## 9. What I'll need from you (later, not now)

- A free **Supabase** account (I'll walk you through creating the project; I need the project URL +
  anon key; the service-role key stays secret).
- A free **Vercel** account for deployment.
- Confirm the **funnel mapping** (§5) and the **"High Ticket" definition**.
- The list of **team emails** to create accounts for.
