<!-- generated-by: gsd-doc-writer -->
# Motion Audit Module

## Purpose

`motion-audit.js` performs an **observational, adjacent-pair labeling** pass: it records which consecutive point pairs carry motion anomaly flags without computing speed, distance totals, time totals, or any derived aggregates. Those belong in downstream layers.

The module is independent from sampling audit decisions; it walks the same ingestion-ordered point array.

## Public API

```javascript
auditMotion(points, params?)
```

- `params` (optional):
  - `validFloorM` (number, default `-500`) — lower bound for endpoint elevation considered valid for motion
  - `validCeilingM` (number, default `9500`) — upper bound for the same

Elevation bounds apply only to the `eleUnresolvable` predicate; they mirror the motion slice of eligibility, not the full elevation-audit channel contract.

## Input point shape

- `lat`, `lon` — finite numbers (validated at ingestion)
- `timeMs` — finite ms since epoch, or `null`; motion uses **only** finite `timeMs` (no `Date.parse`). Missing vs unparsable is not re-derived here — see `audit.temporal`.
- `gpxIndex` — stable ingestion index (number)
- `trkSegIndex` — `<trkseg>` index (number); required for per-segment output
- `ele` — optional; `number`, `null`, or `undefined` (treated as missing for motion ele checks)

## Core behavior

- Evaluates **GPX-stream-adjacent pairs only**: a pair is included only when `curr.gpxIndex === prev.gpxIndex + 1`. Rejected GPX rows are absent from `points[]`, so array neighbors are not always stream-adjacent. See ADR-0013.
- **No anchored timestamp chaining** — no `prevTimestampMs` that bridges across timestamp gaps.
- Computes haversine horizontal distance between the two endpoints.
- Applies **five independent, non-exclusive** boolean predicates per pair. A pair receives every tag whose condition holds; all applicable tags stack on one `pairAnnotations` entry.

### Tag definitions

| Tag | Condition |
|-----|-----------|
| `timeUnresolvable` | One or both endpoints lack finite `timeMs` |
| `backwardTime` | Both timestamps finite AND `curr.timeMs < prev.timeMs` (`dtSec < 0`) |
| `zeroTimeDelta` | Both timestamps finite AND `curr.timeMs === prev.timeMs` (`dtSec === 0`) |
| `nonFiniteDistance` | Haversine result is not finite |
| `eleUnresolvable` | Either endpoint elevation is not a finite number within `[validFloorM, validCeilingM]` |

`backwardTime` and `zeroTimeDelta` are mutually exclusive (both require finite timestamps, but one requires negative and the other zero delta). All other combinations can co-occur.

## Output shape

Returned as `{ audit: { motion: { ... } } }`:

| Field | Description |
|-------|-------------|
| `summary.consecutivePairCount` | Count of stream-adjacent pairs evaluated (not `points.length - 1`) |
| `summary.parameters` | `{ validFloorM, validCeilingM }` actually used |
| `tagCounts` | Per-tag counts of **pairs** carrying that tag (non-exclusive; sums can exceed `consecutivePairCount`) |
| `tagIndex` | Per tag, array of `{ fromGpxIndex, toGpxIndex }` pair identities |
| `pairAnnotations` | Sparse — one object per pair with ≥1 tag; flags stacked flat on object |
| `perSegment` | Array of per-segment summaries (see below) |

**Not emitted:** forward-valid pair count, time/distance/speed aggregates, legacy rejection bucket counters.

Derive clean pair count as: `consecutivePairCount - pairAnnotations.length`

Do **not** use `consecutivePairCount - sum(tagCounts)` — tags stack on the same pair.

### Per-segment summary shape

Each entry in `perSegment` (sorted by `trkSegIndex`):

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

## Segment Awareness

Each point carries `trkSegIndex` from ingestion. The module builds per-segment output by:
1. Building a `Map<gpxIndex, trkSegIndex>` lookup from the points array.
2. Counting consecutive pairs per segment (stream-adjacency checked via `gpxStreamAdjacentPair`).
3. Iterating `pairAnnotations` and attributing each tagged pair to the segment of its `fromGpxIndex`.

Per-segment data emitted as `perSegment[]` sorted ascending by `trkSegIndex`. Follows ADR-correction-0013 (raw per-segment payloads; classification done by correction layer).

## Relationship to temporal audit

`timeUnresolvable` means one or both endpoints lack finite parsed time for this pair. It does **not** re-label why (missing vs unparsable); use `audit.temporal` for point-level cause.

## Integration

- **Pipeline position:** runs after `gpx-ingestion-module.js` and alongside other audit modules; consumes the same `points[]` array.
- **Output consumed by:** `audit-export-module.js` assembles the result into `audit.motion` of the final `audit.json`.
- **Correction layer:** `correction-runner.js` reads motion `perSegment` tagCounts as supporting evidence for segment participation classification.
- Does not mutate points.
