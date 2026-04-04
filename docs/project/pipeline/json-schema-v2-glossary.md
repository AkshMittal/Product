# JSON Schema v2 Glossary and Naming Rules

## Version intent

Schema v2 is a clean replacement contract. Ambiguous names are removed in favor of descriptive, unit-aware names.

## Naming rules

- Use explicit denominator in ratio names whenever ambiguity exists.
- Use explicit unit suffixes:
  - `Ms`, `Sec`, `Meters`, `Ratio`.
- Use explicit context words:
  - `Insertion`, `Final`, `Pair`, `Point`, `Block`, `Isolated`.
- Prefer `...Count` for integer counts.
- Prefer `...Events` for event arrays.
- Prefer `...blocks` for contiguous anomaly blocks.

## Module glossary

## Ingestion

Path: `audit.ingestion`

- `counts.totalPointCount`: total GPX points encountered in stream.
- `counts.validPointCount`: points accepted after coordinate validation.
- `counts.rejectedPointCount`: points rejected at ingestion.
- `context.hasAnyTimestampValues`: any point has a `<time>` element (`timeAbsent === false`), or non-ingestion point with non-null `timeRaw` (ingestion always sets `timeAbsent`).
- `rejections.rejectedPointCount`: rejected point count mirror.
- `rejections.events`: rejected point events.

## Temporal

Path: `audit.temporal`

Tag-based per-point labeling. Tags are non-exclusive; a point carries every applicable tag simultaneously. Only anomalous points appear in `pointAnnotations`. Nominal points produce no entry.

### Top-level fields

- `totalPointsEvaluated`: points seen by temporal audit.
- `session.rawSessionDurationSec`: (lastValidMs - firstValidMs) / 1000; null if fewer than two valid timestamps.
- `session.parseableTimestampPointCount`: points with finite ingestion `timeMs` (temporal audit does not parse `timeRaw`).

### tagCounts

Count of points carrying each tag. Tags are non-exclusive; sums can exceed `totalPointsEvaluated`.

- `tagCounts.missing`: `timeAbsent === true`, or point without `timeAbsent === false` and no finite `timeMs` (malformed input).
- `tagCounts.unparsable`: `timeAbsent === false` and no finite `timeMs` (`<time>` present but empty or not parseable at ingestion).
- `tagCounts.adjacentDuplicate`: `timestampMs === prevValidTimestampMs`. Mutually exclusive with `nonAdjacentRepeat`.
- `tagCounts.belowAnchor`: `timestampMs < anchorTimestampMs` (behind the monotonic high-water mark).
- `tagCounts.belowPrevValid`: `timestampMs < prevValidTimestampMs` (actively retreating from immediate predecessor).
- `tagCounts.nonAdjacentRepeat`: value appeared earlier in stream AND is not the immediately preceding valid point. Mutually exclusive with `adjacentDuplicate`.

### tagIndex

Per-tag arrays of `gpxIndex` values. Mirrors `tagCounts` but provides the actual point set for downstream queries.

- `tagIndex.missing`, `tagIndex.unparsable`, `tagIndex.adjacentDuplicate`, `tagIndex.belowAnchor`, `tagIndex.belowPrevValid`, `tagIndex.nonAdjacentRepeat`

### pointAnnotations

Sparse array of per-point objects (only anomalous points). Fields present only when the tag applies:

- `gpxIndex` (always present)
- `missing: true` - for missing points (no other fields)
- `unparsable: true` — optional forwarded `timeRaw` when ingestion supplied non-null text (debugging only; not parsed in audit)
- `timestampMs` - valid parsed milliseconds (comparative-tag points only)
- `anchorMs` - monotonic anchor value at time of this point
- `belowAnchor: true` + `depthFromAnchorMs` - how far below the anchor
- `belowPrevValid: true`
- `adjacentDuplicate: true`
- `nonAdjacentRepeat: true` + `firstOccurrenceGpxIndex`

### Anchor semantics

`anchorTimestampMs` advances only when `timestampMs > anchorTimestampMs`. Adjacent duplicates and below-anchor points do not move the anchor. The anchor is a strict monotonic high-water mark over distinct forward progress.

### belowAnchor vs belowPrevValid distinction

- `belowAnchor` only: still behind the high-water mark but locally moving forward ("in the hole, but recovering").
- `belowAnchor + belowPrevValid` together: behind the high-water mark AND retreating further from the preceding valid point ("actively digging deeper").

### Design decisions (semantics, important)

- **Tags are non-exclusive**: the old adjacent-duplicate priority over backtracking is removed. A point that is both an adjacent duplicate and below the anchor carries both tags.
- **No "large forward jump" tag**: cannot be distinguished from a valid recording pause without geometry. Raw deltas are available via the sampling audit.
- **nonAdjacentRepeat is stream-wide**: uses `Map<timestampMs, firstGpxIndex>` for O(1) per-point lookup (avoids O(N^2)). First occurrence is not assumed correct.
- **Time-period overlap is downstream**: whether a backtracking region's time range overlaps a prior time range is a range-analysis problem (e.g., `[1,3,5,7]` vs `[2,4,6]` overlap despite no identical values). Requires global view and geometry.

