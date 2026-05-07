<!-- generated-by: gsd-doc-writer -->
# residual-diagnostic-sweep

**File:** `packages/correction/phase3/residual-diagnostic-sweep.js`

## Overview

Phase 3 of the correction pipeline. Runs once after Phase 2 completes. **Observation-only — no mutations.** Produces a structured `diagnostics` payload that `correction-export.js` attaches to `correction.json`.

Reference: plan §Phase 3, ADR-correction-0011, ADR-correction-0012.

## API

```js
const { runResidualDiagnosticSweep } = require('./phase3/residual-diagnostic-sweep');

const diagnostics = runResidualDiagnosticSweep(
  workingState,       // read-only in Phase 3
  spineResult,        // { spinePointsBySegment, envelopeBySegment }
  segmentProfiles     // Array
);
// returns diagnostics payload (plain JSON-serializable object)
```

## Diagnostics payload

```js
{
  residualBelowAnchor:          Array,   // (1)
  residualNonMonotonicSegments: Array,   // (2)
  residualSameTimeGroups:       Array,   // (3)
  residualCrossSegmentSameTime: Array,   // (4)
  coverage:                     Object   // (5)
}
```

### (1) residualBelowAnchor

Points where, in the final `workingOrderedPoints` traversal, the previous same-segment neighbour with usable `timeMs` has a strictly greater `timeMs` — a backward step that survived Phase 1+2.

```js
{
  gpxIndex:     number,
  trkSegIndex:  number,
  prevGpxIndex: number,
  prevTimeMs:   number,
  timeMs:       number,
  deltaMs:      number   // negative value
}
```

### (2) residualNonMonotonicSegments

Segments with at least one `residualBelowAnchor` violation, with violation count.

```js
{ trkSegIndex: number, violations: number }
```

### (3) residualSameTimeGroups

Surviving groups of ≥2 points with identical positive `timeMs` within the same segment, after Phase 1+2 mutations.

```js
{ trkSegIndex: number, timeMs: number, gpxIndexes: number[] }
```

These should normally have been resolved by Phase 1's `duplicate-proposal.js`. Survivors indicate unresolved competition groups (e.g. `exact_group_flag_only`) or stalemate conditions.

### (4) residualCrossSegmentSameTime

Surviving same-`timeMs` groups spanning ≥2 `trkSegIndex` values. These should have been moved to `excludedFromTrust` by `detectCrossSegmentDuplicates`. If any survive, they are surfaced here.

```js
{ timeMs: number, gpxIndexes: number[], trkSegIndexes: number[] }
```

### (5) coverage

```js
{
  segments:              number,   // distinct trkSegIndex values in final workingOrderedPoints
  totalPoints:           number,   // workingOrderedPoints.length + droppedCount
  trustedSurvivingCount: number,   // in workingOrderedPoints AND not excludedFromTrust
  droppedCount:          number,   // workingState.drops.length
  excludedCount:         number    // workingState.excludedFromTrust.length
}
```

`totalPoints` accounts for dropped points no longer in `workingOrderedPoints`.

## No-mutation contract

Phase 3 does not call any `working-state.js` writers. Diagnostics are a separate payload returned to the runner and assembled by `correction-export.js`. This ensures the working state is unchanged between Phase 2 exit and export.

## Related modules

- `runner/correction-runner.js` — calls `runResidualDiagnosticSweep` after Phase 2
- `export/correction-export.js` — attaches `diagnostics` to the final `correction.json`
- `state/correction-idle.js` — the idle predicate checked during Phase 1; residuals are what survive it
