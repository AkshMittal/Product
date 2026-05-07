<!-- generated-by: gsd-doc-writer -->
# Timestamp Audit Module

## Overview

The Timestamp Audit Module performs an observational, per-point labeling pass on timestamp data in GPX points. It analyzes timestamp quality and ordering without mutating, reordering, or normalizing the data. The output is a set of non-exclusive boolean tags applied only to anomalous points.

No point is presumed correct or incorrect. The audit records what is observable — not what should be done about it. Classification and correction decisions belong to downstream layers.

## Purpose

- Identify points with missing or unparsable timestamps (ingestion-time issues)
- Label points that are behind the monotonic high-water mark (`belowAnchor`)
- Label points that are actively retreating from their **GPX stream predecessor's** valid timestamp (`belowPrevValid`)
- Label points whose timestamp equals the **stream predecessor**'s valid time (`adjacentDuplicate`)
- Detect stream-wide timestamp value recurrence via a hash map (`nonAdjacentRepeat`)
- Provide tag-indexed output (fast set-level queries) and point-annotated output (sequential correction workflow) simultaneously
- Emit per-segment temporal summaries for the correction layer

## Function

### `auditTimestamps(points)`

**Parameters:**
- `points` (Array): Ingestion-shaped point objects (`gpxIndex`, `trkSegIndex`, `timeAbsent`, `timeMs`, optional `timeRaw` for forwarding in unparsable annotations only)

**Returns:**
```javascript
{
  audit: {
    temporal: {
      totalPointsEvaluated,
      session: {
        rawSessionDurationSec,          // (lastValidMs - firstValidMs) / 1000, or null
        parseableTimestampPointCount    // points with finite ingestion timeMs
      },
      tagCounts: {
        missing,             // timeAbsent === true, or malformed point without finite timeMs
        unparsable,          // timeAbsent === false and no finite timeMs
        adjacentDuplicate,   // same as accepted point at gpxIndex-1 with finite timeMs
        belowAnchor,         // timestampMs < anchorTimestampMs (monotonic high-water mark)
        belowPrevValid,      // timestampMs < predecessor's timeMs (predecessor = accepted gpxIndex-1 with finite time)
        nonAdjacentRepeat    // value seen earlier in stream, but NOT stream-adjacent duplicate
      },
      tagIndex: {
        missing:            [...gpxIndexes],
        unparsable:         [...gpxIndexes],
        adjacentDuplicate:  [...gpxIndexes],
        belowAnchor:        [...gpxIndexes],
        belowPrevValid:     [...gpxIndexes],
        nonAdjacentRepeat:  [...gpxIndexes]
      },
      pointAnnotations: [   // sparse — only anomalous points emitted
        // missing point:
        { gpxIndex, missing: true },
        // unparsable point:
        { gpxIndex, unparsable: true, timeRaw?: string|null },
        // valid-but-anomalous point (all applicable tags flat on object):
        {
          gpxIndex,
          timestampMs,
          anchorMs,
          belowAnchor?: true,
          depthFromAnchorMs?: number,       // anchorMs - timestampMs; only when belowAnchor
          belowPrevValid?: true,
          adjacentDuplicate?: true,
          nonAdjacentRepeat?: true,
          firstOccurrenceGpxIndex?: number  // only when nonAdjacentRepeat
        }
      ],
      perSegment: [         // one entry per trkSegIndex, sorted ascending
        {
          trkSegIndex:                    number,
          tagCounts:                      { missing, unparsable, adjacentDuplicate, belowAnchor, belowPrevValid, nonAdjacentRepeat },
          tagIndex:                       { missing: [], unparsable: [], adjacentDuplicate: [], belowAnchor: [], belowPrevValid: [], nonAdjacentRepeat: [] },
          monotonicity: {
            hasViolation:                 boolean,
            violationCount:               number    // count of belowAnchor tags in this segment
          },
          consecutiveTimestampPairsCount: number,
          positiveTimeDeltaCount:         number,
          parseableTimestampPointCount:   number,
          hasAnyPositiveTimeDelta:        boolean
        }
      ]
    }
  }
}
```

## Tag Definitions and Exact Conditions

Tags are non-exclusive. A point receives every tag that applies. Missing and unparsable points do not receive any comparative tags (they terminate the per-point loop early).

