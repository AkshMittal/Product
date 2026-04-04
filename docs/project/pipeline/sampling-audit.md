# Sampling Audit Module (Schema v2)

## Purpose

The sampling module performs an observational audit of time-delta sampling behavior and distance deltas. It does not mutate GPX points.

## Core principles

- Time audit and distance audit are separated.
- **Time deltas** use **physically adjacent** pairs only: both endpoints must have finite `timeMs`. There is **no bridging** across missing or unparsable timestamps (temporal audit owns gap labeling).
- Time-conditioned distance uses the same adjacent segment as horizontal distance when that edge has positive `Δt`.
- Distance deltas are always computed from consecutive coordinate pairs — no timestamp dependency.
- Clustering uses insertion-time threshold checks and final-center spread summaries.

## Input points (time channel)

Sampling uses **finite ingestion `timeMs` only** for timestamped points. It does not call `Date.parse` on `timeRaw`. Missing vs unparsable is defined at ingestion (`timeAbsent`, `timeMs`); see temporal audit for per-point labels.

## Time context fields

`audit.sampling.time.timestampContext`

- `hasAnyParseableTimestamp`: at least one parseable timestamp exists.
- `hasAnyPositiveTimeDelta`: at least one adjacent-pair positive `Δt` exists (both endpoints finite `timeMs`).
- `timestampedPointsCount`: points with parseable timestamp.
- `consecutiveTimestampPairsCount`: physically adjacent pairs where **both** endpoints have finite `timeMs` (evaluated for sign; includes non-positive rejects).
- `positiveTimeDeltaCount`: count of collected positive deltas.
- `rejections.nonPositiveTimeDeltaPairs.nonPositivePairCount`: rejected parseable pairs where delta <= 0.
- `rejections.nonPositiveTimeDeltaPairs.events`: event-level rejects.

## Time delta statistics

`audit.sampling.time.deltaStatistics`

- `positiveDeltaCount`
- `minMs`
- `maxMs`
- `medianMs`

## Clustering (v2 semantics)

`audit.sampling.time.clustering`

- `insertionRelativeThreshold`: alpha used at insertion check.
- `sortedClusterCount`
- `sequentialClusterCount`
- `sortedClusterCountOverTotalDeltasRatio`
- `sequentialClusterCountOverTotalDeltasRatio`
- `sequentialOverSortedClusterCountRatio`
- `clusters`

Each cluster object includes:

- `centerSec`: final stabilized center (median of cluster values).
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

### Important math distinction

- Insertion deviation metrics are computed against the center at the moment of acceptance.
- Final deviation metrics are computed against final `centerSec`.
- Therefore:
  - `maxInsertionRelativeDeviation` should stay below `insertionRelativeThreshold` by construction.
  - `finalMaxRelativeDeviation` can exceed the threshold due to center drift/chaining.

## Normalization metadata

`audit.sampling.time.normalization`

- `insertionRelativeThreshold`
- `totalDeltaCount`
- `sortedClusterCount`
- `sequentialClusterCount`
- `meanFinalAbsoluteDeviationSec`
- `maxFinalAbsoluteDeviationSec`
- `meanFinalRelativeDeviation`
- `maxFinalRelativeDeviation`
- `sortedClusterCountOverTotalDeltasRatio`
- `sequentialClusterCountOverTotalDeltasRatio`
- `sequentialOverSortedClusterCountRatio`
- `nonZeroFinalDeviationCount`
- `zeroFinalDeviationCount`

## Distance section

`audit.sampling.distance`

### Pair inspection

- `pairInspection.consecutivePairCount`
- `pairInspection.rejections.invalidDistance.count`

### Delta statistics

- `deltaStatistics.deltaCount`
- `deltaStatistics.minMeters`
- `deltaStatistics.maxMeters`
- `deltaStatistics.medianMeters`

### Clustering

Operates on all distance deltas (the complete population of consecutive spatial steps). Same 2%
relative insertion threshold algorithm as time clustering. `null` if no valid distance deltas exist.

- `clustering.insertionRelativeThreshold`
- `clustering.totalDeltaCount`
- `clustering.sortedClusterCount`
- `clustering.sequentialClusterCount`
- `clustering.sortedClusterCountOverTotalDeltasRatio`
- `clustering.sequentialClusterCountOverTotalDeltasRatio`
- `clustering.sequentialOverSortedClusterCountRatio`
- `clustering.clusters`

Each cluster object includes:

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

- `timeConditionedDeltaCount`: count of distance deltas that were also paired with a positive time
  delta. Informational only; not used for clustering.

### Important math distinction

- Insertion deviation metrics are computed against the center at the moment of acceptance.
- Final deviation metrics are computed against final `centerMeters`.
- Therefore:
  - `maxInsertionRelativeDeviation` should stay below `insertionRelativeThreshold` by construction.
  - `finalMaxRelativeDeviation` can exceed the threshold due to center drift/chaining.

## Notes

- Time delta collection uses only positive deltas.
- Distance clustering uses all consecutive distance deltas regardless of timestamp availability.
- Distance deltas are always strictly adjacent (no gap-bridging), matching the **physically adjacent** side of ADR-0003 (elevation audit no longer emits Δele aggregates; stepping model for downstream ele deltas stays adjacent-only).
- Module output is observational and deterministic for same input order.
