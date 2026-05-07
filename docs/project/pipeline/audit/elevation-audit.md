<!-- generated-by: gsd-doc-writer -->
# Elevation Audit Module

## Purpose

`elevation-audit.js` performs a **per-point observational labeling** pass on the recorded elevation channel. It assigns boolean tags to anomalous points — it does NOT mutate, reorder, smooth, normalize, or compute channel statistics (consecutive Δele, co-presence with time, or block analysis). Those are derivable downstream from points and temporal/motion tags.

## Inputs

```javascript
auditElevation(points, params?)
```

- `points` — accepted trkpt array from ingestion. Each point must have:
  - `gpxIndex` (number) — stable trkpt stream index
  - `trkSegIndex` (number) — which `<trkseg>` this point belongs to
  - `ele` (number | null) — parsed elevation value (null if absent or unparsable)
  - `eleAbsent` (boolean, optional) — `true` if no `<ele>` element; `false` if present but unparsable; omitted for legacy points

- `params` (optional):
  - `validFloorM` (number, default `-500`) — lower bound for valid elevation in metres
  - `validCeilingM` (number, default `9500`) — upper bound for valid elevation in metres

## Outputs

Returned as `{ audit: { elevation: { ... } } }`:

| Field | Description |
|-------|-------------|
| `totalPointsEvaluated` | All points processed |
| `validElevationPointCount` | Points with a finite in-bounds elevation |
| `parameters` | `{ validFloorM, validCeilingM }` actually used |
| `tagCounts` | `{ missing, unparsable, outOfBounds, adjacentDuplicate }` — global counts |
| `tagIndex` | Per-tag arrays of `gpxIndex` values |
| `pointAnnotations` | Sparse — only anomalous points; each object has `gpxIndex` + applicable boolean flags |
| `perSegment` | Array of per-segment summaries (see below) |

### Per-segment summary shape

Each entry in `perSegment` (sorted by `trkSegIndex`):

```javascript
{
  trkSegIndex:              number,
  totalPointsEvaluated:     number,
  validElevationPointCount: number,
  tagCounts: {
    missing:           number,
    unparsable:        number,
    outOfBounds:       number,
    adjacentDuplicate: number
  }
}
```

## Key Logic

### Tag definitions (mutually exclusive groups)

Tags are assigned in a fixed priority cascade per point:

| Tag | Condition |
|-----|-----------|
| `missing` | `eleAbsent === true`, OR `eleAbsent` not `false` and `ele === null` (legacy point fallback) |
| `unparsable` | `eleAbsent === false` AND `ele` is not a finite number |
| `outOfBounds` | `ele` is a finite number outside `[validFloorM, validCeilingM]` |
| `adjacentDuplicate` | `ele` is in-bounds AND equals the previous in-bounds `ele` value |

- `missing` and `unparsable` are mutually exclusive.
- `outOfBounds` cannot co-occur with `missing` or `unparsable`.
- `adjacentDuplicate` applies only to in-bounds numeric values.
- `prevValidEle` resets to `null` on any non-in-bounds point, so adjacentDuplicate cannot bridge across anomalous points.

### pointAnnotations

Sparse — only anomalous points appear. Each entry includes `gpxIndex` and the relevant boolean flag(s) plus the raw `ele` value for `outOfBounds` entries.

## Segment Awareness

Each point carries `trkSegIndex` from ingestion. The module builds a per-segment summary by:
1. Creating a `Map<trkSegIndex, segEntry>` from the points array.
2. Iterating `pointAnnotations` to increment per-segment `tagCounts`.
3. Running a separate pass to count `validElevationPointCount` per segment.

Per-segment data is emitted as `perSegment[]` sorted ascending by `trkSegIndex`. This follows ADR-correction-0013 (raw per-segment payloads; classification is done by the correction layer).

## Integration

- **Pipeline position:** invoked by the audit runner after `gpx-ingestion-module.js` and `timestamp-audit.js`. Consumes the same `points[]` array.
- **Output consumed by:** `audit-export-module.js` assembles the result into `audit.elevation` of the final `audit.json`.
- **Correction layer:** `correction-runner.js` reads `perSegment` tagCounts to inform segment participation classification.
- Does not depend on any other audit module.
