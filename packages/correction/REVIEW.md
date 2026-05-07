# Correction Pipeline — Deep Code Review

**Date:** 2026-05-07  
**Depth:** deep (cross-module)  
**Reviewer:** Claude (adversarial)  
**Files reviewed:** 15

---

## CRITICAL Issues

---

### CR-01: Proposal invariant violated — `applied=false` proposals may have no `skipReason`

**File:** `proposal-schema.js:116-141` (assertValidProposal) / `phase1-loop.js:87-97`

**Issue:** `assertValidProposal` only enforces that `applied=true` proposals must NOT have a `skipReason`. It does NOT enforce that `applied=false` proposals MUST have a `skipReason`. The function is also never called during the loop — it is described as an export-time validator but there is no evidence it is invoked at export.

Inside `phase1-loop.js` lines 87–97, when `allProposals.length === 0`, the function returns immediately with a `passLog` entry — but zero proposals are pushed to `workingState.proposals`. No proposal invariant issue there. However, in the `markOutOfSegmentScope` helper (line 268–282), `proposal.applied = false` and `proposal.skipReason = 'out_of_segment_scope'` are set correctly. But in `resolution-apply.js` line 76–79, proposals with an unknown `kind` fall through to:

```js
proposal.applied    = false;
proposal.skipReason = 'overlap_vetoed';   // wrong reason — not overlap
```

This silently misclassifies unknown-kind proposals as overlap-vetoed. No type guard exists for future proposal kinds.

**Fix:** Add a strict kind-check at the top of `applyProposals` and throw on unknown kind, rather than silently marking `skipReason = 'overlap_vetoed'`:
```js
} else {
  throw new Error('applyProposals: unknown proposal kind: ' + proposal.kind);
}
```

Also call `assertValidProposal` on every proposal before pushing to `workingState.proposals`.

---

### CR-02: Partition invariant — stable edge proposals double-exclude members

**File:** `phase2/edge-reconciliation.js:155-170`

**Issue:** When a staged edge proposal is on a **stable** boundary (`isBoundaryStable` returns true), the code at lines 162–165 both sets `skipReason = 'edge_unresolved'` AND calls `excludeEdgeMembers(...)` with reason `'edge_unresolved'`. This is semantically wrong: a stable edge means the boundary IS resolved (admissible). The comment at line 161 even says "MVP: leave applied=false but mark as deferred-stable; we don't mutate." But then it still excludes the members from trust with reason `edge_unresolved`, which is the same treatment given to genuinely unstable edges. Downstream consumers and Phase 3 have no way to distinguish "stable but deferred" from "unstable unresolvable" — both appear as `edge_unresolved` in `excludedFromTrust`.

**Fix:** Do not call `excludeEdgeMembers` for stable edges. Use a distinct reason like `edge_deferred_stable` (add to enum), or omit the exclusion entirely and leave the proposal with `applied=false, skipReason='edge_deferred_stable'`. The `edgesResolvedStable` return array already tracks them correctly — callers can use that.

---

### CR-03: Partition invariant — `excludedFromTrust` allows duplicate entries for same gpxIndex

**File:** `state/working-state.js:81-89`

**Issue:** `addExcludedFromTrust` is a plain push with no deduplication guard. Multiple pipeline stages can (and do) add the same `gpxIndex` to `excludedFromTrust` with different reasons:
- `detectCrossSegmentDuplicates` (pre-segment) excludes both points in a cross-segment pair.
- Phase 1 multipass can re-encounter the same gpxIndex across iterations if `resolvedAnomalies` is not consulted by all code paths (specifically `duplicate-proposal.js` does not check `resolvedAnomalies`).
- Phase 2 `excludeEdgeMembers` can exclude points already excluded by Phase 1.

A gpxIndex appearing in `excludedFromTrust` more than once violates the partition invariant (each index must appear in exactly one collection exactly once) and will produce incorrect output counts in `correction-export`.

