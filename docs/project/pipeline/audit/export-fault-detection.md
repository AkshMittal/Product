<!-- generated-by: gsd-doc-writer -->
# Export Fault Detection Module

> **Deprecated.** This module is superseded by the correction layer's `deterministic-export-fix.js` (`packages/correction/pre-segment/deterministic-export-fix.js`). It continues to run during the audit phase for backwards compatibility and diagnostics. Removal is scheduled after correction's deterministic-export-fix passes equivalent fixtures (Phase J cleanup).

## Overview

The Export Fault Detection Module analyses GPX `<trkseg>` structure for **export-time faults** — structural anomalies introduced by the export/transfer process rather than by GPS recording behaviour. It runs on the parsed XML document **before** trkpt `gpxIndex` assignment, at the segment level.

**Key distinction from kinematic faults:**

| Fault class | Source | Primary signal |
|-------------|--------|----------------|
| **Export fault** | Export/transfer process bug | `<trkseg>` boundary mismatch |
| **Kinematic fault** | GPS recording behaviour | belowAnchor/backtrack within a segment |

The `trkSegIndex` field on each accepted trkpt (added by `gpx-ingestion-module.js`) is the primary bridge: anomalies that span a `trkSegIndex` boundary are inter-segment (export chunk fault candidates); anomalies that stay within one `trkSegIndex` are intra-segment (recording-level).

## Purpose

- Detect structural GPX export faults deterministically or with high confidence.
- Produce `audit.exportFaults[]` — forwarded alongside the temporal audit for the correction layer to consume.
- Produce `audit.ingestion.segmentSummaries[]` — per-`<trkseg>` time range and point count metadata.
- Support the correction layer's `block-proposal` in classifying `block-finding` instances.

## Public API

### `detectExportFaults(xmlDoc, params?)`

**Called by** `parseGPX()` in `gpx-ingestion-module.js` after `DOMParser.parseFromString()` and before trkpt processing.

**Parameters:**

- `xmlDoc` (`Document`): Parsed XML document from `DOMParser`.
- `params` (optional):
  - `missingChunkThresholdMs` (number, default `1_800_000` = 30 min): Gap larger than this triggers `missing_chunk_fault`.
  - `timezoneShiftTolerance` (number, default `0.1`): Fraction of one hour within which a backward jump is treated as a timezone/DST shift rather than an ordering error. (0.1 = 6 minutes.)

**Returns:**

```javascript
{
  faults:           ExportFault[],
  segmentSummaries: SegmentSummary[]
}
```

---

## Fault types

### 1. `chunk_ordering_fault` — segments out of chronological order

**Detection:** `next.firstTimeMs < curr.lastTimeMs` AND not a round-hour backward jump AND time ranges do not overlap.

**Confidence:** 1.0 (deterministic). **Severity:** critical.

**Fault fields:** `fromTrkSegIndex`, `toTrkSegIndex`, `trackIndex`, `gapMs` (negative).

---

### 2. `duplicate_chunk_fault` — overlapping time ranges

**Detection:** `next.firstTimeMs < curr.lastTimeMs` (backward) AND the two segments' time ranges overlap (`next.firstTimeMs < curr.lastTimeMs AND next.lastTimeMs > curr.firstTimeMs`). Not a round-hour shift.

**Confidence:** 0.95. **Severity:** critical.

**Fault fields:** `fromTrkSegIndex`, `toTrkSegIndex`, `trackIndex`, `gapMs` (negative), `overlapStartMs` (`next.firstTimeMs`), `overlapEndMs` (`min(curr.lastTimeMs, next.lastTimeMs)`).

---

### 3. `missing_chunk_fault` — large gap (flag only)

**Detection:** `next.firstTimeMs − curr.lastTimeMs > missingChunkThresholdMs` (default 30 min).

**Confidence:** 0.85 (could be legitimate recording pause). **Severity:** high.

**Fault fields:** `fromTrkSegIndex`, `toTrkSegIndex`, `trackIndex`, `gapMs` (positive), `gapMinutes`, `impliedDistanceM` (haversine between boundary coordinates; null if unavailable), `impliedSpeedKph` (null if unavailable), `note` (disambiguation hint).

---

### 4. `timestamp_discontinuity_fault` — timezone / DST shift

**Detection:** `next.firstTimeMs < curr.lastTimeMs` AND `hoursBack ≈ nearestHour ≥ 1` (within `timezoneShiftTolerance` fraction of an hour).

**Confidence:** 0.90. **Severity:** medium.

**Fault fields:** `fromTrkSegIndex`, `toTrkSegIndex`, `trackIndex`, `gapMs` (negative), `suspectedTimezoneOffsetHours`.

---

### 5. `intra_segment_timestamp_violation` — backward timestamp within one segment

**Detection:** `times[i] < times[i−1]` within the usable time sequence of a single `<trkseg>`.

**Confidence:** 1.0 (deterministic). **Severity:** high.

**Fault fields:** `trkSegIndex`, `trackIndex`, `pointIndexInSegment` (0-based in segment's usable time sequence), `precedingTimeMs`, `violatingTimeMs`.

---

## `SegmentSummary` shape

```javascript
{
  trackIndex:      number,        // 0-based index of the parent <trk>
  segIndex:        number,        // 0-based index within that track
  globalSegIndex:  number,        // = trkSegIndex on accepted trkpts
  pointCount:      number,        // total <trkpt> elements in this segment
  usableTimeCount: number,        // trkpts with a parseable timeMs
  firstTimeMs:     number | null, // timeMs of first parseable timestamp
  lastTimeMs:      number | null, // timeMs of last parseable timestamp
  minTimeMs:       number | null, // minimum timeMs over the segment
  maxTimeMs:       number | null  // maximum timeMs over the segment
}
```

`globalSegIndex` matches `trkSegIndex` on each accepted trkpt.

---

## Detection priority at inter-segment boundaries

Applied in this order at each boundary (multiple faults can fire):

1. `gapMs < 0` AND ≈ round-hour backward jump → `timestamp_discontinuity_fault`
2. `gapMs < 0` AND consecutive ranges overlap → `duplicate_chunk_fault`
3. `gapMs < 0` AND no overlap → `chunk_ordering_fault`
4. `gapMs > missingChunkThresholdMs` → `missing_chunk_fault`

Cross-track comparisons are **not** performed — different `<trk>` elements may represent different recording sessions in any order.

## Confidence levels and severity summary

| Fault type | Confidence | Severity | Correctable? |
|------------|------------|----------|--------------|
| `chunk_ordering_fault` | 1.0 | critical | Yes — reorder when socket-ok |
| `intra_segment_timestamp_violation` | 1.0 | high | Via correction layer |
| `duplicate_chunk_fault` | 0.95 | critical | Partial — one segment may need manual selection |
| `timestamp_discontinuity_fault` | 0.90 | medium | Yes — apply uniform timezone offset |
| `missing_chunk_fault` | 0.85 | high | No — data is gone; flag only |

## Integration

- **Pipeline position:** called inside `parseGPX()` immediately after `DOMParser` succeeds and before trkpt `gpxIndex` assignment.
- **Results placed at:** `audit.exportFaults[]` and `audit.ingestion.segmentSummaries[]`.
- **Correction layer:** `deterministic-export-fix.js` supersedes this module's classification logic. Export faults are **observational** — they do not mutate `points[]`.

## Dependencies

- Browser `DOMParser` (XML already parsed before this module runs).
- Called by `gpx-ingestion-module.js`.
