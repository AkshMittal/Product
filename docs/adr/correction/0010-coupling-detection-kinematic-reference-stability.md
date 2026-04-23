# ADR-correction-0010: Coupling-detection — kinematic reference stability and bilateral disturbance zones

**Date**: 2026-04-20 (revised 2026-04-23)  
**Status**: accepted **(revised)**

## Context

The correction layer runs kinematic checks (lenient speed, comparative analysis) for `singleton-insert` and `duplicate-reorder` proposals. These checks reference the **kinematic traversal neighbours** at the apply location — the traversal-adjacent points in `workingOrderedPoints` with usable `timeMs` on each side of the insertion or rearrangement. These are not `gpxIndex`-adjacent stream pairs (which reflect recording-density / sampling adjacency); they are the nearest points in traversal order that form valid forward-time kinematic steps, spine gaps allowed.

If those kinematic neighbours are themselves subjects of another proposal — being moved, inserted, or removed — the kinematic result is computed against geometry that will no longer exist after that proposal applies. The check is unreliable. The proposal must be blocked until the neighbourhood is stable.

**"Blocking"** here is kinematic-gate-only: it says nothing about whether the time story is valid (that is overlap-detection's job). A proposal can be overlap-clear but coupling-blocked, or overlap-vetoed but kinematically independent.

**Bilateral disturbance:** A proposal that moves something disturbs neighbourhoods on **two sides**: the leaving side (points that were neighbours of the moved subject lose it and gain new neighbours) and the arriving side (points at the destination gain a new neighbour). Both sides are disturbance sources.

**`adjacent-exact-drop` exception:** The surviving exact duplicate is geometrically identical to the dropped one. The kinematic traversal neighbourhood at that location is unchanged. No disturbance is produced.

**Symmetric blocking (revised 2026-04-23):** `block-finding` (socket-ok) now has a kinematic guard (ADR-correction-0006 revised, ADR-correction-0015). Its kinematic bracket anchors (`prevGpxIndex`, `nextGpxIndex` from `overlapBlockResolution`) are its kinematic reference points. If those anchors are in another proposal's disturbance zone, the block-finding is **coupling-blocked** on this pass — the kinematic check would be computed against geometry that is about to change. The prior "asymmetric blocking" exception for `block-finding` is **revoked** as of 2026-04-23. `block-finding` now participates in `couplingBlockedProposalIds` on the same basis as `singleton-insert` and `insert` competition proposals.

**Independence from overlap-detection:** Both modules compute independently from `workingOrderedPoints` and `correction.proposals[]`. Coupling-detection does not read `overlapVetoedProposalIds` or any other overlap output. This preserves true module independence and avoids implicit execution-order dependencies. Conservative consequence: overlap-vetoed proposals still produce disturbance zones; nearby kinematically sensitive proposals may be coupling-blocked even if the vetoing block will not apply. This is an honest outcome — the snapshot state is genuinely uncertain from coupling's perspective.

## Decision

1. **Coupling is kinematic reference instability.** The coupling gate asks: will the kinematic traversal neighbourhood this proposal's check depends on change because of another proposal? If yes, block the kinematically sensitive proposal on this pass.

2. **Kinematic traversal neighbours** are the traversal-adjacent points in the current `workingOrderedPoints` snapshot with usable `timeMs` on each side of the apply location — not `gpxIndex`-adjacent pairs. `singleton-proposal` derives and emits these as `tPrev`, `tNext`, `bracketGpxIndexes` in the `singleton-insert` proposal payload. `coupling-detection` reads them directly.

3. **Bilateral disturbance zones.** Every proposal that moves, inserts, or removes a point defines:
   - **Leaving side:** current traversal neighbours of the subject's current position — they lose their neighbour.
   - **Arriving side:** traversal neighbours of the destination position — they gain a new neighbour.
   Per-kind definitions:
   - `block-finding`: leaving = traversal neighbours of block first/last point; arriving = bracket anchors (`prevGpxIndex`, `nextGpxIndex`).
   - `singleton-insert`: leaving = current traversal neighbours of the candidate; arriving = `bracketGpxIndexes`.
   - `duplicate-reorder`: leaving = traversal neighbours of each loser's current position; arriving = traversal neighbours around the winner's target position.
   - `adjacent-exact-drop`: no disturbance zone.
   - `exact-group-flag-only`: no disturbance zone (flag-only).

4. **Edge rule.** For each kinematically sensitive proposal P (`singleton-insert`, `duplicate-reorder`): for each other proposal Q — if any of P's kinematic traversal neighbour `gpxIndex` values falls in Q's disturbance zone → coupling edge P ↔ Q.

5. **Connected components → `coupledRegions[]`.** Each region includes all proposals in the component (including `block-finding` disturbance sources for diagnostic traceability), the union of disturbance zone `gpxIndexes`, and a full `edges[]` array per edge (`blockedProposalId`, `disturbanceSourceId`, `disturbedGpxIndex`, `side`).

6. **`couplingBlockedProposalIds[]`** = kinematically sensitive proposals (`insert`, `block-finding`) with ≥1 coupling edge. The kinematic reference points for `block-finding` are its bracket anchors (`prevGpxIndex`, `nextGpxIndex`); for `insert` proposals, they are `bracketGpxIndexes` in the candidate payload.

7. **`independentProposalIds[]`** = all proposal ids not in `couplingBlockedProposalIds` (includes `adjacent-exact-drop` and any `insert`/`block-finding` with no coupling edges).

8. **`resolution-apply` gate:** all applyable proposal kinds are gated by both `overlapVetoedProposalIds` AND `couplingBlockedProposalIds` (AND gate). The prior exception for `block-finding` (overlap-only gate) is **revoked** as of 2026-04-23.

9. **Diagnostics priority:** Maximum edge-level diagnostic data is emitted in `coupledRegions[].edges[]` — `disturbedGpxIndex` and `side` per edge — to support debugging on real data and future development where kinematic coupling patterns are not yet empirically understood.

## Alternatives Considered

### Alternative 1: Symmetric blocking — include block-finding in couplingBlockedProposalIds *(adopted in 2026-04-23 revision)*

- **Original status**: Rejected (concern about stalemates if block can never apply to clear way for singleton).
- **Revised status (2026-04-23)**: Adopted. The original concern assumed block-finding had no kinematic check (so coupling-blocking it was pure waste). With a kinematic guard now on block-reorder (ADR-correction-0015), block-finding's bracket anchors are genuine kinematic references. Coupling-blocking it when those anchors are disturbed is correct: the guard would fire against stale geometry. Stalemate risk is still real but bounded — it resolves when the disturbance source is applied or fails, freeing the block's anchors.

### Alternative 2: Coupling reads overlapVetoedProposalIds to exclude vetoed proposals from disturbance sources

Skip disturbance zone computation for overlap-vetoed proposals since they will not apply.

- **Pros**: Fewer spurious coupling edges.
- **Cons**: Creates a data dependency between coupling and overlap outputs, implying overlap must run first. Breaks module independence. Harder to test each module in isolation.
- **Why not**: Both modules must be independent computations on the same snapshot state. Conservative coupling (some spurious edges) is the honest and testable choice.

### Alternative 3: gpxIndex-adjacent stream pairs as kinematic neighbours

Use `gpxIndex`-adjacent pairs instead of traversal-adjacent spine pairs for kinematic reference.

- **Pros**: Simpler — no need to walk workingOrderedPoints for traversal neighbours.
- **Cons**: Fundamentally wrong for kinematics. gpxIndex adjacency reflects recording density (sampling), not motion continuity. After reorder or drops, gpxIndex-adjacent pairs may span large time/distance gaps; using them for speed analysis produces meaningless results.
- **Why not**: Kinematics is about speed across the forward-time story, not sampling intervals. Traversal-adjacent spine pairs are the correct unit.

## Consequences

### Positive

- Coupling gate is precisely defined: implementable, testable, and independent of overlap output.
- Full edge-level diagnostics in `coupledRegions[].edges[]` enable debugging without real-world data.
- Symmetric model is correct: all kinematically-sensitive proposals (including block-finding, which now has a kinematic guard) are coupling-blocked when their reference points are disturbed.
- `singleton-proposal` and `block-proposal` (via `overlapBlockResolution`) both emit their kinematic reference gpxIndexes in the proposal payload; coupling-detection reads them uniformly.

### Negative

- Overlap-vetoed proposals still produce disturbance zones, potentially coupling-blocking proposals near blocks that will never apply — honest but may appear as false positives until those blocks are resolved.
- Symmetric coupling for `block-finding` increases the stalemate surface: a block coupling-blocked by a singleton, and the singleton coupling-blocked by the block's disturbance zone, creates a circular dependency. Resolution: the multipass loop detects stalemate (all proposals blocked) and exits; both remain in excludedFromTrust or flagged as appropriate. This is the honest outcome — neither can safely apply when the other's reference is unstable.
- Disturbance zone computation for `insert` competition (loser candidate positions) requires knowing the competition group layout — depends on `duplicate-proposal` payload richness.

### Risks

- If `singleton-proposal` emits stale or incorrect `bracketGpxIndexes`, coupling edges will be wrong. The proposal payload is the single source of truth for kinematic neighbour identity.
- `duplicate-reorder` disturbance zone definition (loser leaving-side neighbourhoods) must be pinned when implementing that proposal kind.
