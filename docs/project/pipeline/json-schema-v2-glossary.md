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
- `context.hasAnyTimestampValues`: any non-empty timestamp value exists.
- `rejections.rejectedPointCount`: rejected point count mirror.
- `rejections.events`: rejected point events.

## Temporal

Path: `audit.temporal`

Tag-based per-point labeling. Tags are non-exclusive; a point carries every applicable tag simultaneously. Only anomalous points appear in `pointAnnotations`. Nominal points produce no entry.

### Top-level fields

- `totalPointsEvaluated`: points seen by temporal audit.
- `session.rawSessionDurationSec`: (lastValidMs - firstValidMs) / 1000; null if fewer than two valid timestamps.
- `session.parseableTimestampPointCount`: points where `Date.parse()` succeeded.

### tagCounts

Count of points carrying each tag. Tags are non-exclusive; sums can exceed `totalPointsEvaluated`.

- `tagCounts.missing`: `timeRaw === null`.
- `tagCounts.unparsable`: `Date.parse(timeRaw)` is NaN.
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
- `unparsable: true` - for unparsable points (no other fields)
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

- `evaluatedPairs.consecutivePairCount`
- `evaluatedPairs.forwardValidPairCount`

Rejections:

- `rejections.missingTimestampPairCount`
- `rejections.unparsableTimestampPairCount`
- `rejections.nonFiniteDistancePairCount`
- `rejections.backwardTimePairCount`
- `rejections.zeroTimeDeltaPairCount`
- `rejections.events.*`

Time and distance:

- `time.validMotionTimeSeconds`
- `time.invalidTimeSeconds`
- `time.invalidTimeShareOfEvaluatedTime`
- `distance.totalForwardValidDistanceMeters`

Speed:

- `speed.meanSpeedMps`
- `speed.medianSpeedMps`
- `speed.maxSpeedMps`

## Export metadata

Path: `metadata`

- `schemaVersion`: `2.0.0`
- `generatedAtUtc`
- `source.fileName`
- `summary.totalPointCount`

