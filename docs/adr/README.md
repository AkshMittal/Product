# Architecture Decision Records

Decisions are grouped by **topic** so merges to `main` stay predictable and new domains do not collide with numbering namespaces.

| Topic | Index |
|-------|--------|
| **Audit pipeline** (sampling, temporal, elevation, motion, DEM) | [`audit/README.md`](audit/README.md) |

Add new top-level folders under `docs/adr/<topic>/` when a new domain needs its own ADR sequence (e.g. `docs/adr/product/`, `docs/adr/infra/`).

Shared **blank template**: [`audit/template.md`](audit/template.md) — copy into the right topic folder when adding an ADR.
