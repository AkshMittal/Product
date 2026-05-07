# ADR-correction-0005: Full-array reversal — candidacy and `noCorrectionTemporalAnomalies` acceptance

**Date**: 2026-04-13  
**Status**: accepted  

## Context

**`hasAnyPositiveTimeDelta === false`** is **ambiguous**: no time, all-equal instants, **or** time running **backward** in file order (reversed export). Treating that alone as “geometry-only” can **bake in** wrong traversal direction.

A **strict** test “after reverse, every `timeMs` step is non-decreasing” **fails** when the interior has local noise even though **endpoints** show a global backward file story.

## Decision

1. **Skip reversal** when participation says **geometry-only**, **all-identical / time-useless** pre-check applies, or **<2** finite **`timeMs`** in **`workingOrderedPoints`**.

2. **Candidacy (OR):**  
   - **A)** Ingest audit: **`hasAnyPositiveTimeDelta === false`**.  
   - **B)** **Endpoint envelope** on **current** `workingOrderedPoints` (after dedupe): first row with finite **`timeMs`** has **`timeMs === tMax`**, last such row has **`timeMs === tMin`**, with **`tMax > tMin`**, over all finite-`timeMs` rows.

3. **Hypothesis:** reverse **full** traversal order; **`gpxIndex`** unchanged per point.

4. **Acceptance:** **re-run** read-only temporal + sampling (or equivalent) on the **reversed** snapshot; **keep** reversal **iff** **`noCorrectionTemporalAnomalies === true`**. Else **revert** and emit **`reversal-unconfirmed`** (or equivalent structured failure).

5. **Dropped:** requiring **global monotonic** `timeMs` on the reversed array as the sole acceptance test.

## Alternatives Considered

### Alternative 1: Default global sort by `timeMs` with geometry gates

- **Pros**: Single universal reorder.
- **Cons**: Tie density, multi-story files, and audit/correction boundary complexity; different product from **file-order bracket** chunk story.
- **Why not**: **Not** adopted as MVP default; **full reversal** is the scoped **global** hypothesis with objective acceptance.

### Alternative 2: Never reverse; always geometry-only when no positive Δt

- **Pros**: Simple.
- **Cons**: Systematically wrong for reversed exports.
- **Why not**: **Rejected**.

## Consequences

### Positive

- Reversed tracks can become **correction-idle** without perfect interior monotonicity.

### Negative

- False accept if **`noCorrectionTemporalAnomalies`** is too weak; mitigate with tests.

### Risks

- Envelope candidacy rare false positives — acceptance gate is the backstop.
