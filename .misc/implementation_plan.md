# Correction Layer — MVP Implementation Plan

This plan supersedes all prior versions. It encodes architectural decisions reached through first-principles discussion. Many decisions reverse or replace earlier "AI slop" wording from prior iterations — do **not** treat older comments as authoritative.

The correction layer is the first post-audit processing stage. It consumes the immutable audit output, applies a versioned decision tree per `trkSegIndex`, and produces a **correction metadata profile** plus a **pre-split handoff** to later layers (see **§ Handoff: pre-split lists**). **Kinematic correction, smoothing, and metrics** consume **`canonicalTrustedPoints`** by default — **not** the raw `points` array.

**Raw observations remain immutable.** **`workingOrderedPoints`** mutates only during **early stages** (dedupe, reversal, deterministic export fix), inside **per-segment `resolution-apply`**, and inside **edge reconciliation** (Phase 2). Proposal modules emit candidate corrections only.

---

## Architectural shape (high level)

The pipeline is **multilayered with a global runner** (D1):

1. **Audit layer** runs to completion; produces immutable `audit` payload with per-segment summaries and per-segment per-module aggregates. **Audit no longer classifies export faults** — it only emits structural observations.
2. **Correction layer** fires only after audit completes. Internally it runs:
   - **Pre-segment phase:** participation, global+per-segment reversal, deterministic export fix (chunk reorder, duplicate-segment exclusion).
   - **First spine build** (per-segment, after pre-segment phase).
   - **Phase 1 — per-segment terminal solve** (segments processed in ascending `trkSegIndex` order; each runs its own multipass loop to terminal: idle, stalemate, or `multipassMaxIterations` cap).
   - **Phase 2 — edge reconciliation** (single pairwise pass over adjacent segment boundaries; staged edge proposals from Phase 1 are evaluated here).
   - **Phase 3 — global residual diagnostic sweep** (read-only; logs any belowAnchor/belowPrevValid-equivalent residuals across the final canonical traversal — for telemetry, never acts).
3. **Correction-export** assembles the handoff.

**No global belowAnchor/belowPrevValid tags.** All temporal-anomaly tagging is **per-segment** from this point forward. The global concept is replaced by Phase 3's diagnostic sweep, which is observational only and never gates apply decisions.

---

## Terminology

### Segment

A `<trkseg>` element. Each accepted `<trkpt>` carries `trkSegIndex` (globally 0-based across all `<trk>` elements, document order). Segmentation is **the** primary scoping axis of this layer.

### Spine interval

A **maximal forward-monotonic run with strictly positive Δt** of usable-time points within **one** `trkSegIndex`, **excluding** duplicate-time cluster members.

**Concrete example.** Within one segment, times `1 2 3 4 5 5 5 6 7 8` produce two spine intervals: `[1..4]` and `[6..8]`. None of the three `5`s are on the spine — the duplicate-time cluster is excluded.

The spine predicate is **purely mechanical**:

- Forward-monotonic in traversal order
- Strictly positive Δt between consecutive included points
- Excludes any point that shares its `timeMs` with another point in the segment (duplicate-time cluster member)

Spine intervals are re-derived from current `workingOrderedPoints` after every mutation. Two adjacent spine intervals merge naturally when intervening points satisfy the predicate after correction. There is no separate "is the gap complete enough" test in this layer — that judgment (Δt-cadence consistency, recording-pause vs continuous gap) belongs to downstream smoothing/kinematic-section selection, **not** to the spine layer.

### Spine envelope (per segment)

The min and max `timeMs` over **spine points in that segment**. Used as the segment time envelope for the scope gate. Non-spine points (singletons, duplicate-time cluster members, blocks) do **not** define the envelope by themselves; they are evaluated against it. **Boundary edge cases** are handled in Phase 2 (see **§ Phase 2 — edge reconciliation**).

### Block

A maximal contiguous run of `belowAnchor`-equivalent points within **one** `trkSegIndex`, in current `workingOrderedPoints` traversal order.

### Singleton (non-block)

An isolated backtrack point or same-`timeMs` row not part of a contiguous block run. Includes block-size-1 cases.

### Bracket / socket

- **Bracket:** the anchor points (and times `t_prev`, `t_next`) that frame a block in the intended forward time story. Selected by `overlap-detection` from spine and outside-the-run rules.
- **Socket:** the closed-interval predicate `B_min ≥ t_prev AND B_max ≤ t_next` over the block's usable time envelope `[B_min, B_max]`. Computed by `overlap-detection`, not `block-proposal`.

### Traversal-adjacent vs stream-adjacent

- **Stream-adjacent:** `curr.gpxIndex === prev.gpxIndex + 1`. Immutable — defined on raw input. Used **only** for raw-input checks (initial ingestion analysis, raw audit pair definitions).
- **Traversal-adjacent:** consecutive in current `workingOrderedPoints`. Mutable — recomputed after every reorder, drop, or insert. **This is the canonical adjacency for all correction-layer dedupe and neighbour analysis.** Re-evaluated after every mutation including chunk reorder.

### Per-segment terminal

A segment is "terminal" when its multipass loop has hit one of: `idle` (all proposals applied + verification pass empty), `stalemate` (proposals exist but none applyable), `no-proposals` (none generated), or `max-iterations` (cap hit). Phase 2 only runs once **all segments** are terminal.

### Edge proposal

A proposal generated in Phase 1 whose corrected position would land at or near the segment's first or last spine point — i.e. the proposal would alter the segment's boundary. These are **staged but not applied** in Phase 1. They are reconciled in Phase 2 against the adjacent segment's facing edge.

### Multipass cap

`multipassMaxIterations`, default **500** per segment. Safety net only — design exit is `idle` or `stalemate`. Hitting the cap is logged as a defect signal, not a normal outcome.

---

## Audit layer contract (what correction reads)

The audit layer is **purely observational**. Post-segmentation, it does **not** compute global belowAnchor / belowPrevValid tags, and it does **not** classify export faults. It emits:

### Per-segment structural summaries (ingestion)

`audit.ingestion.segmentSummaries[]` — one entry per `trkSegIndex`:

```
SegmentSummary {
  trackIndex:      number,
  segIndex:        number,
  globalSegIndex:  number,         // = trkSegIndex on accepted points
  pointCount:      number,
  usableTimeCount: number,
  firstTimeMs:     number | null,  // first parseable timestamp in document order
  lastTimeMs:      number | null,  // last parseable timestamp in document order
  minTimeMs:       number | null,
  maxTimeMs:       number | null,
  firstLat:        number | null,  // boundary coords for impliedDistance/Speed
  firstLon:        number | null,
  lastLat:         number | null,
  lastLon:         number | null
}
```

### Per-module per-segment aggregates

Each audit module (`timestamp-audit`, `sampling-audit`, `motion-audit`, `elevation-audit`) emits a `perSegment[trkSegIndex]` slice alongside its global counts. Existing module schemas continue to expose totals; the per-segment slices are additive. The correction layer reads the per-segment slices; global counts remain available for telemetry only.

### Per-segment temporal tags

`audit.temporal.perSegment[trkSegIndex]` carries point-level tags scoped to that segment: `belowAnchor`, `belowPrevValid`, `adjacentDuplicate`, `nonAdjacentRepeat`, `missing`, `unparsable`. These tags are **defined relative to the segment** — `belowAnchor` means "below the anchor anchored within this segment." Cross-segment relationships are not tagged here.

### Boundary observations (no classification)

`audit.ingestion.segmentBoundaries[]` — one entry per inter-segment boundary (`fromTrkSegIndex`, `toTrkSegIndex`):

```
SegmentBoundary {
  fromTrkSegIndex:    number,
  toTrkSegIndex:      number,
  trackIndex:         number,
  gapMs:              number | null,    // next.firstTimeMs - curr.lastTimeMs
  impliedDistanceM:   number | null,    // Haversine using boundary coords
  impliedSpeedKph:    number | null
}
```

Every boundary emits one entry. **No threshold, no classification.** The correction layer decides whether a given boundary is `chunk_ordering`, `duplicate_chunk`, `segment_boundary_gap` (formerly `missing_chunk_fault`), `timestamp_discontinuity`, or none of the above.

### Validity for waypoints/routes (C4)

`audit.waypoints[]` and `audit.routes[]` are forwarded as-is. Each entry carries a per-element validity flag. Correction does **not** mutate these collections. Renderers read validity flags and decide whether to draw.

### What audit no longer emits (post-segmentation)

- Global `belowAnchor` / `belowPrevValid` tag arrays. (Per-segment tags only.)
- `audit.exportFaults[]` with classified fault types. (Replaced by raw `audit.ingestion.segmentBoundaries[]`; correction classifies.)