**Fix:** Guard `addExcludedFromTrust` against duplicates:
```js
function addExcludedFromTrust(state, gpxIndex, reason, stage, details) {
  enums.assertExcludedReason(reason);
  // Enforce partition: one entry per gpxIndex
  for (var i = 0; i < state.excludedFromTrust.length; i++) {
    if (state.excludedFromTrust[i].gpxIndex === gpxIndex) {
      // Already excluded — do not duplicate
      return;
    }
  }
  state.excludedFromTrust.push({ gpxIndex, reason, stage, details });
}
```
Or maintain a fast `Set<gpxIndex>` alongside the array.

---

### CR-04: Partition invariant — points excluded pre-segment can appear in both `drops` and `excludedFromTrust`

**File:** `phase2/edge-reconciliation.js:129` + `pre-segment/deterministic-export-fix.js`

**Issue:** `detectCrossSegmentDuplicates` (called pre-Phase-1) puts all points in a cross-segment group into `excludedFromTrust`. Then in `edge-reconciliation.js` the adjacent-boundary-pair guard (line 129) correctly skips `firstPt` if it is already excluded. However, for the non-boundary-pair case, ALL points (including `lastPt` from the preceding segment) were excluded by `detectCrossSegmentDuplicates`. Nothing prevents `lastPt` from later being dropped by Phase 1 `applyAdjacentExactDrop` within its own segment, causing a point to appear in both `drops` and `excludedFromTrust`.

**Fix:** In `applyAdjacentExactDrop` (resolution-apply.js line 85), check whether the `dropGpxIndex` is already in `excludedFromTrust` before calling `ws.addDrop`. If already excluded, skip the drop mutation.

---

### CR-05: `classifyEdgeSide` fallback always returns `'firstEdge'` for in-envelope block proposals marked `isEdgeProposal`

**File:** `runner/phase1-loop.js:258-265`

**Issue:** When a `block-finding` proposal has `isEdgeProposal=true` but `bMin`/`bMax` are both `null` (they are initialized to `null` by `proposal-schema.js` and only populated by `overlap-detection`), `classifyEdgeSide` returns `'firstEdge'` by default (line 264). This means that if `overlap-detection` has NOT yet run (proposals are classified before gates in the loop at lines 103–116), block proposals with null `bMin`/`bMax` are staged to the wrong side.

More critically: the scope gate at lines 103–116 runs BEFORE overlap-detection (step 4 runs at lines 133–135). So `bMin`/`bMax` on block proposals are always `null` at scope-gate time. `classifyEdgeSide` for block-finding reads `proposal.bMin` / `proposal.bMax` (lines 259–260) — always null — and falls through to return `'firstEdge'` for every edge block, regardless of whether the block is at the start or end of the segment.

**Fix:** Move block-finding's edge-side classification to post-overlap-detection (after `bMin`/`bMax` are populated), or derive edge side from the block member `timeMs` values directly inside `classifyEdgeSide` without relying on `bMin`/`bMax`.

---

### CR-06: ADR-0015 violated — `no_bracket` kinematic check causes `block-finding` to be excluded from trust instead of vetoed by overlap ⚠️ DEFERRED

**File:** `apply/resolution-apply.js:130-163` + `apply/kinematic-guard.js:69-71`

**Deferral reason:** For `no_bracket` to occur, the block must have no traversal neighbours on either side (spans entire working segment). In practice, overlap-detection will veto any such block before `applyBlockFinding` is reached (spine-overlap check catches blocks with no valid socket). This makes the partition invariant violation theoretical in current data. **Revisit when Phase 2 mutation surface is finalised — at that point blocks may reach `applyBlockFinding` without overlap-detection having run.**

**Issue:** ADR-0015 specifies GATING for length-1 block and insert. `computeKinematicCheck` returns `passed=false, failReason='no_bracket'` when BOTH anchors are null. In `applyBlockFinding` (lines 120–138), when `prevCheck` and `nextCheck` are both null (no bracket points), the logic at line 131:

```js
var passed = !prevExceed && !nextExceed && (sp !== null || sn !== null);
```

