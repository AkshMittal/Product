# Documentation

This repository’s written material is organized as **stable reference** vs **time-bound reports**.

## Layout

| Path | What it is |
|------|------------|
| **[`project/`](project/README.md)** | Long-lived docs: GPX audit **pipeline** specs, workbench support modules, and product roadmap. |
| **[`adr/`](adr/README.md)** | ADR hub; topic folders (e.g. [`adr/audit/`](adr/audit/README.md) for the GPX audit pipeline). |
| **[`reports/`](reports/)** | Dated notes: adversarial harness snapshots and run metadata. |

## Where to start

| If you want to… | Read |
|-----------------|------|
| Look up v2 JSON paths | [`project/pipeline/json-schema-v2-glossary.md`](project/pipeline/json-schema-v2-glossary.md) |
| Understand motion pair flags and eligibility | [`project/pipeline/motion-audit.md`](project/pipeline/motion-audit.md) |

## Repository root

- **[`LICENSE`](../LICENSE)** — ISC license (see also `package.json`).
- **[`SECURITY.md`](../SECURITY.md)** — credentials, Supabase client keys, and what not to commit.