### rawTime capture

**Deferred.** Not captured in MVP. If post-MVP DST/timezone analysis becomes useful, audit can be re-extended without breaking correction. The cost-of-deferral is one re-parse of timestamps when needed.

---

## Pipeline order (correction layer)

```
correctionRunner({ points, auditResult }):
  1. participation-check
       — global mode / coverageRatio
       — segmentParticipationProfiles[] (per trkSegIndex)
       — early return if full skip
  2. objective-adjacent-dedupe
       — stream-adjacent only at this stage (raw input)
       — recompute correction-idle predicate (per-segment); skip downstream if all clean
  3. reversal-check
       — global full-array reversal hypothesis
       — per-segment reversal for isFullyReversed segments
  4. Deterministic export fix phase (correction-owned classification)
       — segment-boundary classification: chunk_ordering, duplicate_chunk,
         segment_boundary_gap, timestamp_discontinuity
       — apply chunk reorder and duplicate-segment exclusion
       — recompute correction-idle predicate
  5. Spine intervals (first build, per-segment)
  6. Phase 1 — per-segment terminal solve
       FOR each trkSegIndex in ascending order:
         multipass loop until terminal (idle / stalemate / no-proposals /
         max-iterations); edge proposals staged, not applied
  7. Phase 2 — edge reconciliation (single pairwise pass)
       FOR each adjacent (S[i], S[i+1]):
         resolve staged edge proposals against neighbour stability;
         double-unstable → flag edge_coupling_unstable
  8. Phase 3 — global residual diagnostic sweep
       read-only scan over final canonicalPoints; log any cross-segment
       below-prev-valid / below-anchor residuals
  9. correction-export
```

---

## Phase 1 — per-segment terminal solve

Each segment is processed in ascending `trkSegIndex` order. The next segment does not begin until the current segment has reached terminal.

### Per-segment multipass loop

For one segment S:

```
loop:
  iterationsRun_S++
  if iterationsRun_S >= multipassMaxIterations: exit('max-iterations')

  proposals_S = block-proposal(S) ∪ singleton-proposal(S) ∪ duplicate-proposal(S)
                — all scoped to S; never reference points outside S except for
                  the next-to-edge stability check (described below)

  scope-gate(proposals_S, S.spineEnvelope):
    drop any proposal whose corrected position falls outside S's spine envelope
    UNLESS the proposal is an edge proposal (would land on or extend the
    segment's first/last spine slot) — these are staged for Phase 2

  if proposals_S empty: exit('no-proposals')

  overlap-detection(proposals_S)
  coupling-detection(proposals_S)
  applyable_S = proposals_S \ overlapVetoed \ couplingBlocked

  if applyable_S empty: exit('stalemate')

  resolution-apply(applyable_S)   — mutates workingOrderedPoints for S only
  recompute spineIntervals[S]
  recompute correctionIdle[S]
  if correctionIdle[S]: exit('correction-idle')

  if applyable_S == proposals_S:
    verification-pass:
      rebuild proposals_S; run overlap + coupling; do NOT apply
      if rebuilt proposals_S empty: exit('idle')
      else continue
```

### Edge proposals

A proposal is an **edge proposal** if applying it would alter the segment's `spineEnvelope` boundary:

- **Singleton-insert:** target slot is at the segment's current first or last spine position (would extend the envelope on that side).
- **Block-finding:** the block's `[B_min, B_max]` overlaps or extends past the current envelope edge on either side.
- **Duplicate-reorder:** affects a competition group whose containing spine interval is the segment's first or last.

Edge proposals are **staged in `correction.stagedEdgeProposals[trkSegIndex]`**, not dropped, not applied. They participate in Phase 2.

### Coupling scope (locked rule)

Coupling-detection runs **strictly intra-segment** in Phase 1. Disturbance zones, kinematic traversal neighbours, and spine queries never cross `trkSegIndex`. The only cross-segment reference allowed is for **edge proposals**, and that reference is deferred to Phase 2.

---

## Phase 2 — edge reconciliation

Runs **once** after every segment has reached terminal. Pairwise over adjacent segment boundaries in ascending order.

### Per-boundary algorithm

For boundary between S[i] and S[i+1]:

1. Gather `stagedEdgeProposals[i].lastEdge` and `stagedEdgeProposals[i+1].firstEdge`.
2. Determine **neighbour stability** on each side:
   - S[i]'s last spine point is **stable** iff (a) it is on the spine and (b) it has no staged edge proposal pending on it.
   - Symmetric for S[i+1]'s first spine point.
3. Resolve:

| S[i].lastEdge stable? | S[i+1].firstEdge stable? | Action |
|---|---|---|
| Yes | Yes | No staged proposals to evaluate → no-op. |
| Yes | No (S[i+1] has staged edge) | Evaluate S[i+1].firstEdge against S[i]'s last spine point as a neighbour reference. Apply `insert` / `block-reorder` if seam check passes (insert: time/sequence ordering vs S[i].lastTime; block: no overlap with S[i]'s tail block). |
| No | Yes | Symmetric. |
| No | No | **Double-unstable coupling.** Flag the pair as `edge_coupling_unstable`. Do not resolve either. Both staged proposals are discarded; their target points remain in `workingOrderedPoints` at their current positions and are added to `excludedFromTrust` with reason `edge_unresolved`. |

### Phase 2 runs once

A mutation applied in Phase 2 does **not** re-trigger Phase 1 for the affected segment. If a Phase 2 mutation creates a new interior anomaly, it surfaces in Phase 3's diagnostic sweep and is logged. This is a deliberate MVP simplification: cascading Phase 1 ↔ Phase 2 introduces convergence problems we cannot reason about without real data.

### Cross-segment block exception (N5)

If a Phase 1 block-finding extends across a segment boundary in a way that is not handled by edge reconciliation (e.g. a `4 5 6 1 | 2 3 7 8 9` structure where the misplaced sub-run straddles the boundary), the per-segment solver inside each segment still runs to terminal as if the boundary were a hard wall. Phase 2 only resolves edge proposals, not full-block reorders that span boundaries. Such structures will surface in Phase 3 as residual cross-segment below-prev-valid / below-anchor signals. **MVP does nothing about them** — we wait for telemetry to confirm whether they exist in real data before designing a corrective path.

---

## Phase 3 — global residual diagnostic sweep

Read-only scan over the final post-correction `workingOrderedPoints`:

- For every traversal-adjacent pair `(prev, curr)` with both `timeMs` finite, check `curr.timeMs >= prev.timeMs`.
- For every point, check it is not below any previously-seen anchor (the rolling max of timestamps).
- Aggregate violations by `trkSegIndex` pair (intra-segment vs cross-segment).

Output: `correction.diagnostics.residualTemporalAnomalies[]`. This is **observational telemetry**. Phase 3 never mutates state and never triggers further correction. Its purpose is to surface patterns the per-segment + edge-reconciliation pipeline missed, so we can extend MVP based on real data.

---

## Adjacency primitive: traversal-adjacent

After early mutations (dedupe, reversal, deterministic export fix) and after every Phase 1 `resolution-apply` and every Phase 2 mutation, **traversal adjacency changes** even though `gpxIndex` on surviving points does not. Any consumer of "neighbour" semantics inside the correction layer reads from the **current** traversal order.

| Consumer | Adjacency basis |
|---|---|
| Initial sanity (raw input) | Stream-adjacent (`gpxIndex+1`). Immutable. |
| `objective-adjacent-dedupe` (initial) | Stream-adjacent (raw input snapshot). |
| `duplicate-proposal` per-pass `adjacent-exact-drop` rescan | **Traversal-adjacent** on current `workingOrderedPoints`. |
| Block detection (`belowAnchor` runs) | **Traversal-adjacent** within one `trkSegIndex`. |
| Bracket selection | **Traversal-adjacent**, segment-bounded, informed by `spineIntervals`. |
| Coupling kinematic neighbours | **Traversal-adjacent**, segment-bounded. |
| Phase 2 edge reconciliation | Cross-segment by definition (S[i].lastSpine vs S[i+1].firstSpine). |
| Phase 3 diagnostic sweep | **Traversal-adjacent** across full canonical traversal. |
| Sampling-baseline / Δt density | Stream-adjacent (`gpxIndex` window) — this is sampling-density, distinct from traversal adjacency. |

The shift to traversal-adjacent as canonical is a real change from earlier plans. Stream-adjacent stays only where the question is genuinely about raw recording density.

---

## Schema cleanup: drops vs excludedFromTrust vs annotations

The previous plan carried a tangle of `flags[]`, `masks[]`, `excludedFromTrust[]`, and `drops[]` with overlapping semantics. The cleaned model has **three** concepts only (see ADR-correction-0012 for full rationale):

