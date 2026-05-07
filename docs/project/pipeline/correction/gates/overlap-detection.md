<!-- generated-by: gsd-doc-writer -->
# overlap-detection

**File:** `packages/correction/gates/overlap-detection.js`

## Overview

Cross-proposal footprint gate. Reads the current proposal set and working snapshot; mutates proposal objects in place (setting `overlapStatus`, `bMin`, `bMax`, `tPrev`, `tNext`) and returns veto sets plus annotations.

Runs after all proposals are generated in each Phase 1 pass, before `coupling-detection.js`.

Reference: ADR-correction-0009, plan §Cross-proposal footprint mapping.

## Responsibilities

- Computes `B_min`/`B_max` for each block-finding proposal from member `timeMs` values
- Finds bracket anchors (`prevAnchor`, `nextAnchor`) in the segment spine outside the block
- Checks socket fit (`B_min >= tPrev` AND `B_max <= tNext`)
- Corridor pierce-check: any spine point with `timeMs ∈ (tPrev, tNext)` not in the block
- Detects cross-proposal conflicts: insert-vs-block-envelope and insert-vs-insert corridor overlap

Does NOT interact with `coupling-detection.js` — the two gates are independent.

## API

```js
const { detectOverlap } = require('./gates/overlap-detection');

const result = detectOverlap(
  proposals,              // Array<Object> — all proposals for this pass
  workingOrderedPoints,   // Array<Object> — current snapshot
  spinePointsBySegment    // Map<number, Array<Object>> — per-segment spine points
);
// returns { overlapVetoedProposalIds, overlapBlockResolution, annotations }
```

### Return value

| Key | Type | Description |
|---|---|---|
| `overlapVetoedProposalIds` | string[] | IDs of proposals that failed overlap checks |
| `overlapBlockResolution` | Array | Socket-ok block resolutions (consumed by `resolution-apply`) |
| `annotations` | Array | Proposal-scope annotations explaining each veto |

## Block-finding evaluation path

For each `block-finding` proposal:

1. `hasInternalMonotonicityViolation === true` → veto; annotation `block_internal_monotonicity_fail`
2. Compute `bMin`/`bMax` from member `timeMs`. No usable times → veto; annotation `overlap_block`
3. Find `prevAnchor` (last spine point before `bMin`) and `nextAnchor` (first spine point after `bMax`), both outside the block
4. Both anchors missing → `overlapStatus = 'no-bracket'`; annotation `overlap_bracket_missing`
5. Socket check: `bMin >= tPrev` AND `bMax <= tNext` (null anchor vacuously passes that side)
6. Corridor pierce-check (only when socket-ok and both anchors present): any spine point with `timeMs ∈ (tPrev, tNext)` not in block → veto; annotation `overlap_spine_pierce_detected`
7. Socket fail → veto; annotation `overlap_block`
8. Socket-ok, not pierced → `overlapStatus = 'socket-ok'`; entry added to `overlapBlockResolution`

## Cross-proposal collision detection

### Insert vs block envelope

For each `insert` proposal (non-`isExactGroup`), if `targetTimeMs ∈ [bMin, bMax]` of any block-finding in the same segment → both proposals vetoed; annotation `overlap_singleton_block_conflict` on each.

### Insert vs insert corridor overlap

For each pair of insert proposals in the same segment, if their bracket corridors overlap AND at least one `targetTimeMs` falls inside the overlap window → both vetoed; annotation `overlap_singleton_singleton_conflict` on each.

Open-ended corridors (null `tPrev` → `-Infinity`, null `tNext` → `+Infinity`) are handled gracefully.

`adjacent-exact-drop` proposals have no temporal footprint and are never involved in collision checks.

## Annotation kinds emitted

| Kind | Scope | Meaning |
|---|---|---|
| `block_internal_monotonicity_fail` | proposal | Block has intra-block backward step |
| `overlap_block` | proposal | Block fails socket fit or has no usable times |
| `overlap_bracket_missing` | proposal | No spine anchors found on either side |
| `overlap_spine_pierce_detected` | proposal | Spine point inside the block's corridor |
| `overlap_singleton_block_conflict` | proposal | Insert target inside a block's envelope |
| `overlap_singleton_singleton_conflict` | proposal | Two inserts with conflicting corridors |

## Related modules

- `gates/coupling-detection.js` — second gate; runs after overlap-detection
- `apply/resolution-apply.js` — consumes `overlapBlockResolution` for block-finding apply
- `spine/spine-intervals.js` — provides `spinePointsBySegment`
- `runner/phase1-loop.js` — orchestrates the gate sequence
