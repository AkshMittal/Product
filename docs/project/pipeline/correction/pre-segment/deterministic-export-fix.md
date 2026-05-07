<!-- generated-by: gsd-doc-writer -->
# deterministic-export-fix

**File:** `packages/correction/pre-segment/deterministic-export-fix.js`

## Overview

Correction-owned classifier and applier for inter-segment boundary issues. Supersedes the legacy audit `export-fault-detection.js` (kept for backwards compat). Runs once in the pre-segment stage, after `reversal-check.js` and before Phase 1.

Takes the boundary classifications from `boundary-classifier.js` and applies them in a fixed, deterministic order: chunk reorders first, then duplicate exclusions, then flag-only annotations.

Reference: ADR-correction-0013, plan §Deterministic export fix phase.

## API

```js
const { applyDeterministicExportFixes } = require('./pre-segment/deterministic-export-fix');

const result = applyDeterministicExportFixes(
  workingState,                   // mutable
  boundaryClassifications,        // Array — from boundary-classifier
  segmentSummaries,               // Array — from audit.ingestion.segmentSummaries[]
  segmentParticipationProfiles    // Array — mutated for excluded segments
);
// returns { chunkReorders, droppedSegments, tzDiscontinuities, gapAnnotations }
```

## Apply order

### 1. `chunk_ordering` — canonical segment reorder

Collects all segments involved in any `chunk_ordering` boundary. Sorts them by `minTimeMs` (from `segmentSummaries`). Applies the reorder only if the order actually changed.

Mutations:
- `state.workingOrderedPoints` is rebuilt with segments in correct time order
- Single rearrangement entry kind `'segment-chunk-reorder'` with `affectedTrkSegIndexes` and `newOrder`
- Segment-scope annotation `chunk_ordering_resolved` on each moved segment (details: `previousPosition`, `newPosition`)

Non-affected segments keep their absolute positions; only the slots originally held by affected segments are permuted.

### 2. `duplicate_chunk` — exclude later segment

For each `duplicate_chunk` boundary, drops all points in the `toTrkSegIndex` segment.

Mutations:
- Each dropped point → `ws.addDrop(gpxIndex, 'duplicate_chunk_segment', stage)`
- Points removed from `workingOrderedPoints`
- Segment-scope annotation `duplicate_chunk_excluded`
- Corresponding `segmentParticipationProfiles` entry: `mode = 'geometry-only'`, `correctionIdle = true`

### 3. `timestamp_discontinuity` — flag only

Emits a segment-scope annotation `timestamp_discontinuity` on the `toTrkSegIndex` segment. No mutations.

Details include `gapMs` and `suspectedTimezoneOffsetHours` from the boundary classification.

### 4. `segment_boundary_gap` — flag only

For every boundary with `isBoundaryGap === true`, emits segment-scope annotation `segment_boundary_gap` on the `toTrkSegIndex` segment. No mutations.

Details include `gapMs`, `impliedDistanceM`, `impliedSpeedKph`.

## Return value

```js
{
  chunkReorders:     [{ affected: number[], newOrder: number[] }],
  droppedSegments:   number[],          // trkSegIndexes excluded as duplicate chunks
  tzDiscontinuities: [{ fromTrkSegIndex, toTrkSegIndex, suspectedTimezoneOffsetHours }],
  gapAnnotations:    [{ fromTrkSegIndex, toTrkSegIndex, gapMs }]
}
```

## Related modules

- `pre-segment/boundary-classifier.js` — produces the `boundaryClassifications` input
- `state/working-state.js` — all mutation writers
- `runner/correction-runner.js` — calls this in the pre-segment stage
- `phase2/edge-reconciliation.js` — uses `chunk_ordering` stability to resolve staged edge proposals