### `correction.drops[]`

Points **removed from all ordered traces**. Absent from `fullOrderedPoints` and `canonicalTrustedPoints`. Reasons are limited and policy-driven:

- `adjacent-exact-duplicate` — 100% identical adjacent twin (objective-adjacent-dedupe or per-pass adjacent-exact-drop).
- `duplicate_chunk_segment` — entire segment's points removed by deterministic export fix.

```
{ gpxIndex: number, reason: DropReason, stage: string }
```

### `correction.excludedFromTrust[]`

Points **kept in `fullOrderedPoints`** (UI sees them) but **omitted from `canonicalTrustedPoints`** (kinematic / smoothing does not). Each entry carries one or more reasons. No separate "masks" array — exclusion is the mask.

```
{ gpxIndex: number, reasons: ExcludedReason[], details?: object }
```

Reasons (extensible):

- `same_time_non_winner` — lost a kinematic competition (legacy, superseded by `insert_competition_loser`).
- `insert_competition_loser` — non-winner in a multi-candidate Insert competition.
- `exact_group_unresolved` — non-adjacent identical group, MVP flag-only.
- `cross_segment_duplicate` — same `timeMs` in different `trkSegIndex`, structurally displaced.
- `out_of_segment_scope` — proposal target landed outside segment envelope and was not an edge proposal.
- `edge_unresolved` — Phase 2 double-unstable; both edge proposals discarded.
- `overlap_block_member` — point belongs to a block that hit `overlap` status (no reorder).
- `coupling_blocked_subject` — kinematically sensitive proposal whose subject was blocked by coupling.
- `block_kinematic_guard_failed` — block-reorder socket-ok but kinematic guard failed; block not applied.
- `insert_kinematic_guard_failed` — insert length=1 kinematic guard failed; candidate not applied.
- `sampling_below_neighbour_baseline` — sampling story too weak vs neighbour window.
- `reversal_unconfirmed_member` — point inside a `segment_reversal_unconfirmed` segment.

### `correction.annotations[]`

*(Formerly `correction.sessionFlags[]` — renamed because the collection covers session, segment, and proposal scope, not session-only.)*

Annotations attached to the **session, segment, or proposal** — not to individual surviving canonical points. These are diagnostic / UX hints that do not change trust status by themselves.

```
{ scope: 'session' | 'segment' | 'proposal',
  scopeRef: { trkSegIndex?: number, proposalId?: string },
  kind: AnnotationKind,
  details?: object }
```

Kinds (extensible):

- Session-scope: `geometry-only`, `timestamp-sparse`.
- Segment-scope: `is_fully_reversed`, `segment_reversal_unconfirmed`, `chunk_ordering_resolved`, `duplicate_chunk_excluded`, `segment_boundary_gap`, `timestamp_discontinuity`, `edge_coupling_unstable`, `multipass_cap_hit`.
- Proposal-scope (overlap/coupling): `overlap_block`, `overlap_singleton_block_conflict`, `overlap_singleton_singleton_conflict`, `overlap_spine_pierce_detected`, `overlap_bracket_missing`, `block_internal_monotonicity_fail`, `coupled_same_time_deferred`, `coupled_reference_unstable`, `adjacent_duplicate_ele_mismatch`.
- Proposal-scope (kinematic guard outcomes): `block_reorder_kinematic_guard_failed`, `insert_kinematic_guard_failed`, `insert_competition_resolved`, `insert_competition_kinematic_guard_failed`.

Kinematic-outcome annotations carry `details.kinematics` with the `KinematicCheck` payload (speedPrevKph, speedNextKph, score, thresholdKph, passed, failReason) so downstream can audit the call without re-deriving geometry. See ADR-correction-0015.

A point can simultaneously be in `excludedFromTrust` and have its segment carry an annotation. The two collections answer different questions: trust (excludedFromTrust) vs context (annotations).

### What is removed from prior plans

- `correction.flags[]` — gone. Replaced by `annotations[]` (segment/proposal/session-scope) and `excludedFromTrust[]` (point-scope).
- `correction.masks[]` — gone. The mask **is** exclusion from `canonicalTrustedPoints`.
- `correction.sessionFlags[]` — renamed to `correction.annotations[]`.
- `correction.overlapVetoedProposalIds[]` and `couplingBlockedProposalIds[]` — still computed internally as runner state but encoded in each proposal's `applied` and `skipReason` fields rather than exported as top-level arrays.

---

## Correction-idle predicate (per-segment)

Per A9, `noCorrectionTemporalAnomalies` is evaluated **per segment**. The global short-circuit fires only when **all** segments are correction-idle. Each segment's predicate:

- `audit.temporal.perSegment[seg].belowAnchor` count is 0
- `audit.temporal.perSegment[seg].belowPrevValid` count is 0
- `audit.temporal.perSegment[seg].nonAdjacentRepeat` count is 0
- `audit.sampling.perSegment[seg].positiveTimeDeltaCount === audit.sampling.perSegment[seg].consecutiveTimestampPairsCount`
- No same-time different-coords groups within the segment

A segment with `correctionIdle === true` does not enter Phase 1's multipass loop.

A segment with `correctionIdle === false` enters Phase 1 and runs to terminal. After Phase 1 + Phase 2 + Phase 3, the predicate is recomputed once more per segment for export-time reporting.

---

## Time validity (A3)

`timeMs` must be **strictly positive** to be considered usable: `timeMs > 0`. A `timeMs === 0`, negative, or non-finite value is treated as `unparsable` by audit and never enters the correction usable-time set.

This refines the existing audit `unparsable` semantics; no schema change required.

---

## Spine intervals — operational rules

### First build

Built **after** the deterministic export fix phase completes. Building earlier would reference stale order (chunk reorder and duplicate-segment exclusion both mutate `workingOrderedPoints`).

### Per-segment scoping (locked)

Every spine interval entry carries `trkSegIndex`. No interval crosses a segment boundary — the boundary is treated as a hard wall, identical to a file end. Consumers (bracket selection, pierce-check, coupling disturbance zones, edge proposal detection) restrict spine queries to the originating proposal's segment.

### Re-derivation (mechanical only)

After each mutating `resolution-apply` (in Phase 1) or Phase 2 mutation: re-derive spine for the affected segment(s). The predicate (forward-monotonic + strictly positive Δt + non-cluster-member) is the only test. Two spine runs merge naturally when their interveners now satisfy the predicate.

The **cadence-similarity question** (does the gap between two merged runs match local sampling cadence?) is a downstream concern handled by the smoothing / kinematic-section layer — **not** the spine layer. The spine layer applies the predicate and stops.

### Per-segment minTimestampPairCoverageRatio

In addition to the global `minTimestampPairCoverageRatio` (default 0.8), each segment carries its own coverage ratio in its `SegmentParticipationProfile`. Segments below threshold have `mode: 'timestamp-sparse'` at segment scope; the segment's full multipass loop runs the participation-aware skip path.

---

## Per-segment eligibility (`segmentParticipationProfiles[]`)

Produced by `participation-check` from audit's per-segment slices. One entry per `trkSegIndex`:

```
SegmentParticipationProfile {
  trkSegIndex:                    number,
  mode:                           'geometry-only' | 'timestamp-sparse' | 'full' | 'fully-reversed',
  hasAnomalies:                   boolean,    // any per-segment belowAnchor / belowPrevValid
  hasUsableTimes:                 boolean,    // ≥2 usable timeMs
  coverageRatio:                  number,
  isFullyReversed:                boolean,
  spineEnvelope:                  { minTimeMs: number|null, maxTimeMs: number|null },
                                              // updated after any mutation to the segment
  iterationsRun:                  number,     // Phase 1 multipass iterations consumed
  exitReason:                     string|null // set when Phase 1 terminates for this segment
}
```

`spineEnvelope` is min/max of **spine points only** (not raw min/max of all points). Singletons and cluster members do not define the envelope; they are evaluated against it. Edge proposals (which would extend the envelope) are staged for Phase 2.

---

## Deterministic export fix phase (correction-owned classification)

Runs once, between reversal-check and the first spine build. Operates on `workingOrderedPoints` and consumes `audit.ingestion.segmentBoundaries[]` (raw observations) plus `audit.ingestion.segmentSummaries[]`. The classification logic that previously lived in audit's `export-fault-detection.js` lives **here** in correction.

### Boundary classification

For each entry in `audit.ingestion.segmentBoundaries[]`:

