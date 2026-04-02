# ADR-0006: Elevation audit module scope

**Date**: 2026-04-02  
**Status**: accepted  
**Deciders**: Product / pipeline owners

## Context

The elevation channel needs a bounded audit contract so ingestion-quality and channel statistics do not creep into metric-layer concepts (gain/loss, DEM fusion, vertical speed policies).

## Decision

The elevation audit module covers the **recorded elevation channel only**: coverage, validity against explicit bounds, duplicate runs, consecutive `Δele` statistics (within ADR-0004 constraints), raw elevation range, and co-presence with time — without rates that require motion policy.

**In scope**
- Missing elevation coverage (count, ratio, blocks, isolated events)
- Deterministically invalid values (e.g. `< -500m` or `> 9500m`)
- Adjacent duplicate elevation runs (count, ratio, blocks, isolated events)
- Consecutive `Δele` statistics (min, max, max absolute, zero-delta count)
- Raw elevation statistics (min, max, span, first/last valid, parseable count)
- Co-presence with time (points and pairs with both valid ele and parseable time)

**Out of scope**
- `std(Δele)` — ADR-0004
- Accumulated gain/loss — metric-layer
- Smoothed grade or gradient — processing
- Vertical speed `Δele / Δt` — motion extension (ADR-0007)
- DEM comparison during audit — ADR-0009

## Alternatives Considered

### Alternative 1: Single “mega module” for ele + motion vertical
- **Pros**: One import for all vertical questions.
- **Cons**: Blurs audit boundaries; vertical speed is inherently motion.
- **Why not**: Split ownership per ADR-0008.

## Consequences

### Positive
- Clear module boundary for consumers and CI.

### Negative
- Vertical rate consumers must use motion extension once implemented.

### Risks
- **Risk**: Scope creep (DEM in audit). **Mitigation**: ADR-0009/0010/0011.

**Cross-references**: [`../../project/canonical-track-architecture.md`](../../project/canonical-track-architecture.md), motion audit module
