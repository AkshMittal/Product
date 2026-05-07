# ADR-correction-0011: Three-phase pipeline — per-segment terminal solve, edge reconciliation, residual diagnostic sweep

**Date**: 2026-04-23  
**Status**: accepted

## Context

The correction layer must handle temporal anomalies (backtrack blocks, singletons, duplicate-time groups) within and across segment (`<trkseg>`) boundaries. Two design tensions drove the pipeline shape:

1. **Intra-segment vs cross-segment coupling:** Correction decisions within one segment depend on that segment's own spine intervals and proposal neighbourhood. Allowing cross-segment references during per-segment solve introduces order dependencies and potentially circular blocking (a segment cannot resolve because its edge is waiting on a neighbour that is also waiting). Solving each segment to a stable terminal state before looking at boundaries eliminates this class of bugs.

2. **Boundary handling without cascades:** Boundary cases (a singleton or block that sits at a segment's first or last spine point and would change the segment's time envelope) cannot be resolved with reference to only one segment's state. But resolving them mid-phase-1 would require re-running the solved segment. A single post-phase-1 edge reconciliation pass resolves boundary cases once, cleanly, without re-triggering per-segment loops.

3. **Residual visibility:** After correction, residual temporal anomalies may remain (cross-segment blocks the per-segment solver cannot touch; anomalies introduced by Phase 2 mutations). These must be observable for telemetry and future extension without acting on them — a separate read-only diagnostic sweep is the right tool.

## Decision

The correction layer runs in **three phases**, executed in strict order after the pre-segment phase (participation-check, objective-adjacent-dedupe, reversal-check, deterministic-export-fix, first spine build):

### Phase 1 — per-segment terminal solve

Segments are processed in **ascending `trkSegIndex` order**. Each segment runs its own multipass loop until it reaches a **terminal state**:

| Exit reason | Condition |
|---|---|
| `idle` | All proposals applied on this pass; verification pass emits zero proposals. |
| `stalemate` | Proposals exist but all are gated (overlap-vetoed and/or coupling-blocked). |
| `no-proposals` | Proposal modules emit nothing for this segment on this pass. |
| `correction-idle` | Segment's `correctionIdle` predicate becomes true after a `resolution-apply`. |
| `max-iterations` | `iterationsRun >= multipassMaxIterations` (safety net; target exit is idle/stalemate). |

**`multipassMaxIterations` is locked at 500** (per segment). Hitting this cap is a defect signal, not a normal exit. It is logged in `correction.multipass.perSegment[trkSegIndex].exitReason` with `max-iterations`.

