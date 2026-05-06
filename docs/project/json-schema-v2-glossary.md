<!-- generated-by: gsd-doc-writer -->
> **Last updated**: 2026-05-06

# JSON Schema Glossary and Naming Rules

This document covers both the audit schema (v2) and the correction schema (v1.0.0).

## Version intent

**Audit schema v2** is a clean replacement contract. Ambiguous names are removed in favor of descriptive, unit-aware names.

**Correction schema v1.0.0** is defined by ADR-correction-0012. Output keys are locked; proposals, drops, excludedFromTrust, and annotations are the canonical three-collection output.

## Naming rules

- Use explicit denominator in ratio names whenever ambiguity exists.
- Use explicit unit suffixes:
  - `Ms`, `Sec`, `Meters`, `Ratio`.
- Use explicit context words:
  - `Insertion`, `Final`, `Pair`, `Point`, `Block`, `Isolated`.
- Prefer `...Count` for integer counts.
- Prefer `...Events` for event arrays.
- Prefer `...blocks` for contiguous anomaly blocks.

---

## Audit schema (`audit.json`)

### Ingestion

Path: `audit.ingestion`

- `counts.totalPointCount`: total GPX points encountered in stream.
- `counts.validPointCount`: points accepted after coordinate validation.
- `counts.rejectedPointCount`: points rejected at ingestion.
- `context.hasAnyTimestampValues`: any point has a `<time>` element (`timeAbsent === false`), or non-ingestion point with non-null `timeRaw` (ingestion always sets `timeAbsent`).
- `rejections.rejectedPointCount`: rejected point count mirror.
- `rejections.events`: rejected point events.

### Temporal

Path: `audit.temporal`

