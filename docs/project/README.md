# Project documentation

Long-lived reference for the GPX audit **pipeline**, workbench support modules, and **roadmap**.

## [`pipeline/`](pipeline/)

Audit pipeline scope, per-module specs, and v2 JSON glossary.

| Doc | Topic |
|-----|--------|
| [`gpx-ingestion-module.md`](pipeline/gpx-ingestion-module.md) | Ingestion |
| [`timestamp-audit.md`](pipeline/timestamp-audit.md) | Temporal audit |
| [`sampling-audit.md`](pipeline/sampling-audit.md) | Sampling audit |
| [`motion-audit.md`](pipeline/motion-audit.md) | Motion pair flags and downstream eligibility |
| [`elevation-audit.md`](pipeline/elevation-audit.md) | Elevation channel audit |
| [`scratchpad-tool.md`](pipeline/scratchpad-tool.md) | Scratchpad behavior for ad hoc inspection |
| [`json-schema-v2-glossary.md`](pipeline/json-schema-v2-glossary.md) | v2 JSON paths glossary |

## Root of `project/`

| Doc | Topic |
|-----|--------|
| [`product-roadmap.md`](product-roadmap.md) | Product roadmap |
| [`canonical-track-architecture.md`](canonical-track-architecture.md) | Canonical track representation (single source of truth) |
| [`objective-participation-and-quality.md`](objective-participation-and-quality.md) | Post-audit participation masks, quality gates, and timestamp eligibility |
| [Audit ADRs](../adr/audit/README.md) | Architecture Decision Records for the pipeline (context, alternatives, consequences) |
| [ADR hub](../adr/README.md) | All ADR topic indexes (extend with new folders under `docs/adr/`) |