1. **`chunk_ordering`** — `next.firstTimeMs < curr.lastTimeMs` AND not a round-hour backward jump AND segment time ranges do **not** overlap (`next.maxTimeMs <= curr.minTimeMs` or similar). Resolution: schedule a chunk-reorder.
2. **`duplicate_chunk`** — backward boundary AND segment time ranges **overlap** (`next.minTimeMs < curr.maxTimeMs AND next.maxTimeMs > curr.minTimeMs`) AND not a round-hour backward jump. Resolution: exclude one segment (MVP: the later one in document order). If the overlap region is **100% identical** point-by-point between the two segments, drop the overlapped points from the later segment; if not 100% identical, exclude the entire later segment and add annotation `duplicate_chunk_excluded` (segment-scope) with diagnostic detail.
3. **`segment_boundary_gap`** (renamed from `missing_chunk_fault`) — `gapMs > 0`. **No threshold.** Every forward-gap boundary emits one. Resolution: pure observation. The correction layer does nothing; the renderer draws a straight line between segments. Includes `impliedDistanceM` and `impliedSpeedKph` for downstream UX context. (A8 — we cannot detect missing chunks, so we surface the gap and let UI show it.)
4. **`timestamp_discontinuity`** — backward boundary jump approximately equal to a whole number of hours (within `timezoneShiftTolerance`, default 0.1 fraction of an hour). MVP: flag only via annotation `timestamp_discontinuity` (segment-scope) with `suspectedTimezoneOffsetHours`; no automated correction (we cannot deterministically distinguish a DST shift from a chunk reorder without `rawTime` analysis, and `rawTime` is deferred).

A single boundary may carry only one of `chunk_ordering`, `duplicate_chunk`, `timestamp_discontinuity` (mutually exclusive). `segment_boundary_gap` is emitted independently for any forward gap regardless of the others (it is observational only).

### Apply order

1. Resolve all `chunk_ordering` classifications by sorting affected segments by their `minTimeMs` and reordering them in `workingOrderedPoints` in a single canonical pass. Log each in `correction.rearrangements` with `kind: 'segment-chunk-reorder'`.
2. Resolve all `duplicate_chunk` classifications by excluding the later segment's points. Add to `correction.drops` with reason `duplicate_chunk_segment`. Update `segmentParticipationProfiles[]` to mark excluded segments.
3. `timestamp_discontinuity` and `segment_boundary_gap` are flag-only.

After this phase: recompute correction-idle predicate per segment. If all segments are correction-idle, short-circuit to `correction-export`.

### Intra-segment timestamp violation

Reframed as a **per-segment audit observation**, not an export fault classification. Every `belowPrevValid` tagged in `audit.temporal.perSegment[seg]` is, by definition, an intra-segment timestamp violation. The correction layer reads these per-segment tags directly; no separate `intra_segment_timestamp_violation` classification is needed in the deterministic phase. (Per the locked decision to drop global belowAnchor/belowPrevValid in favor of per-segment tags only, this is the natural representation.)

---

## Block overlap: detection and diagnostics (MVP)

Per **A2**: in MVP, block overlap and block-splitting are **flag-only** — no splitting algorithm, no partial reorder. The block is flagged as a whole and left in place.

For each `block-finding` from `block-proposal`:

1. Read `gpxIndexes`. Compute `B_min`, `B_max`.
2. **Internal monotonicity:** if `internalMonotonicity === false` → `status: 'skipped-non-monotonic'`; emit annotation `block_internal_monotonicity_fail` (proposal-scope).
3. **Brackets:** select `prev` / `next` anchor (and `t_prev`, `t_next`) per versioned policy from `correction.spineIntervals` (segment-scoped) and outside-the-run rules. **Boundary brackets** that would reach a segment edge: convert the `block-finding` into an **edge proposal** (staged for Phase 2) instead of selecting a cross-segment bracket — segments are hard walls in Phase 1.
4. **Closed socket — numeric guard:** `B_min >= t_prev AND B_max <= t_next`.
5. **Structural socket guard (corridor pierce-check):** even when numeric passes, check whether `correction.spineIntervals` contains any spine point inside `(t_prev, t_next)` whose `gpxIndex` is not a member of the block. If so, `status: 'overlap'`; emit annotation `overlap_spine_pierce_detected` (proposal-scope).
6. **Overlap components** (observation-only): bracket / envelope violation, interval violation, equality / spine conflict, duplicate-time signal, bracket missing. Any → `status: 'overlap'`, emit annotation `overlap_block` (proposal-scope) with diagnostic details. Block members go to `excludedFromTrust` with reason `overlap_block_member`.
7. **`socket-ok` and not conflicting** → `status: 'socket-ok'`, emit `blockReorderPayload` for `resolution-apply`.
8. **Kinematic guard (socket-ok only):** After coupling check passes, compute `speedPrevKph` (prevAnchorPoint → block.firstPoint) and `speedNextKph` (block.lastPoint → nextAnchorPoint) using the bracket anchors. Score = speedPrevKph² + speedNextKph². If either speed exceeds `lenientMaxImpliedSpeedKph` (default 80 kph) → **do not apply**; emit annotation `block_reorder_kinematic_guard_failed` (proposal-scope) with `details.kinematics`; block member `gpxIndexes` → `excludedFromTrust` reason `block_kinematic_guard_failed`; proposal `applied: false`, `skipReason: 'kinematic_guard_failed'`. See ADR-correction-0015.

**MVP:** overlap regions are flagged + excluded; no reorder. Partial overlap = same treatment as full overlap. No splitting algorithm.

---

## Cross-proposal footprint mapping (overlap-detection scope)

Each proposal kind makes a temporal claim. Before any apply, `overlap-detection` derives each proposal's footprint and detects cross-kind collisions within the segment:

| Proposal kind | Temporal footprint |
|---|---|
| `block-finding` | `[B_min, B_max]` + bracket corridor `(t_prev, t_next)` |
| `insert` (isExactGroup=false) | `targetTimeMs` + bracket neighbour times as claimed corridor for each candidate |
| `insert` (isExactGroup=true) | `targetTimeMs` of exact group — flag-only, not active for apply gating |
| `adjacent-exact-drop` | No temporal footprint — no corridor claim. |

### MVP collision rules

- **Insert inside block envelope:** if `targetTimeMs` falls within `[B_min, B_max]` of any `block-finding` (regardless of socket status) → veto both via annotation `overlap_singleton_block_conflict` (proposal-scope). Block members + colliding insert candidate → `excludedFromTrust`.
- **Insert in bracket gap (outside block envelope):** valid; evaluated independently subject to its own gates.
- **Block envelope intersects insert competition region:** veto both via appropriate proposal-scope annotations.
- **Two inserts with overlapping corridors:** annotation `overlap_singleton_singleton_conflict` (proposal-scope); veto both unless one corridor strictly contains the other (versioned edge policy).

All collision detection is **segment-scoped**. Cross-segment footprint comparison does not occur in Phase 1 (segments are hard walls). Cross-segment edge interactions are Phase 2's job.

### MVP vs post-MVP

- MVP detects-and-vetoes cross-kind collisions per pass.
- Post-MVP recovery is implicit via per-segment multipass: a singleton vetoed on pass *k* by a block's overlap zone may become viable on pass *k+1* after `block-reorder` clears that zone. No dedicated cross-kind resolver needed.

---

## Reference stability and coupling (intra-segment)

### Coupling-detection: kinematic traversal neighbours

Kinematic checks in `singleton-proposal` and `duplicate-proposal` reference the **traversal-adjacent** points with usable `timeMs` on each side of the apply location, **within the same segment**. Gaps in spine between traversal-adjacent points are allowed.

`singleton-proposal` emits `tPrev`, `tNext`, `bracketGpxIndexes` in the proposal payload. `coupling-detection` reads these directly.

### Bilateral disturbance zones

Every proposal that moves, inserts, or removes a point creates disturbance on two sides:

- **Leaving side:** traversal neighbours of the moved/removed subject in current `workingOrderedPoints`.
- **Arriving side:** traversal neighbours at the destination after apply.

Any proposal whose kinematic traversal neighbours include a point in another proposal's disturbance zone is **coupling-blocked** on this pass.

### `adjacent-exact-drop` exception

Dropping a 100% exact adjacent duplicate produces a survivor that is geometrically identical. No disturbance zone is created. `adjacent-exact-drop` does not couple any other proposal.

### Symmetric blocking (revised)

`block-finding` (socket-ok) now has a kinematic guard (ADR-correction-0006 revised; ADR-correction-0015). Its kinematic reference points are its bracket anchors (`prevGpxIndex`, `nextGpxIndex`). If those anchors are in another proposal's disturbance zone, block-finding is **coupling-blocked** — computing the kinematic guard against unstable geometry produces unreliable results. `block-finding` now participates in `couplingBlockedProposalIds` on the same basis as `insert` proposals. The prior "asymmetric blocking" exception (block-finding coupling-blocked never) is revoked as of 2026-04-23.