...correctly evaluates to `false` because `sp === null && sn === null`. But then lines 150–163 add all block members to `excludedFromTrust` with reason `block_kinematic_guard_failed`. This is semantically wrong: the block was not gated on kinematics, it was gated on missing brackets — which should be caught and vetoed by overlap-detection (which emits `no-bracket` status and vetoes the block). A block proposal that reaches `applyBlockFinding` with `overlapStatus === 'socket-ok'` should always have at least one anchor. If it doesn't, the bug is in overlap-detection's veto logic, but the consequence is incorrect exclusion reason on members.

**Fix:** Add an explicit guard: if `sp === null && sn === null`, set `skipReason = 'overlap_vetoed'` (no-bracket is an overlap concern) rather than excluding members from trust with `block_kinematic_guard_failed`.

---

### CR-07: `duplicate-proposal.js` does not consult `resolvedAnomalies` — re-proposes already-applied singletons as same-timeMs competition groups

**File:** `proposals/duplicate-proposal.js:80-90`

**Issue:** `buildDuplicateProposals` filters out `adjDropDropSet` members and `excludedSet` members from the same-timeMs group scan (lines 83–85). But `excludedSet` is built in `phase1-loop.js` from `workingState.excludedFromTrust` AND `workingState.resolvedAnomalies` (lines 63–65). The problem is that after a singleton insert is successfully applied (`ws.markAnomalyResolved` called), the point is in `resolvedAnomalies` and gets added to `excludedSet`. However, if this point shares a timeMs with another point in the same segment (non-exact duplicate), it was excluded from the same-timeMs group in the CURRENT pass. But on the NEXT pass, `buildDuplicateProposals` rebuilds `segPoints` from `workingOrderedPoints` — which still contains the winner point. The winner is in `resolvedAnomalies` → in `excludedSet` → correctly filtered. This is fine.

**However:** The `adjDropDropSet` used inside `buildDuplicateProposals` (line 62) is LOCAL to that call — it only covers drops found in the CURRENT pass's adjacent-exact scan. It does not include points already dropped in prior passes (those have been removed from `workingOrderedPoints` by `removeFromWorking`). This is correct because removed points are gone. No bug here upon reflection — but documenting for clarity.

The real issue: `buildDuplicateProposals` does NOT receive or consult `resolvedAnomalies` directly; it relies on the caller to pass a pre-built `excludedSet`. In `phase1-loop.js` line 63–65, `resolvedAnomalies` is added to `excludedSet`. This means winner points from prior passes are excluded from duplicate proposals on subsequent passes. This is correct. **Downgrade to WARNING** — see WR section.

---

## WARNING Issues

---

### WR-01: `singleton-proposal.js` emits proposals with no `kinematics` field despite doc claiming it

**File:** `proposals/singleton-proposal.js:96-106`

**Issue:** The module docstring (line 26) says candidates carry `kinematics: KinematicCheck`. The `makeInsertProposal` schema does not include a `kinematics` field. Singleton proposals are emitted with no `kinematics` pre-computed — kinematic check happens at apply time in `resolution-apply.js`. The doc is wrong. This is a documentation/contract mismatch that will mislead anyone adding features that try to read `proposal.kinematics` before apply.

**Fix:** Remove `kinematics: KinematicCheck` from the module docstring, or add an explicit `kinematics: null` field to `makeInsertProposal` schema for consistency with block-finding's post-apply `proposal.kinematics = kinematics` (resolution-apply line 193).

---

### WR-02: `objective-adjacent-dedupe.js` — `prev.gpxIndex + 1` stream-adjacency check breaks after any prior drop or reorder

**File:** `pre-segment/objective-adjacent-dedupe.js:51`

**Issue:** The stream-adjacency check `curr.gpxIndex !== prev.gpxIndex + 1` (line 51) is correct only when the `workingOrderedPoints` array still reflects the original GPX stream order with no gaps. This module is called after `createWorkingState` but its position in the pipeline (step 4, before reversal/export-fix) means no drops have yet occurred. However, if `detectCrossSegmentDuplicates` is called before this module (pipeline order is ambiguous from this module alone — needs `correction-runner.js` confirmation), points may already have been excluded from trust but NOT removed from `workingOrderedPoints` (exclusion does not remove from working). In that case `gpxIndex + 1` check remains valid.

