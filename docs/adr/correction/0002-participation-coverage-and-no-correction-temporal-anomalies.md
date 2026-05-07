# ADR-correction-0002: Participation — coverage gate and `noCorrectionTemporalAnomalies`

**Date**: 2026-04-13  
**Status**: accepted  

## Context

Correction needs a **cheap** participation story: when is the file **timestamp-sparse** vs **full**, when can the **heavy** correction path **short-circuit**, and how do **gaps** (missing/unparsable time, ingestion rejects) relate to **skip** semantics?

Earlier drafts tied “forward clean” to **zero** missing/unparsable timestamps, which mixes **gap bookkeeping** (audit / participation) with **reorder / backtrack** work (correction).

## Decision

1. **Evaluate `coverageRatio` / mode before `noCorrectionTemporalAnomalies`.**  
   - **`minTimestampPairCoverageRatio`** default **0.8** (versioned).  
   - **`parseableTimestampPointCount === 0`** → `geometry-only`.  
   - **`coverageRatio` < threshold** → `timestamp-sparse`; else `full`.  
   - **Sparse** tracks can still be **correction-idle** (`noCorrectionTemporalAnomalies === true`).

2. **`noCorrectionTemporalAnomalies`** (rename from “forward-only clean” for clarity) means **correction-idle**: no work for reorder / backtrack / duplicate-time machinery **in this layer’s scope**. It **does not** assert zero missing/unparsable or zero ingestion rejections.

3. **Predicate (MVP):** `hasAnyPositiveTimeDelta`; all stream-adjacent pairs with both finite `timeMs` have **Δt > 0** (align with `audit.sampling`); **`audit.temporal.tagCounts`** for **`belowAnchor`**, **`belowPrevValid`**, **`nonAdjacentRepeat`** are all **0**. **Missing/unparsable** are **out** of this predicate.

4. **`correction.excludedFromTrust`**: **correction-layer** outcomes only — **do not** duplicate **`audit.ingestion.rejections`** or audit temporal missing/unparsable for participation; downstream **joins `audit` + participation**.

## Alternatives Considered

### Alternative 1: Strict “no gaps” for short-circuit (`missing`/`unparsable` must be0)

- **Pros**: Strong guarantee for downstream “no temporal holes.”
- **Cons**: Mixes audit gap semantics into correction skip; sparse-but-clean interior never short-circuits correctly.
- **Why not**: **Rejected** — gaps remain **audit + participation**; correction skip means **no correction acts**, not “no holes.”

### Alternative 2: `coverageRatio` threshold at 0.5 (placeholder)

- **Pros**: Permissive early MVP.
- **Why not**: Raised to **0.8** for coarser confidence until **sectional** participation exists.

## Consequences

### Positive

- Clear split: **participation / audit** for eligibility and gaps; **correction** for acts and correction-only exclusions.

### Negative

- Downstream must **join** sources for full trust story on `canonicalTrustedPoints`.

### Risks

- Misread of `noCorrectionTemporalAnomalies` as “globally gap-free” — document and name accordingly.
