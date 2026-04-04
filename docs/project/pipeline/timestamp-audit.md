# Timestamp Audit Module

## Overview

The Timestamp Audit Module performs an observational, per-point labeling pass on timestamp data in GPX points. It analyzes timestamp quality and ordering without mutating, reordering, or normalizing the data. The output is a set of non-exclusive boolean tags applied only to anomalous points.

No point is presumed correct or incorrect. The audit records what is observable — not what should be done about it. Classification and correction decisions belong to downstream layers.

## Purpose

- Identify points with missing or unparsable timestamps (ingestion-time issues)
- Label points that are behind the monotonic high-water mark (`belowAnchor`)
- Label points that are actively retreating from their immediate predecessor (`belowPrevValid`)
- Label points that are adjacent to an equal-valued predecessor (`adjacentDuplicate`)
- Detect stream-wide timestamp value recurrence via a hash map (`nonAdjacentRepeat`)
- Provide tag-indexed output (fast set-level queries) and point-annotated output (sequential correction workflow) simultaneously

## Function

### `auditTimestamps(points)`

**Parameters:**
- `points` (Array): Ingestion-shaped point objects (`gpxIndex`, `timeAbsent`, `timeMs`, optional `timeRaw` for forwarding in unparsable annotations only)

**Returns:**
```javascript
{
  audit: {
    temporal: {
      totalPointsEvaluated,     // total points seen
      session: {
        rawSessionDurationSec,          // (lastValidMs - firstValidMs) / 1000, or null
        parseableTimestampPointCount    // points with finite ingestion timeMs
      },
      tagCounts: {
        missing,             // timeAbsent === true, or malformed point without finite timeMs
        unparsable,          // timeAbsent === false and no finite timeMs
        adjacentDuplicate,   // timestampMs === prevValidTimestampMs
        belowAnchor,         // timestampMs < anchorTimestampMs (monotonic high-water mark)
        belowPrevValid,      // timestampMs < prevValidTimestampMs (strictly less than predecessor)
        nonAdjacentRepeat    // value seen earlier in stream, but NOT the immediately preceding valid point
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
        // missing point example:
        { gpxIndex, missing: true },
        // unparsable point example:
        { gpxIndex, unparsable: true, timeRaw?: string|null },
        // valid-but-anomalous point example (all applicable tags flat on object):
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
| `adjacentDuplicate` | `timestampMs === prevValidTimestampMs` | — |
| `belowAnchor` | `timestampMs < anchorTimestampMs` | `depthFromAnchorMs` |
| `belowPrevValid` | `timestampMs < prevValidTimestampMs` | — |
| `nonAdjacentRepeat` | `seenTimestamps.has(timestampMs)` AND `timestampMs !== prevValidTimestampMs` | `firstOccurrenceGpxIndex` |

Note: `adjacentDuplicate` and `nonAdjacentRepeat` are mutually exclusive by definition (a point cannot be simultaneously adjacent and non-adjacent to the same value).

## Anchor and State Semantics

Two state variables track comparative context:

- **`anchorTimestampMs`**: monotonic high-water mark. Initialized to the first valid timestamp. Advances only when `timestampMs > anchorTimestampMs`. Adjacent duplicates and below-anchor points do not move the anchor.
- **`prevValidTimestampMs`**: most recent valid parsed timestamp. Updates on every valid point, including duplicates and below-anchor points.

The `seenTimestamps` Map stores the first gpxIndex of every timestamp value encountered. It is populated once per value (not updated on re-occurrence). This gives O(1) lookup per point, avoiding O(N²) behavior in tracks with no repeats.

## belowAnchor vs belowPrevValid Distinction

These two tags cover overlapping but distinct cases:

- `belowAnchor` only: the point is behind the monotonic high-water mark but is locally progressing forward relative to its predecessor. The stream is "still in the hole" but moving in the right direction.
- `belowAnchor + belowPrevValid` together: the point both lags the high-water mark AND retreats further from its immediate predecessor. The stream is "actively digging deeper".

Example: `T=0, T=100, T=60, T=70, T=80, T=90, T=110`
- T=60: belowAnchor ✓, belowPrevValid ✓ (dropped below anchor=100 and below prev=100)
- T=70: belowAnchor ✓, belowPrevValid ✗ (still behind anchor=100, but 70 > 60 locally)
- T=80, T=90: same as T=70
- T=110: no tags (advances anchor to 110)

## Classification Design Decisions (non-exclusive architecture)

### Decision 1: Tags are non-exclusive

In the previous block-based architecture, adjacent duplicate detection had priority over backtracking. This caused a point that was simultaneously equal to its predecessor AND below the anchor to be classified only as "duplicate", hiding the backtracking condition.

The tag-based architecture removes this priority ordering. Every applicable tag fires. A point below the anchor that is also an adjacent duplicate receives both `belowAnchor` and `adjacentDuplicate`. The correction layer sees the full picture without needing to re-derive it.

### Decision 2: The anchor does not advance on duplicates or below-anchor points

`anchorTimestampMs` only advances when `timestampMs > anchorTimestampMs`. A run of adjacent duplicates "stalls" the anchor; a below-anchor point cannot move it backward. This means the anchor is a strict monotonic high-water mark over genuinely new forward progress.

Concretely: `T=0, T=50, T=50, T=50, T=30` → anchor stays at T=50 through all three duplicates; T=30 is correctly tagged `belowAnchor` against anchor=T=50.

### Decision 3: Adjacent duplicate excludes nonAdjacentRepeat

The `nonAdjacentRepeat` check is gated on `!isAdjacentDup`. A point that equals its immediate predecessor is tagged `adjacentDuplicate`, not `nonAdjacentRepeat`, even if the value appeared earlier in the stream. These two tags are structurally mutually exclusive.

### Decision 4: No "large forward jump" tag

A large positive timestamp step cannot be classified as anomalous from timestamps alone. It may be an intentional recording pause, a device restart, or a stitching artifact — the audit has no way to distinguish. Any jump threshold would be an interpretation. Downstream layers use geometry and continuity to evaluate forward jumps. The sampling audit exposes raw deltas for that purpose.

### Decision 5: Stream-wide nonAdjacentRepeat (not block-local)

Non-adjacent repeat detection covers the full stream via a `Map<timestampMs, firstGpxIndex>`. A re-occurring value 1000 points later is detected the same as one 3 points later. The audit records the fact of recurrence and the first known position; it does not claim which occurrence is correct. "First" is only an ordering fact.

### Decision 6: Time-period overlap between segments is downstream

Detecting whether a backtracking region's time range overlaps (not just matches) previously observed time ranges is a range analysis problem. Example: `[1, 3, 5, 7, 9]` and `[2, 4, 6, 8]` have dense interval overlap with zero identical timestamps. This kind of analysis requires a global view of the full track and typically benefits from geometry. It is explicitly out of scope for the timestamp audit module.

## Output Structure Notes

`tagIndex` is optimized for set-level queries (e.g., "which points are belowAnchor?") and downstream passes that need only a specific tag's population.

`pointAnnotations` is optimized for sequential processing (e.g., a correction layer reading points in order and needing all tags for each anomalous point in one lookup).

Both are complementary and are emitted together without duplication concerns — they serve different algorithmic patterns.

## Dependencies

- Ingestion supplies `timeAbsent` and `timeMs` (`Date.parse` runs only in ingestion for GPX `<time>` text). This module does not parse `timeRaw`.
- `Map` (ES6, available in all target environments)
