<!-- generated-by: gsd-doc-writer -->
# Sampling Audit Module

## Purpose

`sampling-audit.js` performs an **observational audit** of time and distance sampling behaviour in GPX points. It characterises the density and regularity of sampling intervals without mutating, reordering, or normalising any data.

Key constraints:
- Time deltas: **positive-only**, **GPX-stream-adjacent pairs** only (`gpxIndex+1`), both endpoints must have finite ingestion `timeMs`. No bridging across missing/unparsable gaps.
- Distance deltas: same stream-adjacent pairs as time (no array-only adjacency).

## Public API

```javascript
auditSampling(points, gpxFilename?)
```

- `points` — accepted trkpt array from ingestion; each point needs `gpxIndex`, `trkSegIndex`, `timeMs`, `lat`, `lon`.
- `gpxFilename` (optional string) — currently unused in output; reserved for metadata.

## Output shape

Returned as `{ audit: { sampling: { ... } } }`:

### `audit.sampling.time`

```javascript
{
  timestampContext: {
    hasAnyParseableTimestamp:          boolean,
    hasAnyPositiveTimeDelta:           boolean,
    timestampedPointsCount:            number,
    consecutiveTimestampPairsCount:    number,
    positiveTimeDeltaCount:            number,
    rejections: {
      nonPositiveTimeDeltaPairs: {
        nonPositivePairCount: number,
        events: [{ fromIndex, toIndex, delta }]
      }
    }
  },
  deltaStatistics: {
    positiveDeltaCount: number,
    minMs:              number | null,
    maxMs:              number | null,
    medianMs:           number | null
  },
  clustering: {
    insertionRelativeThreshold:                   0.02,
    sortedClusterCount:                           number,
    sequentialClusterCount:                       number,
    sortedClusterCountOverTotalDeltasRatio:        number,
    sequentialClusterCountOverTotalDeltasRatio:    number,
    sequentialOverSortedClusterCountRatio:         number,
    clusters: ClusterDescriptor[]
  },
  normalization: TimeNormalizationMeta | null
}
```

### `audit.sampling.distance`

```javascript
{
  pairInspection: {
    consecutivePairCount: number,
    rejections: { invalidDistance: { count: number } }
  },
  deltaStatistics: {
    deltaCount:    number,
    minMeters:     number | null,
    maxMeters:     number | null,
    medianMeters:  number | null
  },
  clustering:          DistanceClusterDescriptor[] | null,
  normalization:       DistanceNormalizationMeta | null,
  timeConditionedDeltaCount: number
}
```

### `audit.sampling.perSegment`

Array sorted by `trkSegIndex`:

```javascript
{
  trkSegIndex: number,
  time: {
    positiveDeltaCount: number,
    minMs:              number | null,
    maxMs:              number | null,
    medianMs:           number | null
  },
  distance: {
    deltaCount:   number,
    minMeters:    number | null,
    maxMeters:    number | null,
    medianMeters: number | null
  }
}
```

## Key Logic

### Stream adjacency

Only pairs where `curr.gpxIndex === prev.gpxIndex + 1` are evaluated. This is the ADR-0014 traversal-adjacent canonical primitive — it excludes pairs separated by ingestion-rejected rows.

### Clustering algorithm (2% relative insertion threshold)

Both time and distance deltas undergo the same two-pass clustering:

1. **Sorted clustering pass** — values sorted ascending; greedily grouped when the new value's relative deviation from the current cluster's median is `< 0.02` (2%). Each cluster emits `centerSec` (or `centerMeters`), `count`, spread statistics, and insertion/final deviation metrics.

2. **Sequential clustering pass** — same threshold applied in original collection order. The ratio `sequentialClusterCount / sortedClusterCount` signals temporal regularity vs shuffled uniformity.

Cluster descriptors are sorted descending by `count` (dominant regime first).

### ClusterDescriptor fields (time)

| Field | Description |
|-------|-------------|
| `centerSec` | Median of cluster values |
| `count` | Number of deltas in this cluster |
| `clusterShareOfTotalDeltas` | `count / totalPositiveTimeDeltaCount` |
| `minSec`, `maxSec`, `spreadSec` | Range within cluster |
| `meanInsertionRelativeDeviation` | Mean relative deviation at insertion time |
| `maxInsertionRelativeDeviation` | Worst insertion relative deviation |
| `finalMeanAbsoluteDeviationSec` | Mean abs deviation from final cluster center |
| `finalMaxAbsoluteDeviationSec` | Max abs deviation from final cluster center |
| `finalMeanRelativeDeviation` | Mean relative deviation from final center |
| `finalMaxRelativeDeviation` | Max relative deviation from final center |
| `finalSpreadOverCenterRatio` | `spreadSec / centerSec` |

Distance clusters carry equivalent fields with `Meters` suffix.

## Segment Awareness

Each point carries `trkSegIndex` from ingestion. The module buckets time and distance deltas by segment (both endpoints of a pair must belong to the same segment). Per-segment output provides `min`, `max`, `median` for time and distance deltas within each segment's stream-adjacent pairs.

Follows ADR-correction-0013 (raw per-segment payloads; no classification in this module).

## Integration

- **Pipeline position:** runs after `gpx-ingestion-module.js`; independent of other audit modules.
- **Output consumed by:** `audit-export-module.js` assembles the result into `audit.sampling` of the final `audit.json`.
- **Correction layer:** `participation-check.js` may use `perSegment` time stats to classify `timestamp-sparse` segments.
- Does not mutate points.

## Notes

- `exportTimeDeltasJSON`, `exportDistanceDeltasJSON`, `exportTimeDistancePairsJSON` are browser-only download helpers (use `document.createElement`). They are not part of the audit pipeline and have no effect on the returned payload.
