# Adversarial GPX (`custom-test` cohort)

GPX files live in `fixtures/adversarial-custom-test/gpx/` and are named `adv-*.gpx`.

- **Pattern:** `adv-<id>-<scenario>.gpx`
- **`track_uid`** remains basename without `.gpx` (for fixture-driven local runs).

Files live under **`fixtures/adversarial-custom-test/`** (tracked in git) — not under `datasets/` (gitignored).

## Expected outcomes + run report (`EXPECTED.md`, `REPORT.md`)

Assertion targets and the latest harness run output for the 20 adversarial cases live **here** (same folder as the `custom-test` cohort). They are produced by:

```bash
node scripts/generate-gpx-adversarial-suite.js
```

That script writes **`adv-*.gpx`** under `fixtures/adversarial-custom-test/gpx/` and writes **`EXPECTED.md`** + **`REPORT.md`** in this directory.

## Regenerate audit JSON (v2)

From repo root:

```bash
node scripts/generate-gpx-adversarial-suite.js
```

This writes fixture JSON snapshots directly to:

- `fixtures/adversarial-custom-test/json/adv-*.audit.v2.json`

## Import to Supabase (`data_source = custom-test`)

```bash
node scripts/import-audit-adversarial-custom-test.js --dir fixtures/adversarial-custom-test/json
```

Dry-run first:

```bash
node scripts/import-audit-adversarial-custom-test.js --dry-run --limit 1 --dir fixtures/adversarial-custom-test/json
```

## Storage (GPX + JSON)

After DB import, upload both buckets and refresh `tracks` paths/hashes:

```bash
node scripts/upload-custom-test-fixtures-to-storage.js
```

(`--dry-run` supported.) Uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env`.
