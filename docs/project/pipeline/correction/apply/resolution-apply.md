<!-- generated-by: gsd-doc-writer -->
# resolution-apply

**File:** `packages/correction/apply/resolution-apply.js`

## Overview

Applies the AND-gated proposal set to `workingState`. This is the only module that performs mutations (drops, relocations, `excludedFromTrust` writes) during Phase 1.

Gate: `applyable = proposals \ overlapVetoed \ couplingBlocked`.

Reference: plan §resolution-apply, ADR-correction-0015.

## API

```js
const { applyProposals } = require('./apply/resolution-apply');

applyProposals(
  proposals,                    // Array<Object> — all proposals for this pass
  overlapVetoedProposalIds,     // string[] — from overlap-detection
  couplingBlockedProposalIds,   // string[] — from coupling-detection
  overlapBlockResolution,       // Array — socket-ok block resolutions
  workingState,                 // mutable working state
  params,                       // { lenientMaxImpliedSpeedKph? }
  passLabel,                    // string — e.g. 'phase1-pass-0'
  passIndex                     // number
);
```

Every proposal is pushed to `workingState.proposals` (with `applied` and `skipReason` set) regardless of outcome.

## Disposition by proposal kind

### adjacent-exact-drop

Unconditional: no gate, no kinematic check.

- Calls `ws.addDrop(dropGpxIndex, 'adjacent-exact-duplicate', passLabel)`
- Calls `ws.removeFromWorking(dropGpxIndex)`
- Adds rearrangement kind `'adjacent-exact-drop'`
- `proposal.applied = true`

### block-finding (`overlapStatus = 'socket-ok'`)

Disposition: **GATING** (hard fail).

1. Retrieve bracket anchor points from `overlapBlockResolution`
2. Run `computeKinematicCheck(prevAnchorPoint, firstPt, null)` and `computeKinematicCheck(null, lastPt, nextAnchorPoint)`
3. **PASS** (both bracket speeds ≤ threshold):
   - `ws.relocateRunAfter(gpxIndexes, afterGi)` — moves all block members after `prevGpxIndex`
   - `ws.markAnomalyResolved` for each block member
   - Annotation `block_reorder_applied`
   - Rearrangement kind `'block-reorder'`
4. **FAIL**:
   - All block members → `excludedFromTrust` reason `block_kinematic_guard_failed`
   - Annotation `block_reorder_kinematic_guard_failed`
   - `proposal.skipReason = 'kinematic_guard_failed'`

### insert — length 1, `isExactGroup = false`

Disposition: **GATING**.

1. Resolve bracket anchor points from `workingState` via `bracketGpxIndexes`
2. Run `computeKinematicCheck(prevAnchorPt, candidatePt, nextAnchorPt)`
3. **FAIL** → candidate → `excludedFromTrust` reason `insert_kinematic_guard_failed`; annotation `insert_kinematic_guard_failed`
4. **PASS** → `ws.relocatePointAfter(gpxIndex, afterGi)`; `ws.markAnomalyResolved`; annotation `insert_applied`; rearrangement kind `'insert-move'`

### insert — length ≥ 2, `isExactGroup = false`

Disposition: **ADVISORY** with all-fail fallback.

1. Run `computeKinematicCheck` for every candidate against shared bracket anchors
2. Collect passers (speed ≤ threshold on both sides)
3. If no passers, use all candidates as the pool (all-fail fallback)
4. Sort pool by `score` ascending; ties broken by `gpxIndex` ascending
5. Winner = `pool[0]`
6. Losers → `excludedFromTrust` reason `insert_competition_loser`
7. Winner relocated via `moveCandidateToTarget`
8. Annotation: `insert_competition_resolved` (passers exist) or `insert_competition_kinematic_guard_failed` (all failed)

### insert — `isExactGroup = true`

MVP flag-only. No mutation. All candidates → `excludedFromTrust` reason `exact_group_unresolved`. `proposal.skipReason = 'exact_group_flag_only'`.

## Vetoed / blocked proposals

Proposals in `overlapVetoedProposalIds` get `applied = false`, `skipReason = 'overlap_vetoed'` and are pushed to `workingState.proposals` without any mutation.

Proposals in `couplingBlockedProposalIds` get `applied = false`, `skipReason = 'coupling_blocked'`.

## Point placement

`moveCandidateToTarget` places the candidate after `bracketGpxIndexes[0]` (the `tPrev` anchor). If `tPrev` is null (lone bracket is `nextAnchor`), the candidate is placed at the start of the segment.

## Related modules

- `apply/kinematic-guard.js` — `computeKinematicCheck` primitive
- `gates/overlap-detection.js` — provides `overlapVetoedProposalIds` and `overlapBlockResolution`
- `gates/coupling-detection.js` — provides `couplingBlockedProposalIds`
- `state/working-state.js` — all mutation writers (`addDrop`, `relocateRunAfter`, `addExcludedFromTrust`, etc.)
- `runner/phase1-loop.js` — orchestrates the full pass: proposals → gates → apply
