# Architecture Decision Records

Decisions are grouped **by scope folder** under `docs/adr/` so the **main branch** and **other git worktrees** can each keep ADRs that belong to that line of work without mixing unrelated histories.

| Scope folder | Use |
|--------------|-----|
| **`general/`** | Cross-cutting and **main / trunk** decisions (default when recording from `main`). |
| **Other folders** | One folder per worktree, feature line, or subsystem (e.g. `frontend/`, `pipeline/`). Name the folder after that context. |

**Numbering:** each scope folder has its **own** sequence (`0001`, `0002`, …). The same number in two folders is allowed; the path disambiguates.

**Shared:** [`template.md`](template.md) — use when drafting in any scope.

---

## Index

| Scope | ADR | Title | Status | Date |
|-------|-----|-------|--------|------|
| general | [0001](general/0001-canonical-track-single-source-of-truth.md) | Canonical track as single source of truth for the product surface | accepted | 2026-04-02 |
| general | [0002](general/0002-audit-layer-observation-only-and-pipeline-order.md) | Audit layer remains observation-only; post-audit pipeline order | accepted | 2026-04-02 |
| general | [0003](general/0003-logbook-frontend-stack.md) | Logbook frontend stack: Next.js, Mapbox GL, Tailwind, Recharts, Radix | accepted | 2026-04-02 |
| general | [0004](general/0004-mountain-focused-product-scope.md) | Mountain-focused product scope and personal log wedge | accepted | 2026-04-02 |

_Add rows here when you add ADRs in other scope folders._
