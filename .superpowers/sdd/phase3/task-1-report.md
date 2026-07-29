# Task 1 Report: Database — body metrics and demo clients

## Summary

Implemented the database groundwork for Phase 3 professional features by creating the `body_metrics` table and adding four demo clients assigned to Coach Andrea. The work includes two idempotent SQL patches and corresponding updates to schema and policies.

## What was implemented

### 1. Created `supabase/patches/004-body-metrics.sql`
- Defines the `body_metrics` table with columns: `id`, `member_id`, `recorded_by_id`, `measured_on`, `weight_kg`, `note`, `created_at`
- Implements unique constraint on `(member_id, measured_on)` to ensure one reading per client per day
- Makes the upsert idempotent (replayed offline saves land on the same row)
- Includes verification query checking for RLS enabled and policy count

### 2. Created `supabase/patches/005-demo-clients.sql`
- Adds four demo users: Elena Mingotti, Lorenzo Mamone, Alex Giustacchini, Pierfelice Rocco
- Assigns all to Coach Andrea (from seed.sql)
- Creates one workout plan per demo client with three sessions each
- Seeds five appointments spread across today
- Generates five weekly body metrics for Elena to provide trend data for the progress screen
- Includes verification queries for client count, appointments, and body metrics

### 3. Appended to `supabase/schema.sql`
- Added `body_metrics` table definition (without `if not exists` since this is the schema definition)
- Placed after `checkins` and before `push_subscriptions` as specified
- Includes the index on `(member_id, measured_on desc)`

### 4. Appended to `supabase/policies.sql`
- Added `alter table body_metrics enable row level security;` to the RLS block (after checkins)
- Added two policies:
  - `body_metrics_select`: Members can read their own metrics, professionals can read their clients' metrics via `owns_member()`
  - `body_metrics_write_pro`: Only professionals can write metrics for their assigned clients

### 5. Updated `supabase/verify.sql`
- Changed three expected counts from '15' to '16':
  - 'public tables'
  - 'tables with RLS enabled'
  - 'tables with at least one policy'

## How it was verified by inspection

### SQL Correctness
- All SQL statements in patches match the brief character-for-character
- Syntax is valid: proper use of UUIDs, date types, numeric types, constraints, and indexes
- Idempotent patterns used consistently (`if not exists`, `on conflict`, `guard explicitly`)

### File Placement
- `body_metrics` table in schema.sql: Located between `checkins` (lines 176-182) and `push_subscriptions` (line 200)
- `body_metrics` policies in policies.sql: Located between `checkins` block (ends line 191) and `push_subscriptions` block (starts line 204)
- RLS enable added to correct position in policies.sql (line 19, after checkins at line 18)

### Verify.sql Changes
- `git diff supabase/verify.sql` shows exactly 3 changed lines (the three count expectations)
- No other whitespace or structure changes in that file (addressing the noted revert from accidental reindent)

### Schema Consistency
- `schema.sql` table definition matches `004-body-metrics.sql` patch definition (both are idempotent-safe versions of the same table)
- `policies.sql` policies match `004-body-metrics.sql` policies exactly
- Comment styles and formatting align with existing file conventions

## Files changed

- `supabase/patches/004-body-metrics.sql` (created)
- `supabase/patches/005-demo-clients.sql` (created)
- `supabase/schema.sql` (modified: 15 lines added)
- `supabase/policies.sql` (modified: 11 lines added to policies, 1 line added to RLS block)
- `supabase/verify.sql` (modified: 3 lines changed from '15' to '16')

## Self-review findings

None. All specifications from the brief were implemented exactly:
- SQL statements copied verbatim from brief
- File placement matches brief specifications
- Idempotent patterns verified
- No extraneous changes
- Lint passes (`npm run lint`)

## Next Steps (for Davide)

Run these two files in the Supabase SQL editor, in order:
1. `supabase/patches/004-body-metrics.sql` — expect `rls_enabled = true`, `policy_count = 2`
2. `supabase/patches/005-demo-clients.sql` — expect three PASS rows

Then re-run `supabase/verify.sql`; every check must still read PASS, with the three table counts now at 16.