**Coupling scope in Phase 1:** strictly intra-segment. Disturbance zones, kinematic traversal neighbours, and spine queries never cross `trkSegIndex`. Edge proposals (those that would alter the segment's spine envelope) are **staged** in `correction.stagedEdgeProposals[trkSegIndex]` and not applied.

The next segment does not begin until the current segment exits Phase 1.

### Phase 2 — edge reconciliation

Runs **once**, as a single pairwise pass over adjacent segment boundaries in ascending order, after **all** segments have reached Phase 1 terminal.

For each boundary between S[i] and S[i+1]:

1. Determine neighbour stability on each side: a boundary point is **stable** iff it is on the spine AND has no staged edge proposal pending.
2. Resolve per the stability matrix:

| S[i] last stable? | S[i+1] first stable? | Action |
|---|---|---|
| Yes | Yes | No-op. |
| Yes | No | Evaluate S[i+1].firstEdge against S[i].lastSpinePoint as neighbour reference. Apply if seam check passes. |
| No | Yes | Symmetric. |
| No | No | **Double-unstable.** Flag `edge_coupling_unstable` (annotation, segment-scope). Both staged proposals discarded; their subjects → `excludedFromTrust` reason `edge_unresolved`. |

**A Phase 2 mutation does not re-trigger Phase 1** for the affected segment. This is a deliberate MVP simplification; cascading Phase 1 ↔ Phase 2 introduces convergence problems that cannot be reasoned about without real data. Anomalies introduced by Phase 2 mutations surface in Phase 3.

Spine is re-derived for any segment mutated by Phase 2.

### Phase 3 — global residual diagnostic sweep

Read-only scan over final `workingOrderedPoints` after Phase 2:

- For every traversal-adjacent pair `(prev, curr)` with both `timeMs` finite: check `curr.timeMs >= prev.timeMs`.
- For every point: check it is not below any previously-seen rolling max of timestamps.
- Aggregate violations by intra-segment vs cross-segment.

Output: `correction.diagnostics.residualTemporalAnomalies[]`. Phase 3 **never mutates state** and **never gates apply decisions**. Its purpose is to surface patterns the per-segment + edge-reconciliation pipeline missed, so future MVP+ extension can be informed by real-data telemetry.

### Cross-segment block exception (N5)

If a block physically spans a segment boundary (e.g. structure `4 5 6 1 | 2 3 7 8 9` where misplaced sub-runs straddle the boundary), the per-segment solver treats the boundary as a hard wall and runs to terminal within each segment independently. Phase 2 only resolves edge proposals, not full-block reorders spanning boundaries. Such structures surface in Phase 3 as residual cross-segment signals. **MVP does nothing about them.** Design decision deferred until telemetry confirms real-world prevalence.

## Alternatives Considered

### Alternative 1: Global single-pass solver

Run all segments together in a shared multipass loop, allowing cross-segment coupling in every pass.

- **Pros:** Can theoretically resolve cross-segment dependencies in a single convergence path.
- **Cons:** Cross-segment coupling during solve creates order dependencies, potential circular blocking, and non-deterministic exit conditions. Stalemate conditions become global rather than per-segment, eliminating the ability to isolate and diagnose individual segment failures.
- **Why not:** Per-segment isolation is the correct invariant. Cross-segment interactions are bounded and rare; the edge reconciliation pass handles the tractable subset.

### Alternative 2: Phase 2 re-triggers Phase 1 for mutated segments

After each Phase 2 mutation, re-run the affected segment's Phase 1 loop.

- **Pros:** Ensures no interior anomalies remain after Phase 2.
- **Cons:** Convergence is not guaranteed. A Phase 1 re-run may generate new edge proposals that require a new Phase 2, creating unbounded iteration. Cannot be reasoned about without real data.
- **Why not:** MVP defers cascading Phase 1 ↔ Phase 2. Phase 3 makes any cascade-induced residuals visible so they can be counted and designed for post-MVP.

### Alternative 3: No edge reconciliation — treat boundary points as immutable

Apply only intra-segment corrections; never evaluate boundary proposals.

- **Pros:** Eliminates Phase 2 entirely.
- **Cons:** Singletons and blocks that sit at segment edges can never be corrected, even when trivially resolvable against a stable neighbour. Leaves a class of known anomalies permanently unfixed.
- **Why not:** The resolution matrix for Phase 2 is deterministic and bounded. Single-unstable cases are safe to resolve. Only double-unstable cases are deferred (excluded from trust), which is the honest and minimal approach.

### Alternative 4: Include Phase 3 residuals as Phase 1 inputs on a second global pass

After Phase 3, use its residual list as seeds for a second global pass.

- **Pros:** More complete correction.
- **Cons:** Phase 3 residuals include cross-segment blocks that Phase 1 cannot resolve anyway (it treats boundaries as hard walls). A second pass would expend effort finding no-ops. The cross-segment block design question is architectural, not a matter of iteration count.
- **Why not:** Phase 3 is observational by design. Feeding its output back into Phase 1 is an architectural change that belongs post-MVP after telemetry confirms the pattern frequency and shape.

## Consequences

### Positive

- Per-segment isolation eliminates the most complex class of correction-layer bugs (order-dependent cross-segment decisions during solve).
- Edge reconciliation resolves the tractable boundary class without re-triggering Phase 1.
- Phase 3 provides residual visibility without acting on it — honest about what MVP cannot fix, gives telemetry for future work.
- `exitReason` per segment gives precise, testable terminal state for every segment.

### Negative

- Phase 2 mutations that create interior anomalies are not corrected in MVP. Phase 3 makes them visible but leaves them.
- Cross-segment blocks are permanently deferred in MVP. Phase 3 telemetry is the only output.
- `multipassMaxIterations = 500` is a safety net with no theoretical basis — chosen conservatively. Real exits should be 1–10 passes; 500 should never be reached in practice.

### Risks

- If per-segment correction-idle recomputation after `resolution-apply` has a bug (false idle), segments exit early and leave anomalies uncorrected. The verification pass (re-run proposals after full-set apply) provides a secondary check.
- Phase 2 stability detection (is the boundary point on the spine, is there a staged edge proposal?) must be consistent with Phase 1's staged-proposal bookkeeping.
