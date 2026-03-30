# Sampling Audit Module (Schema v2)

## Purpose

The sampling module performs an observational audit of time-delta sampling behavior and distance deltas. It does not mutate GPX points.

## Core principles

- Time audit and distance audit are separated.
- Time-conditioned metrics require positive time progression.
- Geometry-conditioned (valid-distance) distance metrics are always available from consecutive coordinate pairs.
- Clustering uses insertion-time threshold checks and final-center spread summaries.

## Time context fields

`audit.sampling.time.timestampContext`

- `hasAnyParseableTimestamp`: at least one parseable timestamp exists.
- `hasAnyPositiveTimeDelta`: at least one consecutive positive delta exists.
- `timestampedPointsCount`: points with parseable timestamp.
- `consecutiveTimestampPairsCount`: consecutive parseable pairs encountered.
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
- `totalPositiveTimeDeltaCount`
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
- `totalPositiveTimeDeltaCount`
- `sortedClusterCount`
- `sequentialClusterCount`
- `meanFinalAbsoluteDeviationSec`
- `maxFinalAbsoluteDeviationSec`
- `meanFinalRelativeDeviation`
- `maxFinalRelativeDeviation`
- `globalFinalMeanAbsoluteDeviationSec`
- `globalFinalMaxAbsoluteDeviationSec`
- `globalFinalMeanRelativeDeviation`
- `globalFinalMaxRelativeDeviation`
- `sortedClusterCountOverTotalDeltasRatio`
- `sequentialClusterCountOverTotalDeltasRatio`
- `sequentialOverSortedClusterCountRatio`
- `nonZeroFinalDeviationCount`
- `zeroFinalDeviationCount`

## Distance section

`audit.sampling.distance`

- `pairInspection.consecutivePairCount`
- `pairInspection.rejections.invalidDistance.count`
- `geometryConditioned.deltaCount`
- `timeConditioned.deltaCount`

## Notes

- Time delta collection uses only positive deltas.
- Distance audit uses geometry-conditioned deltas when time progression is absent.
- Module output is observational and deterministic for same input order.
omfg # Sampling Audit Module

## Overview

The Sampling Audit Module performs an observational audit pass on time sampling behavior and distance deltas in GPX points. It collects positive time deltas between consecutive valid timestamps and computes distance deltas using the Haversine formula. The module distinguishes between timestamp presence and timestamp progression usability, ensuring geometry-based distance analysis is available even when timestamps are present but non-informative.

## Purpose

This module serves to:

- Analyze time sampling patterns by collecting positive time deltas
- Compute distance deltas between consecutive valid coordinate pairs
- Generate joint time-distance pairs for correlation analysis
- Distinguish between time-conditioned and geometry-conditioned (valid-distance) distance analysis
- Provide detailed audit statistics and flagged events for diagnostic purposes

## Functions

### `auditSampling(points, gpxFilename)`

Audits time sampling behavior and distance deltas in an array of points.

**Parameters:**

- `points` (Array): Array of point objects with `timeRaw`, `lat`, `lon` properties
- `gpxFilename` (string, optional): Optional GPX filename (without extension) for download naming

**Returns:**

- `Object` containing:
  - `timeDeltasMs` (Array): Array of positive time deltas in milliseconds
  - `totalDeltaCount` (number): Count of positive time deltas collected
  - `minDeltaMs` (number|null): Minimum time delta in milliseconds, or `null` if no deltas
  - `maxDeltaMs` (number|null): Maximum time delta in milliseconds, or `null` if no deltas
  - `medianDeltaMs` (number|null): Median time delta in milliseconds, or `null` if no deltas
  - `distanceDeltasM` (Array): Primary distance delta array (time-conditioned if `hasTimeProgression`, else geometry-conditioned)
  - `distanceDeltasMGeometryConditioned` (Array): Always-computed distance deltas for consecutive valid-coordinate pairs (valid-distance / geometry conditioned; not time-gated)
  - `distanceDeltasMTimeConditioned` (Array): Time-conditioned distance deltas (only when `hasTimeProgression`)
  - `timeDistancePairs` (Array<{dtSec: number, ddMeters: number}>): Joint time-distance pairs (only when `hasTimeProgression`)
  - `hasTimeProgression` (boolean): `true` if at least one positive consecutive time delta observed, `false` otherwise
  - `hasValidTimestamps` (boolean): Descriptive flag indicating presence of any parseable timestamp
  - `rejectedTimestampPairsDeltaLeqZero` (number): Count of timestamp pairs rejected due to non-positive delta
  - `consecutivePointPairsConsidered` (number): Count of consecutive point pairs considered for geometry-conditioned distance
  - `rejectedDistanceInvalidOrZero` (number): Count of distance deltas rejected due to invalid or zero values
  - `jointPairsWithBothTimestamps` (number): Count of pairs with both timestamps in joint audit
  - `jointRejectedMissingTimestamp` (number): Count of joint pairs rejected due to missing timestamp
  - `jointRejectedNonPositiveDt` (number): Count of joint pairs rejected due to non-positive time delta
  - `jointRejectedInvalidOrZeroDistance` (number): Count of joint pairs rejected due to invalid or zero distance
  - `nonPositiveTimeDeltaEvents` (Array): Array of non-positive time delta events, each containing:
    - `index` (number): Index of the current point
    - `prevIndex` (number): Index of the previous point
    - `delta` (number): Time delta in milliseconds (≤ 0)

