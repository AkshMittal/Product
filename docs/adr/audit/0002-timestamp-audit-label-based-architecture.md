# ADR-0002: Timestamp audit uses per-point label-based architecture

**Date**: 2026-04-02  
**Status**: accepted  
**Deciders**: Product / pipeline owners

## Context

Timestamp quality was previously expressed with block/singleton summaries and mutually exclusive primary categories (e.g. “duplicate” vs “backtracking”), with precedence rules that could hide facts (e.g. adjacent duplicate checked before anchor-relative backtracking). Downstream correction needs **all** applicable observables per point, deterministically, without implying which timestamp instance is “correct.”

## Decision

The timestamp audit emits **non-exclusive boolean tags** on anomalous points (`missing`, `unparsable`, `adjacentDuplicate`, `belowAnchor`, `belowPrevValid`, `nonAdjacentRepeat`), plus a hybrid payload: `tagCounts`, `tagIndex`, and sparse `pointAnnotations`. It does **not** assign each point to exactly one primary bucket or treat block/singleton summaries as the primary contract.

## Alternatives Considered

### Alternative 1: Keep single primary category + secondary annotations
- **Pros**: Familiar reporting for “dominant” anomaly type.
- **Cons**: Precedence hides overlapping truths; consumers assuming “backtracking = below anchor” miss adjacent-duplicate-under-anchor cases.
- **Why not**: Correction and smoothing need explicit overlap without inventing intersection types.

### Alternative 2: Block-centric output only
- **Pros**: Compact for contiguous runs.
- **Cons**: Loses per-point truth; block derivation is better left to layers that also see geometry.
- **Why not**: Sparse per-point labels + optional downstream blocking preserve facts.

### Alternative 3: Tag “large forward jumps” in timestamp audit
- **Pros**: Highlights suspicious cadence gaps.
- **Cons**: Indistinguishable from intentional recording pause without geometry or policy.
- **Why not**: Stays non-interpretive; sampling audit exposes raw `Δt`; correction layer decides.

## Consequences

### Positive
- Full overlap visible (e.g. `adjacentDuplicate` + `belowAnchor` simultaneously).
- Stream-wide `nonAdjacentRepeat` via `Map<timestampMs, firstGpxIndex>`: **O(1)** amortized per point vs **O(N²)** naive repeat scans.
- Single forward pass; no block-coalescing pass required for core contract.
- `tagIndex` supports set queries; `pointAnnotations` supports ordered correction walks.
- No “first occurrence is correct”: `firstOccurrenceGpxIndex` is an ordering fact only.

### Negative
- JSON payload larger than minimal block summaries (acceptable trade for serious pipelines).
- Consumers must learn tag semantics and mutual exclusions (documented in module + glossary).

### Risks
- **Risk**: Tag mis-read as verdict. **Mitigation**: Emphasize mechanical predicates and anchor-as-maximum, not truth claims.

**Cross-references**: [`../../project/pipeline/timestamp-audit.md`](../../project/pipeline/timestamp-audit.md), [`../../project/pipeline/json-schema-v2-glossary.md`](../../project/pipeline/json-schema-v2-glossary.md) (`audit.temporal`)
