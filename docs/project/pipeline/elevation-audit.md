# Elevation Audit Module

## Overview

The Elevation Audit Module performs an observational audit pass on the recorded elevation channel in GPX points. It analyzes elevation coverage, validity, structural patterns, and co-presence with timestamps — without mutating, smoothing, or normalizing elevation values. This module is read-only and provides diagnostic information about the elevation channel as it exists in the raw stream.

## Scope boundary

This module covers the **recorded elevation channel only**. It does NOT compute:

- Vertical speed or vertical rate (`Δele / Δt`) — belongs in the motion audit module
- Accumulated gain or loss — metric-layer concept, not a stream observable
- Smoothed grade or gradient — requires processing
- DEM comparison or residual analysis — external dependency; belongs in a post-audit quality gate layer
- `std(Δele)` or any variance metric — requires a reference the stream cannot provide (see [ADR-0004](../../adr/audit/0004-elevation-delta-std-not-audit-artifact.md))

## Function

### `auditElevation(points, params)`

Audits the elevation channel in an array of points and returns metadata about elevation quality, coverage, and structural patterns.

**Parameters:**
- `points` (Array): Array of point objects with `gpxIndex`, `ele`, and `timeRaw` properties
- `params` (Object, optional): Explicit audit parameters
  - `validFloorM` (number, default `-500`): Lower bound for deterministically valid elevation in meters
  - `validCeilingM` (number, default `9500`): Upper bound for deterministically valid elevation in meters

**Returns:**
- `Object` containing `{ audit: { elevation: { ... } } }`

## Audit Process

### 1. Missing Elevation Detection

Points where `ele === null` (the `<ele>` tag was absent or unparseable at ingestion) are counted as missing. These points are skipped for all comparison operations.

Output: count, ratio, blocks (contiguous runs of length > 1), isolated events.

### 2. Out-of-Bounds Detection

Points where `ele` is non-null but falls outside the declared valid range (`< validFloorM` or `> validCeilingM`) are classified as deterministically invalid. The bounds are explicit parameters, not hidden assumptions.

These values parsed successfully as numbers but are physically impossible for a surface GPS track. The audit does not say "exclude these" — it reports that they fall outside the declared domain bounds.

Output: count, ratio, blocks, isolated events. Each event records the value and which bound was violated (`belowFloor` or `aboveCeiling`).

### 3. Valid Elevation — Channel Statistics

For all points with non-null, in-bounds elevation:

- `minEle`, `maxEle`: extremes across all valid points
- `elevationSpanM`: `maxEle - minEle`
- `firstValidEle`, `firstValidEleIndex`: first valid elevation in stream order
- `lastValidEle`, `lastValidEleIndex`: last valid elevation in stream order
- `validElevationPointCount`: total valid elevation points

### 4. Adjacent Duplicate Elevation Detection

Points where `ele === previousValidEle` (consecutive parseable, in-bounds elevation values are identical) are classified as adjacent duplicates.

Unlike timestamps, duplicate elevation values are not inherently anomalous — a flat section of trail can legitimately produce identical readings. But they are a structural property that downstream layers need. A run of 50 consecutive identical elevation values is a very different signal from a track where elevation varies at every point.

Output: count, ratio, blocks (contiguous runs of length > 1), isolated events.

### 5. Consecutive Elevation Delta Statistics

For every consecutive pair of valid-elevation points (geometry-conditioned — both have non-null, in-bounds `ele`), the module computes `Δele = ele[i] - ele[i-1]`.

Output:
- `pairCount`: total consecutive valid-elevation pairs evaluated
- `skippedPairsDueToMissingOrOob`: consecutive array-adjacent pairs that could not be evaluated because one or both endpoints had invalid (missing or out-of-bounds) elevation. Tells downstream layers how fragmented the delta series is.
- `zeroDeltaCount`: pairs where `Δele === 0` (ties into adjacent duplicate detection)
- `maxPositiveDeltaM`: largest single-step upward change
- `maxNegativeDeltaM`: largest single-step downward change (negative value)
- `maxAbsoluteDeltaM`: largest single-step change regardless of sign

These are raw stream observables. The audit does not label any delta as a "spike" or "anomaly" — it reports the magnitude and lets later layers decide.