**Side Effects:**

- Logs audit results to console with detailed breakdowns for each pass

### `haversineDistance(lat1, lon1, lat2, lon2)`

Calculates the great-circle distance between two points on Earth using the Haversine formula.

**Parameters:**

- `lat1` (number): Latitude of first point in degrees
- `lon1` (number): Longitude of first point in degrees
- `lat2` (number): Latitude of second point in degrees
- `lon2` (number): Longitude of second point in degrees

**Returns:**

- `number`: Distance in meters

## Key Concepts

### Time Progression vs. Timestamp Presence

The module distinguishes between:

- **Timestamp presence** (`hasValidTimestamps`): Any parseable timestamp exists in the GPX
- **Time progression** (`hasTimeProgression`): At least one positive consecutive time delta (dt > 0) is observed

**Critical distinction**: Presence alone does not imply usability. GPX files with identical timestamps, all-zero deltas, reversed timestamps, or missing timestamps will have `hasTimeProgression === false`.

### Distance Delta Collection Modes

The module operates in two distinct modes based on `hasTimeProgression`:

#### When `hasTimeProgression === true`:

- Collects time deltas (dt > 0)
- Collects time-conditioned distance deltas (for pairs with dt > 0)
- Collects joint time-distance pairs
- `distanceDeltasM` contains time-conditioned deltas

#### When `hasTimeProgression === false`:

- Does NOT collect time deltas
- Does NOT collect joint time-distance pairs
- DOES collect geometry-conditioned distance deltas (all consecutive valid coordinate pairs)
- `distanceDeltasM` contains geometry-conditioned deltas

**Geometry-conditioned distance deltas** are:

- Calculated purely from consecutive valid coordinate pairs
- Independent of timestamps
- Explicitly separated from time-conditioned distance deltas in code (condition = valid finite distance, not timestamp rules)

## Audit Process

### 1. Timestamp Presence Check

A first pass determines if any parseable timestamps exist (`hasValidTimestamps`). This is descriptive only and does not gate collection.

### 2. Main Iteration

The module iterates through all points sequentially:

#### Geometry-conditioned distance (always computed)

For every consecutive pair of points with valid coordinates:

- Computes Haversine distance
- Adds to `distanceDeltasMGeometryConditioned` if finite and > 0
- Tracks rejection count for invalid/zero distances

#### Time Delta Collection (When Timestamps Present)

For points with valid timestamps:

- Compares with previous valid timestamp
- If delta > 0:
  - Adds to `timeDeltasMs`
  - Sets `hasTimeProgression = true`
  - Computes time-conditioned distance delta (if previous point exists)
- If delta ≤ 0:
  - Tracks rejection count
  - Records event in `nonPositiveTimeDeltaEvents`

### 3. Joint Time-Distance Audit (When `hasTimeProgression === true`)

A separate pass generates joint time-distance pairs:

- Only runs when `hasTimeProgression === true`
- Requires both current and previous points to have valid timestamps
- Includes pairs only if dtSec > 0 and ddMeters > 0 and finite
- Tracks detailed rejection counts for missing timestamps, non-positive dt, and invalid distances

### 4. Statistics Calculation

For time deltas:

