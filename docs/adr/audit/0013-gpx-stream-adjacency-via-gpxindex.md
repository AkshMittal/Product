# ADR-0013: GPX stream adjacency via `gpxIndex` (motion, sampling, temporal)

**Date**: 2026-04-04  
**Status**: accepted  
**Deciders**: Product / pipeline owners

## Context

Ingestion accepts only coordinate-valid points into the `points` array. Rejected GPX `<trkpt>` rows appear in `audit.ingestion.rejections.events` only. Therefore **consecutive array indices** `(points[i-1], points[i])` are **not** guaranteed to be **consecutive rows in the source GPX stream**: a rejected point creates a gap in `gpxIndex` between neighbors in the array.

Motion audit, sampling (time Δ, distance Δ, time-conditioned distance), and temporal tags **`adjacentDuplicate`** / **`belowPrevValid`** previously treated “adjacent” as **array-adjacent** (or “last valid in array order”). That implied a kinematic or timestamp edge across a **nonexistent** stream row when coordinates failed.

## Decision

1. **Single adjacency predicate** for pair-based motion and sampling logic: both endpoints must have finite `gpxIndex`, and **`curr.gpxIndex === prev.gpxIndex + 1`**. Pairs that only meet array adjacency are **skipped** (no annotations, no deltas, no pair counts).
2. **`audit.motion.summary.consecutivePairCount`** counts **only** pairs that pass this predicate (not `points.length - 1`).
3. **Sampling** time pairs, distance pairs, and time-conditioned distance use the **same** stream-adjacency gate; summary counters (`consecutivePairCount`, `consecutiveTimestampPairsCount`, etc.) count **evaluated** stream-adjacent pairs only.
4. **Temporal** `adjacentDuplicate` and `belowPrevValid` compare the current point to the **accepted** point at **`gpxIndex - 1`** when that predecessor exists and has **finite `timeMs`**. If the stream predecessor is missing from `points` (rejected) or has no parseable time, those two tags do **not** use the “previous valid in array order” fallback.

`nonAdjacentRepeat`, `belowAnchor`, `seenTimestamps`, missing/unparsable handling, and session span semantics are unchanged except for documentation clarifications.

## Alternatives Considered

### Alternative 1: Keep array adjacency only

- **Pros**: Simpler loop; larger pair counts.
- **Cons**: Mislabels motion/sampling edges across coordinate gaps; temporal “adjacent” duplicate does not match GPX row adjacency.

### Alternative 2: New field names for stream-adjacent counts

- **Pros**: Zero ambiguity for old consumers.
- **Cons**: Breaking rename churn; same conceptual “consecutive pairs” with corrected meaning.

**Chosen**: Retain `consecutivePairCount` / `consecutiveTimestampPairsCount` names; redefine meaning in glossary and ADRs (observation-only contract; consumers must not assume array-only adjacency).

## Consequences

### Positive

- Pair identities in motion and sampling align with **actual GPX stream steps**.
- Temporal adjacent-duplicate / below-previous semantics match **stream row order** for valid times.

### Negative

- Pair counts **decrease** when ingestion rejects points between accepted neighbors.
- Fixtures and any downstream logic assuming `n-1` motion pairs must be recomputed.

### Risks

- **Risk**: External tools cached old semantics. **Mitigation**: ADR, pipeline docs, glossary, adversarial `EXPECTED.md` refresh.

**Cross-references**: [`../../project/pipeline/motion-audit.md`](../../project/pipeline/motion-audit.md), [`../../project/pipeline/sampling-audit.md`](../../project/pipeline/sampling-audit.md), [`../../project/pipeline/timestamp-audit.md`](../../project/pipeline/timestamp-audit.md), [`0003-time-deltas-bridge-gaps-elevation-deltas-adjacent-only.md`](0003-time-deltas-bridge-gaps-elevation-deltas-adjacent-only.md)
