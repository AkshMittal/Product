# Motion audit module

## Purpose

`motion-audit.js` performs an **observational, adjacent-pair labeling** pass: it records which consecutive point pairs are mechanically eligible for downstream kinematics (horizontal / 3D), without computing speed, distance totals, time totals, or other derived metrics. Those belong in downstream layers.

The module is independent from sampling audit decisions; it walks the same ingestion-ordered point array.

## Public API

- `auditMotion(points, params?)`
- Optional `params`:
  - `validFloorM` (default `-500`) — lower bound for endpoint elevation considered valid for motion.
  - `validCeilingM` (default `9500`) — upper bound for the same.

Elevation bounds apply only to the **`eleUnresolvable`** predicate; they mirror the motion slice of eligibility, not the full elevation-audit channel contract.

## Input point shape

- `lat`, `lon` — numbers (finite after ingestion)
- `timeMs` — number (finite ms since epoch) or `null` from ingestion; motion uses **only** finite `timeMs` for time deltas (no `Date.parse`). Missing vs unparsable is not re-derived here — see `audit.temporal`.
- `gpxIndex` — number (stable ingestion index)
- `ele` — optional; `number`, `null`, or omitted (`undefined` is treated like missing for motion ele checks)

## Core behavior

- Evaluates **GPX-stream-adjacent** pairs only: for neighbors in the `points` array, include the pair only when **`curr.gpxIndex === prev.gpxIndex + 1`**. Rejected GPX rows are absent from `points`, so array neighbors are not always stream-adjacent. See **ADR-0013**.
- **No anchored timestamp chaining** — no `prevTimestampMs` that skips points; pairs do not bridge across timestamp gaps.
- Computes haversine horizontal distance between the two endpoints.
- Applies **five independent, non-exclusive** boolean predicates per pair. A pair receives every tag whose condition holds (e.g. backward time and bad elevation on the same pair both appear on one `pairAnnotations` entry).

Tag names and exact conditions are specified in [`json-schema-v2-glossary.md`](json-schema-v2-glossary.md) under **`audit.motion`**.

## Output shape (summary)

Returned as `audit.motion`:

| Area | Role |
|------|------|
| `summary.consecutivePairCount` | Count of **stream-adjacent** pairs evaluated (see Core behavior), not `points.length - 1`. |
| `summary.parameters` | `validFloorM`, `validCeilingM` actually used. |
| `tagCounts` | Per-tag counts of **pairs** carrying that tag (non-exclusive; sums can exceed `consecutivePairCount`). |
| `tagIndex` | Per tag, an array of pair identities `{ fromGpxIndex, toGpxIndex }`. |
| `pairAnnotations` | **Sparse** — one object per pair with at least one tag; stacked flags on the same object. Optional `dtSec` / `ddMeters` per glossary rules. |

**Not emitted:** “forward-valid pair count,” time/distance/speed aggregates, or legacy rejection bucket counters. Pairs with **no** motion tags are identified by **absence** from `pairAnnotations`. A safe derived count is:

`consecutivePairCount - pairAnnotations.length`

Do **not** substitute `consecutivePairCount - sum(tagCounts)` — tags stack on the same pair, so `tagCounts` over-count pairs.

## Relationship to temporal audit

`timeUnresolvable` means one or both endpoints do not yield a finite parsed time for this pair. It does **not** re-label *why* (missing vs unparsable); use `audit.temporal` for point-level cause.

## Notes

- Does not mutate points.
- Same dual projection pattern as temporal audit: **sparse annotations by entity** (`pairAnnotations`) plus **label → index** (`tagIndex`), with **`tagCounts`** for quick summaries.
