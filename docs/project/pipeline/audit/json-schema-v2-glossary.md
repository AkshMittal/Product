<!-- generated-by: gsd-doc-writer -->
# Audit JSON Schema v2 Glossary

> **Last updated**: 2026-05-06

Reference glossary for the `audit.json` payload produced by `audit-export-module.js` (`schemaVersion: "2.0.0"`). Each top-level key under `audit.*` is assembled from the module listed.

---

## Top-level envelope

```javascript
{
  metadata: {
    schemaVersion:   '2.0.0',        // hardcoded; check before reading audit.* keys
    generatedAtUtc:  string,          // ISO 8601; wall-clock at buildAuditExportPayload() call time
    source: {
      fileName:      string | null    // source GPX filename; null if not provided
    },
    summary: {
      totalPointCount: number         // accepted trkpt count (see resolution order below)
    }
  },
  audit: {
    ingestion:  IngestionAudit | null,
    temporal:   TemporalAudit  | null,
    sampling:   SamplingAudit  | null,
    motion:     MotionAudit    | null,
    elevation:  ElevationAudit | null
  }
}
```

`totalPointCount` resolution order:
1. Explicit `input.totalPointCount` if a finite number.
2. `ingestionAudit.counts.totalPointCount` if present.
3. `0` as fallback.

---

## `audit.ingestion` — GPX Ingestion Module

**Source:** `gpx-ingestion-module.js`

```javascript
{
  counts: {
    totalTrkptCount:    number,   // all <trkpt> elements found in XML
    validTrkptCount:    number,   // accepted into points[]
    rejectedTrkptCount: number,   // failed coordinate validation
    trkSegmentCount:    number,   // total <trkseg> elements across all tracks
    waypointCount:      number,
    routeCount:         number
  },
  context: {
    hasAnyTimestampValues: boolean,  // any accepted point has timeAbsent === false
    hasWaypoints:          boolean,
    hasRoutes:             boolean,
    hasMultipleSegments:   boolean
  },
  rejections: {
    events: RejectionEvent[]         // one per rejected trkpt; see below
  },
  segmentSummaries:  SegmentSummary[],   // one per <trkseg> (from export-fault-detection.js)
  segmentBoundaries: SegmentBoundary[]   // one per trkSegIndex with ≥1 accepted point
}
```

### `RejectionEvent`

```javascript
{
  gpxIndex:    number,
  trkSegIndex: number,
  pointType:   'trkpt',
  rawLat:      string | null,
  rawLon:      string | null,
  rawEle:      string | null,
  rawTime:     string | null,
  reason:      string           // human-readable rejection cause
}
```

### `SegmentBoundary`

One entry per `trkSegIndex` with at least one accepted point. Sorted ascending by `trkSegIndex`.

```javascript
{
  trkSegIndex:   number,
  firstGpxIndex: number,
  lastGpxIndex:  number,
  firstTimeMs:   number | null,  // timeMs of the first accepted point in the segment
  lastTimeMs:    number | null,  // timeMs of the last accepted point in the segment
  minTimeMs:     number | null,  // minimum timeMs across the segment
  maxTimeMs:     number | null   // maximum timeMs across the segment
}
```

Consumed by the correction layer's `boundary-classifier.js` (ADR-0013).

### `SegmentSummary` (from `export-fault-detection.js`)

```javascript
{
  trackIndex:      number,        // 0-based index of the parent <trk>
  segIndex:        number,        // 0-based index within that track
  globalSegIndex:  number,        // = trkSegIndex on accepted trkpts
  pointCount:      number,        // total <trkpt> elements (including rejected)
  usableTimeCount: number,        // trkpts with a parseable timeMs
  firstTimeMs:     number | null,
  lastTimeMs:      number | null,
  minTimeMs:       number | null,
  maxTimeMs:       number | null
}
```

---

## `audit.temporal` — Timestamp Audit Module

**Source:** `timestamp-audit.js`

