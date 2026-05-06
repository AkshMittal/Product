<!-- generated-by: gsd-doc-writer -->
# participation-check.js — Segment Participation Classification

## Purpose

Classifies each GPX segment (and the session globally) by how well it can participate in timestamp-based correction. Produces per-segment `SegmentParticipationProfile` objects and a `perSegmentTags` map that all downstream stages consume. Pure read/derive — never mutates points or drops anything.

## Inputs

```js
checkParticipation(points, auditJson, params?)
```

| Parameter | Type | Description |
|---|---|---|
| `points` | Array | All accepted GPX points |
| `auditJson` | Object | Full audit JSON (`{ audit: { temporal, sampling } }`) |
| `params` | Object | Optional `{ minTimestampPairCoverageRatio }` (default 0.8) |

## Outputs

```js
{
  participation: { mode, coverageRatio, reasons[] },
  segmentParticipationProfiles: SegmentParticipationProfile[],
  perSegmentView: { pointBySegment: Map, perSegmentTags: Map, global: Object }
}
```

**`SegmentParticipationProfile`** fields:

| Field | Type | Description |
|---|---|---|
| `trkSegIndex` | number | Segment identifier |
| `mode` | string | `'full'`, `'timestamp-sparse'`, `'geometry-only'`, `'fully-reversed'` |
| `hasAnomalies` | boolean | True if any belowAnchor/belowPrevValid/nonAdjacentRepeat/adjacentDuplicate tags exist |
| `hasUsableTimes` | boolean | `parseableTimestampPointCount >= 2` |
| `coverageRatio` | number | `positiveTimeDeltaCount / consecutiveTimestampPairsCount` |
| `isFullyReversed` | boolean | Every consecutive parseable pair is strictly decreasing |
| `spineEnvelope` | Object | `{ minTimeMs: null, maxTimeMs: null }` (populated later by spine module) |
| `iterationsRun` | number | 0 initially |
| `exitReason` | string\|null | null initially |
| `correctionIdle` | boolean | false initially |

## Key logic

**Mode evaluation priority** (same for global and per-segment):

1. `parseableTimestampPointCount === 0` → `geometry-only` (reason: `no-parseable-timestamps`)
2. `hasAnyPositiveTimeDelta === false` → `geometry-only` (reason: `all-timestamps-uniform`)  
   Exception: if `isFullyReversed === true`, use `fully-reversed` instead
3. `coverageRatio < minRatio` → `timestamp-sparse` (reason: `insufficient-pair-coverage`)
4. Otherwise → `full`

**`isFullyReversed`**: computed per-segment when `parseableTimestampPointCount >= 2`; true iff every stream-adjacent consecutive parseable pair has `Δt < 0` and there is at least one such pair (`rfDec === rfTotal >= 1`).

**`perSegmentTags` source**: Prefers `audit.temporal.perSegment[]` (authoritative); falls back to deriving counts directly from points for segments absent from audit.

**Global counts**: Prefer `audit.sampling.time.timestampContext` authoritative values when present; otherwise sum per-segment counts.

**`hasAnomalies`**: true if any of `belowAnchor`, `belowPrevValid`, `nonAdjacentRepeat`, or `adjacentDuplicate` tag arrays is non-empty.

## Invariants

- Does not mutate any point objects
- Does not write to `workingState`
- Profiles are sorted by `trkSegIndex` ascending
- `perSegmentTags` has one entry per segment; entries for segments absent from audit are synthesised from points

## Integration

- Called first in `correction-runner.js` (step 3)
- `segmentProfiles` is mutated by downstream stages (`correctionIdle`, `mode`, `exitReason`)
- `perSegmentTags` is read (not mutated) by `correction-idle.js`, `reversal-check.js`, and `phase1-loop.js`

## Related ADRs

- ADR-0002 — per-segment eligibility
- ADR-0007 — participation check design
