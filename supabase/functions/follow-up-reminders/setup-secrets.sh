#!/usr/bin/env bash
# Sets the Edge Function secrets for the follow-up reminder job.
#
# Run this yourself — it prompts for the mailbox password and pipes it straight
# into Supabase's encrypted secret store. The password is never echoed to the
# terminal, never written to a file, and never committed. Do not paste it into a
# chat, a ticket, or this script.
#
#   chmod +x setup-secrets.sh
#   ./setup-secrets.sh
#
# Requires the Supabase CLI, logged in and linked:
#   supabase login
#   supabase link --project-ref <YOUR_PROJECT_REF>

set -euo pipefail

# ── Values that are not secret ───────────────────────────────────────────────
SMTP_HOST="mail.transcure.biz"
SMTP_PORT="587"                                   # 587 = STARTTLS. Use 465 for implicit TLS.
SMTP_USER="muhammad.danish@transcure.biz"
SMTP_FROM="Transcure Lead Tracker <muhammad.danish@transcure.biz>"
APP_URL="https://transcure-leads.vercel.app"

command -v supabase >/dev/null 2>&1 || {
  echo "Error: the Supabase CLI is not installed." >&2
  echo "  macOS:   brew install supabase/tap/supabase" >&2
  echo "  Windows: scoop install supabase" >&2
  echo "  Other:   https://supabase.com/docs/guides/cli" >&2
  exit 1
}

echo "Setting reminder secrets for:"
echo "  SMTP host : $SMTP_HOST:$SMTP_PORT"
echo "  Mailbox   : $SMTP_USER"
echo "  App URL   : $APP_URL"
echo

# ── The password: read silently, never stored ───────────────────────────────
printf 'Password for %s: ' "$SMTP_USER"
read -rs SMTP_PASS
echo
[ -n "$SMTP_PASS" ] || { echo "Error: password was empty; nothing set." >&2; exit 1; }

# ── Shared secret gating the function endpoint ──────────────────────────────
# Printed once, because migration 004_cron_schedule.sql needs it and Supabase
# will not let you read a secret back afterwards.
if command -v openssl >/dev/null 2>&1; then
  CRON_SECRET="$(openssl rand -hex 24)"
else
  CRON_SECRET="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi

supabase secrets set \
  SMTP_HOST="$SMTP_HOST" \
  SMTP_PORT="$SMTP_PORT" \
  SMTP_USER="$SMTP_USER" \
  SMTP_PASS="$SMTP_PASS" \
  SMTP_FROM="$SMTP_FROM" \
  APP_URL="$APP_URL" \
  CRON_SECRET="$CRON_SECRET"

unset SMTP_PASS

cat <<EOF

Secrets set.

  CRON_SECRET = $CRON_SECRET

Copy that value now — paste it into 004_cron_schedule.sql at step 5. Supabase
will not show it to you again. If you lose it, re-run this script to generate a
new one and update the migration to match.

Next:
  1. supabase functions deploy follow-up-reminders --no-verify-jwt
  2. Test delivery (see README step 4) before scheduling
EOF