```javascript
{
  totalPointsEvaluated: number,
  session: {
    rawSessionDurationSec:        number | null,  // (lastValidMs - firstValidMs) / 1000
    parseableTimestampPointCount: number
  },
  tagCounts: {
    missing:           number,
    unparsable:        number,
    adjacentDuplicate: number,
    belowAnchor:       number,
    belowPrevValid:    number,
    nonAdjacentRepeat: number
  },
  tagIndex: {
    missing:           number[],   // gpxIndex arrays per tag
    unparsable:        number[],
    adjacentDuplicate: number[],
    belowAnchor:       number[],
    belowPrevValid:    number[],
    nonAdjacentRepeat: number[]
  },
  pointAnnotations: TemporalAnnotation[],  // sparse — anomalous points only
  perSegment:       TemporalSegmentSummary[]
}
```

### Tag definitions (non-exclusive)

| Tag | Condition |
|-----|-----------|
| `missing` | `timeAbsent === true`, or malformed point without finite `timeMs` |
| `unparsable` | `timeAbsent === false` AND `timeMs` not finite |
| `adjacentDuplicate` | `timeMs === predecessor.timeMs` (predecessor = accepted `gpxIndex-1` with finite `timeMs`) |
| `belowAnchor` | `timeMs < anchorTimestampMs` (monotonic high-water mark) |
| `belowPrevValid` | `timeMs < predecessor.timeMs` |
| `nonAdjacentRepeat` | Value seen earlier in stream AND not `adjacentDuplicate` |

`adjacentDuplicate` and `nonAdjacentRepeat` are mutually exclusive. Anchor advances only on `timeMs > anchorTimestampMs`.

### `TemporalAnnotation`

```javascript
// missing point:
{ gpxIndex, missing: true }

// unparsable point:
{ gpxIndex, unparsable: true, timeRaw?: string | null }

// valid-but-anomalous point (all applicable tags flat on object):
{
  gpxIndex,
  timestampMs,
  anchorMs,
  belowAnchor?:              true,
  depthFromAnchorMs?:        number,   // anchorMs - timestampMs; only when belowAnchor
  belowPrevValid?:           true,
  adjacentDuplicate?:        true,
  nonAdjacentRepeat?:        true,
  firstOccurrenceGpxIndex?:  number    // only when nonAdjacentRepeat
}
```

### `TemporalSegmentSummary`

Sorted ascending by `trkSegIndex`.

```javascript
{
  trkSegIndex:                    number,
  tagCounts:                      { missing, unparsable, adjacentDuplicate, belowAnchor, belowPrevValid, nonAdjacentRepeat },
  tagIndex:                       { missing: [], unparsable: [], adjacentDuplicate: [], belowAnchor: [], belowPrevValid: [], nonAdjacentRepeat: [] },
  monotonicity: {
    hasViolation:                 boolean,
    violationCount:               number    // = perSegment belowAnchor count
  },
  consecutiveTimestampPairsCount: number,
  positiveTimeDeltaCount:         number,
  parseableTimestampPointCount:   number,
  hasAnyPositiveTimeDelta:        boolean
}
```

Primary input to `participation-check.js` for segment classification.

---

## `audit.sampling` — Sampling Audit Module

**Source:** `sampling-audit.js`

```javascript
{
  time: {
    timestampContext: {
      hasAnyParseableTimestamp:       boolean,
      hasAnyPositiveTimeDelta:        boolean,
      timestampedPointsCount:         number,
      consecutiveTimestampPairsCount: number,
      positiveTimeDeltaCount:         number,
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
      insertionRelativeThreshold:                  0.02,
      sortedClusterCount:                          number,
      sequentialClusterCount:                      number,
      sortedClusterCountOverTotalDeltasRatio:       number,
      sequentialClusterCountOverTotalDeltasRatio:   number,
      sequentialOverSortedClusterCountRatio:        number,
      clusters:                                    TimeClusterDescriptor[]
    },
    normalization: TimeNormalizationMeta | null
  },
  distance: {
    pairInspection: {
      consecutivePairCount: number,
      rejections: { invalidDistance: { count: number } }
    },
    deltaStatistics: {
      deltaCount:   number,
      minMeters:    number | null,
      maxMeters:    number | null,
      medianMeters: number | null
    },
    clustering:               DistanceClusteringMeta | null,
    normalization:            DistanceNormalizationMeta | null,
    timeConditionedDeltaCount: number
  },
  perSegment: SamplingSegmentSummary[]
}
```

