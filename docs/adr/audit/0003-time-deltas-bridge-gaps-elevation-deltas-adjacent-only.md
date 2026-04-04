# ADR-0003: Time Δ bridges gaps; elevation Δ and conditioned distance stay adjacent

**Date**: 2026-04-02  
**Status**: accepted  
**Deciders**: Product / pipeline owners

## Context

Sampling audit time deltas and elevation audit elevation deltas answer different questions: one reflects **device recording regime**, the other **channel step-by-step behavior**. Using the same gap-bridging rule for both would either misrepresent cadence or smear elevation structure.

## Decision

1. **Sampling audit** computes `Δt` between the **last and next parseable** timestamp, skipping points with missing or unparsable time — bridging across gaps in parseable time is intentional.
2. **Elevation audit** (amended 2026-04-04) no longer emits consecutive `Δele` statistics or skipped-pair counters. **Point-level** elevation labels (`missing`, `unparsable`, `outOfBounds`, `adjacentDuplicate`) describe the channel; any `Δele` series or gap analysis is **downstream**, using physically adjacent points and those labels as needed. (Philosophy: **adjacent-only** steps for elevation *structure* remain the honest model; audit just does not aggregate Δele in-pipeline anymore.)
3. **Time-conditioned distance deltas** in sampling use the physically **adjacent** previous point as the spatial anchor, not the last-timestamped point; they pair with time only when that adjacent pair has positive `Δt`.

## Alternatives Considered

### Alternative 1: Always use physically adjacent pairs for `Δt` clustering
- **Pros**: Uniform rule across modules.
- **Cons**: Missing timestamps would fragment apparent cadence even when the device still recorded on a stable interval.
- **Why not**: Contradicts the goal of characterizing inter-**parseable**-record timing.

### Alternative 2: Bridge gaps in `Δele` like `Δt`
- **Pros**: Fewer “gaps” in delta series.
- **Cons**: Merges two physical steps into one delta; misrepresents local elevation channel structure.
- **Why not**: Gap is itself an observable; bridging would be processing, not audit. (Elevation audit no longer emits Δele aggregates; downstream may still choose adjacent-only stepping.)

## Consequences

### Positive
- Time clustering reflects true inter-record regime when timestamps are sparse.
- Elevation deltas stay honest to sequential channel evolution.
- Distance + time pairing stays aligned with real spatial steps.

### Negative
- Module-specific rules must be documented so consumers do not assume one bridging policy everywhere.

### Risks
- **Risk**: Confusion between “geometry-adjacent” and “parseable-time-adjacent.” **Mitigation**: Glossary and this ADR; clear field names in schema.

**Cross-references**: [`../../project/pipeline/sampling-audit.md`](../../project/pipeline/sampling-audit.md), [`../../project/pipeline/elevation-audit.md`](../../project/pipeline/elevation-audit.md)
