<!-- generated-by: gsd-doc-writer -->
# singleton-proposal

**File:** `packages/correction/proposals/singleton-proposal.js`

## Overview

Emits `insert` proposals for isolated `belowAnchor` candidates — points that are `belowAnchor` in the audit output but are NOT members of a contiguous block run.

Each singleton candidate gets one `insert` proposal with `candidateGpxIndexes.length === 1`. The proposal carries bracket anchor information (`tPrev`, `tNext`, `bracketGpxIndexes`) derived from the candidate's current traversal-adjacent neighbours within the same segment.

Reference: plan §singleton-proposal, ADR-correction-0010.

## Candidate selection

A point qualifies as a singleton candidate when all of the following hold:
- `belowAnchor === true` (in the per-segment audit tags)
- NOT a member of any block-finding run (`blockMemberGpxIndexes`)
- NOT in `excludedSet`
- Has a usable `timeMs` (finite, > 0)

## API

```js
const { buildSingletonProposals } = require('./proposals/singleton-proposal');

const proposals = buildSingletonProposals(
  workingOrderedPoints,       // Array<Object>
  belowAnchorGpxIndexes,      // Array<number>|Set<number>
  blockMemberGpxIndexes,      // Set<number>
  trkSegIndex,                // number
  spineEnvelope,              // { minTimeMs, maxTimeMs }|null
  params,                     // { lenientMaxImpliedSpeedKph? }
  excludedSet                 // Set<number>|Array<number> — optional
);
// returns Array<insert proposal>
```

## Bracket derivation

For each candidate, walks traversal-adjacent neighbours within the **same `trkSegIndex`** (does not cross segment boundaries):

- `tPrev` — nearest preceding point with usable `timeMs`
- `tNext` — nearest following point with usable `timeMs`
- `bracketGpxIndexes` — `[prevGpxIndex?, nextGpxIndex?]`

The bracket is used by `coupling-detection.js` to determine kinematic reference stability and by `resolution-apply.js` to place the point after the `prevAnchor`.

## Edge-proposal classification

`isEdgeProposal === true` when `candidate.timeMs` falls at or past the segment spine envelope edge:

- No spine envelope → always edge
- `candidate.timeMs <= envelope.minTimeMs` OR `>= envelope.maxTimeMs` → edge

Edge proposals are staged in Phase 1 and resolved in Phase 2.

## Proposal shape

Produced via `proposal-schema.makeInsertProposal`. Key fields for length-1 insert:

| Field | Type | Description |
|---|---|---|
| `kind` | `'insert'` | Proposal type |
| `candidateGpxIndexes` | `[number]` | Single-element array |
| `isExactGroup` | `false` | Always false for singletons |
| `tPrev` | number\|null | Prev bracket anchor `timeMs` |
| `tNext` | number\|null | Next bracket anchor `timeMs` |
| `bracketGpxIndexes` | number[] | `[prevGpxIndex?, nextGpxIndex?]` |
| `targetTimeMs` | number | Candidate's `timeMs` |
| `isEdgeProposal` | boolean | Edge classification |

## Disposition in resolution-apply

Length-1 insert proposals use **GATING** disposition (ADR-0015):
- Kinematic check must pass (`speedPrev ≤ threshold` AND `speedNext ≤ threshold`)
- Fail → candidate moves to `excludedFromTrust` with reason `insert_kinematic_guard_failed`
- Pass → candidate relocated to chronologically correct position via `relocatePointAfter`

## Related modules

- `block-proposal.js` — handles multi-point contiguous `belowAnchor` runs
- `duplicate-proposal.js` — handles same-`timeMs` competition groups
- `gates/overlap-detection.js` — corridor pierce-check for insert proposals
- `gates/coupling-detection.js` — reference stability check
- `apply/resolution-apply.js` — GATING apply logic for length-1 inserts
