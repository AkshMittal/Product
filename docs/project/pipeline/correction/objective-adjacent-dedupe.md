<!-- generated-by: gsd-doc-writer -->
# objective-adjacent-dedupe.js — Pre-Mutation Adjacent Exact Deduplication

## Purpose

Performs a single deterministic deduplication pass before any other mutation. Detects stream-adjacent exact duplicate points (same `timeMs`, `lat`, `lon`) within the same `trkSegIndex` and applies the elevation-table rules to decide which point to keep. Runs before Phase 1 so that `stream-adjacent === traversal-adjacent` still holds (ADR-0014).

## Inputs

```js
applyObjectiveAdjacentDedupe(workingState, params?)
```

| Parameter | Type | Description |
|---|---|---|
| `workingState` | Object | Mutable working state |
| `params` | Object | Optional `{ validEleFloorM, validEleCeilingM }` (defaults applied) |

## Outputs

Returns:
```js
{ droppedPairs, eleMismatches, oobBothSurvivors }
```

Side effects on `workingState`:
- Drops recorded in `drops[]` with reason `'adjacent-exact-duplicate'`, stage `'pre-segment-objective-dedupe'`
- Dropped gpxIndexes removed from `workingOrderedPoints`
- OOB-both survivors have their `ele` field set to `null`
- Ele-mismatch pairs produce `proposal`-scope annotations `'adjacent_duplicate_ele_mismatch'`

## Key logic

**Stream-adjacent filter**: `curr.gpxIndex !== prev.gpxIndex + 1` → skip (not stream-adjacent). Same-segment hard wall: `curr.trkSegIndex !== prev.trkSegIndex` → skip.

**Equality check**: both `timeMs` must be positive finite and equal; `lat` and `lon` must be identical.

**Elevation classification**: each point's `ele` is classified as `usable`, `absent`, or `oob`:
- `absent`: `eleAbsent === true`, or `ele` is null/undefined/non-finite
- `oob`: finite but outside `[validEleFloorM, validEleCeilingM]`
- `usable`: finite and within bounds

**Elevation table**:

| Prev ele | Curr ele | Action |
|---|---|---|
| usable, equal values | usable, equal values | DROP curr |
| both absent | both absent | DROP curr |
| usable | absent | DROP curr (keep the one with ele) |
| absent | usable | DROP prev (keep the one with ele) |
| both oob | both oob | DROP curr; set survivor's `ele` to null |
| usable | oob | DROP curr |
| oob | usable | DROP prev |
| usable ≠ usable | — | NO DROP; emit `adjacent_duplicate_ele_mismatch` annotation |

**Apply order**:
1. Null OOB-both survivors' `ele` in-place
2. Record drops + filter `workingOrderedPoints`
3. Emit ele-mismatch annotations

## Invariants

- Only processes stream-adjacent pairs (consecutive `gpxIndex` values within same segment)
- Cross-segment adjacent pairs are never deduplicated here
- Ele-mismatch pairs are annotated but NOT dropped
- Dropped points are removed from `workingOrderedPoints` in a single filter pass after collecting all pairs

## Integration

- Called from `correction-runner.js` after cross-segment duplicate detection (step 4)
- Followed by `correction-idle` recompute and optional short-circuit
- ADR-0014: legitimises the "stream-adjacent = traversal-adjacent" assumption

## Related ADRs

- ADR-0014 — traversal-adjacent canonical dedupe primitive
