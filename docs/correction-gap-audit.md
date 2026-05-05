# Plan-vs-Code Gap Audit

Date: 2026-04-24
Scope: `packages/correction/**` vs `implementation_plan.md` and ADRs `correction/0001..0015`.

Legend:
- **WRONG** — code implements a materially different algorithm than the spec.
- **MISSING** — spec describes behaviour that is absent.
- **STUB** — module exists as a no-op/trivial placeholder.
- **EXTRA** — code does something the spec does not call for.
- **INCOMPLETE** — present but partial (often TODO-marked).

Sections citing ADRs use short form (e.g. "ADR-0011"). Plan section cites use `§<heading>`.

---

## Cross-cutting findings

1. **Participation is the wrong concept end-to-end.** ADR-0002 / ADR-0007 / plan §Per-segment eligibility define participation as an **audit-coverage** story: parseable timestamp count, `hasAnyPositiveTimeDelta`, `coverageRatio` vs `minTimestampPairCoverageRatio`, and the resulting `mode ∈ {geometry-only | timestamp-sparse | full | fully-reversed}` computed **globally AND per segment**, feeding `segmentParticipationProfiles[]`. The runner and the `participation-check` module both do **nothing** of this. `participation-check.js` is a naive lat/lon finiteness filter; the runner never builds `segmentParticipationProfiles[]` or evaluates modes. No correction-idle short-circuit exists anywhere in the pipeline.

2. **No correction-idle short-circuit at any stage.** Plan §Pipeline order / §Correction-idle predicate (ADR-0002 A9) requires recomputing a per-segment `correctionIdle` predicate after participation, after `objective-adjacent-dedupe`, after `reversal-check`, after `deterministic-export-fix`, and after every `resolution-apply` and checking "all segments idle → skip to export". The runner never computes this predicate at all. Phase 1 never exits via `correction-idle`; it exits only on `all_applied`, `stalemate`, `stable`, `no_proposals`, `max_iterations`.

3. **Per-segment audit consumption is broken.** ADR-0013 / plan §Audit layer contract say the correction layer reads `audit.temporal.perSegment[trkSegIndex]` tag arrays and `audit.sampling.perSegment[]`. The runner reads `auditJson.audit.exportFaults` (a field the same plan says audit **no longer emits** — ADR-0013), and the Phase 1 loop reads `temporalAudit.tagIndex.belowAnchor` (a tagIndex shape that does not exist in the ADR-0013 output). The runner's per-segment temporal lookup (`temporal.perSegment.find(...)` and rewrap as `{ tagIndex: segTemporalEntry.tagCounts, perSegment: ... }`) is a fabricated shape, not the canonical payload. Net effect: `belowAnchor` / `belowPrevValid` sets used by `block-proposal` and `singleton-proposal` will be empty in practice.

4. **Boundary classifier implements an entirely different taxonomy.** ADR-0013 / plan §Boundary classification require `{chunk_ordering | duplicate_chunk | segment_boundary_gap | timestamp_discontinuity}`. The actual code emits `{same_day | cross_day | gap_large | time_missing | backward}` — a different set of labels designed around calendar-day heuristics. This is not a renaming; the conditions differ (no `minTimeMs`/`maxTimeMs` overlap check, no round-hour timezone detection, no impliedSpeed consumption).

5. **Three-phase orchestration is mostly scaffolding.** Phase 2 (edge reconciliation) is a TODO stub with a comment questioning its existence. Phase 3 (residual diagnostic sweep) is a TODO stub returning `[]`. Edge-proposal staging (plan §Edge proposals / §Phase 2) is not implemented anywhere — no `stagedEdgeProposals[]`, no envelope gate, no edge-proposal classification in block/singleton/duplicate proposal modules. Phase 1 processes all segments sequentially but does **not** stage edges; it simply lets every proposal through to the gates.

6. **Reorder application is placebo.** `resolution-apply.js` contains TODO markers for the actual reorder in both `applyBlockFinding` and `applyInsert`. It sets `proposal.applied = true`, adds an annotation, and writes kinematic annotations — but **does not mutate `workingOrderedPoints`** for block-reorder or for insert (length=1) winners or competition winners. The only real mutation is `removeFromWorking` for `adjacent-exact-drop`, `isExactGroup` drops, and competition losers. Phase 1 multipass can therefore never converge by actual reordering.

7. **Annotation kinds are not ADR-0012 compliant.** Code emits `block_reorder_applied` and `insert_applied` annotations that are NOT in the locked ADR-0012 enum. The enum also is not validated anywhere. Annotation shape `{ kind, scope, proposalId, gpxIndexes, details }` differs from the ADR-0012 shape `{ scope, scopeRef: { trkSegIndex?, proposalId? }, kind, details }` — `scopeRef` is missing, `gpxIndexes` is an ad-hoc top-level field.

8. **`excludedFromTrust` shape is wrong.** ADR-0012 specifies `{ gpxIndex, reasons: ExcludedReason[], details? }` — one entry per gpxIndex, many reasons — with a partition invariant checked at export. The code uses `{ gpxIndex, reason, stage }` (single reason, plus non-spec `stage` field), appends duplicates per reason, and never dedupes by gpxIndex. Partition invariant is not validated in `correction-export`.