## Sampling

Path: `audit.sampling.time`

### Context

- `timestampContext.hasAnyParseableTimestamp`
- `timestampContext.hasAnyPositiveTimeDelta`
- `timestampContext.timestampedPointsCount`
- `timestampContext.consecutiveTimestampPairsCount`
- `timestampContext.positiveTimeDeltaCount`
- `timestampContext.rejections.nonPositiveTimeDeltaPairs.nonPositivePairCount`
- `timestampContext.rejections.nonPositiveTimeDeltaPairs.events`

### Delta statistics

- `deltaStatistics.positiveDeltaCount`
- `deltaStatistics.minMs`
- `deltaStatistics.maxMs`
- `deltaStatistics.medianMs`

### Clustering

- `clustering.insertionRelativeThreshold`
- `clustering.totalDeltaCount`
- `clustering.sortedClusterCount`
- `clustering.sequentialClusterCount`
- `clustering.sortedClusterCountOverTotalDeltasRatio`
- `clustering.sequentialClusterCountOverTotalDeltasRatio`
- `clustering.sequentialOverSortedClusterCountRatio`

Per cluster:

- `centerSec`
- `count`
- `clusterShareOfTotalDeltas`
- `minSec`
- `maxSec`
- `spreadSec`
- `meanInsertionRelativeDeviation`
- `maxInsertionRelativeDeviation`
- `meanInsertionAbsoluteDeviationSec`
- `maxInsertionAbsoluteDeviationSec`
- `finalMeanAbsoluteDeviationSec`
- `finalMaxAbsoluteDeviationSec`
- `finalMeanRelativeDeviation`
- `finalMaxRelativeDeviation`
- `finalSpreadOverCenterRatio`

### Normalization

- `normalization.insertionRelativeThreshold`
- `normalization.totalDeltaCount`
- `normalization.sortedClusterCount`
- `normalization.sequentialClusterCount`
- `normalization.meanFinalAbsoluteDeviationSec`
- `normalization.maxFinalAbsoluteDeviationSec`
- `normalization.meanFinalRelativeDeviation`
- `normalization.maxFinalRelativeDeviation`
- `normalization.sortedClusterCountOverTotalDeltasRatio`
- `normalization.sequentialClusterCountOverTotalDeltasRatio`
- `normalization.sequentialOverSortedClusterCountRatio`
- `normalization.nonZeroFinalDeviationCount`
- `normalization.zeroFinalDeviationCount`

## Sampling (distance)

Path: `audit.sampling.distance`

### Pair inspection

- `pairInspection.consecutivePairCount`
- `pairInspection.rejections.invalidDistance.count`

### Delta statistics

- `deltaStatistics.deltaCount`
- `deltaStatistics.minMeters`
- `deltaStatistics.maxMeters`
- `deltaStatistics.medianMeters`

### Clustering

Operates on all distance deltas (complete population of consecutive spatial steps). `null` if
no valid distance deltas exist.

- `clustering.insertionRelativeThreshold`
- `clustering.totalDeltaCount`
- `clustering.sortedClusterCount`
- `clustering.sequentialClusterCount`
- `clustering.sortedClusterCountOverTotalDeltasRatio`
- `clustering.sequentialClusterCountOverTotalDeltasRatio`
- `clustering.sequentialOverSortedClusterCountRatio`

Per cluster:

- `centerMeters`
- `count`
- `clusterShareOfTotalDeltas`
- `minMeters`
- `maxMeters`
- `spreadMeters`
- `meanInsertionRelativeDeviation`
- `maxInsertionRelativeDeviation`
- `meanInsertionAbsoluteDeviationMeters`
- `maxInsertionAbsoluteDeviationMeters`
- `finalMeanAbsoluteDeviationMeters`
- `finalMaxAbsoluteDeviationMeters`
- `finalMeanRelativeDeviation`
- `finalMaxRelativeDeviation`
- `finalSpreadOverCenterRatio`

### Normalization

- `normalization.insertionRelativeThreshold`
- `normalization.totalDeltaCount`
- `normalization.sortedClusterCount`
- `normalization.sequentialClusterCount`
- `normalization.meanFinalAbsoluteDeviationMeters`
- `normalization.maxFinalAbsoluteDeviationMeters`
- `normalization.meanFinalRelativeDeviation`
- `normalization.maxFinalRelativeDeviation`
- `normalization.sortedClusterCountOverTotalDeltasRatio`
- `normalization.sequentialClusterCountOverTotalDeltasRatio`
- `normalization.sequentialOverSortedClusterCountRatio`
- `normalization.nonZeroFinalDeviationCount`
- `normalization.zeroFinalDeviationCount`

### Supplementary

- `timeConditionedDeltaCount`: geometry-conditioned deltas that also had a positive time delta pair.

## Motion

Path: `audit.motion`

Label-based, pair-centric output. Tags are **non-exclusive** — a pair receives every tag whose predicate fires. Only anomalous pairs appear in `pairAnnotations`. Pairs with no tags fired are forward-valid and fully observable (absence = not flagged). No derived kinematic stats (speed, distance, time) are emitted — downstream computes those using the exclusion sets.

