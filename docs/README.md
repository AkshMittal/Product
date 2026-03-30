# Documentation

This repository’s written material is organized as **stable reference** vs **time-bound reports**.

## Layout

| Path | What it is |
|------|------------|
| **[`project/`](project/README.md)** | Long-lived docs: GPX audit **pipeline** specs, workbench support modules, and product roadmap. |
| **[`reports/`](reports/)** | Dated notes: adversarial harness snapshots and run metadata. |

## Where to start

| If you want to… | Read |
|-----------------|------|
| Understand the end-to-end audit pipeline and JSON contract | [`project/pipeline/post-1-pipeline-technical-writeup.md`](project/pipeline/post-1-pipeline-technical-writeup.md) |
| Look up v2 JSON paths | [`project/pipeline/json-schema-v2-glossary.md`](project/pipeline/json-schema-v2-glossary.md) |
| Understand sequence-aware scatter and slider behavior | [`project/pipeline/kde-visualization-module.md`](project/pipeline/kde-visualization-module.md) |
| Understand motion metrics and anomaly primitives | [`project/pipeline/motion-audit.md`](project/pipeline/motion-audit.md) |
| Understand local block and map modules used by workbench | [`project/pipeline/local-block-audit.md`](project/pipeline/local-block-audit.md), [`project/pipeline/map-audit-module.md`](project/pipeline/map-audit-module.md) |

## Repository root

- **[`LICENSE`](../LICENSE)** — ISC license (see also `package.json`).
- **[`SECURITY.md`](../SECURITY.md)** — credentials, Supabase client keys, and what not to commit.

## Branch note

[`BRANCH_POLICY.md`](../BRANCH_POLICY.md) describes what belongs on `main` vs `case-study`. The `docs/` tree on `main` should only reference assets present on `main`.