### `SamplingSegmentSummary`

Sorted ascending by `trkSegIndex`.

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

All deltas use GPX-stream-adjacent pairs only (`gpxIndex+1`, both endpoints with finite `timeMs`).

---

## `audit.motion` — Motion Audit Module

**Source:** `motion-audit.js`

```javascript
{
  summary: {
    consecutivePairCount: number,       // stream-adjacent pairs evaluated (not points.length - 1)
    parameters: {
      validFloorM:   number,            // default -500
      validCeilingM: number             // default 9500
    }
  },
  tagCounts: {
    backwardTime:      number,
    zeroTimeDelta:     number,
    timeUnresolvable:  number,
    nonFiniteDistance: number,
    eleUnresolvable:   number
  },
  tagIndex: {
    backwardTime:      [{ fromGpxIndex, toGpxIndex }],
    zeroTimeDelta:     [{ fromGpxIndex, toGpxIndex }],
    timeUnresolvable:  [{ fromGpxIndex, toGpxIndex }],
    nonFiniteDistance: [{ fromGpxIndex, toGpxIndex }],
    eleUnresolvable:   [{ fromGpxIndex, toGpxIndex }]
  },
  pairAnnotations: MotionPairAnnotation[],   // sparse — tagged pairs only
  perSegment:      MotionSegmentSummary[]
}
```

### Tag definitions (non-exclusive, per pair)

| Tag | Condition |
|-----|-----------|
| `timeUnresolvable` | One or both endpoints lack finite `timeMs` |
| `backwardTime` | Both timestamps finite AND `curr.timeMs < prev.timeMs` |
| `zeroTimeDelta` | Both timestamps finite AND `curr.timeMs === prev.timeMs` |
| `nonFiniteDistance` | Haversine result is not finite |
| `eleUnresolvable` | Either endpoint elevation not finite within `[validFloorM, validCeilingM]` |

`backwardTime` and `zeroTimeDelta` are mutually exclusive. All other combinations can co-occur.

### `MotionPairAnnotation`

```javascript
{
  fromGpxIndex:      number,
  toGpxIndex:        number,
  timeUnresolvable?: true,
  backwardTime?:     true,
  dtSec?:            number,         // present when backwardTime or zeroTimeDelta
  zeroTimeDelta?:    true,
  nonFiniteDistance?: true,
  eleUnresolvable?:  true,
  ddMeters?:         number          // present when timeUnresolvable and distance is finite
}
```

Clean pair count: `consecutivePairCount - pairAnnotations.length`. Do NOT use `consecutivePairCount - sum(tagCounts)` — tags stack on the same pair.

### `MotionSegmentSummary`

Sorted ascending by `trkSegIndex`.

```javascript
{
  trkSegIndex:          number,
  consecutivePairCount: number,
  tagCounts: {
    backwardTime:      number,
    zeroTimeDelta:     number,
    timeUnresolvable:  number,
    nonFiniteDistance: number,
    eleUnresolvable:   number
  }
}
```

---

## `audit.elevation` — Elevation Audit Module

**Source:** `elevation-audit.js`

```javascript
{
  totalPointsEvaluated:     number,
  validElevationPointCount: number,
  parameters: {
    validFloorM:   number,    // default -500
    validCeilingM: number     // default 9500
  },
  tagCounts: {
    missing:           number,
    unparsable:        number,
    outOfBounds:       number,
    adjacentDuplicate: number
  },
  tagIndex: {
    missing:           number[],   // gpxIndex arrays per tag
    unparsable:        number[],
    outOfBounds:       number[],
    adjacentDuplicate: number[]
  },
  pointAnnotations: ElevationAnnotation[],   // sparse — anomalous points only
  perSegment:       ElevationSegmentSummary[]
}
```

