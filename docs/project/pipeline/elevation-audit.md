# Elevation audit module

## Overview

The Elevation Audit Module performs a **per-point observational labeling** pass on the recorded **elevation channel** in GPX points. It does **not** mutate, smooth, or normalize values. Output mirrors the temporal audit pattern: **`tagCounts`**, **`tagIndex`**, and sparse **`pointAnnotations`**.

It does **not** emit channel statistics (min/max/span), consecutive Δele summaries, co-presence with time, or block structures — those are **downstream** concerns (derive from raw points and labels, and cross-reference `audit.temporal` / `audit.motion` when needed).

## Purpose

- Distinguish **missing** `<ele>` (no child element) from **unparsable** `<ele>` (element present but not a finite number), via ingestion’s `eleAbsent` flag.
- Flag **out-of-bounds** numeric elevation against `[validFloorM, validCeilingM]`.
- Flag **adjacent duplicate** elevation: current in-bounds value equals the **previous in-bounds** value (same chaining idea as temporal’s adjacent duplicate on valid values).

## Relationship to motion audit

- **Elevation audit** = **point-level** channel labels (`missing`, `unparsable`, `outOfBounds`, `adjacentDuplicate`).
- **Motion audit** = **pair-level** kinematic eligibility, including `eleUnresolvable` using the same numeric bounds **independently** (no runtime dependency between modules). See [`motion-audit.md`](motion-audit.md) and ADR-0006 / ADR-0007.

## Public API

### `auditElevation(points, params?)`

**Parameters**

- `points` — array of `{ gpxIndex, ele, eleAbsent? }` as produced by ingestion (`eleAbsent` boolean when `<ele>` absent vs present).
- `params.validFloorM` (default `-500`), `params.validCeilingM` (default `9500`) — inclusive valid range for numeric `ele`.

**Returns**

```javascript
{
  audit: {
    elevation: {
      totalPointsEvaluated,
      validElevationPointCount,  // finite ele within [floor, ceiling]
      parameters: { validFloorM, validCeilingM },
      tagCounts: {
        missing,
        unparsable,
        outOfBounds,
        adjacentDuplicate
      },
      tagIndex: {
        missing: [...gpxIndexes],
        unparsable: [...gpxIndexes],
        outOfBounds: [...gpxIndexes],
        adjacentDuplicate: [...gpxIndexes]
      },
      pointAnnotations: [
        { gpxIndex, missing: true },
        { gpxIndex, unparsable: true },
        { gpxIndex, outOfBounds: true, ele },
        { gpxIndex, ele, adjacentDuplicate: true }
      ]
    }
  }
}
```

## Tag definitions and mutual exclusion

| Tag | Condition |
|-----|-----------|
| `missing` | `eleAbsent === true` **or** legacy: `ele === null` and `eleAbsent` is not `false`. |
| `unparsable` | `eleAbsent === false` and `ele === null` (or non-finite). **Mutually exclusive** with `missing`. |
| `outOfBounds` | Finite numeric `ele` outside `[validFloorM, validCeilingM]`. **Mutually exclusive** with `missing` and `unparsable`. |
| `adjacentDuplicate` | In-bounds numeric `ele` equals previous **in-bounds** point’s `ele`. **Mutually exclusive** with `missing`, `unparsable`, and `outOfBounds`. |

Non-overlapping groups: at most one of `missing` / `unparsable` / `outOfBounds` applies. `adjacentDuplicate` only applies on the in-bounds path.

## Out of scope

- `std(Δele)` — ADR-0004  
- Gain/loss, vertical speed, 3D kinematics — motion / downstream (ADR-0007)  
- DEM comparison during audit — ADR-0009  

## JSON paths

See [`json-schema-v2-glossary.md`](json-schema-v2-glossary.md) section **Elevation**.
