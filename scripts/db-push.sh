#!/usr/bin/env bash
# Apply any unapplied migrations directly to the Supabase project.
#
# Needs SUPABASE_DB_URL in .env.local — the connection string from
# Supabase > Settings > Database > Connection string > URI.
#
# Tracks what has run in a schema_migrations table, so this is safe to run
# repeatedly and only ever applies what is new. Each migration runs inside a
# transaction: a failure rolls back rather than leaving the schema half-built.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

if [ -f .env.local ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env.local; set +a
fi

# Build the URL from the password if a full one was not supplied. The project
# ref comes out of the Supabase URL we already have, and the right host is
# found by trying them: direct connection is IPv6-only on newer projects, so
# the session pooler is often the only one that works from a laptop.
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
    cat >&2 <<'MSG'
Neither SUPABASE_DB_URL nor SUPABASE_DB_PASSWORD is set.

  Supabase dashboard > Settings > Database > Reset database password
  Then add to .env.local:

    SUPABASE_DB_PASSWORD=your-password

MSG
    exit 1
  fi

  ref="$(printf '%s' "${NEXT_PUBLIC_SUPABASE_URL:-}" | sed -E 's#https?://([^.]+)\..*#\1#')"
  if [ -z "$ref" ]; then
    echo "Could not read the project ref from NEXT_PUBLIC_SUPABASE_URL." >&2
    exit 1
  fi

  encoded="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$SUPABASE_DB_PASSWORD")"

  candidates=(
    "postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres"
  )
  for region in us-east-1 us-east-2 us-west-1 us-west-2 eu-west-1 eu-central-1 ap-southeast-1 ap-southeast-2 ap-northeast-1 sa-east-1 ca-central-1; do
    candidates+=("postgresql://postgres.${ref}:${encoded}@aws-0-${region}.pooler.supabase.com:5432/postgres")
    candidates+=("postgresql://postgres.${ref}:${encoded}@aws-1-${region}.pooler.supabase.com:5432/postgres")
  done

  for candidate in "${candidates[@]}"; do
    if psql "$candidate" -tAc 'select 1' > /dev/null 2>&1; then
      SUPABASE_DB_URL="$candidate"
      echo "==> connected via $(printf '%s' "$candidate" | sed -E 's#://[^@]+@#://***@#')"
      break
    fi
  done

  if [ -z "${SUPABASE_DB_URL:-}" ]; then
    echo "Could not reach the database with that password on any known host." >&2
    echo "Grab the full URI from the dashboard's Connect button and set SUPABASE_DB_URL instead." >&2
    exit 1
  fi
fi

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -c '
  create table if not exists public.schema_migrations (
    version    text primary key,
    applied_at timestamptz not null default now()
  );' > /dev/null

# Adopting a database that was migrated by hand: record everything up to and
# including a version as applied, without running it. Standard practice when
# a tracking table arrives after the schema it tracks.
#
#   ./scripts/db-push.sh --baseline-through 20260921000300_free_for_all
if [ "${1:-}" = "--baseline-through" ]; then
  through="${2:?usage: --baseline-through <version>}"
  for file in supabase/migrations/*.sql; do
    version="$(basename "$file" .sql)"
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -c \
      "insert into public.schema_migrations (version) values ('$version')
       on conflict (version) do nothing"
    echo "==> baselined $version"
    [ "$version" = "$through" ] && break
  done
  echo
  echo "Baselined. Run again without arguments to apply the rest."
  exit 0
fi

applied=0
skipped=0

for file in supabase/migrations/*.sql; do
  version="$(basename "$file" .sql)"
  exists=$(psql "$SUPABASE_DB_URL" -tAc \
    "select 1 from public.schema_migrations where version = '$version'")

  if [ "$exists" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  echo "==> $version"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
    -f "$file" \
    -c "insert into public.schema_migrations (version) values ('$version')"
  applied=$((applied + 1))
done

if [ -f supabase/seed.sql ]; then
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
  echo "==> seed refreshed ($(psql "$SUPABASE_DB_URL" -tAc 'select count(*) from spectrum_cards') cards)"
fi

echo
echo "$applied applied, $skipped already present."