### Independent computation

`coupling-detection` reads `correction.proposals[]`, `workingOrderedPoints`, and `correction.spineIntervals` only. It does **not** read overlap output. Both modules are independent computations on the same snapshot. Overlap-vetoed proposals still appear in disturbance-zone analysis — a proposal near an overlap-vetoed block may be coupling-blocked even though the block will not apply. Conservative + honest.

### Strictly intra-segment in Phase 1

Coupling never crosses `trkSegIndex` in Phase 1. The only cross-segment reference is via the staged-edge-proposal mechanism, which surfaces in Phase 2.

---

## Adjacent dedupe (A10)

### Initial pass (`objective-adjacent-dedupe`)

Stream-adjacent only. Operates on raw input snapshot before any mutation. Within one `trkSegIndex` only — does not cross segment boundaries (raw stream-adjacent pairs across a `<trkseg>` boundary cannot be recording duplicates).

### Per-pass rescan (`duplicate-proposal` `adjacent-exact-drop`)

**Traversal-adjacent** on current `workingOrderedPoints`. Within one `trkSegIndex` only in Phase 1.

**Cross-segment adjacent dedupe (A10):** Allowed in Phase 2 only — and only at a true segment boundary where S[i].lastPoint and S[i+1].firstPoint become traversal-adjacent across the boundary and satisfy the exact-duplicate predicate. If both points are spine-stable and identical (time + lat + lon + ele per ADR rules), drop one in Phase 2 with reason `adjacent-exact-duplicate` and `stage: 'edge-reconciliation'`. If either is unstable (has a staged edge proposal), no drop — defer to telemetry.

### Equality table (unchanged from prior plan)

| Situation | Action |
|---|---|
| Time, lat, lon, ele all exactly equal (incl. identical null/absent ele) | Drop one; `correction.drops` reason `adjacent-exact-duplicate`. |
| Both lack usable ele | Drop one; survivor keeps absent/null ele. |
| Exactly one usable ele | Drop the one without usable ele; survivor keeps in-band value. |
| Both finite ele but both out-of-bounds | Drop one; survivor `ele = null`. |
| Both have usable ele but values differ | No drop — annotation `adjacent_duplicate_ele_mismatch` (proposal-scope), both points kept. |

---

## Reversal-check

### Global reversal hypothesis

Cheap full-array reversal hypothesis. Accept iff the reversed snapshot satisfies the correction-idle predicate **for all segments**. Else revert; emit annotation `reversal_unconfirmed` (session-scope).

### Per-segment reversal

For each segment with `isFullyReversed: true` in its `SegmentParticipationProfile`:

1. Reverse the segment's point order within `workingOrderedPoints` (gpxIndex unchanged).
2. **Accept** iff:
   - Reversed segment is internally monotonic.
   - Reversed segment's new time range is consistent with neighbouring segments: `reversedSeg.minTimeMs >= prevSeg.maxTimeMs` and `reversedSeg.maxTimeMs <= nextSeg.minTimeMs` (equality allowed at seam).
3. Accepted: log in `correction.rearrangements` with `kind: 'segment-reversal'`; update `spineEnvelope`.
4. Rejected: revert; emit annotation `segment_reversal_unconfirmed` (segment-scope); affected `gpxIndexes` go to `excludedFromTrust` with reason `reversal_unconfirmed_member`.

Global reversal runs first; per-segment runs second on whatever remains. They are mutually exclusive in practice but both paths run sequentially without interference.

---

## Module catalog (correction layer)

### `participation-check.js`

| | |
|---|---|
| **Inputs** | `points`, `auditResult` (per-segment summaries, per-module per-segment slices, per-segment temporal tags). |
| **Outputs** | Global `participation` slice; `segmentParticipationProfiles[]` (runner-internal). |
| **Mutates** | No. |
| **Early exit** | If global mode allows full skip (correction-idle for all segments) → emit minimal handoff and return. |

**Mode evaluation (global and per-segment):**

```
IF parseableTimestampPointCount === 0
  → mode = 'geometry-only', reason = 'no-parseable-timestamps'

ELSE IF parseableTimestampPointCount > 0
         AND hasAnyPositiveTimeDelta === false
  → mode = 'geometry-only', reason = 'all-timestamps-uniform'
    (all usable timeMs are identical; no temporal ordering information)

ELSE IF coverageRatio < minTimestampPairCoverageRatio (default 0.8)
  → mode = 'timestamp-sparse', reason = 'insufficient-pair-coverage'

ELSE
  → mode = 'full'
```

Per-segment mode evaluation matches global: evaluate in the same order for each `trkSegIndex`. A segment can be `full` while another is `timestamp-sparse` or `geometry-only`.

### `objective-adjacent-dedupe.js`

| | |
|---|---|
| **Duty** | Stream-adjacent only on raw input; one trkSegIndex at a time; equality table above. |
| **Mutates** | Yes (drops). |
| **Early exit** | After mutation, recompute per-segment correction-idle predicate. If all segments idle → skip downstream. |

### `reversal-check.js`

| | |
|---|---|
| **Duty** | Global full-array reversal hypothesis; per-segment reversal for `isFullyReversed` segments. |
| **Mutates** | Yes (reorder when accepted). |
| **Early exit** | Recompute per-segment correction-idle. If all segments idle → skip downstream. |

### `deterministic-export-fix.js` (NEW — replaces audit's classification)

| | |
|---|---|
| **Duty** | Classify each entry in `audit.ingestion.segmentBoundaries[]` into `chunk_ordering` / `duplicate_chunk` / `segment_boundary_gap` / `timestamp_discontinuity` / none. Apply chunk reorder and duplicate-segment exclusion. Flag-only for boundary-gap and timestamp-discontinuity. |
| **Mutates** | Yes (chunk reorder; duplicate-segment exclusion via drops). |
| **Early exit** | After mutation, recompute per-segment correction-idle. If all segments idle → skip downstream. |

### `spine-intervals.js`

| | |
|---|---|
| **Duty** | Compute per-`trkSegIndex` `correction.spineIntervals` from current `workingOrderedPoints`. Predicate: forward-monotonic + strictly positive Δt + non-cluster-member, within one segment. |
| **Mutates** | No. |
| **Called** | First time after deterministic export fix. Re-derived after each mutating apply in Phase 1 and after each Phase 2 mutation. |

### `block-proposal.js`

| | |
|---|---|
| **Duty** | Emit `block-finding` for each maximal contiguous `belowAnchor` run within one `trkSegIndex`. Compute `internalMonotonicity`. Mark proposal as edge proposal if `[B_min, B_max]` extends the segment's `spineEnvelope` on either side. |
| **Mutates** | No. |
| **Scope** | Per-segment. Skipped for segments with `hasAnomalies: false`. |

### `singleton-proposal.js`

| | |
|---|---|
| **Duty** | Non-duplicate backtrack candidates. Sampling vs gpxIndex window; emit `insert` proposal (`isExactGroup: false`, `candidates.length === 1`) with `targetTimeMs`, candidate `tPrev`, `tNext`, `bracketGpxIndexes` (segment-bounded). Kinematic check computed here and embedded in candidate payload; guard disposition (gating) evaluated in `resolution-apply`. Mark as edge proposal if `targetTimeMs` would land at segment's first or last spine slot. |
| **Mutates** | No. |
| **Scope** | Per-segment. |

### `duplicate-proposal.js`

| | |
|---|---|
| **Duty (per pass)** | Traversal-adjacent rescan for `adjacent-exact-drop` (within segment); emit `insert` proposals for same-`timeMs`-different-coords competition groups (`isExactGroup: false`, `candidates.length ≥ 2`) with per-candidate kinematic payloads; emit `insert` proposals with `isExactGroup: true` for non-adjacent identical groups (MVP = flag-only, `applied: false`). Cross-segment same-time → `cross_segment_duplicate` (excludedFromTrust, no proposal). |
| **Mutates** | No. |
| **Scope** | Per-segment competition pools. Phase 2 handles cross-segment adjacent dedupe. |

### `overlap-detection.js`

| | |
|---|---|
| **Duty** | Cross-proposal footprint mapping (segment-scoped). Block path first: brackets, numeric socket, pierce-check; emit `overlapBlockResolution`. Then cross-kind collision detection. Emit `overlapVetoedProposalIds` (internal runner state) and proposal-scope annotations. |
| **Mutates** | No. |
| **Scope** | Per-segment proposal set. |

### `coupling-detection.js`

