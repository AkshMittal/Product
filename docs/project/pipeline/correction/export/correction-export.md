<!-- generated-by: gsd-doc-writer -->
# correction-export

**File:** `packages/correction/export/correction-export.js`

## Overview

Assembles the canonical `correction.json` payload. The final step of the correction pipeline. Verifies the partition invariant before returning — throws if any violation is detected.

Reference: ADR-correction-0012 §Output schema.

## API

```js
const { buildCorrectionExport } = require('./export/correction-export');

const correctionJson = buildCorrectionExport({
  workingState,
  participation,
  segmentProfiles,
  boundaryClassifications,
  spineResult,              // { spinePointsBySegment, envelopeBySegment }
  passLog,
  coupledRegions,
  overlapBlockResolution,
  phase2Result,
  diagnostics,
  paramsSnapshot,
  auditPerSegmentTags
});
```

Throws `Error` if the partition invariant is violated.

## Output schema

All keys are locked by ADR-correction-0012:

| Key | Type | Description |
|---|---|---|
| `metadata` | Object | `schemaVersion`, `generatedAtUtc`, `paramsSnapshot` |
| `participation` | Object | Session-level participation mode and coverage ratio |
| `segmentProfiles` | Array | Post-correction `SegmentParticipationProfile[]` |
| `boundaryClassifications` | Array | Inter-segment boundary records |
| `spineIntervals` | Array | Per-segment spine point lists and envelopes |
| `proposals` | Array | All proposals across all passes (with `applied`, `skipReason`) |
| `drops` | Array | Three-collection: dropped points |
| `excludedFromTrust` | Array | Three-collection: excluded points |
| `annotations` | Array | Three-collection: all annotations |
| `rearrangements` | Array | Physical mutation log |
| `stagedEdgeProposals` | Array | Phase 2 input/output snapshot |
| `coupledRegions` | Array | Phase 1 coupling groups |
| `overlapBlockResolution` | Array | Phase 1 socket-ok block resolutions |
| `passLog` / `multipass.perSegment` | Array | Per-segment Phase 1 pass log and exit reason |
| `phase2` | Object | Phase 2 result summary |
| `diagnostics` | Object | Phase 3 residual sweep payload |
| `fullOrderedPoints` | number[] | `gpxIndex` sequence in final traversal order |
| `canonicalTrustedPoints` | Array | Trusted-surviving points: `{ gpxIndex, lat, lon, ele, timeMs, trkSegIndex }` |
| `partitionInvariant` | Object | Partition verification report |

## Partition invariant

Every `gpxIndex` ingested into `workingState` must appear in **exactly one** of three disjoint sets:

```
ingested = drops ∪ workingOrderedPoints

(a) drops[]              — removed from working order
(b) excludedFromTrust[]  — present in working order but flagged unreliable
(c) trusted-surviving    — workingOrderedPoints AND NOT excludedFromTrust
```

Checks performed:
- `drops ∩ excludedFromTrust` must be empty
- `drops ∩ workingOrderedPoints` must be empty
- `excludedFromTrust ⊆ workingOrderedPoints` (excluded points stay in working order)
- Every ingested index is in exactly one of `{drops, workingOrderedPoints}` (XOR)

If any check fails, `buildCorrectionExport` throws with a JSON summary of violation counts.

The `partitionInvariant` key in the output reports:

```js
{
  ingested:             number,
  drops:                number,
  excluded:             number,
  trustedSurviving:     number,
  workingOrderedPoints: number,
  ok:                   boolean,
  violations: {
    dropsExclOverlap:     number[],
    dropsWorkingOverlap:  number[],
    excludedNotInWorking: number[],
    orphans:              number[]
  }
}
```

## Trusted-surviving points

`canonicalTrustedPoints` is the subset of `workingOrderedPoints` not in `excludedFromTrust`, in traversal order, with fields `{ gpxIndex, lat, lon, ele, timeMs, trkSegIndex }`. This is the primary output consumed by downstream consumers.

## Proposal serialisation

`proposals` is the full flat array across all passes. Each proposal is serialised to a plain object with kind-specific fields. See `state/proposal-schema.js` for field definitions.

## Related modules

- `runner/correction-runner.js` — calls `buildCorrectionExport` as the final step
- `state/working-state.js` — source of all three collections
- `phase3/residual-diagnostic-sweep.js` — provides `diagnostics`
- `phase2/edge-reconciliation.js` — provides `phase2Result`
- `state/proposal-schema.js` — proposal shape definitions