| Tag | Condition | Metadata |
|---|---|---|
| `missing` | `timeAbsent === true`, or `timeAbsent` not `false` and no finite `timeMs` | — |
| `unparsable` | `timeAbsent === false` and `timeMs` not finite | optional forwarded `timeRaw` on annotation (not parsed here) |
| `adjacentDuplicate` | Accepted point at `gpxIndex - 1` exists with finite `timeMs`, and `timestampMs ===` that `timeMs` | — |
| `belowAnchor` | `timestampMs < anchorTimestampMs` | `depthFromAnchorMs` |
| `belowPrevValid` | Predecessor as above exists and `timestampMs <` its `timeMs` | — |
| `nonAdjacentRepeat` | `seenTimestamps.has(timestampMs)` AND not `adjacentDuplicate` | `firstOccurrenceGpxIndex` |

Note: `adjacentDuplicate` and `nonAdjacentRepeat` are mutually exclusive by definition.

## Anchor and State Semantics

- **`anchorTimestampMs`**: monotonic high-water mark. Initialized to the first valid timestamp. Advances only when `timestampMs > anchorTimestampMs`. Adjacent duplicates and below-anchor points do not move the anchor.

**Stream predecessor for comparative tags:** `adjacentDuplicate` and `belowPrevValid` use the **accepted** point at **`gpxIndex - 1`** (if present in the `pointByGpxIndex` map) with finite `timeMs`. If that GPX row was rejected or has no parseable time, those two tags are not applied. See ADR-0013.

The `seenTimestamps` Map stores the first `gpxIndex` of every timestamp value encountered. O(1) amortized lookup; avoids O(N²) in tracks with no repeats.

## belowAnchor vs belowPrevValid Distinction

- `belowAnchor` only: behind the monotonic high-water mark but locally progressing forward. Stream is "still in the hole" but moving right direction.
- `belowAnchor + belowPrevValid` together: lags the high-water mark AND retreats further from immediate predecessor. Stream is "actively digging deeper".

Example: `T=0, T=100, T=60, T=70, T=80, T=90, T=110`
- T=60: belowAnchor ✓, belowPrevValid ✓
- T=70: belowAnchor ✓, belowPrevValid ✗
- T=110: no tags (advances anchor to 110)

## Segment Awareness

Each point carries `trkSegIndex` from ingestion. The module builds per-segment output in two passes:

1. Stream-order scan counting `parseableCount`, `consecutivePairs`, and `positiveDeltas` per segment.
2. Iteration over `pointAnnotations` to populate per-segment `tagCounts` and `tagIndex`.

`perSegment[].monotonicity.violationCount` equals the per-segment `belowAnchor` count. This is the primary input to `participation-check.js` for classifying segments as `timestamp-sparse` or `fully-reversed`.

Follows ADR-correction-0013 (raw per-segment payloads; no classification in this module).

## Classification Design Decisions (non-exclusive architecture)

### Tags are non-exclusive

Every applicable tag fires. A point below the anchor that is also an adjacent duplicate receives both `belowAnchor` and `adjacentDuplicate`. The correction layer sees the full picture without re-deriving it.

### Anchor does not advance on duplicates or below-anchor points

`anchorTimestampMs` advances only when `timestampMs > anchorTimestampMs`. Concretely: `T=0, T=50, T=50, T=50, T=30` → anchor stays at T=50 through all three duplicates; T=30 is correctly tagged `belowAnchor`.

### Adjacent duplicate excludes nonAdjacentRepeat

`nonAdjacentRepeat` is gated on `!isAdjacentDup`. These two tags are structurally mutually exclusive.

### No "large forward jump" tag

A large positive step cannot be classified as anomalous from timestamps alone — it may be an intentional pause, restart, or stitching artifact. Downstream layers use geometry and continuity for that evaluation. The sampling audit exposes raw deltas.

### Stream-wide nonAdjacentRepeat (not block-local)

Detection covers the full stream via `Map<timestampMs, firstGpxIndex>`. The audit records fact of recurrence and first known position; it does not claim which occurrence is correct.

## Integration

- **Pipeline position:** runs after `gpx-ingestion-module.js`; independent of other audit modules.
- **Output consumed by:** `audit-export-module.js` assembles the result into `audit.temporal` of the final `audit.json`.
- **Correction layer:** `participation-check.js` consumes `perSegment[].monotonicity` and `perSegment[].hasAnyPositiveTimeDelta`; `phase1-loop.js` reads `tagIndex.belowAnchor`, `tagIndex.belowPrevValid`, `tagIndex.nonAdjacentRepeat` to drive proposals.
- Does not mutate points.

## Dependencies

- Ingestion supplies `timeAbsent` and `timeMs` (`Date.parse` runs only in ingestion). This module does not parse `timeRaw`.
- `Map` (ES6, available in all target environments).
