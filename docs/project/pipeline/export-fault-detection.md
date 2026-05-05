# Export Fault Detection Module

## Overview

The Export Fault Detection Module analyses GPX `<trkseg>` structure for **export-time faults** — structural anomalies introduced by the export/transfer process rather than by GPS recording behaviour. It runs on the parsed XML document **before** trkpt `gpxIndex` assignment, at the segment level.

**Key distinction from kinematic faults:**

| Fault class | Source | Primary signal |
|-------------|--------|----------------|
| **Export fault** | Export/transfer process bug | `<trkseg>` boundary mismatch |
| **Kinematic fault** | GPS recording behaviour | Belowanchor/backtrack within a segment |

The `trkSegIndex` field on each accepted trkpt (added by `gpx-ingestion-module.js`) is the primary bridge: anomalies that span a `trkSegIndex` boundary are inter-segment (export chunk fault candidates); anomalies that stay within one `trkSegIndex` are intra-segment (recording-level).

## Purpose

- Detect structural GPX export faults deterministically or with high confidence.
- Produce `audit.exportFaults[]` — forwarded alongside the temporal audit for the correction layer to consume.
- Produce `audit.ingestion.segmentSummaries[]` — per-`<trkseg>` time range and point count metadata.
- Support the correction layer's `block-proposal` in classifying `block-finding` instances: a contiguous `belowAnchor` run where all points share the same `trkSegIndex` and the segment has an identified `chunk_ordering_fault` is a strong signal that this is an export-chunk reorder rather than a GPS backtrack.

## Public API

### `detectExportFaults(xmlDoc, params?)`

**Called by** `parseGPX()` in `gpx-ingestion-module.js` after `DOMParser.parseFromString()` and before trkpt processing.

**Parameters**

- `xmlDoc` (`Document`): Parsed XML document from `DOMParser`.
- `params` (optional): Versioned detection parameters.
  - `missingChunkThresholdMs` (number, default `1_800_000` = 30 min): Gap larger than this triggers `missing_chunk_fault`.
  - `timezoneShiftTolerance` (number, default `0.1`): Fraction of one hour within which a backward jump is treated as a timezone/DST shift rather than an ordering error. (Default 0.1 = 6 minutes.)

**Returns**

```javascript
{
  faults:           ExportFault[],
  segmentSummaries: SegmentSummary[]
}
```

---

## Fault types

### 1. `chunk_ordering_fault` — segments out of chronological order

**What happens:** The export process wrote segments in the wrong order. `trkseg[i+1]` starts before `trkseg[i]` ends, and the gap is not a round-hour timezone/DST shift.

**Detection:** `next.firstTimeMs < curr.lastTimeMs` AND not a round-hour backward jump.

**Confidence:** 1.0 (deterministic).

**Severity:** critical.

**Correction implication:** The block can be reordered — this is the same fault class that `block-proposal` emits as `block-finding` for `overlap-detection` to evaluate with a closed-socket test. A `block-finding` whose `gpxIndexes[]` span only one `trkSegIndex` value and whose segment carries a `chunk_ordering_fault` is a strong reorder candidate.

```
<trkseg>                          ← trkseg[0]: ends at T=07:30
  <trkpt><time>07:00</time>...
  <trkpt><time>07:30</time>...
</trkseg>
<trkseg>                          ← trkseg[1]: starts at T=06:00 — out of order
  <trkpt><time>06:00</time>...
  <trkpt><time>06:30</time>...
</trkseg>
```

**Fault fields:**
- `fromTrkSegIndex`, `toTrkSegIndex`, `trackIndex`
- `gapMs` (negative — `next.firstTimeMs − curr.lastTimeMs`)

---

### 2. `duplicate_chunk_fault` — overlapping time ranges

**What happens:** A buffer re-flush or export retry caused the same time range to appear in two consecutive segments (the ranges overlap).

**Detection:** `next.firstTimeMs < curr.lastTimeMs` (backward) AND the two segments' full time ranges overlap: `next.minTimeMs < curr.maxTimeMs AND next.maxTimeMs > curr.minTimeMs`. Not a round-hour shift.

**Confidence:** 0.95.

**Severity:** critical.