9. **`correction-export` output shape diverges from plan §Output shape.** Missing fields: `metadata.profileId/algorithmVersion/parameters`, `participation`, `segmentProfiles[]`, `multipass.perSegment`, `proposals[]` (the final proposal records with `applied`/`skipReason`), `rearrangements[]`, `diagnostics.residualTemporalAnomalies[]`, `fullOrderedPoints`, `canonicalTrustedPoints`. It emits instead `survivingGpxIndexes` (not in spec) and raw pass log/coupledRegions/overlapBlockResolution that the spec explicitly says are internal runner state and should be **encoded into proposal.skipReason at export** (ADR-0012).

10. **`drops` reason strings do not match ADR-0012 enum.** Code uses `'objective_adjacent_exact_duplicate'`, `'adjacent_exact_duplicate'`, `'exact_group_non_winner'`. ADR-0012 locks only `'adjacent-exact-duplicate'` and `'duplicate_chunk_segment'`. `exact_group_non_winner` is not a valid DropReason — exact-group duplicates per ADR-0012/0015 should use `drops` with `adjacent-exact-duplicate` only when they are adjacent; otherwise the non-winners should go to `excludedFromTrust`.

11. **Overlap-detection only implements the block path.** ADR-0009 explicitly scopes this module to cross-proposal footprint mapping for ALL kinds (block envelope, insert corridors, insert-in-block-envelope, insert-singleton-singleton corridor overlap). The code only handles `block-finding`: no insert footprint, no cross-kind collisions, no `overlap_singleton_block_conflict` / `overlap_singleton_singleton_conflict` annotations, no aggregation across proposals. This is the confirmed ADR-0009 gap.

12. **ADR-0008 (early block/chunk reorder before proposals) correctly NOT attempted.** ADR-0008 was superseded — plan rules require no separate early block stage. Code is aligned with this.

13. **ADR-0005 (reversal full-array hypothesis) is a stub.** Plan §Reversal-check calls for (a) a cheap global-array reversal attempt accepted iff reversed snapshot is correction-idle for all segments, and (b) per-segment `isFullyReversed` reversal with neighbour consistency seam checks. Code returns an array of `{isReversalCandidate: false, confidence: 0}` per boundary — no reversal ever happens.

14. **`deterministic-export-fix` is a stub** despite being a locked owner (ADR-0013). Returns `{fixesApplied: [], annotations: []}`. No chunk reorder, no duplicate-segment exclusion.

15. **Runner / phase1-loop signature drift.** `runCorrection` has a three-way overloaded signature (`auditJson`, array params, `acceptedPoints` as array) that is not in the plan. Segment profiles are not built; Phase 1 iterates over raw `trkSegIndex` values from `acceptedPoints` rather than from `segmentParticipationProfiles[]`.

16. **No scope-gate (envelope) check in Phase 1.** Plan §Phase 1 requires: each proposal targeting outside `seg.spineEnvelope` → staged as edge proposal or excluded with `out_of_segment_scope`. This logic is entirely absent.

17. **No verification pass.** Plan §Per-segment multipass loop requires that when `applyable == proposals`, re-build proposals and re-run overlap+coupling without applying, and only exit `idle` if empty. Code just uses `all_applied` as a one-shot exit with no verification.

18. **Spine envelope is not produced.** Plan §Spine envelope / §SegmentParticipationProfile require computing `spineEnvelope: {minTimeMs, maxTimeMs}` per segment from spine points. Code stops at "array of spine points". No consumer uses spine envelope because none exists.

19. **No `rearrangements` collection is ever populated.** Plan mandates `correction.rearrangements` entries for every mutation with `kind`, `passIndex`, `trkSegIndex`, `stage`. None is written.

20. **Cross-segment duplicate handling missing.** Plan §Adjacent dedupe / ADR-0012 require `cross_segment_duplicate` excludedFromTrust reason for same-timeMs across `trkSegIndex`. `duplicate-proposal.js` groups only within one trkSegIndex and never emits cross-segment detection.

---

## Per-module findings

### `runner/correction-runner.js`
**Spec:** Plan §`correctionRunner` orchestration. Consume `{points, auditResult}`; run pre-segment (participation → objective-dedupe → reversal → deterministic-export-fix), recompute `correctionIdle` per segment after each step and short-circuit to export when all idle; build first spine; Phase 1 per-segment in ascending trkSegIndex; Phase 2 pairwise; Phase 3 read-only; invoke export with full payload per plan §Output shape.

**Code:** A flat orchestrator that takes a polymorphic `auditJson/acceptedPoints/params` signature. Calls participation-check only to side-effect (return ignored). Calls boundary-classifier (wrong taxonomy), objective-dedupe (returns drop list — used), reversal-check (stub result ignored), deterministic-export-fix (stub, ignored). Builds workingState from `points minus objective drops`. Enumerates unique trkSegIndexes from `acceptedPoints` and runs Phase 1 for each. Recomputes spine once more, runs Phase 2 (stub), Phase 3 (stub), then exports.

**Gaps:**
- [WRONG] Reads `audit.exportFaults` — removed by ADR-0013; not present in the audit payload.
- [WRONG] Per-segment temporal wrap `{ tagIndex: segTemporalEntry.tagCounts, perSegment }` fabricates a shape not aligned with plan.
- [MISSING] No `segmentParticipationProfiles[]`. No mode evaluation.
- [MISSING] No per-step correction-idle recompute and no short-circuit to export.
- [MISSING] First spine build is not bookmarked; spine is recomputed inside each segment loop iteration instead (legal but wasteful).
- [MISSING] Phase 2 receives segment boundaries (raw) but no `stagedEdgeProposals` — because Phase 1 never stages them.
- [MISSING] Export call omits pass logs, proposal records, participation, segmentProfiles, multipass stats, rearrangements, diagnostics.
- [EXTRA] Polymorphic signature not in spec.

