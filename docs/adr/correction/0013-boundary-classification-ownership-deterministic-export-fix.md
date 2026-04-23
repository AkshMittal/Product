# ADR-correction-0013: Boundary classification ownership — deterministic export fix in correction; audit emits raw observations only

**Date**: 2026-04-23  
**Status**: accepted

## Context

The correction layer requires knowledge of inter-segment structural patterns — chunk ordering errors, duplicate segments, time-zone shifts, and true segment gaps — to decide whether to reorder segments, exclude them, or flag them for the UI.

Previously, `audit/pipeline/export-fault-detection.js` classified these patterns and emitted `audit.exportFaults[]` with typed fault entries. This created two problems:

1. **Audit was no longer purely observational.** Audit's stated contract (ADR-general-0002) is to observe and measure without making corrective decisions. Classifying a boundary as `chunk_ordering` vs `duplicate_chunk` is a decision — it triggers a downstream action (reorder vs exclude). That decision requires thresholds, heuristics, and policy that belong in the correction layer, not the observation layer.

2. **Classification logic was separated from the corrective action it gates.** `export-fault-detection.js` classified; `correction-runner` acted. Any change to the classification heuristic (e.g. refining the timezone-shift detection threshold) required touching an audit module even though the behaviour change was entirely in correction.

The prior plan also referred to `segment_boundary_gap` as `missing_chunk_fault` — a name that implied certainty about the cause (a missing recording chunk) when the observation is just a forward time gap. Renamed to `segment_boundary_gap` for honesty.

## Decision

### Audit emits raw observations only

`audit.ingestion.segmentBoundaries[]` — one entry per inter-segment boundary (`fromTrkSegIndex`, `toTrkSegIndex`):

```ts
interface SegmentBoundary {
  fromTrkSegIndex: number;
  toTrkSegIndex: number;
  trackIndex: number;
  gapMs: number | null;           // next.firstTimeMs - curr.lastTimeMs (negative = backward)
  impliedDistanceM: number | null; // Haversine using boundary coords; null if coords unavailable
  impliedSpeedKph: number | null;  // impliedDistanceM / gapMs * 3600000; null if gapMs <= 0
}
```

**No threshold. No classification field. No fault type.** Every inter-segment boundary emits exactly one entry. `gapMs` is signed — negative means the second segment starts before the first ends. `impliedSpeedKph` is populated only for positive `gapMs` (forward gaps); it is null for zero or negative `gapMs`.

### Correction owns classification — `deterministic-export-fix.js`

`deterministic-export-fix.js` (correction layer) reads `audit.ingestion.segmentBoundaries[]` and `audit.ingestion.segmentSummaries[]` and classifies each boundary into at most one of the following (mutually exclusive), plus `segment_boundary_gap` which is independent and non-exclusive:

#### `chunk_ordering`

Condition: `gapMs < 0` (backward boundary) AND the two segments' time ranges do **not** overlap meaningfully (i.e. `next.maxTimeMs <= curr.maxTimeMs` or the overlap fraction is below a heuristic threshold) AND the backward jump is **not** approximately a whole number of hours (timezone-shift guard).

Action: schedule segment reorder. All `chunk_ordering` segments are sorted by `minTimeMs` and reordered in a single canonical pass. Logged in `correction.rearrangements[]` with `kind: 'segment-chunk-reorder'`.

#### `duplicate_chunk`

Condition: `gapMs < 0` AND the two segments' time ranges **overlap** materially (`next.minTimeMs < curr.maxTimeMs AND next.maxTimeMs > curr.minTimeMs`) AND the backward jump is **not** approximately a whole number of hours.

Action: exclude the later segment. If the overlap region is 100% identical point-by-point, drop only the overlapping points from the later segment; if not 100% identical, exclude the entire later segment. Added to `correction.drops[]` with reason `duplicate_chunk_segment`. Annotation `duplicate_chunk_excluded` (segment-scope) emitted.

#### `timestamp_discontinuity`

Condition: backward boundary jump is approximately a whole number of hours (within `timezoneShiftTolerance`, default 0.1 fraction of an hour).

Action: flag only. Annotation `timestamp_discontinuity` (segment-scope) with `suspectedTimezoneOffsetHours`. No automated correction. (Cannot deterministically distinguish DST shift from chunk reorder without `rawTime` analysis; `rawTime` is deferred — ADR-audit-0012.)

