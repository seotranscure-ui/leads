# Automatic follow-up reminders — setup

Sends a daily digest of outstanding follow-ups over **Transcure's own SMTP server**. No Gmail or Outlook account is connected, no third-party email API is involved, and nobody needs the tool open for mail to go out.

What it does on each daily run:

1. **Digest** — one email per recipient listing every follow-up channel still outstanding. A week keeps appearing until *all* of its channels (Email, SMS, Call, LinkedIn) are ticked off, and repeats daily while overdue.
2. **Decision prompt** — once all 5 weeks are complete, emails the manager once asking whether the lead responded.
3. **Auto-mark Lost** — if no outcome is recorded within the grace period (default 7 days), marks the lead Lost and sends a notification.

---

## 1. Run the migrations

In the Supabase SQL Editor, in order:

```
app/supabase/migrations/001_follow_ups.sql          (if not already applied)
app/supabase/migrations/002_manager_email_default.sql
app/supabase/migrations/003_auto_reminders.sql
```

Leave `004_cron_schedule.sql` until step 4 — it needs the function deployed first.

## 2. Set the secrets

Transcure's mail settings are already filled in. The only thing you supply is the mailbox password.

```bash
chmod +x setup-secrets.sh
./setup-secrets.sh
```

The script prompts for the password, reads it without echoing, pipes it straight into Supabase's encrypted secret store, and unsets it. It is never written to disk and never committed.

**Do not paste the password into a chat, a ticket, or a file in this repo.** Anything typed into a chat persists in that transcript; anything committed persists in git history even after deletion. Run the script yourself.

What it sets:

| Secret | Value |
|---|---|
| `SMTP_HOST` | `mail.transcure.biz` |
| `SMTP_PORT` | `587` (STARTTLS) |
| `SMTP_USER` | `muhammad.danish@transcure.biz` |
| `SMTP_PASS` | *prompted* |
| `SMTP_FROM` | `Transcure Lead Tracker <muhammad.danish@transcure.biz>` |
| `APP_URL` | `https://transcure-leads.vercel.app` |
| `CRON_SECRET` | generated, printed once |

Notes:

- **Never put SMTP credentials in `app_settings`.** RLS grants every authenticated user read access to that table, so a password there would be readable by the whole team and reachable from the browser. Edge Function secrets are server-side only.
- **Port 587** uses STARTTLS. If `mail.transcure.biz` wants implicit TLS instead, change `SMTP_PORT` to `465` in the script — the function auto-detects TLS on 465.
- `CRON_SECRET` is printed once. Copy it — step 5 needs it and Supabase won't show it again.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. Don't set them.

Prefer clicking? **Project Settings → Edge Functions → Secrets** takes the same names and values.

### A note on using a personal mailbox

`muhammad.danish@transcure.biz` is a person's account. It works, but a dedicated mailbox (`no-reply@transcure.biz`) is worth considering: reminders break silently when a personal password rotates or the account is disabled, and mail to the team will appear to come from Danish personally. To switch later, change `SMTP_USER`/`SMTP_FROM` in the script and re-run it.

## 3. Deploy

```bash
supabase functions deploy follow-up-reminders --no-verify-jwt
```

`--no-verify-jwt` is required so the scheduler can call it. The function is not left open: it rejects any request without the right `x-cron-secret`.

## 4. Test before scheduling

Check the SQL wiring without sending anything:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "https://<PROJECT_REF>.supabase.co/functions/v1/follow-up-reminders?dry=true"
```

Returns who *would* be emailed and how many items each digest holds.

Then send one real email to confirm the SMTP credentials work:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  "https://<PROJECT_REF>.supabase.co/functions/v1/follow-up-reminders?test=you@transcure.com"
```

Get this working before moving on. A wrong password or port surfaces here as a clear SMTP error; on a schedule it would just fail silently at 9am.

## 5. Schedule it

Open `app/supabase/migrations/004_cron_schedule.sql`, fill in the three placeholders, and run it:

- `<PROJECT_REF>` — your project ref (Settings → General)
- `<CRON_SECRET>` — the value from step 2
- `<UTC_HOUR>` — send hour **in UTC**. pg_cron runs on UTC; Pakistan is UTC+5 with no DST, so subtract 5: **09:00 PK → `4`**

## 6. Set the recipient

In the app: **Admin → Follow-ups — Lead manager email**. Nothing sends until this is set. Individual leads can override it on the Follow-Ups page.

---

## Checking on it

**Admin → Follow-ups — Automatic reminders → Recent sends** shows every send with its status. That's the fastest way to confirm the job is alive.

In SQL:

```sql
-- Did the cron job fire?
select * from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'follow-up-reminders-daily')
order by start_time desc limit 20;

-- What went out, and did anything fail?
select * from public.follow_up_reminders order by created_at desc limit 50;
```

## If mail isn't arriving

| Symptom | Cause |
|---|---|
| `cron.job_run_details` empty | Job never registered — re-run `004`, check `pg_cron` and `pg_net` are enabled |
| Job ran, nothing in `follow_up_reminders` | Function rejected the call — `CRON_SECRET` in `004` doesn't match the secret |
| Rows with `status = 'failed'` | Read the `error` column — usually wrong SMTP password, port, or a blocked connection |
| Everything `sent`, nothing received | Delivered but filtered. Check spam, then SPF/DKIM for the `SMTP_FROM` domain |
| No rows at all, no failures | No outstanding follow-ups, or no manager email set in Admin |

## Turning it off

Uncheck **Send reminders automatically** in Admin — the job still runs but exits immediately. To stop it entirely:

```sql
select cron.unschedule('follow-up-reminders-daily');
```
