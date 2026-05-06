<!-- generated-by: gsd-doc-writer -->
# boundary-classifier.js — Inter-Segment Boundary Classification

## Purpose

Classifies each consecutive segment pair's boundary based on the timestamp relationship between the end of one segment and the start of the next. Produces classification labels used by `deterministic-export-fix.js` to decide what corrective action (if any) to take. Pure read — no mutations.

## Inputs

```js
classifySegmentBoundaries(segmentSummaries, params?)
```

Two accepted input shapes:

1. **Pre-computed boundary objects** (from `correction-runner.deriveInterSegmentBoundaries`): detected by checking if the first element has `fromTrkSegIndex`. Routed to `classifyBoundaryObjects`.
2. **Raw segment summaries** (`audit.ingestion.segmentSummaries[]`): pairwise boundaries derived internally.

| Parameter | Type | Description |
|---|---|---|
| `segmentSummaries` | Array | Segment summaries or pre-computed boundary objects |
| `params` | Object | Optional `{ timezoneShiftTolerance }` (default from `params/defaults`) |

## Outputs

Array of boundary records, one per consecutive segment pair:

```js
{
  fromTrkSegIndex,
  toTrkSegIndex,
  trackIndex,           // null
  classification,       // see below
  isBoundaryGap,        // true for forward gaps
  gapMs,
  impliedDistanceM,     // null (not computed here)
  impliedSpeedKph,      // null (not computed here)
  suspectedTimezoneOffsetHours,
  raw                   // original input objects
}
```

## Key logic

**Classification decision tree** (per consecutive pair, using `currLastTimeMs` and `nextFirstTimeMs`):

1. Either time is null → `classification: null`
2. `nextFirstTimeMs < currLastTimeMs` (backward jump):
   - Compute `deltaHours = (lastT - firstT) / 3_600_000`
   - If `|deltaHours - round(deltaHours)| <= timezoneShiftTolerance` AND `round(deltaHours) >= 1` → `'timestamp_discontinuity'`; sets `suspectedTimezoneOffsetHours`
   - Else: compare min/max time ranges for overlap
     - `nextMin < currMax && nextMax > currMin` → `'duplicate_chunk'`
     - Otherwise → `'chunk_ordering'`
3. `gapMs > 0` (forward gap): `isBoundaryGap = true`; `sameUtcDay(lastT, firstT)` → `'same_day'` else `'cross_day'`
4. `gapMs === 0` → `classification: null`

`sameUtcDay` compares UTC year/month/date of two timestamps.

**Pass-through path** (`classifyBoundaryObjects`): same decision logic but reads `currLastTimeMs`/`nextFirstTimeMs`/`currMinTimeMs`/`currMaxTimeMs`/`nextMinTimeMs`/`nextMaxTimeMs` directly from pre-computed boundary objects.

## Invariants

- Emits exactly one record per consecutive segment pair
- `classification` is at most one of the five values or `null`
- `impliedDistanceM` and `impliedSpeedKph` are always `null` (not computed by this module)
- Does not write to `workingState`

## Integration

- Called from `correction-runner.js` (step 4) with pre-computed boundary objects
- Output consumed by `deterministic-export-fix.js` and `edge-reconciliation.js`
- ADR-0013: boundary classification ownership lives in correction layer, not audit layer

## Related ADRs

- ADR-0013 — boundary classification ownership