#### `segment_boundary_gap`

Condition: `gapMs > 0` (any forward gap, regardless of size).

Action: observation only. Annotation `segment_boundary_gap` (segment-scope) with `gapMs`, `impliedDistanceM`, `impliedSpeedKph`. Renderer draws a straight line between segments. No threshold — every forward gap emits one annotation regardless of size. (We cannot detect missing chunks; we surface the gap and let UI show it.)

`segment_boundary_gap` can co-occur with the `chunk_ordering`, `duplicate_chunk`, or `timestamp_discontinuity` classifications at different boundaries. It cannot co-occur with any of those three for the **same** boundary (those three are triggered by `gapMs < 0`; `segment_boundary_gap` is triggered by `gapMs > 0`).

### `export-fault-detection.js` deprecation

`audit/pipeline/export-fault-detection.js` is **deprecated and removed**. Its segment-summary work is folded into `gpx-ingestion-module.js` (which now emits `segmentSummaries[]`). Its boundary observations become `audit.ingestion.segmentBoundaries[]` (raw, unclassified). Its classification logic is reimplemented in `correction/pipeline/deterministic-export-fix.js`.

`docs/project/pipeline/export-fault-detection.md` is **deprecated**. A new `docs/project/pipeline/deterministic-export-fix.md` is created under correction.

## Alternatives Considered

### Alternative 1: Keep classification in audit

- **Pros:** Single location for fault logic; correction just acts on pre-classified types.
- **Cons:** Audit is no longer purely observational. Classification thresholds (timezone tolerance, overlap fraction heuristic) are correction policy, not measurement. Each threshold change requires touching an audit module. Violates ADR-general-0002.
- **Why not:** The audit contract is observation-only. Classification is correction's job.

### Alternative 2: Duplicate classification in both layers

Keep `audit.exportFaults[]` as-is; have correction re-classify from raw observations for its own use.

- **Pros:** No breaking audit change.
- **Cons:** Two classification implementations that can drift out of sync. No single source of truth for boundary decisions.
- **Why not:** Two sources of truth for the same classification is strictly worse than one.

### Alternative 3: Move `export-fault-detection.js` to correction without audit changes

Move the file; have correction call it; audit still emits the raw observations it previously fed into the classifier.

- **Pros:** Lower migration cost.
- **Cons:** The raw observations audit already emits (`segmentBoundaries[]` shape) are sufficient; the classifier wrapper is a pure correction-layer concern and should live there from the start.
- **Why not:** Same outcome as the decision; the only difference is file location, which is what we're deciding.

### Alternative 4: No `segment_boundary_gap` annotation — only non-zero classification

Emit annotations only for `chunk_ordering`, `duplicate_chunk`, `timestamp_discontinuity`; let forward gaps be implicit.

- **Pros:** Fewer annotations.
- **Cons:** Downstream UX layers have no explicit signal that a gap exists between segments. They would have to re-derive this from the raw boundary data, which is the same work done here.
- **Why not:** Explicit gap annotation is needed for correct UI rendering (straight line vs connected polyline) and for telemetry on gap size distributions.

## Consequences

### Positive

- Audit contract is clean: observe, measure, emit raw data. No policy decisions.
- Correction owns all classification heuristics in one place (`deterministic-export-fix.js`); threshold changes require touching only correction.
- `segmentBoundaries[]` raw observations are sufficient for any future re-classification without re-running audit.
- `segment_boundary_gap` honest naming vs `missing_chunk_fault`.

### Negative

- Breaking change: any consumer reading `audit.exportFaults[]` must migrate to `correction.annotations[]` for the classified signals.
- `export-fault-detection.md` documentation is deprecated; `deterministic-export-fix.md` must be written.

### Risks

- The timezone-shift heuristic (round-hour backward jump within `timezoneShiftTolerance`) may mis-classify some legitimate chunk orderings as timezone discontinuities. This is a known MVP limitation; correction flags but does not act, so a mis-classification produces a spurious annotation rather than a wrong reorder.
- The overlap-fraction threshold for distinguishing `duplicate_chunk` from `chunk_ordering` requires empirical tuning from real data. MVP default is conservative.
