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

Only successfully parsed timestamps are compared. The module maintains:

- `lastValidTimestampMs`: previous parseable timestamp in original point order (for **adjacent duplicate** detection)
- `anchorTimestampMs`: a monotonic **high-water mark** (for **backtracking** detection). This anchor only advances when the stream reaches or exceeds it.

For each valid timestamp (after the first one), the module checks:

- **Adjacent duplicate (primary duplicate family)**: `timestampMs === lastValidTimestampMs`
- **Backtracking (primary backtracking family)**: `timestampMs < anchorTimestampMs`
- **Monotonic forward (non-backtracking)**: `timestampMs >= anchorTimestampMs` (and then `anchorTimestampMs = timestampMs`)

Notes:

- Adjacent duplicates remain their own anomaly family even if they occur inside a backtracking region.
- Non-adjacent repeated timestamps that occur *within* a backtracking region remain **primary backtracking**; repeat structure may be recorded only as a secondary annotation.

### 4. Maximum Backtracking Depth Tracking

When a backtracking timestamp is detected, the module calculates the depth from the monotonic anchor:
```
depthFromAnchor = anchorTimestampMs - timestampMs
```

The maximum depth observed across all points is tracked and reported.

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
5. **Backtracking timestamps are logged but not fixed**: The module reports issues but does not attempt to correct them

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

## Classification Precedence and Design Decisions

These are the explicit design choices made in the classification logic. They are recorded here so that anyone reviewing audit output — or reconsidering these rules later — knows what was decided and why.

### Decision 1: Duplicate check runs before backtracking check

The check `timestampMs === lastValidTimestampMs` (adjacent duplicate) runs before `timestampMs < anchorTimestampMs` (backtracking). A point that satisfies both conditions is classified as **duplicate**, not backtracking.

**Rationale**: Adjacent duplicates are the simplest and most structurally distinct anomaly. They are the most likely to be identified and corrected first in downstream layers. Keeping them as their own primary family — even when they sit below the monotonic anchor — means the audit output is pre-sorted by the natural correction order of later layers. This is observational, not policy: the audit is describing what the stream contains in a way that maps cleanly to how downstream layers encounter it.

### Decision 2: Adjacent duplicates can shorten or terminate a backtracking block

When a backtracking point is immediately followed by a point with the same timestamp value, the follower is classified as **duplicate** (not backtracking). This means an adjacent duplicate peels off the trailing edge of a backtracking block.

Concretely: a stream like `T=12, T=8, T=8, T=15` produces one backtracking singleton (the first `T=8`) and one duplicate singleton (the second `T=8`). The backtracking block ends at length 1 even though both `T=8` points are below the anchor.

A reviewer seeing a backtracking singleton immediately adjacent to a duplicate singleton at the same timestamp value should read this as: the first point entered the backtracking region; the second point was an adjacent repeat of the previous parseable point. Both observations are true. The dup-first rule separates them into their natural families.

### Decision 3: The anchor does not advance on duplicate points

A duplicate is caught by the `=== lastValidTimestampMs` check before it can reach the `>= anchorTimestampMs` branch. This means `anchorTimestampMs` is not updated when duplicates are processed.

Consequence: a long run of adjacent duplicates at the current anchor value "stalls" the anchor rather than advancing it. The anchor only advances when a strictly new high-water mark is observed. This is correct behavior: the anchor is a monotonic high-water mark over *distinct forward progress* in the timestamp stream, and adjacent repetitions do not constitute forward progress.

Concretely: a stream like `T=10, T=10, T=10, T=10, T=8` produces a duplicate block of length 3 (the three repeated `T=10` points), then one backtracking singleton (`T=8`). The backtracking is measured against anchor `T=10`, which never moved during the duplicate run.

### Decision 4: Non-adjacent repeated timestamps inside a backtracking block remain primary backtracking

When the same timestamp value appears more than once within a contiguous backtracking block, but not as adjacent duplicates, those repeat occurrences are classified as **backtracking** (not duplicate). The repeat structure is recorded only as a secondary annotation (`repeatInBacktrackingBlock` on the event, `nonAdjacentRepeatPointCount` and `repeats` on the block) and does not affect the primary anomaly family.

**Rationale**: inside a backtracking region, the stream has already departed from monotonic order. The salient observable is the backtracking itself. The fact that a particular timestamp value recurs within that region is secondary structural information, not a new anomaly class.

---

## Notes

- This module is purely observational and does not modify data
- Parsed milliseconds are calculated temporarily and never stored
- The module processes points sequentially in array order
- A point contributes to exactly one primary comparison counter (duplicate, backtracking, or monotonic forward)
- The first valid timestamp establishes the baseline for subsequent comparisons
