<!-- generated-by: gsd-doc-writer -->
# duplicate-proposal

**File:** `packages/correction/proposals/duplicate-proposal.js`

## Overview

Handles two distinct duplicate detection responsibilities:

**(A) Per-segment proposals** (`buildDuplicateProposals`) — called per pass inside the Phase 1 multipass loop. Emits:
- `adjacent-exact-drop` proposals for traversal-adjacent exact duplicates
- `insert` proposals with `candidateGpxIndexes.length >= 2` for same-`timeMs` competition groups

**(B) Cross-segment detection** (`detectCrossSegmentDuplicates`) — called once before Phase 1 starts. Writes `excludedFromTrust` entries directly; emits no proposals.

Reference: plan §duplicate-proposal, ADR-correction-0004, ADR-correction-0014.

## API

### buildDuplicateProposals

```js
const { buildDuplicateProposals } = require('./proposals/duplicate-proposal');

const proposals = buildDuplicateProposals(
  workingOrderedPoints, // Array<Object>
  trkSegIndex,          // number
  spineEnvelope,        // { minTimeMs, maxTimeMs }|null
  params,               // { lenientMaxImpliedSpeedKph? }
  excludedSet           // Set<number>|Array<number> — optional
);
// returns Array<adjacent-exact-drop | insert proposal>
```

### detectCrossSegmentDuplicates

```js
const { detectCrossSegmentDuplicates } = require('./proposals/duplicate-proposal');

const detections = detectCrossSegmentDuplicates(
  workingOrderedPoints, // Array<Object>
  workingState          // mutable — writes excludedFromTrust entries
);
// returns Array<{ timeMs, gpxIndexes, trkSegIndexes }>
```

## Per-segment logic (A)

### Adjacent-exact-drop (A1)

Scans segment points in traversal order. Two consecutive points are exact duplicates when they share `timeMs`, `lat`, `lon`, AND `ele` (with `eleAbsent` normalisation). The second point gets an `adjacent-exact-drop` proposal.

Adjacent-exact-drop proposals bypass overlap-detection and coupling-detection — they are applied unconditionally.

### Same-timeMs groups (A2)

After adjacent-exact-drop candidates are identified, groups points by `timeMs`. Groups of size ≥ 2 (excluding already drop-queued or excluded points) become `insert` proposals:

- `isExactGroup = true` — every member shares `lat`, `lon`, `ele` → MVP flag-only, no mutation
- `isExactGroup = false` — competition group → ADVISORY disposition in `resolution-apply`; winner is lowest-score kinematic passer (all-fail fallback: lowest-score overall)

## Cross-segment detection (B)

Scans all points for same `timeMs` across different `trkSegIndex` values. Each gpxIndex in a qualifying group is written to `excludedFromTrust` with reason `cross_segment_duplicate`.

**Adjacent boundary pair exception:** If a cross-segment group consists of exactly two points from consecutive segments at the segment boundary (last point of segment S_i, first point of segment S_{i+1}), those points are left for Phase 2 `edge-reconciliation.js` to resolve deterministically. They are NOT excluded here.

Call timing: once before Phase 1, after `objective-adjacent-dedupe`, `reversal-check`, and `deterministic-export-fix`.

## Proposal shapes

### adjacent-exact-drop

| Field | Type | Description |
|---|---|---|
| `kind` | `'adjacent-exact-drop'` | |
| `keepGpxIndex` | number | Earlier point (kept) |
| `dropGpxIndex` | number | Later duplicate (dropped) |
| `eleMismatch` | boolean | True if `ele` values differ despite otherwise exact match |

### insert (competition)

| Field | Type | Description |
|---|---|---|
| `kind` | `'insert'` | |
| `candidateGpxIndexes` | number[] | All same-`timeMs` group members |
| `isExactGroup` | boolean | All identical vs competition |
| `bracketGpxIndexes` | number[] | Shared bracket from first candidate |
| `tPrev`, `tNext` | number\|null | Shared bracket anchor times |
| `targetTimeMs` | number | The shared `timeMs` |

## Related modules

- `phase2/edge-reconciliation.js` — handles cross-segment adjacent boundary drops
- `apply/resolution-apply.js` — ADVISORY disposition for competition groups
- `state/working-state.js` — `addExcludedFromTrust` used by cross-segment detection
- `state/proposal-schema.js` — proposal factories