| | |
|---|---|
| **Duty** | Compute bilateral disturbance zones; build coupling edges; form coupled regions; emit `couplingBlockedProposalIds` and `independentProposalIds`. Kinematic reference points for `block-finding` = its bracket anchors (`prevGpxIndex`, `nextGpxIndex`); for `insert` proposals = `bracketGpxIndexes` in candidate payload. All proposal kinds with kinematic references participate symmetrically in coupling. Strictly intra-segment in Phase 1. |
| **Mutates** | No. |

### `resolution-apply.js`

| | |
|---|---|
| **Duty** | AND gate: `applyable = proposals \ overlapVetoed \ couplingBlocked`. For `block-finding` socket-ok proposals that pass the gate: run kinematic guard before apply (speedPrev² + speedNext² metric; 80 kph per-speed threshold; fail → do not apply; block members → excludedFromTrust `block_kinematic_guard_failed`; annotation `block_reorder_kinematic_guard_failed`). For `insert` length=1 proposals: run kinematic guard; fail → do not apply; candidate → excludedFromTrust `insert_kinematic_guard_failed`; annotation `insert_kinematic_guard_failed`. For `insert` length≥2 non-exact: select winner by kinematic score (lowest sum-of-squares among passers; lowest-`gpxIndex` tiebreak; fallback to lowest score if all fail). Apply all remaining in deterministic order: block-reorder → insert (winner) → adjacent-exact-drop (descending `dropGpxIndex`). Append `rearrangements` with `passIndex` and `trkSegIndex`. |
| **Mutates** | Yes — only mutator besides early stages and Phase 2. |
| **Post-apply** | Recompute spine for affected segment; recompute that segment's correction-idle. If true → exit segment's Phase 1 loop. |

### `edge-reconciliation.js` (NEW — Phase 2)

| | |
|---|---|
| **Duty** | Pairwise pass over adjacent boundaries; resolve staged edge proposals against neighbour stability per the table in **§ Phase 2**. |
| **Mutates** | Yes (single pass, no re-trigger of Phase 1). |
| **Outputs** | Append to `rearrangements`; flag `edge_coupling_unstable` for double-unstable pairs. |

### `residual-diagnostic-sweep.js` (NEW — Phase 3)

| | |
|---|---|
| **Duty** | Read-only scan over final `workingOrderedPoints` for any traversal-adjacent backward time pairs; aggregate by intra-segment vs cross-segment. |
| **Mutates** | No. |
| **Outputs** | `correction.diagnostics.residualTemporalAnomalies[]`. |

### `correction-export.js`

| | |
|---|---|
| **Duty** | Build `fullOrderedPoints`, `excludedFromTrust`, `canonicalTrustedPoints`. Finalize `correction` profile with `drops`, `excludedFromTrust`, `annotations`, `rearrangements`, `multipass.perSegment[]`, `diagnostics`. Set `applied` and `skipReason` on each proposal record. Validate partition invariant. |
| **Mutates** | No (read final snapshot). |

---

## `correctionRunner` orchestration

```
correctionRunner({ points, auditResult }):

  // === Pre-segment phase ===
  participationProfile, segmentProfiles = participation-check(points, auditResult)

  if all segmentProfiles correction-idle AND product allows full skip:
    return minimal-handoff(points)

  workingOrderedPoints = copy(points)
  multipassMaxIterations = profile.multipassMaxIterations  // default 500

  objective-adjacent-dedupe(workingOrderedPoints)
  recompute per-segment correction-idle
  if all idle: jump to correction-export

  reversal-check(workingOrderedPoints, segmentProfiles)
  recompute per-segment correction-idle
  if all idle: jump to correction-export

  deterministic-export-fix(workingOrderedPoints,
                           audit.ingestion.segmentBoundaries,
                           audit.ingestion.segmentSummaries)
  recompute per-segment correction-idle
  if all idle: jump to correction-export

  spineIntervals = spine-intervals(workingOrderedPoints)  // first build

  // === Phase 1 — per-segment terminal solve ===
  stagedEdgeProposals = {}
  FOR seg in segmentProfiles ordered by trkSegIndex ASC:
    if seg.correctionIdle: continue
    iter = 0
    LOOP:
      iter++
      if iter >= multipassMaxIterations:
        seg.exitReason = 'max-iterations'
        break

      // block-proposal → block-finding proposals
      // singleton-proposal → insert proposals (length=1, isExactGroup=false)
      // duplicate-proposal → adjacent-exact-drop + insert proposals (competition or isExactGroup)
      proposals = block-proposal(seg) ∪ singleton-proposal(seg) ∪ duplicate-proposal(seg)

      // scope gate (intra-segment only at this point)
      for p in proposals:
        if p targets outside seg.spineEnvelope:
          if p is edge proposal:
            stagedEdgeProposals[seg.trkSegIndex].add(p)
            remove p from proposals
          else:
            mark p out_of_segment_scope; add subject to excludedFromTrust;
            remove p from proposals

      if proposals empty:
        seg.exitReason = 'no-proposals'
        break

      overlapResult = overlap-detection(proposals, spineIntervals[seg])
      couplingResult = coupling-detection(proposals, workingOrderedPoints, spineIntervals[seg])

      applyable = proposals \ overlapResult.vetoed \ couplingResult.blocked

      if applyable empty:
        seg.exitReason = 'stalemate'
        break

      // resolution-apply: kinematic guard on block-finding + insert length=1 before apply;
      // competition winner selection for insert length≥2; adjacent-exact-drop no guard
      resolution-apply(applyable, workingOrderedPoints, spineIntervals[seg])
      append rearrangements (with passIndex=iter, trkSegIndex=seg.trkSegIndex)
      spineIntervals[seg] = spine-intervals(workingOrderedPoints, seg)
      recompute seg.correctionIdle
      if seg.correctionIdle:
        seg.exitReason = 'correction-idle'
        break

      if applyable == proposals (full set applied):
        // verification pass
        rebuilt = block-proposal(seg) ∪ singleton-proposal(seg) ∪ duplicate-proposal(seg)
        // (scope-gate again; overlap + coupling; do NOT apply)
        if rebuilt empty:
          seg.exitReason = 'idle'
          break
        // else: continue loop
    // end LOOP
    seg.iterationsRun = iter
  // end FOR

  // === Phase 2 — edge reconciliation ===
  FOR boundary (S[i], S[i+1]) in ascending order:
    edge-reconciliation(stagedEdgeProposals[i].lastEdge,
                       stagedEdgeProposals[i+1].firstEdge,
                       workingOrderedPoints,
                       spineIntervals)
    // append rearrangements with stage='edge-reconciliation';
    // unresolvable double-unstable pairs → annotation edge_coupling_unstable (segment-scope);
    // affected points → excludedFromTrust reason edge_unresolved
  // re-derive spine for any segment that was mutated by Phase 2

  // === Phase 3 — global residual diagnostic sweep ===
  diagnostics = residual-diagnostic-sweep(workingOrderedPoints)
  // observational only

  // === Export ===
  return correction-export(workingOrderedPoints, drops, excludedFromTrust,
                          annotations, rearrangements, segmentProfiles,
                          proposals, multipass-stats, diagnostics)
```

---

## Output shape (MVP)

