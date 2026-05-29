# Event temporal migration runbook

Deploying the temporal fix does **not** mutate existing event dates. Only the scripts below change stored values.

## Prerequisites

- Schema migration applied (`temporalKind`, `allDayStartDate`, `allDayEndDate`, `dateRepairedAt`).
- `DATABASE_URL` set (use staging or a production read replica for audit-only runs).
- Code deployed with `eventTemporal` normalizer on all write/export paths.

## Order of operations

### 1. Deploy application + migration

```bash
npx prisma migrate deploy
npm run build
```

### 2. Backfill new columns (no instant repair yet)

```bash
npx tsx scripts/backfill-event-temporal.ts --dry-run
npx tsx scripts/backfill-event-temporal.ts --apply
```

Populates `temporalKind` and civil dates from legacy `start`/`end`/`timezone` without changing instants (except what backfill sets for missing kind).

### 3. Audit (read-only)

```bash
npm run audit:event-dates
# or
npx tsx scripts/audit-event-dates.ts --format=csv --out=reports/event-date-audit.csv
```

Review summary:

- `needs_storage_repair` — wrong 12Z/22Z or mismatched civil dates
- `needs_review` — likely midnight UTC ingest (manual fix)
- `export_semantics_change` — TIMED events will use Google `dateTime` after deploy

### 4. Repair dry-run

```bash
npx tsx scripts/repair-event-dates.ts --dry-run --bucket=auto_safe
```

Inspect `reports/repair-log-*.json`.

### 5. Apply auto-safe repairs

```bash
npx tsx scripts/repair-event-dates.ts --apply --bucket=auto_safe
```

For specific IDs from audit CSV:

```bash
npx tsx scripts/repair-event-dates.ts --apply --ids-file=reports/ids-to-repair.txt
```

### 6. Manual review pass

Fix rows flagged `needs_review` in admin or source CSV, then re-run audit.

### 7. Re-audit

```bash
npm run audit:event-dates
```

Target: `needs_storage_repair` ≈ 0.

### 8. Google Calendar sync

Repairs set `gcalSyncPending` on published events. Users with connected calendars should use **Sync now**, or run your existing GCal sync job so:

- ALL_DAY events use civil `date` fields
- TIMED events use `dateTime` + `timeZone`

## npm scripts

| Script | Command |
|--------|---------|
| Audit | `npm run audit:event-dates` |
| Backfill | `npx tsx scripts/backfill-event-temporal.ts --apply` |
| Repair | `npx tsx scripts/repair-event-dates.ts --apply --bucket=auto_safe` |
| Tests | `npm run test:event-temporal` |

Reports are written under `reports/` (gitignored).