### `runner/phase1-loop.js`
**Spec:** Plan §Phase 1 / ADR-0011. Per-segment multipass; scope-gate against `spineEnvelope` with edge-proposal staging; `applyable = proposals \ overlapVetoed \ couplingBlocked`; `resolution-apply` mutates; recompute spine + correction-idle per iteration; verification pass when `applyable == proposals`. Five exit reasons: `idle | stalemate | no-proposals | correction-idle | max-iterations`.

**Code:** Iterates up to `multipassMaxIterations`. Reads `belowAnchor` out of `temporalAudit.tagIndex.belowAnchor`. Builds block/singleton/duplicate proposals. Runs overlap + coupling gates. Calls `resolution-apply`. Classifies exit as `no_proposals | stable | stalemate | all_applied | max_iterations`.

**Gaps:**
- [WRONG] Exit reasons differ from ADR-0011's locked set. `all_applied` is not spec; should verify then emit `idle`. `stable` is not spec.
- [MISSING] No scope-gate / envelope check. No edge-proposal staging.
- [MISSING] No `correction-idle` recompute after apply. No `correction-idle` exit.
- [MISSING] No verification pass (re-build proposals after full-set apply and re-run gates without applying).
- [MISSING] No per-segment `iterationsRun` / `exitReason` / passLog written back into a `segmentProfiles[]` surface.
- [WRONG] `belowAnchor` is sourced from a shape (`tagIndex.belowAnchor`) that doesn't match ADR-0013's `audit.temporal.perSegment[seg].belowAnchor` tag arrays.

### `pre-segment/participation-check.js` (user-flagged)
**Spec:** Plan §`participation-check.js` + ADR-0002 / ADR-0007. Inputs: points + auditResult. Outputs: global `participation` slice (`mode`, `coverageRatio`, reasons) AND `segmentParticipationProfiles[]` (per-trkSegIndex `mode`, `hasAnomalies`, `hasUsableTimes`, `coverageRatio`, `isFullyReversed`, `spineEnvelope`, `iterationsRun`, `exitReason`). Mode evaluation: `parseableTimestampPointCount===0` → geometry-only; `hasAnyPositiveTimeDelta===false` → geometry-only; `coverageRatio < 0.8` → timestamp-sparse; else full. Never mutates. Early-return "full skip" if all segments correction-idle.

**Code:** Iterates over points; returns two gpxIndex Sets partitioning by lat/lon finiteness. No audit input. No modes. No coverage ratio.

