# ADR-0006: Elevation audit module scope

**Date**: 2026-04-02  
**Status**: accepted (amended 2026-04-04)  
**Deciders**: Product / pipeline owners

## Context

The elevation channel needs a bounded audit contract so ingestion-quality labels do not creep into metric-layer concepts (gain/loss, DEM fusion, vertical speed policies).

## Decision

**Amendment (2026-04-04):** The elevation audit module emits **per-point label-based** output aligned with the temporal audit pattern: `tagCounts`, `tagIndex`, and sparse `pointAnnotations`. Tags cover **missing** `<ele>`, **unparsable** `<ele>`, **out-of-bounds** numeric values, and **adjacent duplicate** in-bounds values (vs the previous in-bounds point). **Mutual exclusion** applies among `missing`, `unparsable`, and `outOfBounds`; `adjacentDuplicate` applies only on the in-bounds path.

**In scope**

- Missing vs unparsable distinction via ingestion `eleAbsent` + `ele` (see module doc).
- Validity against explicit bounds `[validFloorM, validCeilingM]`.
- Adjacent duplicate detection on the in-bounds chain.
- `validElevationPointCount` and `totalPointsEvaluated`.

**Removed from audit payload (derive downstream)**

- Block summaries, isolated-event splits, ratios over total points (unless reintroduced as policy).
- Raw channel statistics: min, max, span, first/last.
- Consecutive Δele statistics and skipped-pair counters.
- Co-presence with time / parseable-time pairing counts — use `audit.temporal`, `audit.motion`, and point-level elevation tags with `gpxIndex` intersection downstream.

**Out of scope (unchanged)**

- `std(Δele)` — ADR-0004  
- Accumulated gain/loss — metric-layer  
- Smoothed grade or gradient — processing  
- Vertical speed `Δele / Δt` and 3D kinematic scalars — downstream / motion eligibility (ADR-0007)  
- DEM comparison during audit — ADR-0009  

## Alternatives Considered

### Alternative 1: Single “mega module” for ele + motion vertical
- **Pros**: One import for all vertical questions.
- **Cons**: Blurs audit boundaries; vertical speed is inherently motion-linked.
- **Why not**: Split ownership per ADR-0008.

## Consequences

### Positive
- Same consumer pattern as temporal: tag index + sparse annotations; no duplicate “statistics vs labels” drift.
- Clear handoff: elevation = **point channel**; motion = **pair eligibility** (including `eleUnresolvable`).

### Negative
- Downstream must re-derive blocks and descriptive stats if product still needs them.

### Risks
- **Risk**: Scope creep (DEM in audit). **Mitigation**: ADR-0009/0010/0011.

**Cross-references**: [`../../project/canonical-track-architecture.md`](../../project/canonical-track-architecture.md), [`../../project/pipeline/elevation-audit.md`](../../project/pipeline/elevation-audit.md), motion audit module