### summary

- `summary.consecutivePairCount`: total adjacent pairs evaluated (always `points.length - 1`).
- `summary.parameters.validFloorM`: ele lower bound used for `eleUnresolvable` check.
- `summary.parameters.validCeilingM`: ele upper bound used for `eleUnresolvable` check.

**Note on `forwardValidPairCount`:** Not emitted. Derive as `consecutivePairCount - pairAnnotations.length`. Do NOT derive as `consecutivePairCount - sum(tagCounts)` — tags are non-exclusive and can stack on the same pair, causing double-counting.

### tagCounts

Count of pairs carrying each tag. Non-exclusive; sums can exceed `consecutivePairCount`.

- `tagCounts.backwardTime`: both endpoints have finite ingestion `timeMs`, Δt < 0.
- `tagCounts.zeroTimeDelta`: both endpoints have finite ingestion `timeMs`, Δt === 0.
- `tagCounts.timeUnresolvable`: one or both endpoints lack finite `timeMs`. (Missing vs unparsable is defined by ingestion `timeAbsent` + `timeMs` — consult `audit.temporal` for per-point cause.)
- `tagCounts.nonFiniteDistance`: haversine distance is non-finite.
- `tagCounts.eleUnresolvable`: one or both endpoints have `ele === null` or `ele` outside `[validFloorM, validCeilingM]`. Fired independently of time/distance tags.

### tagIndex

Per-tag arrays of pair identity objects. A pair that carries multiple tags appears in each relevant array.

- `tagIndex.backwardTime`: `[{ fromGpxIndex, toGpxIndex }, ...]`
- `tagIndex.zeroTimeDelta`: same shape.
- `tagIndex.timeUnresolvable`: same shape.
- `tagIndex.nonFiniteDistance`: same shape.
- `tagIndex.eleUnresolvable`: same shape.

**Downstream exclusion patterns:**
- Horizontal speed eligible pairs: all pairs NOT in `timeUnresolvable ∪ backwardTime ∪ zeroTimeDelta ∪ nonFiniteDistance`.
- 3D speed eligible pairs: additionally exclude `eleUnresolvable`.
- Δele (terrain) eligible pairs: exclude only `eleUnresolvable`.

### pairAnnotations

Sparse array — only anomalous pairs. One entry per pair regardless of how many tags fire.

- `fromGpxIndex` (always present)
- `toGpxIndex` (always present) — physically adjacent to `fromGpxIndex` in the points array; gpxIndex values may not be numerically contiguous if ingestion rejected intermediate points.
- `timeUnresolvable: true` — optional.
- `backwardTime: true` — optional. Mutually exclusive with `zeroTimeDelta` by math; not exclusive with others.
- `zeroTimeDelta: true` — optional. Mutually exclusive with `backwardTime` by math; not exclusive with others.
- `dtSec` — present when `backwardTime` or `zeroTimeDelta`; raw Δt in seconds (negative for backward, 0 for zero-delta).
- `ddMeters` — present when `timeUnresolvable` AND haversine is finite. Omitted if `nonFiniteDistance` also fires.
- `nonFiniteDistance: true` — optional.
- `eleUnresolvable: true` — optional. Independent of all time/distance tags; can co-occur with any combination.

## Elevation

Path: `audit.elevation`

Per-point label-based output (same hybrid pattern as `audit.temporal`). Tags are **pairwise mutually exclusive** across the **coverage** group (`missing`, `unparsable`, `outOfBounds`); `adjacentDuplicate` applies only to **in-bounds numeric** points.

### Top-level fields

- `totalPointsEvaluated`
- `validElevationPointCount` — points with finite `ele` inside `[validFloorM, validCeilingM]` (may include points also tagged `adjacentDuplicate`).
- `parameters.validFloorM`, `parameters.validCeilingM`

### tagCounts

- `missing` — no `<ele>` element (`ingestion`: `eleAbsent === true`).
- `unparsable` — `<ele>` present but not a finite number (`eleAbsent === false`, `ele === null`).
- `outOfBounds` — finite `ele` outside `[validFloorM, validCeilingM]`.
- `adjacentDuplicate` — in-bounds `ele` equals the **previous in-bounds** point’s `ele` (geometry order).

### tagIndex

Per-tag arrays of `gpxIndex` (numbers).

### pointAnnotations

Sparse — only points with at least one tag. Shapes include `{ gpxIndex, missing: true }`, `{ gpxIndex, unparsable: true }`, `{ gpxIndex, outOfBounds: true, ele }`, `{ gpxIndex, ele, adjacentDuplicate: true }`.

**Not emitted:** block summaries, min/max/span, consecutive Δele aggregates, co-presence with time — derive downstream from points + labels + `audit.temporal` / `audit.motion` if needed.

**Ingestion:** Valid points carry `eleAbsent: boolean` so `missing` and `unparsable` are distinguishable. Legacy points without `eleAbsent` and `ele === null` are classified as **missing**.

## Export metadata

Path: `metadata`

- `schemaVersion`: `2.0.0`
- `generatedAtUtc`
- `source.fileName`
- `summary.totalPointCount`