**Correction implication:** MVP flag + mask only — the overlap prevents safe reorder without knowing which copy is authoritative. One segment may need to be dropped.

```
<trkseg>                  ← trkseg[0]: [06:00..06:30]
  <trkpt><time>06:00...
  <trkpt><time>06:30...
</trkseg>
<trkseg>                  ← trkseg[1]: [06:15..06:45] — overlaps!
  <trkpt><time>06:15...
  <trkpt><time>06:45...
</trkseg>
```

**Fault fields:**
- `fromTrkSegIndex`, `toTrkSegIndex`, `trackIndex`
- `gapMs` (negative)
- `overlapStartMs` — `next.firstTimeMs`
- `overlapEndMs` — `min(curr.lastTimeMs, next.lastTimeMs)`

---

### 3. `missing_chunk_fault` — large gap (flag only)

**What happens:** A large positive gap between consecutive segments suggests data was lost during export (a buffer flush window was skipped, a file chunk was deleted, etc.).

**Detection:** `next.firstTimeMs − curr.lastTimeMs > missingChunkThresholdMs` (default 30 min).

**Confidence:** 0.85 (could be a legitimate recording pause).

**Severity:** high.

**Correction implication:** Flag only — data cannot be recovered. The gap is annotated for UI display. Cross-reference with activity type and device context to distinguish a lunch break from data loss.

**Fault fields:**
- `fromTrkSegIndex`, `toTrkSegIndex`, `trackIndex`
- `gapMs` (positive, large)
- `gapMinutes` — `Math.round(gapMs / 60000)`
- `impliedDistanceM` — Haversine distance in metres between the last point of `fromTrkSegIndex` and the first point of `toTrkSegIndex` (null if coordinates unavailable)
- `impliedSpeedKph` — `(impliedDistanceM / 1000) / (gapMs / 3600000)`, rounded to 1 decimal (null if unavailable)
- `note` — human-readable disambiguation hint

---

### 4. `timestamp_discontinuity_fault` — timezone / DST shift

**What happens:** The timestamp at a segment boundary jumps backward by approximately N whole hours — consistent with a timezone conversion applied inconsistently (e.g. device recorded in UTC, export applied a local offset only for some segments, or a DST transition was handled twice).

**Detection:** `next.firstTimeMs < curr.lastTimeMs` AND `hoursBack ≈ nearestHour ≥ 1` (within `timezoneShiftTolerance` fraction of an hour).

**Confidence:** 0.90.

**Severity:** medium (can be corrected by applying a uniform timezone offset; less severe than a true ordering fault).

**Fault fields:**
- `fromTrkSegIndex`, `toTrkSegIndex`, `trackIndex`
- `gapMs` (negative)
- `suspectedTimezoneOffsetHours` — `Math.round(hoursBack)`

---

### 5. `intra_segment_timestamp_violation` — backward timestamp within one segment

**What happens:** Within a single `<trkseg>`, a `<trkpt>` timestamp is strictly less than the preceding `<trkpt>` timestamp. This is a recording-level anomaly (GPS glitch, clock reset, signal dropout), not an export chunk fault.

**Detection:** `times[i] < times[i−1]` within the usable time sequence of a segment.

**Confidence:** 1.0 (deterministic).

**Severity:** high.

**Correction implication:** The temporal audit (`timestamp-audit.js`) already detects this as `belowPrevValid` / `belowAnchor` on individual trkpt points. The export fault layer surfaces it here with `trkSegIndex` context so the correction layer can verify that the `trkSegIndex` scope matches expectations:
- If the anomaly is intra-segment (`trkSegIndex` unchanged across the boundary) → `block-proposal` should classify this as a kinematic backtrack, NOT a chunk reorder candidate.
- If the anomaly crosses a `trkSegIndex` boundary → inter-segment → `chunk_ordering_fault` or `timestamp_discontinuity_fault` as applicable.

**Fault fields:**
- `trkSegIndex` — the segment containing the violation
- `trackIndex`
- `pointIndexInSegment` — 0-based position in the segment's usable time sequence
- `precedingTimeMs`
- `violatingTimeMs`

---

## `SegmentSummary` shape

