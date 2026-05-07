<!-- generated-by: gsd-doc-writer -->
# coupling-detection

**File:** `packages/correction/gates/coupling-detection.js`

## Overview

Bilateral disturbance / kinematic coupling gate. Determines which proposals share kinematic reference points such that applying one would invalidate another's bracket. Coupled proposals are blocked from applying together.

Runs after `overlap-detection.js` in each Phase 1 pass. Strictly intra-segment: disturbance zones, kinematic traversal neighbours, and edges never cross `trkSegIndex`. Cross-segment interactions are deferred to Phase 2.

Reference: ADR-correction-0010 (revised 2026-04-23), plan §Reference stability and coupling.

## API

```js
const { detectCoupling } = require('./gates/coupling-detection');

const result = detectCoupling(
  proposals,             // Array<Object> — all proposals for this pass
  workingOrderedPoints   // Array<Object> — current snapshot
);
// returns { couplingBlockedProposalIds, independentProposalIds, coupledRegions }
```

### Return value

| Key | Type | Description |
|---|---|---|
| `couplingBlockedProposalIds` | string[] | IDs of proposals with at least one coupling edge |
| `independentProposalIds` | string[] | IDs with no coupling edges |
| `coupledRegions` | Array | Connected-component groups with edge details |

## Core concepts

### Disturbance zone

The set of `gpxIndex` values that a proposal "disturbs" — points whose traversal position would change if the proposal applied.

| Proposal kind | Leaving side | Arriving side |
|---|---|---|
| `insert` | Traversal-adjacent neighbours of each candidate (same segment) | Each candidate's `bracketGpxIndexes` |
| `block-finding` | Traversal-adjacent neighbours of the block's first/last members (excluding block members themselves) | `[prevGpxIndex, nextGpxIndex]` from overlap-detection |
| `adjacent-exact-drop` | (empty) | (empty) |

Full disturbance zone = leaving ∪ arriving.

### Kinematic reference set

The set of `gpxIndex` values whose stability a proposal depends on (i.e., if these points move, the proposal's bracket is invalid):

- `insert`: union of all `bracketGpxIndexes`
- `block-finding`: `[prevGpxIndex, nextGpxIndex]`
- `adjacent-exact-drop`: empty

### Edge rule

P is coupled to Q iff any of P's kinematic references falls in Q's disturbance zone AND both proposals share `trkSegIndex`. Block-finding blocks symmetrically (revised 2026-04-23).

## Connected components

After building coupling edges, proposals are grouped into connected components via union-find. A `coupledRegion` has:

```js
{
  trkSegIndex:               number,
  proposalIds:               string[],
  disturbanceZoneGpxIndexes: number[],  // union of all zones in the region
  edges: [{
    blockedProposalId:   string,
    disturbanceSourceId: string,
    disturbedGpxIndex:   number,
    side:                'arriving' | 'leaving',
    trkSegIndex:         number
  }]
}
```

Any proposal with at least one edge is added to `couplingBlockedProposalIds`. In `resolution-apply.js` these get `skipReason = 'coupling_blocked'`.

## Relationship to overlap-detection

Overlap-detection and coupling-detection are independent — overlap checks temporal footprint geometry; coupling checks kinematic reference stability. Both run every pass; `resolution-apply.js` gates on both.

## Related modules

- `gates/overlap-detection.js` — temporal footprint gate (runs first)
- `apply/resolution-apply.js` — AND-gates both veto sets before applying
- `runner/phase1-loop.js` — orchestrates both gates
