#!/usr/bin/env bash
# Apply the migrations to a throwaway database and run the security suite.
#
# Uses a plain PostgreSQL instance with a small harness standing in for the
# Supabase-specific roles and publication. That is not a substitute for testing
# against Supabase itself — PostgREST schema exposure and Realtime payloads can
# only be checked there — but it verifies the SQL, the grants, the RLS policies
# and the table constraints.
#
#   brew install postgresql@17 && brew services start postgresql@17
#   ./scripts/db-test.sh
set -euo pipefail

DB="${WAVELENGTH_TEST_DB:-wavelength_test}"
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

echo "==> Recreating $DB"
psql -d postgres -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists ${DB}" \
  -c "create database ${DB}"

echo "==> Supabase harness (roles, publication)"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/test/roles.sql

echo "==> Migrations"
for file in supabase/migrations/*.sql; do
  echo "    $(basename "$file")"
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$file"
done

echo "==> Seed"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
echo "    $(psql -d "$DB" -tAc 'select count(*) from spectrum_cards;') cards"

echo "==> Security suite"
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/test/security.sql 2>&1 \
  | grep -E 'PASS|FAIL|All security' \
  | sed -E 's/^psql:[^ ]+ //; s/^NOTICE:  //'

echo
echo "Database checks complete."
