<!-- generated-by: gsd-doc-writer -->
# correction-idle.js — Per-Segment Correction-Idle Predicate

## Purpose

Determines whether a segment has no remaining work for the correction pipeline. Used as the short-circuit condition after each pre-segment stage and after each Phase 1 multipass iteration. If all segments are idle, the pipeline skips to export.

## Inputs

**`isSegmentCorrectionIdle(segTags, segWorkingPoints)`**

| Parameter | Type | Description |
|---|---|---|
| `segTags` | Object | Per-segment tag object from `perSegmentTags` map (built by `participation-check`) |
| `segWorkingPoints` | Array | Points in `workingOrderedPoints` belonging to this segment |

`segTags` fields consulted:
- `belowAnchor[]`
- `belowPrevValid[]`
- `nonAdjacentRepeat[]`
- `positiveTimeDeltaCount`
- `consecutiveTimestampPairsCount`

**`recomputeAllCorrectionIdle(segmentProfiles, perSegmentTags, workingOrderedPoints)`**

| Parameter | Type | Description |
|---|---|---|
| `segmentProfiles` | Array | Array of profile objects (mutated: `correctionIdle` field updated) |
| `perSegmentTags` | Map | `trkSegIndex → segTags` |
| `workingOrderedPoints` | Array | Current full working point list |

## Outputs

- `isSegmentCorrectionIdle` → `boolean`
- `recomputeAllCorrectionIdle` → `boolean` (`allIdle` — true iff every segment is idle); also mutates each profile's `correctionIdle` field

## Key logic

A segment is correction-idle when ALL five conditions hold:

1. `belowAnchor.length === 0`
2. `belowPrevValid.length === 0`
3. `nonAdjacentRepeat.length === 0`
4. `positiveTimeDeltaCount === consecutiveTimestampPairsCount` (every consecutive pair has Δt > 0)
5. No same-time-different-coords groups in the segment's current working points (detected by grouping by `timeMs` and checking for differing `lat`/`lon`)

If `segTags` is null/undefined, the segment is assumed idle (no audit data available).

`recomputeAllCorrectionIdle` groups all `workingOrderedPoints` by `trkSegIndex` once, then calls `isSegmentCorrectionIdle` for each profile.

## Invariants

- Does not mutate `workingOrderedPoints`
- Assumes `segTags` anomaly arrays reflect the original audit ordering (they are not re-derived from points)
- The same-time-different-coords check only considers points with `timeMs > 0` and finite

## Integration

Called from `correction-runner.js` after:
- Step 4 (objective adjacent dedupe)
- Step 5 (reversal check)
- Step 6 (deterministic export fix)
- After each segment's Phase 1 loop (inside the segment iteration loop)

Also used internally by `reversal-check.js` via `isSegmentCorrectionIdle`.

## Related ADRs

- ADR-0002 / ADR-0007 — per-segment eligibility and idle predicate design