### Tag definitions (priority cascade, mutually exclusive groups)

| Tag | Condition |
|-----|-----------|
| `missing` | `eleAbsent === true`, or legacy point with `ele === null` |
| `unparsable` | `eleAbsent === false` AND `ele` not a finite number |
| `outOfBounds` | `ele` finite AND outside `[validFloorM, validCeilingM]` |
| `adjacentDuplicate` | `ele` in-bounds AND equals previous in-bounds `ele` |

`prevValidEle` resets to `null` on any non-in-bounds point.

### `ElevationSegmentSummary`

Sorted ascending by `trkSegIndex`.

```javascript
{
  trkSegIndex:              number,
  totalPointsEvaluated:     number,
  validElevationPointCount: number,
  tagCounts: {
    missing:           number,
    unparsable:        number,
    outOfBounds:       number,
    adjacentDuplicate: number
  }
}
```

---

## `audit.exportFaults[]` — Export Fault Detection Module

**Source:** `export-fault-detection.js` (deprecated; superseded by `deterministic-export-fix.js`)

Placed at `audit.exportFaults[]` (not inside `audit.ingestion`). Common fields:

```javascript
{
  type:       string,             // fault type constant (see below)
  severity:   'critical' | 'high' | 'medium' | 'low',
  confidence: number,             // 0–1
  trackIndex: number,             // parent <trk> index (0-based)
  details:    string              // human-readable description
}
```

| Type | Confidence | Severity | Extra fields |
|------|-----------|----------|-------------|
| `chunk_ordering_fault` | 1.0 | critical | `fromTrkSegIndex`, `toTrkSegIndex`, `gapMs` |
| `duplicate_chunk_fault` | 0.95 | critical | `fromTrkSegIndex`, `toTrkSegIndex`, `gapMs`, `overlapStartMs`, `overlapEndMs` |
| `missing_chunk_fault` | 0.85 | high | `fromTrkSegIndex`, `toTrkSegIndex`, `gapMs`, `gapMinutes`, `impliedDistanceM`, `impliedSpeedKph`, `note` |
| `timestamp_discontinuity_fault` | 0.90 | medium | `fromTrkSegIndex`, `toTrkSegIndex`, `gapMs`, `suspectedTimezoneOffsetHours` |
| `intra_segment_timestamp_violation` | 1.0 | high | `trkSegIndex`, `pointIndexInSegment`, `precedingTimeMs`, `violatingTimeMs` |

---

## Cross-module field glossary

| Field | Type | Meaning |
|-------|------|---------|
| `gpxIndex` | number | 0-based trkpt-stream sequential index; stable across all modules. Assigned by `gpx-ingestion-module.js`. |
| `trkSegIndex` | number | 0-based `<trkseg>` index, globally across all `<trk>` elements. Key for per-segment grouping. |
| `timeMs` | number \| null | `Date.parse(timeRaw)` result from ingestion. Only finite values are used for timing calculations. |
| `timeAbsent` | boolean | `true` = no `<time>` element; `false` = element present (may still be unparsable). |
| `eleAbsent` | boolean | `true` = no `<ele>` element; `false` = element present (may still be unparsable). |
| `perSegment` | array | Per-`trkSegIndex` summaries emitted by each audit module. Raw payloads — no classification (ADR-correction-0013). |
| `anchorTimestampMs` | number | Monotonic high-water mark of valid timestamps seen so far. Advances only on `timeMs > anchor`. |
| `consecutivePairCount` | number | Count of GPX-stream-adjacent pairs (`gpxIndex+1`). Less than `points.length - 1` when ingestion rejects rows. |

---

## Schema version history

| Version | Notes |
|---------|-------|
| `2.0.0` | Current. Per-segment summaries added to all four audit modules. `perSegment[]` fields follow ADR-correction-0013 (raw payloads; correction layer classifies). |
