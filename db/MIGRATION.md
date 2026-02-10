# Supabase → Standalone Postgres Migration

This project used Supabase Postgres previously. The new backend uses a standalone Postgres database + a FastAPI service, with Clerk JWT auth.

## Prereqs

- `pg_dump` and `psql` available (Postgres client tools)
- A standalone Postgres database you control (set `DATABASE_URL`)
- Your Supabase database connection string (temporary; do **not** commit it)

## 1) Apply schema to your standalone Postgres

The schema lives in `db/schema.sql`.

Run the schema apply script (recommended):

```bash
python api/scripts/apply_schema.py
```

This reads `DATABASE_URL` from your environment.

## 2) Export data from Supabase

Export the `profiles` table (data only):

```bash
pg_dump "$SUPABASE_DB_URL" --data-only --inserts --column-inserts --table public.profiles > db/profiles_data.sql
```

Notes:
- `SUPABASE_DB_URL` is your Supabase Postgres connection string.
- The output file `db/profiles_data.sql` should **not** be committed.

## 3) Import data into your standalone Postgres

```bash
psql "$DATABASE_URL" -f db/profiles_data.sql
```

## 4) Smoke test

- Start the FastAPI service.
- Sign in on the app and open **My Profile**.
- You should see existing profile values from the migrated data.

