<!-- generated-by: gsd-doc-writer -->
# correction-runner.js — Top-Level Pipeline Orchestrator

## Purpose

Orchestrates the full three-phase correction pipeline. Accepts raw GPX points and audit JSON, runs all pre-segment stages, Phase 1 per-segment multipass loop, Phase 2 edge reconciliation, Phase 3 residual diagnostics, and assembles the final `correction.json` payload. Contains the short-circuit logic that skips to export whenever all segments become idle.

## Inputs

```js
runCorrection(auditJson, acceptedPoints, params?)
// Minimal form (no audit data):
runCorrection(acceptedPoints)
```

| Parameter | Type | Description |
|---|---|---|
| `auditJson` | Object | Full audit output (`{ audit: { ingestion, temporal, sampling, … } }`) |
| `acceptedPoints` | Array | Raw GPX points, each with `{ gpxIndex, trkSegIndex, lat, lon, ele, timeMs }` |
| `params` | Object | Optional overrides: `multipassMaxIterations`, `minTimestampPairCoverageRatio`, `lenientMaxImpliedSpeedKph`, etc. |

Parameter normalisation: if `auditJson` is an array and `acceptedPoints` is absent, treats the first argument as `acceptedPoints` with an empty audit.

## Outputs

Returns a `correctionPayload` object assembled by `correction-export.buildCorrectionExport`. Key top-level fields:

- `metadata` — schema version, timestamp, params snapshot
- `participation` — global mode (`full` / `timestamp-sparse` / `geometry-only`)
- `segmentProfiles` — per-segment participation + exit metadata
- `boundaryClassifications` — inter-segment boundary records
- `proposals` — all proposals across all passes with `applied` + `skipReason`
- `drops` / `excludedFromTrust` / `annotations` / `rearrangements` — three-collection output
- `canonicalTrustedPoints` — trusted-surviving points in traversal order
- `partitionInvariant` — verification report (throws if violated)
- `diagnostics` — Phase 3 residual sweep payload
- `phase2` — edge reconciliation summary

## Key logic

Pipeline executes in order. After steps 4, 5, and 6, checks `allSegmentsIdle`; if true, calls `buildEarlyExport` and returns immediately.

1. **Parameter normalisation** — resolves `auditJson` / `acceptedPoints` / `params` from flexible call signatures
2. **Create working state** — `createWorkingState(resolvedPoints)` initialises all mutable collections
3. **Participation check** — classifies each segment as `full`, `timestamp-sparse`, `geometry-only`, or `fully-reversed`
4. **Boundary classification** — derives inter-segment boundaries from `audit.ingestion.segmentBoundaries[]`, classifies each
5. **Cross-segment duplicate detection** — one-shot `detectCrossSegmentDuplicates` writes `excludedFromTrust` entries
6. **Objective adjacent dedupe** — drops stream-adjacent exact duplicates; short-circuit check
7. **Reversal check** — global hypothesis first, then per-segment `isFullyReversed`; short-circuit check
8. **Deterministic export fixes** — chunk reordering, duplicate-chunk exclusion, timezone/gap annotations; short-circuit check
9. **Spine + envelope** — `computeSpineResult` + `attachSpineEnvelopes` for Phase 1
10. **Phase 1 loop** — per-segment multipass (sorted by `trkSegIndex`); segments with `correctionIdle === true` or `geometry-only` emit `no_proposals` and are skipped; recomputes idle after each segment
11. **Phase 2** — `runEdgeReconciliation` on post-Phase-1 snapshot
12. **Phase 3** — `runResidualDiagnosticSweep` (read-only)
13. **Export** — `buildCorrectionExport` assembles and verifies partition invariant

`buildEarlyExport` (short-circuit path) still runs Phase 3 and calls `buildCorrectionExport`.

`deriveInterSegmentBoundaries` builds boundary objects from `audit.ingestion.segmentBoundaries[]`, computing `gapMs` and carrying `minTimeMs`/`maxTimeMs` per segment.

## Invariants

- `acceptedPoints` must be an array; throws `'runCorrection: acceptedPoints[] required'` otherwise
- All segments idle after any pre-segment stage → short-circuit to export (no Phase 1 executed)
- Partition invariant is verified at export time; `buildCorrectionExport` throws if violated
- `segmentProfiles` is sorted by `trkSegIndex` before Phase 1

## Integration

- Called by `packages/correction/index.js` (public facade)
- Calls every sub-module in the correction layer
- Returns the correction payload consumed by downstream tooling or tests

## Related ADRs

- ADR-0011 — three-phase pipeline, terminal-solve model
- ADR-0012 — output schema (`drops`, `excludedFromTrust`, `annotations`)
- ADR-0013 — boundary classification ownership in correction layer
- ADR-0014 — traversal-adjacent canonical dedupe primitive
- ADR-0015 — kinematic guard
