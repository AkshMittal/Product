<!-- generated-by: gsd-doc-writer -->
# edge-reconciliation

**File:** `packages/correction/phase2/edge-reconciliation.js`

## Overview

Phase 2 of the correction pipeline. Runs once after all segments finish Phase 1. Two responsibilities:

1. **Cross-segment adjacent-exact-drop** — drops the first point of segment S_{i+1} when it is an exact duplicate of the last point of S_i and both points are spine-stable.
2. **Staged-edge proposal reconciliation** — resolves edge proposals that Phase 1 parked in `workingState.stagedEdgeProposals` against a boundary stability matrix.

Reference: ADR-correction-0014 §Cross-segment adjacent dedupe exception, plan §Edge proposals, ADR-correction-0010.

## API

```js
const { runEdgeReconciliation } = require('./phase2/edge-reconciliation');

const result = runEdgeReconciliation(
  workingState,             // mutable
  spineResult,              // { spinePointsBySegment, envelopeBySegment }
  boundaryClassifications   // Array — from boundary-classifier
);
// returns { crossSegmentDrops, edgesResolvedStable, edgesResolvedUnstable }
```

## Responsibility 1: Cross-segment adjacent-exact-drop

For each consecutive segment pair (S_i, S_{i+1}) in traversal order:

1. Check if `S_i.lastPoint` and `S_{i+1}.firstPoint` are exact duplicates (same `timeMs`, `lat`, `lon`, `ele`)
2. Check spine stability: both points must be members of their segment's spine
3. **Both stable** → drop `S_{i+1}.firstPoint`:
   - `ws.addDrop(gpxIndex, 'adjacent-exact-duplicate', 'edge-reconciliation')`
   - `ws.removeFromWorking(gpxIndex)`
   - Rearrangement kind `'cross-segment-adjacent-drop'`
4. **Either unstable** → no drop; segment-scope annotation `edge_coupling_unstable` on `S_{i+1}` with spine stability flags
5. **Guard**: if `S_{i+1}.firstPoint.gpxIndex` is already in `excludedFromTrust` (placed there by Phase 1's `detectCrossSegmentDuplicates`), skip the drop to avoid partition invariant violation

## Responsibility 2: Staged-edge proposal reconciliation

Each segment may have up to two staged edge proposals (parked by `phase1-loop.js`):
- `firstEdge` — proposal touching the incoming boundary of the segment
- `lastEdge` — proposal touching the outgoing boundary

Each proposal is resolved against the **boundary stability matrix**:

| Boundary classification | Stability |
|---|---|
| `chunk_ordering` | Stable (resolved by deterministic-export-fix reorder) |
| `duplicate_chunk` | Unstable (segment side gone) |
| `timestamp_discontinuity` | Unstable |
| `segment_boundary_gap` | Unstable |
| No boundary (session edge) | Unstable |

**Stable edges** — MVP: not physically applied. Edge members → `excludedFromTrust` reason `edge_unresolved`, `skipReason = 'edge_unresolved'`. Recorded in `edgesResolvedStable` for future work.

**Unstable edges** — Same outcome: members → `excludedFromTrust` reason `edge_unresolved`. Segment-scope annotation `edge_coupling_unstable`. Recorded in `edgesResolvedUnstable`.

In both cases, the proposal is pushed to `workingState.proposals` with `applied = false`.

## Return value

```js
{
  crossSegmentDrops: [{
    keepGpxIndex:    number,
    dropGpxIndex:    number,
    fromTrkSegIndex: number,
    toTrkSegIndex:   number
  }],
  edgesResolvedStable:   [{ trkSegIndex, side, proposalId, boundary }],
  edgesResolvedUnstable: [{ trkSegIndex, side, proposalId, boundary }]
}
```

## Exact duplicate definition

Same as used throughout the pipeline: `timeMs`, `lat`, `lon`, and `ele` (with `eleAbsent` normalisation) must all match. Invalid `timeMs` (non-finite or ≤ 0) → not a duplicate.

## Related modules

- `runner/correction-runner.js` — calls `runEdgeReconciliation` after Phase 1 completes
- `pre-segment/deterministic-export-fix.js` — produces `chunk_ordering` boundary resolutions that make edges stable
- `proposals/duplicate-proposal.js` — `detectCrossSegmentDuplicates` may pre-exclude boundary-adjacent points
- `spine/spine-intervals.js` — provides `spinePointsBySegment` for stability tests
- `phase3/residual-diagnostic-sweep.js` — Phase 3 reads post-Phase-2 working state