More critically: the check relies on ALL original GPX indexes being contiguous integers with no gaps at ingestion time. If the audit layer produces non-contiguous `gpxIndex` values (e.g., sparse indexing), this check silently skips all adjacent-pair checks. There is no validation that `gpxIndex` values are contiguous.

**Fix:** Document the contiguous-gpxIndex assumption explicitly and add an assertion, or replace the `gpxIndex + 1` check with a positional adjacency check (consecutive array positions with same trkSegIndex).

---

### WR-03: `reversal-check.js` — per-segment seam check uses PRE-reversal neighbour ranges, not updated post-prior-reversal ranges

**File:** `pre-segment/reversal-check.js:138-149`

**Issue:** `rangeBySeg` (line 91) is computed from the original (pre-reversal) working order. When multiple segments are `isFullyReversed`, the loop processes them in `trkSegIndex` sort order (line 103). After accepting segment S_i's reversal, `rangeBySeg.set(segIdx, ...)` is updated (line 167). However, the next segment S_{i+1} uses `rangeBySeg.get(segOrder[pos - 1])` for the prev-segment seam check — which is the UPDATED range for S_i if S_i was just reversed and accepted. This is correct and intentional.

**But:** If S_i was REJECTED (reverted at line 171), `rangeBySeg` for S_i is NOT reverted — it keeps the original pre-reversal range. This is also correct because the revert restores the original order. No bug here.

**Actual warning:** The seam check uses `>=` / `<=` (equality allowed, lines 141/146). This means a reversed segment whose first time equals its predecessor's last time passes the seam check. This is intentional ("equality allowed" is noted in the doc). But if two adjacent reversed segments both end up with the same boundary timestamp, both pass independently yet their combined order may still be contradictory. This is a design gap but within MVP scope.

---

### WR-04: `overlap-detection.js` — insert vs block envelope veto also vetoes already-vetoed block proposals, resetting their `overlapStatus` implicitly

**File:** `gates/overlap-detection.js:184-207`

**Issue:** In the cross-kind collision loop (lines 179–208), when an insert's `targetTimeMs` falls inside `[bp2.bMin, bp2.bMax]`, both `ip.id` and `bp2.id` are added to the `vetoed` set. But if `bp2` was already vetoed in the block-finding pass (e.g., `overlapStatus = 'no-bracket'` or `'overlap'`), adding it to `vetoed` again is harmless (Set deduplication). However, the annotation is still pushed twice if `bp2` is processed by multiple insert proposals — one annotation per conflicting insert. This can produce O(n²) annotations for n inserts all falling inside one block envelope, flooding `workingState.annotations`.

**Fix:** Guard the block-conflict annotation with a check that `bp2.id` has not already been vetoed in this cross-kind loop:
```js
if (!alreadyAnnotatedBlocks.has(bp2.id)) {
  alreadyAnnotatedBlocks.add(bp2.id);
  annotations.push({ /* block-side annotation */ });
}
```

---

### WR-05: `coupling-detection.js` — coupling is asymmetric: P blocked by Q does NOT imply Q blocked by P in output

**File:** `gates/coupling-detection.js:199-203`

**Issue:** `couplingBlockedProposalIds` is built from `edges` where each edge has a `blockedProposalId` and `disturbanceSourceId`. The edge is added when P's kinematic reference falls in Q's disturbance zone. The union-find correctly groups them into the same component. But `couplingBlockedProposalIds` at line 200 only includes proposals that appear as `blockedProposalId` — i.e., proposals whose kinematic refs are disturbed. A proposal Q that has a large disturbance zone but no kinematic refs disturbed by P will appear as `disturbanceSourceId` but NOT in `couplingBlockedProposalIds`. It will still be in `independentProposalIds` and will be applied — potentially invalidating P's planned bracket.

