# Timestamp Audit Module

## Overview

The Timestamp Audit Module performs an observational audit pass on timestamp data in GPX points. It analyzes timestamp quality and ordering without mutating, reordering, or normalizing the data. This module is read-only and provides diagnostic information about timestamp issues in the parsed GPX data.

## Purpose

This module serves as a diagnostic tool to identify timestamp-related data quality issues. It helps understand:
- How many points have missing timestamps
- How many timestamps cannot be parsed
- Whether timestamps are in correct chronological order
- The severity of any timestamp ordering issues

## Function

### `auditTimestamps(points)`

Audits timestamps in an array of points and returns metadata about timestamp quality and ordering.

**Parameters:**
- `points` (Array): Array of point objects with `timeRaw` property

**Returns:**
- `Object` (audit metadata) containing:
  - `totalPointsChecked` (number): Total number of points analyzed
  - `missingTimestampCount` (number): Points where `timeRaw === null`
  - `unparsableTimestampCount` (number): Points where `Date.parse()` returns `NaN`
  - `duplicateTimestampCount` (number): Points with timestamps equal to the previous valid timestamp
  - `backwardTimestampCount` (number): Points with timestamps less than the previous valid timestamp
  - `strictlyIncreasingCount` (number): Points with timestamps greater than the previous valid timestamp (correct order)
  - `maxBackwardJumpMs` (number|null): Maximum observed backward time delta in milliseconds, or `null` if no backward jumps
  - `backwardTimestampEvents` (Array): Array of backward timestamp transition events, each containing:
    - `index` (number): Index of the current point with backward timestamp
    - `prevIndex` (number): Index of the previous point
    - `prevTime` (string): Formatted time string of previous timestamp (HH:MM:SS)
    - `currTime` (string): Formatted time string of current timestamp (HH:MM:SS)
  - `duplicateTimestampEvents` (Array): Array of duplicate timestamp events, each containing:
    - `index` (number): Index of the current point with duplicate timestamp
    - `prevIndex` (number): Index of the previous point
    - `time` (string): Formatted time string of the duplicate timestamp (HH:MM:SS)

**Side Effects:**
- Logs audit results to console with detailed breakdown

## Helper Functions

### `formatTime(timeRaw)` (Internal)

Formats a timestamp string for display in flagged events.

**Parameters:**
- `timeRaw` (string): Raw timestamp string

**Returns:**
- `string`: Formatted time string in `HH:MM:SS` format, or original string if unparsable

**Behavior:**
- Parses timestamp using `Date` constructor
- Formats as `HH:MM:SS` with zero-padding
- Returns original string if parsing fails
- Returns empty string if input is null/undefined

## Audit Process

### 1. Missing Timestamp Detection

Points where `timeRaw === null` are counted as missing. These points are skipped for all comparison operations.

### 2. Timestamp Parsing

For non-null timestamps, the module attempts to parse using `Date.parse(timeRaw)`:
- If parsing succeeds (returns a number), the timestamp is considered valid
- If parsing fails (returns `NaN`), the point is counted as unparsable and skipped for comparisons

### 3. Timestamp Comparison

Only successfully parsed timestamps are compared. The module maintains a `lastValidTimestampMs` to track the previous valid timestamp for comparison.

For each valid timestamp (after the first one), the module checks:

- **Duplicate**: `timestampMs === lastValidTimestampMs`
- **Backward**: `timestampMs < lastValidTimestampMs`
- **Strictly Increasing**: `timestampMs > lastValidTimestampMs` (correct chronological order)

### 4. Maximum Backward Jump Tracking

When a backward timestamp is detected, the module calculates the backward jump:
```
backwardJump = lastValidTimestampMs - timestampMs
```

The maximum backward jump observed across all points is tracked and reported.

## Important Behaviors

### Read-Only Operation

- **Does NOT mutate points**: Points are never modified
- **Does NOT reorder data**: Original point order is preserved
- **Does NOT normalize timestamps**: Timestamps remain in their original format
- **Does NOT store parsed milliseconds**: Parsed milliseconds are temporary and not stored on point objects

### Comparison Rules

1. **Missing timestamps are not compared**: Points with `timeRaw === null` are skipped entirely
2. **Unparsable timestamps are not compared**: Points where `Date.parse()` fails are skipped
3. **Only valid timestamps are compared**: Comparison only occurs between successfully parsed timestamps
4. **Equal timestamps are allowed**: Duplicate timestamps are logged but not treated as errors
5. **Backward timestamps are logged but not fixed**: The module reports issues but does not attempt to correct them

### First Point Handling

The first point with a valid timestamp has no previous timestamp to compare against, so it is not counted in any comparison metrics (duplicate, backward, or strictly increasing).

## Console Output

The module automatically logs audit results to the console in the following format:

```
=== Timestamp Audit Results ===
Total points checked: <number>
Missing timestamps: <number>
Unparsable timestamps: <number>
Duplicate timestamps: <number>
Backward timestamps: <number>
Strictly increasing timestamps: <number>
Maximum backward jump (ms): <number> or 'N/A (no backward jumps observed)'
Maximum backward jump (seconds): <number>
================================
```

## Usage Example

```javascript
// After parsing GPX file
const parseResult = await parseGPXFile(file);
const points = parseResult.points;

// Run timestamp audit
const auditMetadata = auditTimestamps(points);

// Access audit results
console.log(`Missing timestamps: ${auditMetadata.missingTimestampCount}`);
console.log(`Backward timestamps: ${auditMetadata.backwardTimestampCount}`);
console.log(`Max backward jump: ${auditMetadata.maxBackwardJumpMs}ms`);
```

## Expected Point Structure

Points passed to this module must have a `timeRaw` property:

```javascript
{
  timeRaw: string | null  // Raw timestamp string or null if missing
  // ... other point properties
}
```

## Dependencies

- Browser `Date.parse()` API (native, no external dependencies)

## Notes

- This module is purely observational and does not modify data
- Parsed milliseconds are calculated temporarily and never stored
- The module processes points sequentially in array order
- All counters are independent (a point can only contribute to one comparison counter)
- The first valid timestamp establishes the baseline for subsequent comparisons
