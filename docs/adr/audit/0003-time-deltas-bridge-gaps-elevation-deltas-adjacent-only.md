# ADR-0003: Time Δ adjacent-only in sampling; elevation stepping stays adjacent

**Date**: 2026-04-02  
**Amended**: 2026-04-04  
**Status**: accepted  
**Deciders**: Product / pipeline owners

## Context

Sampling audit time deltas and elevation audit elevation deltas answer different questions: one reflects **local device cadence when timestamps are valid on consecutive points**, the other **channel step-by-step behavior**.  

**Amendment (2026-04-04):** Bridging time Δ across missing/unparsable points mixed **wall-clock gap span** into the same population as **nominal inter-record cadence**, which misled clustering and summary stats (e.g. a single large Δ across a corrupt block looked like a dominant sampling regime). Temporal audit already labels gaps; sampling should not reinterpret them as extra Δt samples.

## Decision

1. **Sampling audit** computes `Δt` only for **physically adjacent** point pairs `(points[i-1], points[i])` where **both** endpoints have a **finite** ingestion `timeMs`. It does **not** carry the “last valid timestamp” across invalid points. Gap structure remains observable via **`audit.temporal`**.
2. **Elevation audit** (amended 2026-04-04) no longer emits consecutive `Δele` statistics or skipped-pair counters. **Point-level** elevation labels (`missing`, `unparsable`, `outOfBounds`, `adjacentDuplicate`) describe the channel; any `Δele` series or gap analysis is **downstream**, using physically adjacent points and those labels as needed. (Philosophy: **adjacent-only** steps for elevation *structure* remain the honest model; audit just does not aggregate Δele in-pipeline anymore.)
3. **Time-conditioned distance deltas** in sampling pair the **same physically adjacent** segment as horizontal distance: positive `Δt` on that edge only when both times are finite and `Δt > 0`.

## Alternatives Considered

### Alternative 1: Bridge gaps in sampling `Δt` (superseded 2026-04-04)

- **Pros**: Fewer gaps in the delta series; one scalar “time to next parseable record.”
- **Cons**: Large bridged Δ values distort **min/max/median** and **clustering** as if they were typical hop intervals; pair identity was not surfaced in the main export payload.
- **Why not (now)**: Temporal labels cover gaps; sampling should summarize **adjacent-valid cadence** only.

### Alternative 2: Bridge gaps in `Δele` like `Δt`

- **Pros**: Fewer “gaps” in delta series.
- **Cons**: Merges two physical steps into one delta; misrepresents local elevation channel structure.
- **Why not**: Gap is itself an observable; bridging would be processing, not audit. (Elevation audit no longer emits Δele aggregates; downstream may still choose adjacent-only stepping.)

## Consequences

### Positive

- Time clustering reflects **dominant local sampling steps** when the time channel is continuous on the edge.
- No spurious “mega-Δt” from spanning corrupt blocks in the same population as 1 Hz cadence.
- Clear split: **temporal** = time-channel pathology; **sampling time** = adjacent-valid cadence regimes.

### Negative

- Wall-clock duration across a gap is **not** emitted as a sampling Δt (derivable from points + temporal if needed).

### Risks

- **Risk**: Confusion between “geometry-adjacent” and “both times parseable on that edge.” **Mitigation**: Glossary and this ADR; field names in schema.

**Cross-references**: [`../../project/pipeline/sampling-audit.md`](../../project/pipeline/sampling-audit.md), [`../../project/pipeline/elevation-audit.md`](../../project/pipeline/elevation-audit.md)