This is the classic asymmetric coupling bug: P can't be applied because Q disturbs P's bracket, but Q IS applied because no one disturbs Q's bracket. The doc says "Block-finding now blocks symmetrically (revised 2026-04-23)" but the implementation at lines 199–203 only blocks proposals that appear as `blockedProposalId`.

**Fix:** Block all proposals in any coupled region (size > 1), not just those that are kinematic-reference victims:
```js
var blockedSet = new Set();
coupledRegions.forEach(function(region) {
  region.proposalIds.forEach(function(id) { blockedSet.add(id); });
});
```

---

### WR-06: `phase1-loop.js` — edge proposals staged multiple times overwrite prior staged proposal silently

**File:** `runner/phase1-loop.js:111-113` + `state/working-state.js:137-147`

**Issue:** `ws.stageEdgeProposal` simply overwrites `entry[side]` if called again for the same `(trkSegIndex, side)` pair. In `phase1-loop.js`, the check `isEdgeAlreadyStaged(side)` (line 107) prevents staging when already staged. BUT: if two DIFFERENT proposals in the same pass have `isEdgeProposal=true` and the same `classifyEdgeSide` result, the FIRST one gets staged and the SECOND gets marked `out_of_segment_scope` (line 109). The first-wins semantics are correct. However, across PASSES (on a new iteration), after the staged proposal is consumed by Phase 2, `isEdgeAlreadyStaged` still returns true (the map entry persists). So in pass 2+, any new edge proposals for an already-staged side are silently discarded as `out_of_segment_scope`, even though Phase 2 has not yet run and the prior staged proposal may have been superseded by mutations.

**Fix:** Clear staged edge slots for a segment after Phase 2 runs, or document that the stage-once-per-side semantics are intentional and that Phase 1's mutations cannot produce a better edge proposal than the first one seen.

---

### WR-07: `assertValidProposal` does not enforce `skipReason` presence when `applied=false`

**File:** `state/proposal-schema.js:116-141`

**Issue:** The proposal invariant (CLAUDE.md) states: "every proposal has `applied` boolean; if `applied === false`, `skipReason` must be present." `assertValidProposal` at line 125 only enforces the inverse (applied=true → no skipReason). It does not throw when `applied=false && skipReason === null`. Proposals that fail to be marked with a skip reason will silently pass validation.

**Fix:**
```js
if (proposal.applied === false &&
    (proposal.skipReason === null || proposal.skipReason === undefined)) {
  throw new Error('proposal.applied=false must have skipReason');
}
```

---

### WR-08: `participation-check.js` — `hasAnomalies` does not include `nonAdjacentRepeat` in correction-idle compatibility

**File:** `pre-segment/participation-check.js:166-171`

**Issue:** `hasAnomalies` (line 166) checks `belowAnchor`, `belowPrevValid`, `nonAdjacentRepeat`, and `adjacentDuplicate`. The correction-idle predicate (`correction-idle.js`) checks `belowAnchor`, `belowPrevValid`, `nonAdjacentRepeat`, AND same-time-different-coords groups (implied by `nonAdjacentRepeat`). This is consistent.

However, `block-proposal.js` is only skipped when `profile.hasAnomalies === false` (line 38), but `profile` is passed as `null` from `phase1-loop.js` line 68:
```js
blockProposal.buildBlockProposals(..., null, excludedSet)
```

The `profile` argument is always `null` in the phase1 loop call — the profile guard in `block-proposal.js` line 38 is **dead code** and never fires. The phase1 loop has its own pre-check (correction-idle test in `correction-runner.js`) to skip idle segments, but `block-proposal` itself never sees a non-null profile.

**Fix:** Either pass the actual profile to `buildBlockProposals` in `phase1-loop.js`, or remove the dead guard from `block-proposal.js`.

---

### WR-09: `kinematic-guard.js` — `NaN` speed propagates through comparisons silently

**File:** `apply/kinematic-guard.js:45, 55`

