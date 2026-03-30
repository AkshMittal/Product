# Branch Policy

## Purpose

This repository uses two long-lived branches with explicit ownership.

## `main` (Foundation)

- Owns reusable pipeline code and validation assets.
- Keeps core modules, schema contracts, docs, and test fixtures.
- Must stay free from case-study-specific UI and execution tooling.

Allowed in `main`:
- `js/pipeline/*`
- `docs/project/` (pipeline + workbench module docs + roadmap; see `docs/project/README.md`)
- `docs/reports/` for dated run notes
- custom test GPX fixtures and expected results

Not allowed in `main`:
- case-study frontend (`case-study.html`, `js/frontend/*`)
- case-study-only scripts (DB/storage import/upload/orchestration)
- generated run outputs, CSV datasets, parsed dumps

## `case-study` (Application)

- Includes the case-study product surface and execution stack.
- Contains UI, case-study scripts, and current pipeline code.
- May include custom test fixtures/results used for validation.

## Generated Data Policy (Both Branches)

Never commit generated/runtime artifacts, including:
- `runs/`
- `datasets/`
- logs and local env files

`.gitignore` must keep these excluded on both branches.

## Merge discipline (`case-study` ↔ `main`)

When promoting work from `case-study` to `main`:

- Prefer **cherry-picking** reusable pipeline code, schema docs, and validation assets — not wholesale branch merges that drag in UI or case-study-only tooling.
- **`main` is canonical** for `docs/project/product-roadmap.md`, `docs/reports/adversarial-validation-status.md`, and this file (`BRANCH_POLICY.md`). Do not overwrite `main` versions from `case-study`; merge `main` → `case-study` or resolve conflicts in favor of `main` for those paths.
- **Do not** land case-study-only scripts (DB/storage import, upload, orchestration) on `main`.
- `docs/project` entries promoted from `case-study` must map to files that actually exist on `main`; remove stale references during promotion.
