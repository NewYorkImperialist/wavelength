-- Minimal stand-in for the parts of a Supabase project our migrations rely on,
-- so the SQL can be executed against a plain PostgreSQL instance.
-- Not a substitute for testing against Supabase itself, but it catches
-- syntax errors, bad constraints, and broken policies.

drop database if exists wavelength_test;
create database wavelength_test;
