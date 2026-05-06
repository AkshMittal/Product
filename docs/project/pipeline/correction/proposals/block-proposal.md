<!-- generated-by: gsd-doc-writer -->
# block-proposal

**File:** `packages/correction/proposals/block-proposal.js`

## Overview

Emits `block-finding` proposals — one per maximal contiguous run of `belowAnchor` points within a single `trkSegIndex`. Runs inside the Phase 1 multipass loop, once per pass per active segment.

A "block" is a contiguous sequence of points all tagged `belowAnchor` in the audit output. The proposal represents a candidate reorder: move the block to its chronologically correct position within the segment's spine.

Reference: plan §block-proposal, ADR-correction-0006.

## Responsibilities

**Owns:**
- Identifying maximal contiguous `belowAnchor` runs within a segment
- Computing `hasInternalMonotonicityViolation` (true if any consecutive pair within the block has Δt ≤ 0)
- Computing the block's time range (`blockMin`, `blockMax`) from member `timeMs` values
- Classifying each proposal as `isEdgeProposal` against the segment's spine envelope

**Does not own:**
- `B_min`/`B_max` numeric values in the overlap resolution (computed by `overlap-detection.js`)
- Bracket anchor selection (computed by `overlap-detection.js`)
- Socket gating and kinematic guard (handled by `resolution-apply.js`)

## API

```js
const { buildBlockProposals } = require('./proposals/block-proposal');

const proposals = buildBlockProposals(
  workingOrderedPoints,   // Array<Object> — current traversal snapshot
  belowAnchorGpxIndexes,  // Array<number>|Set<number> — per-segment audit tag
  trkSegIndex,            // number
  spineEnvelope,          // { minTimeMs, maxTimeMs }|null
  profile,                // { hasAnomalies: boolean } — optional
  excludedSet             // Set<number>|Array<number> — optional
);
// returns Array<block-finding proposal>
```

Returns `[]` immediately if:
- `profile.hasAnomalies === false`
- `belowAnchorGpxIndexes` is empty

## Edge-proposal classification

A block-finding is `isEdgeProposal === true` when the block's `[blockMin, blockMax]` overlaps or extends past the segment spine envelope on either side:

- No spine envelope (null) → every proposal is an edge proposal
- `blockMin <= envelope.minTimeMs` OR `blockMax >= envelope.maxTimeMs` → edge

Edge proposals are parked in `workingState.stagedEdgeProposals` by the phase1-loop and resolved in Phase 2.

## Proposal shape

Produced via `proposal-schema.makeBlockFindingProposal`. Key fields:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique `block:N` identifier |
| `kind` | `'block-finding'` | Proposal type |
| `trkSegIndex` | number | Owning segment |
| `gpxIndexes` | number[] | Block members in traversal order |
| `hasInternalMonotonicityViolation` | boolean | True if any intra-block backward step |
| `isEdgeProposal` | boolean | True if block touches segment envelope edge |
| `bMin`, `bMax` | number\|null | Populated later by overlap-detection |
| `overlapStatus` | string\|null | `'socket-ok'` \| `'overlap'` \| `'no-bracket'` \| null |

## Excluded-point handling

Points in `excludedSet` are not included as block members and break block continuity — an excluded point ends the current block run.

## Related modules

- `singleton-proposal.js` — handles isolated (non-block) `belowAnchor` points
- `gates/overlap-detection.js` — computes `bMin`/`bMax` and vets socket fit
- `gates/coupling-detection.js` — checks kinematic reference stability
- `apply/resolution-apply.js` — applies passing blocks via `relocateRunAfter`
- `state/proposal-schema.js` — `makeBlockFindingProposal` factory