Label-based per-point tags (`tagCounts`, `tagIndex`, `pointAnnotations`). Full field list and anchor semantics: [`pipeline/json-schema-v2-glossary.md`](pipeline/json-schema-v2-glossary.md#temporal).

- `totalPointsEvaluated`: points seen by temporal audit.
- `session.rawSessionDurationSec`: (lastValidMs − firstValidMs) / 1000; null if fewer than two valid timestamps.
- `session.parseableTimestampPointCount`: points with finite ingestion `timeMs` (temporal audit does not parse `timeRaw`).
- `tagCounts.missing` / `tagCounts.unparsable` / comparative tags — see pipeline glossary; `unparsable` annotations may forward `timeRaw` for debugging only.
- `perSegment[]`: per-segment blocks, each containing:
  - `trkSegIndex`
  - `consecutiveTimestampPairsCount`
  - `positiveTimeDeltaCount`
  - `parseableTimestampPointCount`
  - `hasAnyPositiveTimeDelta`
  - `tagIndex`: `{ belowAnchor, belowPrevValid, nonAdjacentRepeat, adjacentDuplicate, missing, unparsable }` (arrays of gpxIndex)

### Sampling

Path: `audit.sampling.time`

Time positive-`Δt` population is **GPX-stream-adjacent pairs** (`toGpxIndex === fromGpxIndex + 1`) with finite `timeMs` on both ends only (see pipeline glossary, ADR-0013).

#### Context

- `timestampContext.hasAnyParseableTimestamp`
- `timestampContext.hasAnyPositiveTimeDelta`
- `timestampContext.timestampedPointsCount`
- `timestampContext.consecutiveTimestampPairsCount`
- `timestampContext.positiveTimeDeltaCount`
- `timestampContext.rejections.nonPositiveTimeDeltaPairs.nonPositivePairCount`
- `timestampContext.rejections.nonPositiveTimeDeltaPairs.events`

#### Delta statistics

- `deltaStatistics.positiveDeltaCount`
- `deltaStatistics.minMs`
- `deltaStatistics.maxMs`
- `deltaStatistics.medianMs`

#### Clustering

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

#### Normalization

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

### Motion

Path: `audit.motion`

Label-based **stream-adjacent** pair output (`toGpxIndex === fromGpxIndex + 1`). Tags are **non-exclusive**. See [`pipeline/json-schema-v2-glossary.md`](pipeline/json-schema-v2-glossary.md#motion) for full field list.

- `summary.consecutivePairCount`, `summary.parameters.validFloorM`, `summary.parameters.validCeilingM`
- `tagCounts.backwardTime`, `tagCounts.zeroTimeDelta`, `tagCounts.timeUnresolvable`, `tagCounts.nonFiniteDistance`, `tagCounts.eleUnresolvable`
- `tagIndex.*` — per-tag arrays of `{ fromGpxIndex, toGpxIndex }`
- `pairAnnotations` — sparse; one object per tagged pair

**Not emitted:** forward-valid pair count, time/distance/speed aggregates. Derive clean pair count as `consecutivePairCount - pairAnnotations.length`.

### Elevation

Path: `audit.elevation`

Label-based **per-point** elevation channel tags (`tagCounts`, `tagIndex`, `pointAnnotations`). See [`pipeline/json-schema-v2-glossary.md`](pipeline/json-schema-v2-glossary.md#elevation).

### Export metadata

Path: `metadata`

- `schemaVersion`: `2.0.0`
- `generatedAtUtc`
- `source.fileName`
- `summary.totalPointCount`

---

## Correction schema (`correction.json`, schema v1.0.0)

Defined by ADR-correction-0012. All keys are locked.

### Top-level fields

- `metadata.schemaVersion`: `1.0.0`
- `metadata.generatedAtUtc`
- `metadata.paramsSnapshot`: parameters used for this run (e.g., `minTimestampPairCoverageRatio`, `multipassMaxIterations`, `lenientMaxImpliedSpeedKph`)

### Participation

- `participation`: global participation record
  - `mode`: `full` | `timestamp-sparse` | `geometry-only`
  - `coverageRatio`: `positiveTimeDeltaCount / consecutiveTimestampPairsCount`
  - `reasons`: string array (e.g., `insufficient-pair-coverage`, `no-parseable-timestamps`, `all-timestamps-uniform`)

### Segment profiles

- `segmentProfiles[]`: per-segment participation profiles (post-correction)
  - `trkSegIndex`
  - `mode`: `full` | `timestamp-sparse` | `geometry-only` | `fully-reversed`
  - `hasAnomalies`: boolean
  - `hasUsableTimes`: boolean (`parseableTimestampPointCount >= 2`)
  - `coverageRatio`
  - `isFullyReversed`: boolean
  - `spineEnvelope`: `{ minTimeMs, maxTimeMs }`
  - `iterationsRun`: Phase 1 iterations run for this segment
  - `exitReason`: Phase 1 exit reason string or null
  - `correctionIdle`: boolean

### Boundary classifications

- `boundaryClassifications[]`: inter-segment boundary records
  - types: `chunk_ordering`, `duplicate_chunk`, `timestamp_discontinuity`, `segment_boundary_gap`

### Spine intervals

- `spineIntervals[]`: per-segment spine-trusted point lists
  - `trkSegIndex`
  - `spinePoints[]`: `{ gpxIndex, timeMs }`
  - `spineEnvelope`: `{ minTimeMs, maxTimeMs }`

### Three-collection output (partition invariant)

Every `gpxIndex` ingested must appear in **exactly one** of these three collections:

- `drops[]`: dropped points
  - `{ gpxIndex, reason, stage }`
- `excludedFromTrust[]`: present in `workingOrderedPoints` but flagged unreliable
  - `{ gpxIndex, ... }`
- trusted-surviving: points in `canonicalTrustedPoints` (i.e., in `workingOrderedPoints` but not in `excludedFromTrust`)

### Proposals

- `proposals[]`: all proposals across all passes
  - Common fields: `id`, `kind`, `trkSegIndex`, `isEdgeProposal`, `applied` (boolean), `skipReason` (string or null if applied)
  - `kind: 'insert'`: `candidateGpxIndexes`, `isExactGroup`, `tPrev`, `tNext`, `bracketGpxIndexes`, `targetTimeMs`, `winner`
  - `kind: 'block-finding'`: `gpxIndexes`, `hasInternalMonotonicityViolation`, `bMin`, `bMax`, `prevGpxIndex`, `nextGpxIndex`, `tPrev`, `tNext`, `overlapStatus`, `kinematics`
  - `kind: 'adjacent-exact-drop'`: `keepGpxIndex`, `dropGpxIndex`, `eleMismatch`

**Proposal invariant:** every proposal has `applied` boolean; if `applied === false`, `skipReason` must be present.

### Annotations

- `annotations[]`: segment-scoped and session-scoped observations
  - `kind` must be in the locked enum (ADR-correction-0012)

### Rearrangements

- `rearrangements[]`: physical mutation log (insert-move, block-reorder, etc.)

### Phase outputs

- `stagedEdgeProposals[]`: Phase 2 input/output snapshot per segment (`trkSegIndex`, `firstEdge`, `lastEdge`)
- `multipass.perSegment[]`: per-segment Phase 1 pass log (`trkSegIndex`, `exitReason`, `iterationsRun`, `passes[]`)
- `phase2`: Phase 2 result summary
- `diagnostics`: Phase 3 residual sweep payload
- `coupledRegions[]`: coupling detection output
- `overlapBlockResolution[]`: overlap gate resolution records

### Point sequences

- `fullOrderedPoints[]`: gpxIndex-only sequence in current traversal order (post-correction)
- `survivingGpxIndexes[]`: gpxIndexes of trusted-surviving points (subset of `fullOrderedPoints` excluding `excludedFromTrust`)
- `canonicalTrustedPoints[]`: `{ gpxIndex, lat, lon, ele, timeMs, trkSegIndex }` for trusted-surviving subset in traversal order

### Partition invariant report

- `partitionInvariant`: `{ ingested, drops, excluded, trustedSurviving, workingOrderedPoints, ok, violations }`
  - `ok: true` is required; export throws if violated