```js
{
  correction: {
    profile: {
      profileId: string,
      algorithmVersion: string,
      parameters: {
        minTimestampPairCoverageRatio: 0.8,   // global coverage gate
        lenientMaxImpliedSpeedKph: 80,        // kinematic guard ceiling (per-speed, not score)
        multipassMaxIterations: 500,          // per-segment safety net
        timezoneShiftTolerance: 0.1           // fraction-of-hour tolerance for DST detection
      }
    },
    participation: {
      mode: 'geometry-only' | 'timestamp-sparse' | 'full',
      coverageRatio: number,
      reasons: string[]
    },
    segmentProfiles: [
      {
        trkSegIndex: number,
        mode: string,
        coverageRatio: number,
        hasAnomalies: boolean,
        isFullyReversed: boolean,
        spineEnvelope: { minTimeMs, maxTimeMs },
        correctionIdle: boolean,
        iterationsRun: number,
        exitReason: 'idle'           // all applied + verification pass empty
                  | 'stalemate'      // proposals exist but all gated
                  | 'no-proposals'   // no proposals emitted this pass
                  | 'correction-idle'// correctionIdle predicate true after apply
                  | 'max-iterations' // safety cap hit (defect signal)
                  | null             // segment not yet terminal (should not appear at export)
      }
    ],
    spineIntervals: [
      { trkSegIndex: number, fromGpxIndex: number, toGpxIndex: number }
    ],
    multipass: {
      maxIterations: number,
      perSegment: { [trkSegIndex]: { iterationsRun, exitReason, passLog? } }
    },
    proposals: [
      // block-finding: emitted by block-proposal.js
      { id, kind: 'block-finding',
        trkSegIndex: number,
        isEdgeProposal?: boolean,
        applied: boolean,
        skipReason?: 'kinematic_guard_failed' | 'overlap_vetoed' | 'coupling_blocked' | 'edge_unresolved',
        // blockReorderPayload, internalMonotonicity, bracketGpxIndexes, etc.
      },
      // insert: unified kind (replaces singleton-insert, duplicate-reorder, exact-group-flag-only)
      { id, kind: 'insert',
        trkSegIndex: number,
        isEdgeProposal?: boolean,
        isExactGroup: boolean,         // geometry-identical → no kinematic check; MVP = flag-only
        targetTimeMs: number,
        candidates: [                  // length=1: single-subject; length≥2: competition
          { gpxIndex, lat, lon, tPrev?, tNext?, bracketGpxIndexes?, kinematics? }
        ],
        winner?: { gpxIndex, ... },    // set if applied=true
        applied: boolean,
        skipReason?: 'kinematic_guard_failed' | 'overlap_vetoed' | 'coupling_blocked' | 'edge_unresolved',
      },
      // adjacent-exact-drop: emitted by duplicate-proposal.js
      { id, kind: 'adjacent-exact-drop',
        trkSegIndex: number,
        dropGpxIndex: number,
        survivorGpxIndex: number,
        applied: boolean,
      }
    ],
    overlapApplication: {
      // vetoedProposalIds is internal runner state; encoded in proposal.skipReason at export
      overlapBlockResolution: [
        { findingId, status, tPrev?, tNext?, bMin?, bMax?,
          prevGpxIndex?, nextGpxIndex?, blockReorderPayload? }
      ]
    },
    coupling: {
      // independentProposalIds / couplingBlockedProposalIds are internal runner state;
      // encoded in proposal.skipReason at export
      coupledRegions: [
        { proposalIds, gpxIndexes, edges: [
            { blockedProposalId, disturbanceSourceId, disturbedGpxIndex, side }
          ], reason }
      ]
    },
    rearrangements: [
      // includes: full-reversal, segment-reversal, segment-chunk-reorder,
      //          block-reorder, insert (singleton or competition winner),
      //          adjacent-exact-drop
      { kind, passIndex, trkSegIndex, gpxIndexes, stage, ... }
    ],
    drops: [
      { gpxIndex, reason: DropReason, stage }
    ],
    excludedFromTrust: [
      { gpxIndex, reasons: ExcludedReason[], details? }
    ],
    annotations: [
      { scope: 'session' | 'segment' | 'proposal',
        scopeRef: { trkSegIndex?, proposalId? },
        kind: AnnotationKind,
        details? }
    ],
    diagnostics: {
      residualTemporalAnomalies: [
        { trkSegIndex?, fromTrkSegIndex?, toTrkSegIndex?,
          gpxIndexes, kind: 'intra-segment-below-prev' | 'intra-segment-below-anchor'
                          | 'cross-segment-below-prev' | 'cross-segment-below-anchor' }
      ]
    },
    fullOrderedPoints: [ /* same objects as final working snapshot, drops removed */ ],
    excludedFromTrustResolved: [ /* gpxIndex set, mirroring excludedFromTrust for fast lookup */ ]
  },
  canonicalTrustedPoints: [ /* fullOrderedPoints \ excludedFromTrust */ ]
}
```

---

## Handoff: pre-split lists (dumb downstream)

Correction-export does the partition once:

| Field | Role |
|---|---|
| `canonicalTrustedPoints` | Default input for kinematic correction, smoothing, metrics. Consecutive entries are polyline vertices for "trusted" work. Time-conditioned eligibility joins `audit` + per-segment participation. |
| `correction.fullOrderedPoints` | Full traversal after correction (drops removed), including untrusted rows. UX: single ordered trace, grey segments, tooltips. |
| `correction.excludedFromTrust` | Correction-layer outcomes only (point-scope exclusions). Does **not** duplicate audit ingestion rejections or audit temporal missing/unparsable. |
| `correction.drops` | Indices removed from both lists. |
| `correction.annotations` | Session/segment/proposal-scope annotations (renamed from `sessionFlags`). |
| `audit.ingestion.rejections` | Never in pipeline arrays; UI joins for rejected-row provenance. |

**Partition sanity (accepted ingest only):** for every `gpxIndex` in `points` at correction input, exactly one of:
- `gpxIndex ∈ correction.drops` (absent from `fullOrderedPoints`), or
- `gpxIndex ∈ canonicalTrustedPoints` (in `fullOrderedPoints`, not in `excludedFromTrust`), or
- `gpxIndex ∈ excludedFromTrust` (in `fullOrderedPoints`, not in `canonicalTrustedPoints`).

Ingestion-rejected indices are not in `points`; they appear only in audit + UI merge.

---

## Waypoints and routes (C4)

`audit.waypoints[]` and `audit.routes[]` are forwarded **directly** from audit to the rendering layers, bypassing correction. Correction does not mutate them. Each entry carries a per-element validity flag set by ingestion. Renderers decide whether to draw based on the flag. They never receive `gpxIndex`; correction's `gpxIndex`-keyed structures (`workingOrderedPoints`, `spineIntervals`, proposals, `drops`, `excludedFromTrust`) operate exclusively on the trkpt `points[]` array.

---

## Audit module table (post-segmentation reference)

Canonical implementations under `packages/audit/pipeline/`. Per-segment slices added to each module's output.

| Module | File | Per-segment additions |
|---|---|---|
| **Ingestion** | `gpx-ingestion-module.js` | `audit.ingestion.segmentSummaries[]` (with boundary coords); `audit.ingestion.segmentBoundaries[]` (raw observations only — no classification). |
| **Temporal** | `timestamp-audit.js` | `audit.temporal.perSegment[trkSegIndex]` with point-level tag counts (`belowAnchor`, `belowPrevValid`, `adjacentDuplicate`, `nonAdjacentRepeat`, `missing`, `unparsable`). Tags are segment-scoped (e.g. `belowAnchor` = below the rolling anchor within the segment). No global belowAnchor / belowPrevValid arrays. |
| **Sampling** | `sampling-audit.js` | `audit.sampling.perSegment[trkSegIndex]` with per-segment `consecutiveTimestampPairsCount`, `positiveTimeDeltaCount`, Δt clustering metadata. Distance: same. |
| **Motion** | `motion-audit.js` | `audit.motion.perSegment[trkSegIndex]` with pair-level tag counts. |
| **Elevation** | `elevation-audit.js` | `audit.elevation.perSegment[trkSegIndex]` with point-level tag counts. |
| **Audit export** | `audit-export-module.js` | Assembles per-segment slices into the audit payload. |

**Removed from audit:** `export-fault-detection.js` no longer classifies. Its segment-summary work is folded into ingestion. Its boundary observations become `audit.ingestion.segmentBoundaries[]`. The classification logic moves to the correction layer's `deterministic-export-fix.js`.

---

## Multipass diagnostics (recommended)

Per segment, log per iteration:

- `passIndex`, `proposalIds`, `applyableIds`, `appliedProposalIds`, `overlapVetoedCount`, `couplingBlockedCount`.
- Per-segment `iterationsRun` and `exitReason`.

Phase 1 verification-pass entries logged with `verificationOnly: true` and `appliedProposalIds: []`.

This is not an invariant that proposal cardinality must shrink monotonically — it is a safety net for non-determinism hunts and regression debugging.

---

## Performance and architecture (expectations)

- **Upload latency:** Each stage is O(n) or O(n × small window) on point count. Per-segment multipass is O(segments × max-iterations × per-segment-work). With `multipassMaxIterations = 500` as a safety net (real exits at idle/stalemate happen in 1–10 passes), overhead is acceptable for MVP. Optimize only if profiling shows a problem.
- **Architecture:** Explicit pipeline with three phases. Pre-split export keeps downstream simple.
- **ES modules:** D2 — transition from CommonJS to ES modules is low-cost (mechanical: `function foo` → `export function foo`, `require` → `import`, `"type": "module"` in package.json, jest/vitest config tweak). Defer until convenient; not a one-way door, not blocking MVP.

---

## Documentation

### Correction ADRs (split by scope)

