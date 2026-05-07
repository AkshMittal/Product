<!-- generated-by: gsd-doc-writer -->
# working-state.js — Mutable Pipeline Working State

## Purpose

Creates and manages the single mutable state object threaded through the entire correction pipeline. Provides validated mutator functions for all four output collections and the live point array. All mutators validate inputs against ADR-0012 schema enums via `schema-enums.js` before writing.

## Inputs

`createWorkingState(points)` — accepts the accepted GPX points array (shallow-cloned; original not mutated).

All other exports are mutator functions that accept `(state, …args)`.

## Outputs

`createWorkingState` returns a working state object:

| Field | Type | Description |
|---|---|---|
| `workingOrderedPoints` | Array | Current traversal-order point list; mutated by drops and reorders |
| `drops` | Array | `{ gpxIndex, reason, stage }` — points physically removed |
| `excludedFromTrust` | Array | `{ gpxIndex, reasons[], details? }` — points present but flagged unreliable; one entry per gpxIndex (upserted) |
| `annotations` | Array | `{ scope, scopeRef, kind, details? }` — observations at session/segment/proposal scope |
| `rearrangements` | Array | Physical mutation log entries |
| `stagedEdgeProposals` | Map | `segIdx → { firstEdge?, lastEdge? }` — edge proposals deferred to Phase 2 |
| `proposals` | Array | Accumulator of all proposals across all passes |
| `resolvedAnomalies` | Set | gpxIndexes whose audit anomaly tag has been resolved by a successful apply |
| `passNumber` | number | Current multipass iteration index (set by phase1-loop) |

## Key logic

- **`addDrop(state, gpxIndex, reason, stage)`** — validates `reason` against `DROP_REASON_SET`; appends to `drops[]`
- **`addExcludedFromTrust(state, gpxIndex, reason, details?)`** — validates `reason` against `EXCLUDED_REASON_SET`; upserts (one entry per gpxIndex; adds reason to `reasons[]` if not already present; merges `details` shallow)
- **`addAnnotation(state, annotation)`** — validates `scope` and `kind` via `assertAnnotationKind`; normalises `scopeRef`; appends
- **`addRearrangement(state, rearrangement)`** — requires `kind` and `stage` fields; appends
- **`stageEdgeProposal(state, trkSegIndex, side, proposal)`** — `side` must be `'lastEdge'` or `'firstEdge'`; creates entry in `stagedEdgeProposals` Map if absent
- **`removeFromWorking(state, gpxIndex)`** — filters `workingOrderedPoints` by gpxIndex; returns `true` if removed
- **`relocateRunAfter(state, gpxIndexes, afterGpxIndex)`** — moves a contiguous run of points (by gpxIndex array) to immediately after `afterGpxIndex` in traversal order; `afterGpxIndex === null` places at head; throws if any gpxIndex missing or `afterGpxIndex` not found
- **`relocatePointAfter(state, movedGpxIndex, afterGpxIndex)`** — convenience wrapper around `relocateRunAfter` for a single point
- **`markAnomalyResolved(state, gpxIndex)`** — adds to `resolvedAnomalies` Set

Adjacency is always derived from the current `workingOrderedPoints` order; there is no pre-computed adjacency index (ADR-0014).

## Invariants

- `drops` entries are append-only; a dropped gpxIndex is never re-added
- `excludedFromTrust` is upserted — duplicate `(gpxIndex, reason)` pairs are silently ignored
- Drop reasons must be in `DROP_REASON_SET`: `'adjacent-exact-duplicate'` or `'duplicate_chunk_segment'`
- `excludedFromTrust` reasons must be in `EXCLUDED_REASON_SET` (12 valid values)
- Annotation kinds are scope-locked per `ANNOTATION_KIND_BY_SCOPE`
- `relocateRunAfter` throws if any of the target gpxIndexes is absent from `workingOrderedPoints`

## Integration

- Created by `correction-runner.js` at the start of each run
- Passed by reference through every pipeline stage
- `schema-enums.js` is the only dependency

## Related ADRs

- ADR-0012 — three-collection output schema (`drops`, `excludedFromTrust`, `annotations`)
- ADR-0014 — traversal-adjacent canonical dedupe (adjacency derived from `workingOrderedPoints` on every read)