### 6. Co-Presence with Time

Since both `ele` and `timeRaw` are optional fields, the module reports their overlap:

- `pointsWithBothValidEleAndParseableTime`: points eligible for eventual vertical motion analysis
- `pointsWithValidEleButNoTime`: valid elevation but no parseable timestamp
- `pointsWithParseableTimeButNoEle`: parseable timestamp but no valid elevation
- `consecutivePairsWithBothValidEleAndPositiveDt`: consecutive pairs where both points have valid ele AND positive time delta — the subset available for 3D motion analysis in the motion audit extension

These are coverage diagnostics only. No rates are computed.

## Important Behaviors

### Read-Only Operation

- **Does NOT mutate points**: Points are never modified
- **Does NOT smooth elevation**: No smoothing, interpolation, or gap-filling
- **Does NOT accumulate gain/loss**: Raw deltas only; accumulation is a metric-layer concern
- **Does NOT use external data**: No DEM lookups; operates purely on the GPX stream

### Validity Rules

1. **Missing elevation points are skipped**: `ele === null` breaks the consecutive-delta chain
2. **Out-of-bounds points are skipped**: Values outside `[validFloorM, validCeilingM]` are not used for delta computation or statistics
3. **Only valid (non-null, in-bounds) elevation values participate** in channel statistics, delta computation, and adjacent-duplicate detection
4. **The bounds are explicit parameters**: They appear in the output under `parameters` so the audit is reproducible and the thresholds are transparent

### Block and Singleton Pattern

Follows the same convention as the timestamp audit module:
- Blocks: contiguous runs of length > 1 for each anomaly type
- Isolated events: events not included in any block
- Both views are emitted so downstream layers can distinguish clustered from scattered anomalies

## Output Schema

```
audit.elevation.totalPointsEvaluated
audit.elevation.validElevationPointCount
audit.elevation.parameters.validFloorM
audit.elevation.parameters.validCeilingM
audit.elevation.channelStatistics.minEle
audit.elevation.channelStatistics.maxEle
audit.elevation.channelStatistics.elevationSpanM
audit.elevation.channelStatistics.firstValidEle
audit.elevation.channelStatistics.firstValidEleIndex
audit.elevation.channelStatistics.lastValidEle
audit.elevation.channelStatistics.lastValidEleIndex
audit.elevation.missing.pointCount
audit.elevation.missing.pointCountOverTotalPointsRatio
audit.elevation.missing.maxBlockLength
audit.elevation.missing.blocks[]
audit.elevation.missing.isolatedPointCount
audit.elevation.missing.isolatedPointEvents[]
audit.elevation.outOfBounds.pointCount
audit.elevation.outOfBounds.pointCountOverTotalPointsRatio
audit.elevation.outOfBounds.maxBlockLength
audit.elevation.outOfBounds.blocks[]
audit.elevation.outOfBounds.isolatedPointCount
audit.elevation.outOfBounds.isolatedPointEvents[]
audit.elevation.adjacentDuplicate.pointCount
audit.elevation.adjacentDuplicate.pointCountOverTotalPointsRatio
audit.elevation.adjacentDuplicate.maxBlockLength
audit.elevation.adjacentDuplicate.blocks[]
audit.elevation.adjacentDuplicate.isolatedPointCount
audit.elevation.adjacentDuplicate.isolatedPointEvents[]
audit.elevation.consecutiveDeltas.pairCount
audit.elevation.consecutiveDeltas.skippedPairsDueToMissingOrOob
audit.elevation.consecutiveDeltas.zeroDeltaCount
audit.elevation.consecutiveDeltas.maxPositiveDeltaM
audit.elevation.consecutiveDeltas.maxNegativeDeltaM
audit.elevation.consecutiveDeltas.maxAbsoluteDeltaM
audit.elevation.coPresenceWithTime.pointsWithBothValidEleAndParseableTime
audit.elevation.coPresenceWithTime.pointsWithValidEleButNoTime
audit.elevation.coPresenceWithTime.pointsWithParseableTimeButNoEle
audit.elevation.coPresenceWithTime.consecutivePairsWithBothValidEleAndPositiveDt
```

## Dependencies

- None (no external libraries, no DEM, no browser APIs beyond what the points array provides)
