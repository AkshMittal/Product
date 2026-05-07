<!-- generated-by: gsd-doc-writer -->
# phase1-loop.js — Per-Segment Phase 1 Multipass Loop

## Purpose

Runs the per-segment iterative proposal→gate→apply loop until the segment is stable or a cap is reached. Each iteration builds fresh proposals from the current working snapshot, applies overlap and coupling gates, calls `resolution-apply`, and decides whether to continue. Handles edge proposals by staging them to `workingState.stagedEdgeProposals` for Phase 2.

## Inputs

```js
runPhase1Loop(workingState, auditContext, trkSegIndex, params)
```

| Parameter | Type | Description |
|---|---|---|
| `workingState` | Object | Mutable working state (mutated in place) |
| `auditContext` | `{ tagIndex: { belowAnchor: number[] } }` | Per-segment audit tags for the target segment |
| `trkSegIndex` | number | Segment to process |
| `params` | Object | Optional; `multipassMaxIterations` (default from `params/defaults`) |

## Outputs

```js
{ exitReason, iterationsRun, passLog }
```

| Field | Type | Description |
|---|---|---|
| `exitReason` | string | One of `'no_proposals'`, `'stable'`, `'stalemate'`, `'max_iterations'` |
| `iterationsRun` | number | Number of pass frames recorded |
| `passLog` | Array | Per-iteration record with `passNumber`, `proposalCounts`, `exitReason`, optional `verification` |

Side effects on `workingState`: drops, rearrangements, annotations, excludedFromTrust entries, staged edge proposals.

## Key logic

1. **Spine + envelope** — recomputed at the start of every iteration from current `workingOrderedPoints`
2. **Excluded set** — union of `excludedFromTrust` gpxIndexes and `resolvedAnomalies` set; passed to all proposal builders to suppress re-proposals
3. **Proposal building** — `buildBlockProposals`, `buildSingletonProposals`, `buildDuplicateProposals` all called; results concatenated
4. **First-pass zero-proposal short-circuit** — if no proposals on iteration 1 → `exitReason: 'no_proposals'`; on later iterations → `'stable'`
5. **Scope gate** — edge proposals (`isEdgeProposal === true`, excluding `adjacent-exact-drop`) are staged via `ws.stageEdgeProposal`; already-staged side is marked `out_of_segment_scope`; non-edge proposals enter `inScope[]`
6. **Zero in-scope short-circuit** — all proposals were edge-staged or out-of-scope → `exitReason: 'stable'`
7. **Overlap gate** — `detectOverlap(inScope, workingOrderedPoints, spinePointsBySegment)`; annotations are pushed to `workingState`
8. **Coupling gate** — `detectCoupling(inScope, workingOrderedPoints)`
9. **Apply** — `applyProposals(inScope, overlapVetoed, couplingBlocked, …)`
10. **Loop-exit decision**:
    - `applied === 0 && inScope > 0` → `'stalemate'`, break
    - `notApplied === 0` → verification pass: rebuild proposals + gates without applying; if none active → `'stable'`, break; else continue
    - Otherwise → next iteration
11. **Max iterations cap** — if loop exhausts `maxIter`, `exitReason: 'max_iterations'`; emits `multipass_cap_hit` session annotation

`classifyEdgeSide` determines whether an edge proposal touches the `firstEdge` or `lastEdge` of the segment's time envelope.

`markOutOfSegmentScope` excludes candidate/block-member gpxIndexes from trust and sets `proposal.skipReason = 'out_of_segment_scope'`.

## Invariants

- Every proposal written to `workingState.proposals` has `applied` boolean set
- Every proposal with `applied === false` has `skipReason` set
- `resolvedAnomalies` prevents re-emitting proposals for successfully corrected points on subsequent iterations
- `stagedEdgeProposals` accepts at most one proposal per side (`firstEdge` / `lastEdge`) per segment per Phase 1 run

## Integration

- Called from `correction-runner.js` for each active segment in Phase 1
- Depends on: `block-proposal`, `singleton-proposal`, `duplicate-proposal`, `overlap-detection`, `coupling-detection`, `resolution-apply`, `spine-intervals`, `working-state`, `params/defaults`
- Staged edge proposals are consumed by `phase2/edge-reconciliation.js`

## Related ADRs

- ADR-0011 — three-phase pipeline, per-segment multipass terminal-solve model
- ADR-0014 — traversal-adjacent canonical dedupe primitive
- ADR-0015 — kinematic guard (GATING vs ADVISORY disposition)