- **Cross-cutting branch scope:** `docs/adr/general/0005-post-audit-correction-branch-scope.md` — audit vs correction boundary, observation-only audit (now strengthened by classification moving out of audit), versioned correction.
- **Correction-layer decisions (MVP):** `docs/adr/correction/README.md` — indexed ADRs. Required updates / additions:
  - **0006** (bracket/socket/pierce-check/block-reorder kinematic guard) — **revised 2026-04-23**: kinematic guard added for block-reorder; prior "no kinematic for block path" revoked. See ADR-correction-0015.
  - **0009** (cross-proposal footprint) — segment-bounded.
  - **0010** (coupling kinematic reference stability) — **revised 2026-04-23**: asymmetric blocking exception revoked; block-finding now coupling-blockable via its bracket anchor references. Symmetric blocking model adopted.
  - **0011** — three-phase pipeline; per-segment terminal solve; edge reconciliation; residual diagnostic sweep.
  - **0012** — schema cleanup: drops, excludedFromTrust, annotations; unified `insert` proposal kind; `applied`/`skipReason` on proposals; deprecation of `flags[]`, `masks[]`, `sessionFlags[]`.
  - **0013** — boundary classification ownership (deterministic export fix in correction; audit emits raw `segmentBoundaries[]` only).
  - **0014** — traversal-adjacent vs stream-adjacent dedupe primitive; traversal-adjacent is canonical.
  - **0015** — kinematic guard disposition: gating for single-subject (block-reorder, insert length=1); advisory-with-fallback for multi-candidate competition (insert length≥2); sum-of-squares score metric; 80 kph lenient ceiling.

### Audit pipeline module docs

- `docs/project/pipeline/gpx-ingestion-module.md` — update for `segmentBoundaries[]` (raw observations); remove classification language.
- `docs/project/pipeline/export-fault-detection.md` — **deprecate** as audit module doc; replace with `docs/project/pipeline/deterministic-export-fix.md` under correction.
- All audit module docs: add per-segment slice schemas.

`implementation_plan.md` (this file) is the operational spec. ADRs record decisions, rejected alternatives, and rationale.

---

## Verification plan

### Adversarial fixtures (rewrite from scratch per D4)

Existing audit tests are weak and miss edge cases. The verification suite is rewritten with synthetic GPX fixtures that exercise the per-segment + edge-reconciliation pipeline end-to-end.

#### Audit-layer fixtures (per-segment emission)

- Multi-segment fixture with mixed `belowAnchor` / `belowPrevValid` distribution → verify per-segment tag aggregates match expected counts; no global tag arrays.
- Boundary-only fixtures → verify `audit.ingestion.segmentBoundaries[]` emits one entry per boundary with correct `gapMs`, `impliedDistanceM`, `impliedSpeedKph` (Haversine); no classification fields.

#### Pre-segment phase

- Correction-idle at participation (per-segment all-clear) → skip correction.
- Adjacent dupes 100% identical → one drop logged with `stage: 'objective-adjacent-dedupe'`.
- All-identical timestamps → no false reversal; geometry-only path.
- Envelope-candidacy reversal accept / revert based on per-segment correction-idle on reversed snapshot.
- Per-segment `isFullyReversed` accept / revert with neighbour consistency check.

#### Deterministic export fix

- `chunk_ordering` boundary → segments reordered; logged with `kind: 'segment-chunk-reorder'`.
- `duplicate_chunk` boundary, 100% identical overlap → overlap region dropped from later segment; rest of later segment retained.
- `duplicate_chunk` boundary, non-identical overlap → entire later segment excluded (drops + annotation `duplicate_chunk_excluded`).
- `segment_boundary_gap` → flagged on every forward gap regardless of size; impliedDistance/Speed populated.
- `timestamp_discontinuity` (round-hour backward) → flagged with `suspectedTimezoneOffsetHours`; no auto-correction.

#### Phase 1 (per-segment terminal solve)

- Block-finding internal monotonicity true / false paths.
- Block socket-ok in middle of segment → `block-reorder` applied.
- Block at segment edge → staged as edge proposal, not applied in Phase 1.
- Singleton mid-segment → applied subject to overlap + coupling gates.
- Singleton at segment edge → staged as edge proposal.
- Block + singleton overlap (singleton inside `[B_min, B_max]`) → both vetoed; both excludedFromTrust.
- Two singletons with overlapping corridors → both vetoed.
- Spine pierce-check: numeric socket passes but spine point sits in corridor → block status `overlap`; annotation `overlap_spine_pierce_detected`.
- Block socket-ok kinematic guard: speedPrev or speedNext exceeds 80 kph → block not applied; annotation `block_reorder_kinematic_guard_failed`; block members → excludedFromTrust.
- Insert length=1 kinematic guard fail → not applied; annotation `insert_kinematic_guard_failed`; candidate → excludedFromTrust.
- Insert length≥2 competition → winner selected by lowest sum-of-squares score; annotation `insert_competition_resolved` or `insert_competition_kinematic_guard_failed`; losers → excludedFromTrust `insert_competition_loser`.
- Coupling: insert's kinematic neighbour is a block's leaving-side disturbance point → insert coupling-blocked. Block's bracket anchor is a singleton's disturbance point → block coupling-blocked (symmetric).
- Adjacent-exact-drop has no disturbance zone → does not couple.
- Stalemate exit when proposals exist but all gated.
- Idle exit when full proposal set applied + verification pass empty.
- Multipass cap hit → exit `max-iterations`; annotation `multipass_cap_hit` (segment-scope).
- Correction-idle short-circuit at any per-segment recomputation point.

#### Phase 2 (edge reconciliation)

- S[i].lastEdge stable, S[i+1] has staged singleton edge → singleton resolves against S[i].lastTime.
- S[i] has staged edge, S[i+1].firstEdge stable → symmetric.
- Both edges staged → `edge_coupling_unstable`; both staged proposals discarded; affected points excludedFromTrust with reason `edge_unresolved`.
- Cross-segment adjacent dedupe: S[i].lastPoint == S[i+1].firstPoint, both spine-stable → drop one in Phase 2.
- Phase 2 mutation creates new interior anomaly → does NOT re-trigger Phase 1; surfaces in Phase 3.

#### Phase 3 (residual diagnostic sweep)

- `4 5 6 1 | 2 3 7 8 9` cross-segment block → Phase 1 + Phase 2 do nothing; Phase 3 logs cross-segment-below-anchor entries.
- Intra-segment residual after a Phase 2 mutation → Phase 3 logs intra-segment entry.

#### Schema

- `drops`, `excludedFromTrust`, `annotations` are the only output collections; no `flags[]`, `masks[]`, or `sessionFlags[]` produced.
- Partition sanity: every accepted gpxIndex appears in exactly one of drops / canonicalTrustedPoints / excludedFromTrust.
- Every `insert` proposal has `isExactGroup` and `candidates[]` populated; `kind` is never `singleton-insert`, `duplicate-reorder`, or `exact-group-flag-only`.
- Kinematic guard annotation `details.kinematics` is present for every `block_reorder_kinematic_guard_failed`, `insert_kinematic_guard_failed`, `insert_competition_resolved`, `insert_competition_kinematic_guard_failed` annotation.
- No proposal with `applied: true` has a `skipReason`.
- No proposal with `skipReason: 'kinematic_guard_failed'` has `applied: true`.

### Regression check

Existing audit adversarial suite is **not** preserved as-is — it tested the global-tag model. Rewrite the audit suite to test per-segment emission. Correction is additive and does not mutate the first-pass audit payload.

---

## Open items / explicit deferrals

- **`rawTime` capture** — deferred. Re-extend audit if post-MVP DST analysis becomes worthwhile.
- **Cross-segment block reorder** (e.g. `4 5 6 1 | 2 3 7 8 9` patterns) — MVP does nothing; Phase 3 surfaces residuals; design decision deferred until telemetry confirms real-world prevalence.
- **Block splitting algorithm** — deferred per A2; MVP is flag-only.
- **Cadence-similarity gap annotation** — belongs to downstream smoothing layer, not the spine layer in correction.
- **ES modules transition** — deferred per D2; not blocking.
- **Lenient kinematic ceiling default** — versioned parameter (`lenientMaxImpliedSpeedKph`, MVP default 80 km/h); refine after telemetry.
- **Quality levels (UX-facing `qualityLevel`)** — MVP emits numeric `coverageRatio` only.

---

## Post-MVP exploration (backlog)

- Cross-segment block reorder design (driven by Phase 3 residual telemetry).
- Block overlap resolution (split, smaller chunk insertions, partial overlap kinematic salvage).
- Non-adjacent 100% duplicate spine-aware collapse.
- `rawTime`-aware DST/timezone classification with deterministic correction.
- Cross-kind cross-segment overlap resolution (only after the simpler per-segment + edge-reconciliation MVP collects telemetry).
- Section-level (intra-segment) participation modes for stitched GPX with mixed regions.
- Migration of correction package (and audit) to ES modules.
- Kinematic smoothing ADR: formal segment / allowed-adjacency graph from `gpxIndex` gaps + `excludedFromTrust` + downstream kinematic-correction output.
- Offline A/B on coupling-detection sensitivity, kinematic checks, and annotation taxonomy (kinds and score thresholds).
