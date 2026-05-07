<!-- generated-by: gsd-doc-writer -->
# proposal-schema

**File:** `packages/correction/state/proposal-schema.js`

## Overview

Factory functions and strict validator for the three proposal kinds used throughout the correction pipeline. Ensures all proposals are created with the correct shape and that the `applied`/`skipReason` invariant holds at export time.

Reference: ADR-correction-0012.

## Proposal kinds

| Kind | Created by | Applied by |
|---|---|---|
| `'block-finding'` | `block-proposal.js` | `resolution-apply.js` |
| `'insert'` | `singleton-proposal.js`, `duplicate-proposal.js` | `resolution-apply.js` |
| `'adjacent-exact-drop'` | `duplicate-proposal.js` | `resolution-apply.js` (unconditional) |

## Common fields (all proposals)

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier (`block:N`, `insert:N`, `adj-drop:N`) |
| `kind` | string | One of the three kinds above |
| `trkSegIndex` | number | Owning segment |
| `isEdgeProposal` | boolean | True if proposal touches segment spine envelope edge |
| `applied` | boolean | Set by `resolution-apply.js` |
| `skipReason` | string\|null | Required when `applied === false`; must be null when `applied === true` |

## API

### makeInsertProposal(opts)

```js
const p = makeInsertProposal({
  trkSegIndex,
  candidateGpxIndexes,  // number[] — required, length >= 1
  isExactGroup,         // boolean
  isEdgeProposal,
  tPrev,                // number|null
  tNext,                // number|null
  bracketGpxIndexes,    // number[]
  targetTimeMs          // number|null
});
```

Additional fields initialised to `null`: `winner`.

### makeBlockFindingProposal(opts)

```js
const p = makeBlockFindingProposal({
  trkSegIndex,
  gpxIndexes,           // number[] — required, length >= 1
  hasInternalMonotonicityViolation,
  isEdgeProposal
});
```

Fields `bMin`, `bMax`, `prevGpxIndex`, `nextGpxIndex`, `tPrev`, `tNext`, `overlapStatus` are initialised to `null` and populated later by `overlap-detection.js`.

### makeAdjacentExactDropProposal(opts)

```js
const p = makeAdjacentExactDropProposal({
  trkSegIndex,
  keepGpxIndex,   // number — required
  dropGpxIndex,   // number — required
  eleMismatch     // boolean
});
```

`isEdgeProposal` is always `false` for adjacent-exact-drop.

### assertValidProposal(proposal)

Strict validator. Throws on:
- Missing `id`, `trkSegIndex`, unknown `kind`
- `applied` is not boolean
- `applied === false` with no `skipReason`
- `applied === true` with a non-null `skipReason`
- Kind-specific required fields missing

Used at export time by `correction-export.js`.

## applied / skipReason invariant

```
proposal.applied === false  ↔  proposal.skipReason is a non-null string
proposal.applied === true   ↔  proposal.skipReason === null
```

This invariant is enforced by `assertValidProposal` and also by the schema test in `packages/correction/__tests__/invariants-property.test.js`.

## Valid skipReason values

Defined in `state/schema-enums.js` as `PROPOSAL_SKIP_REASONS`:

| Value | Set by |
|---|---|
| `'kinematic_guard_failed'` | `resolution-apply.js` |
| `'overlap_vetoed'` | `resolution-apply.js` |
| `'coupling_blocked'` | `resolution-apply.js` |
| `'edge_unresolved'` | `phase2/edge-reconciliation.js` |
| `'out_of_segment_scope'` | phase1-loop (out-of-scope proposals) |
| `'exact_group_flag_only'` | `resolution-apply.js` |

## Related modules

- `state/schema-enums.js` — locked enum sets and validators
- `apply/resolution-apply.js` — sets `applied` and `skipReason` on every proposal
- `export/correction-export.js` — calls `assertValidProposal` at export time
