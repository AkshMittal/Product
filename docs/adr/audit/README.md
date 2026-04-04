# Audit pipeline — Architecture Decision Records

Structured log of **GPX audit pipeline** design choices. Each ADR captures **context**, **decision**, **alternatives**, and **consequences**.

For narrative module specs, see [`../../project/pipeline/`](../../project/pipeline/) and cross-references inside each ADR.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-sampling-rate-clustering-audit-artifact.md) | Sampling rate clustering is an audit artifact | accepted | 2026-04-02 |
| [0002](0002-timestamp-audit-label-based-architecture.md) | Timestamp audit uses per-point label-based architecture | accepted | 2026-04-02 |
| [0003](0003-time-deltas-bridge-gaps-elevation-deltas-adjacent-only.md) | Time Δ bridges gaps; elevation Δ and conditioned distance stay adjacent | accepted | 2026-04-02 |
| [0004](0004-elevation-delta-std-not-audit-artifact.md) | std(Δele) is not an audit artifact | accepted | 2026-04-02 |
| [0005](0005-directional-vector-variance-not-audit-artifact.md) | Directional and vector variance are not audit artifacts | accepted | 2026-04-02 |
| [0006](0006-elevation-audit-module-scope.md) | Elevation audit: per-point labels (amended) | accepted (amended 2026-04-04) | 2026-04-04 |
| [0007](0007-3d-motion-audit-extension-scope.md) | 3D eligibility in motion audit; computed 3D scalars downstream | accepted | 2026-04-03 |
| [0008](0008-audit-field-combination-ownership.md) | Which module owns each field combination | accepted | 2026-04-02 |
| [0009](0009-dem-not-used-during-audit.md) | DEM is not used during audit | accepted | 2026-04-02 |
| [0010](0010-dem-residual-post-audit-quality-gate.md) | DEM residual analysis as post-audit quality gate | accepted (impl. deferred) | 2026-04-02 |
| [0011](0011-dem-full-substitution-declared-channel.md) | Full DEM substitution only as declared attached channel | accepted (impl. deferred) | 2026-04-02 |
| [0012](0012-ingestion-only-time-parse.md) | GPX time parsing only at ingestion; audits consume `timeMs` | accepted | 2026-04-04 |

**Template:** [`template.md`](template.md)

**New audit ADRs:** add `docs/adr/audit/NNNN-short-title.md`, increment `NNNN`, append a row here.