**Gaps:**
- [WRONG] Entirely different algorithm (coordinate-presence filter) vs audit-coverage participation. This is the user-flagged divergence.
- [MISSING] Global `participation` slice.
- [MISSING] `segmentParticipationProfiles[]` and per-segment mode.
- [MISSING] Coverage-ratio comparison against `minTimestampPairCoverageRatio`.
- [MISSING] `isFullyReversed` candidacy output (drives reversal-check's per-segment path).
- [MISSING] Full-skip early-return.

### `pre-segment/boundary-classifier.js`
**Spec:** Plan §Deterministic export fix phase + ADR-0013. Classify each `audit.ingestion.segmentBoundaries[]` entry into `chunk_ordering` | `duplicate_chunk` | `timestamp_discontinuity` (mutually exclusive) PLUS `segment_boundary_gap` (independent, every forward gap). Uses `gapMs`, `min/maxTimeMs` overlap test, round-hour backward-jump detection with `timezoneShiftTolerance` default 0.1.

**Code:** Takes an array of segmentSummary-shaped entries (trkSegIndex, first/lastGpxIndex/TimeMs) instead of segmentBoundaries. Classifies into `same_day | cross_day | gap_large | backward | time_missing` using calendar-day comparisons.

**Gaps:**
- [WRONG] Classification taxonomy is entirely different from ADR-0013.
- [WRONG] Consumes a segmentSummary-like shape, not `SegmentBoundary`.
- [MISSING] Overlap test (`next.min/maxTimeMs` vs `curr.min/maxTimeMs`) to distinguish `chunk_ordering` vs `duplicate_chunk`.
- [MISSING] Round-hour backward-jump detection for `timestamp_discontinuity`.
- [MISSING] Forward-gap `segment_boundary_gap` emission with `impliedDistanceM` / `impliedSpeedKph`.
- [MISSING] Output used by the runner — current runner throws away the classifications entirely.

### `pre-segment/participation-check.js` — see above.

### `pre-segment/objective-adjacent-dedupe.js`
**Spec:** Plan §Adjacent dedupe / §Initial pass / ADR-0014. Stream-adjacent only (`curr.gpxIndex === prev.gpxIndex + 1`), within one trkSegIndex only (do not cross segment boundary), equality table per plan (ele-mismatch → annotation not drop; OOB-both → drop; one-absent → drop the absent). Drop reason `'adjacent-exact-duplicate'`.

**Code:** Stream-adjacent check ✓. Time + lat + lon + ele exact equality. Emits drop record.

**Gaps:**
- [MISSING] No `trkSegIndex` guard — stream-adjacent pairs across a `<trkseg>` boundary should not be eligible; code compares only gpxIndex+1.
- [WRONG] Drop reason string `'objective_adjacent_exact_duplicate'` — ADR-0012 locks `'adjacent-exact-duplicate'`.
- [MISSING] Ele equality table: plan §Adjacent dedupe equality table requires special handling (both-absent drop, one-absent drop, both-OOB drop with survivor ele=null, both-usable-differ → no drop + annotation `adjacent_duplicate_ele_mismatch`). Code treats ele mismatch simply as "not a duplicate" (no annotation, no drop).

### `pre-segment/reversal-check.js`
**Spec:** Plan §Reversal-check + ADR-0005. Cheap full-array reversal hypothesis: reverse; accept iff all segments correction-idle on reversed snapshot; else revert + session annotation `reversal_unconfirmed`. Per-segment reversal: for each `isFullyReversed` profile, reverse within segment, accept iff internally monotonic AND neighbour-seam consistent; else revert + annotation `segment_reversal_unconfirmed` + members → excludedFromTrust `reversal_unconfirmed_member`.

**Code:** Stub. Returns `[{trkSegIndex, isReversalCandidate: false, confidence: 0}]` for every boundary entry (also the wrong shape — one entry per boundary, not per segment).

**Gaps:**
- [STUB] No reversal logic at all.
- [MISSING] Global reversal hypothesis.
- [MISSING] Per-segment reversal.
- [WRONG] Operates on segmentBoundaries shape, not segmentProfiles.
- [MISSING] Never emits annotations or mutates.

### `pre-segment/deterministic-export-fix.js`
**Spec:** Plan §Deterministic export fix phase + ADR-0013. Consume raw `audit.ingestion.segmentBoundaries[]` and `segmentSummaries[]`. Apply chunk reorder by `minTimeMs`; exclude duplicate chunks; flag gap/tz discontinuity. Write `drops` with `duplicate_chunk_segment`, `rearrangements` with `segment-chunk-reorder`, annotations `chunk_ordering_resolved`, `duplicate_chunk_excluded`, `segment_boundary_gap`, `timestamp_discontinuity`.

**Code:** Stub. Takes `exportFaults` (removed from audit by ADR-0013) and returns empty arrays.

**Gaps:**
- [STUB] No fixes applied.
- [WRONG] Wrong input (exportFaults, not segmentBoundaries).
- [MISSING] Entire classification → action pipeline.

### `spine/spine-intervals.js`
**Spec:** Plan §Spine intervals. Per-`trkSegIndex` set of forward-monotonic + strictly positive Δt + non-cluster-member points. Hard segment-wall. Re-derived after every mutation. Also needs per-segment `spineEnvelope` (min/max of spine points).

**Code:** Groups by `trkSegIndex`, detects duplicate-time cluster members, walks stream order requiring strictly forward timeMs. Returns `Map<trkSegIndex, Array<Point>>`. Correct per predicate.

**Gaps:**
- [MISSING] Does not walk `workingOrderedPoints` as "traversal order" vs stream order — correct only if workingOrderedPoints is itself the canonical traversal; plan allows this, but the predicate should be on traversal order specifically.
- [MISSING] `spineEnvelope` (min/max) per segment is not exposed — consumers (scope gate, edge-proposal detection) have no way to query envelope.
- [MISSING] Does not exclude "non-cluster-member" by a proper cluster definition that also treats `belowPrevValid`-clustering; current predicate is minimally correct by Plan §Spine interval (which only requires time-duplicate exclusion). Acceptable.
- Overall rating: closest-to-spec module in the tree.

### `proposals/block-proposal.js`
**Spec:** Plan §Module catalog `block-proposal.js`. Emit `block-finding` per maximal contiguous `belowAnchor` run within one `trkSegIndex`. Compute `internalMonotonicity`. Mark as edge proposal if `[B_min, B_max]` extends segment envelope.

**Code:** Walks workingOrderedPoints in one segment, detects contiguous `belowAnchor` runs via the supplied set, emits `{gpxIndexes, hasInternalMonotonicityViolation}`.

**Gaps:**
- [MISSING] No `isEdgeProposal` detection — Phase 1 scope-gate / edge-staging broken as a result.
- [MISSING] No skip-for-`hasAnomalies:false` (plan says "Skipped for segments with hasAnomalies: false"). Currently always runs.
- [MISSING] Does not emit `block_internal_monotonicity_fail` annotation when `internalMonotonicity === false` (plan §Block overlap step 2 attributes annotation emission to overlap-detection, OK — but overlap-detection does not emit it either).
- [MISSING] Segment-summary trace of block start/end gpxIndexes is fine but plan also expects `B_min/B_max` to be computed by overlap-detection (it is — OK). No gap there.

### `proposals/singleton-proposal.js`
**Spec:** Plan §`singleton-proposal.js`. Non-duplicate backtrack candidates. Sampling vs gpxIndex window (not implemented here — OK, the "sampling vs gpxIndex window" bit is for the baseline exclusion `sampling_below_neighbour_baseline`). Emit `insert` (isExactGroup=false, candidates.length=1) with `targetTimeMs`, `tPrev`, `tNext`, `bracketGpxIndexes`. Kinematic payload computed here (plan says "Kinematic check computed here and embedded in candidate payload").

**Code:** For each belowAnchor-not-block candidate, walks left/right in working order within the segment to find traversal-adjacent finite-time bracket, emits insert proposal with `candidateGpxIndexes=[gi]`, `tPrev`, `tNext`, `bracketGpxIndexes`.

**Gaps:**
- [MISSING] `targetTimeMs` is not emitted on the proposal (plan §Output shape requires `targetTimeMs` on InsertProposal). Overlap-detection and coupling both need it.
- [MISSING] Kinematic check not pre-computed in candidate payload (`kinematics` field per ADR-0012 InsertCandidate shape).
- [MISSING] Full candidate payload per ADR-0012: `{gpxIndex, lat, lon, tPrev, tNext, bracketGpxIndexes, kinematics}`. Code only carries `candidateGpxIndexes`.
- [MISSING] `isEdgeProposal` detection.
- [MISSING] `sampling_below_neighbour_baseline` exclusion path.

### `proposals/duplicate-proposal.js`
**Spec:** Plan §`duplicate-proposal.js`. Traversal-adjacent rescan for adjacent-exact-drop (within segment). Emit `insert` with length≥2 for competition groups. Emit `insert` with `isExactGroup=true` for non-adjacent identical groups (flag-only). Cross-segment same-time → `cross_segment_duplicate` excludedFromTrust (no proposal).

**Code:** Finds traversal-adjacent exact duplicates → adjacent-exact-drop proposals. Groups by timeMs → emits insert proposals with all group members. Detects `allExact` via isExactDuplicate from index 0.

**Gaps:**
- [MISSING] Cross-segment same-timeMs detection → `cross_segment_duplicate`.
- [MISSING] `targetTimeMs` on insert proposals.
- [WRONG] `allExact` logic: checks `isExactDuplicate(first, g)` for every g — but exact equality requires same lat+lon+ele; groups detected by timeMs alone can fail this test while still being meaningful competitions. Edge-case OK, but the competition pool should consistently be all group members regardless; `allExact` should drive only the `isExactGroup` bit, which appears correct.
- [MISSING] If a group is split between adjacent-exact-drop and a remaining competition, `duplicate-proposal` may emit both for overlapping gpxIndexes — no dedup between the two paths.
- [MISSING] Per-candidate kinematics.

### `gates/overlap-detection.js`
**Spec:** Plan §Block overlap / §Cross-proposal footprint + ADR-0009. Block path: B_min/B_max, bracket anchors from spine, closed-socket numeric test, corridor pierce-check. THEN cross-proposal footprint mapping: insert inside block envelope → veto both; insert-insert corridor overlap → veto both. Emit proposal-scope annotations `overlap_block`, `overlap_singleton_block_conflict`, `overlap_singleton_singleton_conflict`, `overlap_spine_pierce_detected`, `overlap_bracket_missing`.

**Code:** Block path only. B_min/B_max correctly computed. Walks segment spine looking for last-point < B_min and first-point > B_max (not in block) — OK. Numeric socket test. Pierce-check scanning spine for non-block point in (tPrev, tNext). Emits `overlapVetoedProposalIds[]` and `overlapBlockResolution[]`. No annotations.

**Gaps:**
- [MISSING] **Cross-proposal footprint mapping entirely absent (ADR-0009 primary concern).** No insert footprint extraction, no insert-inside-block-envelope detection, no insert-insert corridor comparison.
- [MISSING] No proposal-scope annotations (`overlap_block`, `overlap_spine_pierce_detected`, `overlap_bracket_missing`, `overlap_singleton_block_conflict`, `overlap_singleton_singleton_conflict`, `block_internal_monotonicity_fail`).
- [MISSING] No `no-bracket` specific handling — currently lumps into `overlap` (plan distinguishes `overlap` vs `no-bracket`).
- [MISSING] No `spinePointPierceDetected` is populated truthfully; it is always `false` in the emitted resolution even when pierce detection fires (the proposal gets vetoed in that case so the resolution entry is never emitted — but that means we cannot distinguish "numeric-ok but pierced" diagnostically).
- [MISSING] Overlap-detection does not consider previously-vetoed proposals when mapping footprints; per ADR-0009 all proposals contribute to the footprint.

### `gates/coupling-detection.js`
**Spec:** Plan §Reference stability and coupling + ADR-0010 revised 2026-04-23. Bilateral disturbance zones per proposal (leaving + arriving). Kinematic refs: insert → bracketGpxIndexes; block-finding → [prevGpxIndex, nextGpxIndex]. adjacent-exact-drop has no disturbance zone and no kinematic refs. Strictly intra-segment in Phase 1. Block-finding NOW coupling-blockable (symmetric blocking).

**Code:** Implements bilateral disturbance zones per kind. Uses traversal neighbours for leaving side, bracket anchors for arriving side. Builds coupling edges via "kinematic ref falls in disturbance zone". Union-find components into `coupledRegions`. Emits `couplingBlockedProposalIds`, `independentProposalIds`.

**Gaps:**
- [MISSING] Coupling is NOT restricted to intra-segment in the code. Disturbance zone and kinematic refs cross `trkSegIndex` because `traversalNeighbours` and `bracketGpxIndexes` are not filtered by segment. Must enforce same-segment invariant per ADR-0011 Phase 1.
- [INCOMPLETE] `side` derivation has a bug: `P.bracketGpxIndexes && P.bracketGpxIndexes.includes(Prefs[ri])` — block-finding proposals don't have `bracketGpxIndexes`, only `prevGpxIndex`/`nextGpxIndex`; side classification for blocks is always "leaving" incorrectly.
- [MISSING] No reason annotations `coupled_same_time_deferred`, `coupled_reference_unstable`.
- [MISSING] `independentProposalIds` logic includes ALL proposals regardless of kinematic sensitivity (including adjacent-exact-drop, which is correct only because drops have no edges); but blockedSet check is not symmetric — an overlap-vetoed block still appearing in another proposal's disturbance zone should still count. The code accidentally gets this right because it iterates all proposals.

### `apply/kinematic-guard.js`
**Spec:** ADR-0015. Haversine-based speedPrev/speedNext in km/h; pass iff both ≤ threshold (default 80). Score = sp² + sn². `failReason ∈ {speed_prev_exceeded | speed_next_exceeded | both_exceeded | no_bracket}`.

**Code:** Implements per ADR-0015 correctly including missing-bracket handling and zero-Δt degenerate cases. Score computation preserves single-side score (used by competition even with one-sided bracket).

**Gaps:**
- [INCOMPLETE] `no_bracket` semantics: ADR-0015 says missing side "vacuously passes", so a valid one-sided candidate should PASS. The code's branch "if speedPrevKph === null && speedNextKph === null → passed=false, failReason=no_bracket" is only for both-missing and is correct. Otherwise passed is derived from the available side — correct.
- Rating: closest-to-spec.

### `apply/resolution-apply.js`
**Spec:** Plan §`resolution-apply.js` + ADR-0015. AND gate applyable = proposals \ vetoed \ blocked. For block-finding socket-ok: compute guard using prev and next anchors vs block.first/last; pass → apply block-reorder (physically reorder block members to socket position). For insert length=1: guard gating. For insert length≥2: advisory-with-fallback, winner = lowest score among passers (fallback = lowest score overall). For adjacent-exact-drop: unconditional drop. `isExactGroup: drop all but lowest gpxIndex. Append rearrangements with passIndex + trkSegIndex. Recompute spine + correction-idle post-apply.

**Code:** Correctly gates by vetoed/blocked. Block: computes two one-sided kinematic checks and combines `guardPassed`. On fail → annotation + excludedFromTrust. On pass → annotation and sets `applied=true` but does NOT actually reorder. Insert length=1: guard; pass → annotation only (TODO reorder). Insert length≥2: builds per-candidate checks, sorts, picks winner, marks losers excludedFromTrust + removeFromWorking, but TODO on actually reordering the winner. isExactGroup: drops all but lowest gpxIndex. adjacent-exact-drop: unconditional drop.

**Gaps:**
- [INCOMPLETE/MISSING] **No actual reorder/move logic** for block-finding, insert length=1, insert competition winners. TODOs left in place. This is the biggest behavioural bug — Phase 1 can never actually converge via reorder.
- [WRONG] Annotation kinds `block_reorder_applied` and `insert_applied` are NOT in the ADR-0012 enum.
- [WRONG] Kinematic check for block uses `guard.computeKinematicCheck(prevAnc, firstPt, null, ...)` and a separate call for the next side, then combines. The spec computes **one** KinematicCheck with both sides and a single score = sp² + sn². The combined `kinematics` built ad-hoc at the call site loses `failReason` detail.
- [MISSING] Block-reorder `excludedFromTrust` writes `reason` as a string but ADR-0012 wants `reasons: []`; the working-state helpers collaborate on the wrong shape.
- [MISSING] No `rearrangements` pushes anywhere in `resolution-apply`.
- [MISSING] No post-apply spine recompute inside this module; phase1-loop does recompute, but the per-segment `correctionIdle` recompute step is missing (see cross-cutting #2).
- [WRONG] `addExcludedFromTrust` is called with a single reason per write; will produce duplicate entries per gpxIndex over multiple passes (violates ADR-0012 shape).
- [MISSING] Insert-length=1 / competition: `targetTimeMs` is not available on the proposal (singleton-proposal doesn't emit it), so "move candidate to target position" cannot be computed.
- [MISSING] Fallback winner for `insert_competition_kinematic_guard_failed`: code sets `annKind = 'insert_competition_kinematic_guard_failed'` and proceeds to `applied = true` — correct per ADR-0015. But winner is STILL not actually moved.
- [EXTRA] Competition losers are both excludedFromTrust AND `removeFromWorking` — ADR-0012 says excludedFromTrust points stay in `fullOrderedPoints`. They should NOT be removed from workingOrderedPoints; only drops get removed. This is a silent data-loss bug.

### `phase2/edge-reconciliation.js`
**Spec:** Plan §Phase 2 + ADR-0011. Pairwise pass over adjacent boundaries in ascending order. Gather staged edge proposals. Resolve per stability matrix (both stable → no-op; one-stable → apply; double-unstable → discard + `edge_coupling_unstable` annotation + `edge_unresolved` excludedFromTrust). Cross-segment adjacent dedupe exception (ADR-0014). Append to `rearrangements`. Single pass, no re-trigger of Phase 1.

**Code:** Empty TODO stub. Includes a handwritten comment questioning whether the phase is needed ("why are we running this edgereconcilation? we discussed that we are keeping the global adjacent dedup...").

**Gaps:**
- [STUB] Entire phase.
- [MISSING] No staging input plumbing from Phase 1.
- Note: the handwritten comment is itself a planning drift signal — the plan/ADR-0011 is explicit that Phase 2 is required and does more than adjacent dedupe (it reconciles staged edge proposals).

### `phase3/residual-diagnostic-sweep.js`
**Spec:** Plan §Phase 3 + ADR-0011. Read-only scan. For each traversal-adjacent (prev, curr) with both timeMs finite: check `curr >= prev`. For each point: check not below rolling max. Aggregate by intra-segment vs cross-segment. Output `correction.diagnostics.residualTemporalAnomalies[]` shaped per plan §Output shape. Does not mutate state.

**Code:** Empty TODO stub returning `[]`.

**Gaps:**
- [STUB] Entire phase.
- [MISSING] No diagnostics output.

### `export/correction-export.js`
**Spec:** Plan §Output shape. Build `fullOrderedPoints`, `excludedFromTrust`, `canonicalTrustedPoints`. Finalize drops/excludedFromTrust/annotations/rearrangements/multipass/diagnostics/profile/participation/segmentProfiles. Set `applied` and `skipReason` on proposals. Validate partition invariant.

**Code:** Builds `{metadata, drops, excludedFromTrust, annotations, spineIntervals, coupledRegions, overlapBlockResolution, passLog, survivingGpxIndexes}`. No partition invariant check.

**Gaps:**
- [MISSING] `fullOrderedPoints`, `canonicalTrustedPoints`.
- [MISSING] `profile.{profileId, algorithmVersion, parameters}`.
- [MISSING] `participation` and `segmentProfiles`.
- [MISSING] `rearrangements[]`.
- [MISSING] `multipass.perSegment[]`.
- [MISSING] `diagnostics.residualTemporalAnomalies[]`.
- [MISSING] Final `proposals[]` array with `applied` and `skipReason` on each entry.
- [MISSING] Partition invariant validation (ADR-0012).
- [EXTRA] Exports `coupledRegions`, `overlapBlockResolution`, `passLog`, `survivingGpxIndexes` — ADR-0012 says internal runner state should be collapsed into proposal.skipReason.
- [WRONG] `excludedFromTrust` / `drops` shape differs from ADR-0012 (multi-reason on excludedFromTrust).

### `state/working-state.js`
**Spec:** Working state with workingOrderedPoints + drops + excludedFromTrust + annotations. Mutated by resolution-apply. ADR-0012 schema for the three collections.

**Code:** Correct skeleton. `addDrop/addExcludedFromTrust/addAnnotation` append a single record each.

**Gaps:**
- [WRONG] `addExcludedFromTrust` appends `{gpxIndex, reason, stage}` per call — should upsert into an existing `{gpxIndex, reasons: [...]}` entry per ADR-0012.
- [WRONG] `addDrop` uses an ad-hoc reason enum (callers write `'objective_adjacent_exact_duplicate'`, `'exact_group_non_winner'`) not in ADR-0012's `DropReason`.
- [MISSING] `rearrangements` collection not present.
- [MISSING] `stagedEdgeProposals` map not present.

### `state/proposal-schema.js`
**Spec:** ADR-0012. Three kinds: insert (candidates[]), block-finding, adjacent-exact-drop. Insert carries `targetTimeMs`, `isExactGroup`, `candidates: InsertCandidate[]` with `{gpxIndex, lat, lon, tPrev?, tNext?, bracketGpxIndexes?, kinematics?}`. Every proposal gains `applied`, `skipReason`.

**Code:** Three kinds present. Insert carries `candidateGpxIndexes` (plain array of gpxIndex), `isExactGroup`, `tPrev`, `tNext`, `bracketGpxIndexes`. No `targetTimeMs`, no `candidates[]` with per-candidate lat/lon/kinematics.

**Gaps:**
- [WRONG] Insert payload shape: `candidates[]` of objects vs a flat `candidateGpxIndexes` array.
- [MISSING] `targetTimeMs`.
- [MISSING] `applied` / `skipReason` not initialized (only set later by resolution-apply).
- [MISSING] No `winner` field on insert.
- [MISSING] No `isEdgeProposal` field on any kind.
- [INCOMPLETE] `assertValidProposal` only checks id/kind/trkSegIndex; does not enforce per-kind invariants (candidates length match to isExactGroup, etc.).

### `params/defaults.js`
**Spec:** Plan §Output shape parameters: `minTimestampPairCoverageRatio=0.8`, `lenientMaxImpliedSpeedKph=80`, `multipassMaxIterations=500`, `timezoneShiftTolerance=0.1`.

**Code:** `lenientMaxImpliedSpeedKph=80`, `multipassMaxIterations=500`, `validEleFloorM=-500`, `validEleCeilingM=9500`.

**Gaps:**
- [MISSING] `minTimestampPairCoverageRatio` default.
- [MISSING] `timezoneShiftTolerance` default.
- [EXTRA] `validEleFloorM` / `validEleCeilingM` — referenced in motion/elevation audit, not locked as correction-layer params. Acceptable since adjacent-dedupe needs an OOB test, but plan has no defined key for these here.

---

## Priority-ordered remediation list

1. **Rewrite `participation-check.js` per ADR-0002 / ADR-0007 / plan §Per-segment eligibility.** Compute `parseableTimestampPointCount`, `hasAnyPositiveTimeDelta`, `coverageRatio`, global mode + per-segment `SegmentParticipationProfile[]`, `isFullyReversed` candidacy. Emit the `participation` slice plus `segmentParticipationProfiles[]`. Wire the "all segments idle → short-circuit to export" path.

2. **Wire correction-idle predicate and short-circuits.** Add per-segment `correctionIdle` evaluator (using `audit.temporal.perSegment` + `audit.sampling.perSegment`). Call after participation, objective-dedupe, reversal, deterministic-export-fix, and every `resolution-apply`. Exit Phase 1 early with reason `correction-idle` when predicate becomes true.

3. **Fix `correction-runner.js` audit consumption.** Read `auditResult.audit.ingestion.segmentBoundaries`, `segmentSummaries`, `temporal.perSegment[trkSegIndex]`, `sampling.perSegment[trkSegIndex]`. Stop reading `audit.exportFaults`. Normalize signature (drop polymorphic overload).

4. **Implement `deterministic-export-fix.js` per ADR-0013.** Classify boundaries; apply chunk reorder by `minTimeMs`; exclude duplicate chunks; emit `rearrangements`, `drops`, annotations (`chunk_ordering_resolved`, `duplicate_chunk_excluded`, `segment_boundary_gap`, `timestamp_discontinuity`).

5. **Rewrite `boundary-classifier.js`.** Replace same_day/cross_day/gap_large/backward taxonomy with `chunk_ordering | duplicate_chunk | timestamp_discontinuity | segment_boundary_gap` per ADR-0013. Consume `SegmentBoundary` shape with `gapMs`, `impliedDistanceM`, `impliedSpeedKph`. (Or fold this into `deterministic-export-fix.js` — ADR-0013 treats classification as part of that module.)

6. **Implement actual reorder mutations in `resolution-apply.js`.** Block-reorder: move block members into socket position in workingOrderedPoints. Insert length=1: move candidate to target position. Insert competition winner: move winner to target, keep losers at original positions but flag excludedFromTrust (do NOT removeFromWorking). Write `rearrangements` entries with `passIndex` + `trkSegIndex` + `stage`.

7. **Fix `excludedFromTrust` shape and partition handling.** Adopt `{gpxIndex, reasons: []}` upsert semantics. Validate partition invariant in `correction-export`.

8. **Implement edge-proposal staging + Phase 2 edge reconciliation.** Add `spineEnvelope` to spine output; add scope-gate + `isEdgeProposal` detection in block-/singleton-/duplicate-proposal; pass staged proposals to Phase 2; implement stability matrix and `edge_coupling_unstable` / `edge_unresolved` paths.

9. **Implement overlap-detection cross-proposal footprint (ADR-0009).** Add insert footprint, insert-in-block-envelope, insert-insert corridor-overlap detection; emit proposal-scope annotations `overlap_singleton_block_conflict`, `overlap_singleton_singleton_conflict`, `overlap_block`, `overlap_spine_pierce_detected`, `overlap_bracket_missing`, `block_internal_monotonicity_fail`.

10. **Fix Phase 1 loop exit taxonomy and add verification pass.** Replace `all_applied`/`stable` with spec set `{idle | stalemate | no-proposals | correction-idle | max-iterations}`. When `applyable == proposals`, rebuild proposals and run gates without applying; only exit `idle` if rebuilt set is empty.

11. **Enforce intra-segment invariant in `coupling-detection.js`.** Filter traversal neighbours and kinematic refs to same trkSegIndex. Fix `side` derivation for block-finding proposals.

12. **Implement Phase 3 residual diagnostic sweep per ADR-0011.**

13. **Implement `reversal-check.js`** global and per-segment reversal per ADR-0005.

14. **Fix `objective-adjacent-dedupe.js`**: add same-`trkSegIndex` guard; fix drop reason string to `'adjacent-exact-duplicate'`; implement full ele equality table with `adjacent_duplicate_ele_mismatch` annotation.

15. **Align annotation shape with ADR-0012** (`scopeRef`). Remove non-spec kinds (`block_reorder_applied`, `insert_applied`). Validate kind against locked enum at export time.

16. **Extend `proposal-schema.js`** with `targetTimeMs`, `candidates[]` object array, `applied=false` default, `skipReason?: null`, `isEdgeProposal`. Pre-compute `kinematics` in `singleton-proposal.js` and `duplicate-proposal.js` for each candidate.

17. **Extend `correction-export.js`** to emit the full plan §Output shape: `profile`, `participation`, `segmentProfiles`, `multipass.perSegment`, `proposals[]` (final records with `applied`+`skipReason`), `rearrangements[]`, `diagnostics`, `fullOrderedPoints`, `canonicalTrustedPoints`. Validate partition invariant. Drop `survivingGpxIndexes`, `coupledRegions`, `overlapBlockResolution`, `passLog` from the top-level (move inside `multipass.perSegment` / `proposals[].skipReason`).

18. **Add missing defaults** `minTimestampPairCoverageRatio = 0.8`, `timezoneShiftTolerance = 0.1` to `params/defaults.js`.

19. **Implement `cross_segment_duplicate` detection** in `duplicate-proposal.js` (flag same-`timeMs` across trkSegIndex → excludedFromTrust reason, no proposal).

20. **Implement `rearrangements` collection** throughout (deterministic-export-fix, resolution-apply, phase2).

End of audit.
