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

Label-based per-point tags (`tagCounts`, `tagIndex`, `pointAnnotations`). Full field list and anchor semantics: [`pipeline/json-schema-v2-glossary.md`](pipeline/json-schema-v2-glossary.md#temporal).

- `totalPointsEvaluated`: points seen by temporal audit.
- `session.rawSessionDurationSec`: (lastValidMs − firstValidMs) / 1000; null if fewer than two valid timestamps.
- `session.parseableTimestampPointCount`: points with finite ingestion `timeMs` (temporal audit does not parse `timeRaw`).
- `tagCounts.missing` / `tagCounts.unparsable` / comparative tags — see pipeline glossary; `unparsable` annotations may forward `timeRaw` for debugging only.

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

Label-based adjacent-pair output. Tags are **non-exclusive**. See [`pipeline/json-schema-v2-glossary.md`](pipeline/json-schema-v2-glossary.md#motion) for full field list.

- `summary.consecutivePairCount`, `summary.parameters.validFloorM`, `summary.parameters.validCeilingM`
- `tagCounts.backwardTime`, `tagCounts.zeroTimeDelta`, `tagCounts.timeUnresolvable`, `tagCounts.nonFiniteDistance`, `tagCounts.eleUnresolvable`
- `tagIndex.*` — per-tag arrays of `{ fromGpxIndex, toGpxIndex }`
- `pairAnnotations` — sparse; one object per tagged pair

**Not emitted:** forward-valid pair count, time/distance/speed aggregates. Derive clean pair count as `consecutivePairCount - pairAnnotations.length`.

## Elevation

Path: `audit.elevation`

Label-based **per-point** elevation channel tags (`tagCounts`, `tagIndex`, `pointAnnotations`). See [`pipeline/json-schema-v2-glossary.md`](pipeline/json-schema-v2-glossary.md#elevation).

## Export metadata

Path: `metadata`

- `schemaVersion`: `2.0.0`
- `generatedAtUtc`
- `source.fileName`
- `summary.totalPointCount`