- Calculates min, max, and median from collected positive deltas
- All statistics are `null` if no positive deltas collected

## Console Output

The module logs detailed audit information:

```
=== Sampling Audit - Global Context ===
Total points received: <number>
Has valid timestamps (presence): <true|false>
========================================

=== Time Delta Audit ===
Timestamped points: <number>
Timestamped consecutive pairs: <number>
Positive deltas collected: <number>
Rejected (delta <= 0): <number>
========================

=== Distance Delta Audit (time-conditioned|geometry-conditioned) ===
Distance deltas collected: <number>
[Consecutive point pairs considered: <number>]
[Rejected (invalid or zero distance): <number>]
===============================================

=== Sampling Audit Results ===
Total positive deltas collected: <number>
[Statistics if deltas > 0]
Total distance deltas collected: <number>
================================

=== Joint Time-Distance Audit ===
[Only if hasTimeProgression === true]
Consecutive pairs inspected: <number>
Pairs with both timestamps: <number>
Valid joint pairs collected: <number>
Rejected:
  - Missing timestamp: <number>
  - Non-positive Δt: <number>
  - Invalid/zero distance: <number>
================================
```

## Important Behaviors

### Read-Only Operation

- **Does NOT mutate points**: Points are never modified
- **Does NOT reorder data**: Original point order is preserved
- **Does NOT normalize timestamps**: Timestamps remain in their original format
- **Does NOT synthesize timestamps**: Missing timestamps are not inferred

### Time Progression Logic

- `hasTimeProgression` is set to `true` only when at least one positive consecutive time delta is observed
- If timestamps exist but show no positive progression, a console message is logged: "Timestamps detected but show no positive progression; time-based analysis disabled."
- This ensures geometry-conditioned distance analysis is always available when needed

### Distance Delta Separation

- `distanceDeltasMGeometryConditioned`: Always computed for all consecutive valid coordinate pairs
- `distanceDeltasMTimeConditioned`: Only computed when `hasTimeProgression === true` and dt > 0
- `distanceDeltasM`: Primary array for charts/exports, set to time-conditioned when progression exists, else geometry-conditioned

## Export Functions

### `exportTimeDeltasJSON(timeDeltasMs, filename)`

Exports time deltas to a JSON file for download.

**Parameters:**

- `timeDeltasMs` (Array): Array of time deltas in milliseconds
- `filename` (string): Filename for download

### `exportDistanceDeltasJSON(distanceDeltasM, filename)`

Exports distance deltas to a JSON file for download.

**Parameters:**

- `distanceDeltasM` (Array): Array of distance deltas in meters
- `filename` (string): Filename for download

### `exportTimeDistancePairsJSON(timeDistancePairs, filename)`

Exports time-distance pairs to a JSON file for download.

**Parameters:**

- `timeDistancePairs` (Array<{dtSec: number, ddMeters: number}>): Array of time-distance pairs
- `filename` (string): Filename for download

## Usage Example

```javascript
// After parsing GPX file
const parseResult = await parseGPXFile(file);
const points = parseResult.points;

// Run sampling audit
const samplingMetadata = auditSampling(points, file.name);

// Access results
console.log(`Time progression: ${samplingMetadata.hasTimeProgression}`);
console.log(`Time deltas collected: ${samplingMetadata.timeDeltasMs.length}`);
console.log(`Distance deltas collected: ${samplingMetadata.distanceDeltasM.length}`);
console.log(`Joint pairs collected: ${samplingMetadata.timeDistancePairs.length}`);

// Export data
exportTimeDeltasJSON(samplingMetadata.timeDeltasMs, 'time_deltas.json');
```

## Expected Point Structure

Points passed to this module must have:

```javascript
{
  lat: number,           // Latitude (-90 to 90)
  lon: number,           // Longitude (-180 to 180)
  timeRaw: string | null // Raw timestamp string or null if missing
  // ... other point properties
}
```

## Dependencies

- Browser `Date.parse()` API (native, no external dependencies)
- Math functions for Haversine calculation (native)

## Notes

- This module is purely observational and does not modify data
- All distance calculations use the Haversine formula (great-circle distance)
- The module processes points sequentially in array order
- Geometry-conditioned distance deltas are always computed regardless of timestamp status
- Time-based analysis is only enabled when positive time progression is detected

