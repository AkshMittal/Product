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

- `totalPointsEvaluated`: points seen by temporal audit.
- `session.rawSessionDurationSec`: last valid timestamp minus first valid timestamp.
- `session.parseableTimestampPointCount`: points with parseable timestamps.
- `temporalOrder.monotonicForwardCount`: forward/non-backtracking progression count.

Per anomaly group (`missing`, `unparsable`, `duplicate`, `backtracking`):

- `pointCount`
- `pointCountOverTotalPointsRatio`
- `maxBlockLength`
- `blocks`
- `isolatedPointCount`
- `isolatedPointEvents`

Backtracking-only:

- `maxDepthFromAnchorMs`: max depth below monotonic anchor.

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
- `clustering.totalPositiveTimeDeltaCount`
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

- `normalization.meanFinalAbsoluteDeviationSec`
- `normalization.maxFinalAbsoluteDeviationSec`
- `normalization.meanFinalRelativeDeviation`
- `normalization.maxFinalRelativeDeviation`
- `normalization.globalFinalMeanAbsoluteDeviationSec`
- `normalization.globalFinalMaxAbsoluteDeviationSec`
- `normalization.globalFinalMeanRelativeDeviation`
- `normalization.globalFinalMaxRelativeDeviation`
- `normalization.nonZeroFinalDeviationCount`
- `normalization.zeroFinalDeviationCount`

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