**Issue:** When `dtPrev < 0` (candidate time before anchor time — legitimate for a misplaced point), `speedPrevKph = NaN` (line 45: `dtPrev === 0 ? Infinity : NaN`). Then at line 63: `speedPrevKph > thresholdKph` evaluates to `false` for `NaN` in JavaScript. This means a candidate with a NEGATIVE time delta from its prev anchor PASSES the kinematic guard (prevFails=false) when it shouldn't. The point is kinematically invalid (negative dt) but the guard passes it.

**Fix:** Treat NaN speed as automatic failure:
```js
var prevFails = speedPrevKph !== null && (isNaN(speedPrevKph) || speedPrevKph > thresholdKph);
var nextFails = speedNextKph !== null && (isNaN(speedNextKph) || speedNextKph > thresholdKph);
```

---

### WR-10: `deterministic-export-fix.js` — chunk reorder annotation loop uses wrong index variable

**File:** `pre-segment/deterministic-export-fix.js:107-118`

**Issue:** The annotation loop at line 107 iterates `for (var m = 0; m < sortedByMinTime.length; m++)` and emits annotation when `preOrder[m] !== sortedByMinTime[m]`. The `newPosition: m` detail is correct. But `previousPosition: preOrder.indexOf(sortedByMinTime[m])` (line 113) does a linear scan of `preOrder` for each m — O(n²) over all affected segments. For a GPX file with many out-of-order chunks this could be significant. More importantly, `preOrder.indexOf` returns the index within `affected` (the filtered subset), not within `originalSegOrder`. This position is misleading — it is not the global segment position, just the position within the affected subset.

**Fix (correctness):** Store a `preOrderIndexMap` before the sort for O(1) lookup and document that positions are relative to the affected subset, not the global segment list.

---

## INFO Issues

---

### IN-01: `duplicate-proposal.js:189` — variable `i` shadowed by outer loop

**File:** `proposals/duplicate-proposal.js:169, 189`

The outer loop at line 169 uses `var i` and the inner body at line 189 also declares `var i` inside `byTime.forEach`. In CommonJS/non-strict-function-scope JS, `var` is function-scoped so these are the same variable — the inner `for (var i = 0; ...)` inside the `forEach` callback is a new function scope. No actual shadowing bug, but confusing. Use `let`/`const` or rename inner variables.

---

### IN-02: `phase1-loop.js` — `passFrame.exitReason` not set in the `notApplied.length === 0` branch that continues the loop

**File:** `runner/phase1-loop.js:181-220`

When `notApplied.length === 0` and `verifyActive.length > 0` (line 216), `passFrame` is pushed without an `exitReason` field (the `passFrame.exitReason` assignment only happens on break paths). Consumers reading `passLog[n].exitReason` will get `undefined` for continuing passes. Consistent with "loop continues" but `undefined` vs a labelled reason like `'continuing'` makes log parsing fragile.

---

### IN-03: `schema-enums.js` — `PROPOSAL_SKIP_REASONS` includes `exact_group_flag_only` but no code path sets it

**File:** `state/schema-enums.js:82`

`exact_group_flag_only` is in the locked enum but `resolution-apply.js` never uses it. Exact-group proposals are applied (applied=true, skipReason=null) at line 211. Dead enum value. Either use it or remove it.

---

### IN-04: `working-state.js` — `addRearrangement` does not validate `kind` against an enum

**File:** `state/working-state.js:120-127`

`addDrop` and `addExcludedFromTrust` both validate against locked enums. `addRearrangement` validates only that `kind` and `stage` are present — no enum check. Rearrangement kinds (`block-reorder`, `insert-move`, `adjacent-exact-drop`, `segment-reversal`, etc.) are scattered across callers with no central enum. A typo in a caller would silently produce an invalid rearrangement kind in the output.

---

### IN-05: `edge-reconciliation.js` — `isExactDuplicate` duplicated from `duplicate-proposal.js`

**File:** `phase2/edge-reconciliation.js:205-211`

Identical function to `duplicate-proposal.js:38-44`. Extract to a shared utility (e.g., `packages/shared/` or `packages/correction/utils/`) to avoid divergence.

---

_Reviewed: 2026-05-07_  
_Reviewer: Claude (adversarial deep review)_