```javascript
{
  trackIndex:     number,        // 0-based index of the parent <trk>
  segIndex:       number,        // 0-based index within that track
  globalSegIndex: number,        // 0-based index across all tracks (= trkSegIndex on trkpts)
  pointCount:     number,        // total <trkpt> elements in this segment
  usableTimeCount: number,       // trkpts with a parseable timeMs
  firstTimeMs:    number | null, // timeMs of first parseable timestamp in document order
  lastTimeMs:     number | null, // timeMs of last parseable timestamp in document order
  minTimeMs:      number | null, // minimum timeMs over the segment
  maxTimeMs:      number | null  // maximum timeMs over the segment
}
```

`globalSegIndex` is the key linking field: it matches `trkSegIndex` on each accepted trkpt from `gpx-ingestion-module.js`.

---

## trkSegIndex and export fault classification

The `trkSegIndex` field on accepted trkpt points is the primary diagnostic signal for distinguishing export-chunk faults from recording-level anomalies:

```
points[]:
  { gpxIndex: 0, trkSegIndex: 0, timeMs: T0 }
  { gpxIndex: 1, trkSegIndex: 0, timeMs: T1 }   ← same segment
  { gpxIndex: 2, trkSegIndex: 1, timeMs: T2 }   ← new segment
  { gpxIndex: 3, trkSegIndex: 1, timeMs: T3 }
```

**Intra-segment backtrack** (recording-level):
```
  { gpxIndex: 5, trkSegIndex: 2, timeMs: 100 }
  { gpxIndex: 6, trkSegIndex: 2, timeMs: 50  }  ← belowAnchor; same trkSegIndex
  { gpxIndex: 7, trkSegIndex: 2, timeMs: 60  }
```
→ temporal audit flags `belowAnchor`; `block-proposal` emits `block-finding`; export fault layer emits `intra_segment_timestamp_violation`. The `block-finding`'s `gpxIndexes[]` all share one `trkSegIndex` — not a chunk ordering fault.

**Inter-segment chunk ordering** (export fault):
```
  { gpxIndex: 5, trkSegIndex: 1, timeMs: 100 }  ← last point of segment 1
  { gpxIndex: 6, trkSegIndex: 2, timeMs: 50  }  ← first point of segment 2 — lower time
  { gpxIndex: 7, trkSegIndex: 2, timeMs: 60  }
```
→ temporal audit flags `belowAnchor` on gpxIndex 6; export fault layer emits `chunk_ordering_fault` at the boundary; `block-proposal` emits `block-finding` for the contiguous `belowAnchor` run; the matching export fault is evidence that this is a reorder candidate for `overlap-detection`'s socket test.

The correction layer uses both signals together — the temporal audit provides the exact point-level anomaly flags; the export fault detection provides the segment-level structural diagnosis.

---

## Confidence levels and severity summary

| Fault type | Confidence | Severity | Correctable? |
|------------|------------|----------|--------------|
| `chunk_ordering_fault` | 1.0 (deterministic) | critical | Yes — `block-reorder` when socket-ok |
| `intra_segment_timestamp_violation` | 1.0 (deterministic) | high | Via correction layer (`singleton-insert` / `block-reorder`) |
| `duplicate_chunk_fault` | 0.95 | critical | Partial — one segment may need manual selection |
| `timestamp_discontinuity_fault` | 0.90 | medium | Yes — apply uniform timezone offset |
| `missing_chunk_fault` | 0.85 | high | No — data is gone; flag only |

---

## Dependencies

- Browser `DOMParser` (XML already parsed before this module runs).
- Called by `gpx-ingestion-module.js`; results forwarded in `audit.exportFaults[]` and `audit.ingestion.segmentSummaries[]`.

## Notes

- Cross-track boundary comparisons are **not** performed — different `<trk>` elements may legitimately represent different recording sessions in any order.
- The `missingChunkThresholdMs` default (30 min) is conservative for hiking tracks. For cycling or driving sessions with short breaks this may produce false positives. The parameter is versioned in the audit profile.
- Export faults are **observational** — they do not mutate `points[]` or `workingOrderedPoints`. The correction layer reads them as contextual evidence when evaluating block proposals.
