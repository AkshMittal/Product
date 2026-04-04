# GPX Ingestion Module

## Overview

The GPX Ingestion Module parses raw GPX (GPS Exchange Format) XML using the browser’s `DOMParser`, walks **waypoints** (`<wpt>`), **route points** (`<rtept>`), and **track points** (`<trkpt>`) in that order, and assigns a monotonic **`gpxIndex`** per point encountered (accepted or rejected). It performs **pure ingestion**: no cleaning, smoothing, or repair—only coordinate validation for **accept vs reject**, plus structured time/ele channel fields for downstream audits.

## Purpose

- Produce the **`points`** array passed to temporal, sampling, motion, and elevation audits (accepted points only).
- Emit **`audit.ingestion`** metadata aligned with schema v2: counts, light context flags, and **structured rejection events** for coordinate failures.
- Preserve **`gpxIndex`** as the stable **GPX stream index** so “adjacent” logic downstream can use `gpxIndex + 1` (see [ADR-0013](../../adr/audit/0013-gpx-stream-adjacency-via-gpxindex.md)).

## Public API

### `parseGPX(gpxString)`

**Parameters**

- `gpxString` (string): Full GPX XML text.

**Returns**

An object:

| Path | Description |
|------|-------------|
| `points` | `Array` of accepted point objects (same order as stream; rejects omitted). |
| `audit.ingestion` | Ingestion audit slice for export (see below). |

**Throws**

- `Error` if XML is malformed (`parsererror` from `DOMParser`).

### `parseGPXFile(file)`

Same return shape as `parseGPX`, from a browser `File` via `FileReader` (returns a `Promise`).

### `parsePointElement(pointElement, gpxIndex, pointType)` (internal)

Not part of the stable public contract; used internally. Parameters are **`gpxIndex`** (stream index for this element) and **`pointType`** (`'wpt' \| 'rtept' \| 'trkpt'`).

---

## `audit.ingestion` shape (schema v2)

This object is what `buildAuditExportPayload` places at `payload.audit.ingestion` when the exporter is given `ingestionAudit: result.audit.ingestion`.

### `counts`

| Field | Meaning |
|-------|---------|
| `totalPointCount` | All GPX points seen (`wpt` + `rtept` + `trkpt`), before discard. |
| `validPointCount` | Length of accepted `points` array. |
| `rejectedPointCount` | Points discarded for invalid/out-of-range coordinates. |
| `pointTypeCounts` | `{ wpt, rtept, trkpt }` counts as found in XML. |

### `context`

| Field | Meaning |
|-------|---------|
| `hasMultiplePointTypes` | More than one of `wpt` / `rtept` / `trkpt` has count &gt; 0. |
| `hasAnyTimestampValues` | Any point has a `<time>` element or non-null time raw signal per ingestion rules. |

### `rejections`

| Field | Meaning |
|-------|---------|
| `events` | Array of **coordinate rejection** records (see below). |

**Nomenclature:** The export path is **`audit.ingestion.rejections.events`**. The parser builds this array internally as `rejectionEvents` and assigns it to `rejections.events` (not a legacy top-level `stats` object).

Each element of **`rejections.events`**:

| Field | Type | Meaning |
|-------|------|---------|
| `gpxIndex` | number | Stream index of the rejected row (same indexing as accepted points would have had). |
| `pointType` | string | `'wpt'`, `'rtept'`, or `'trkpt'`. |
| `rawLat` | string | Attribute text as read from XML. |
| `rawLon` | string | Attribute text as read from XML. |
| `rawEle` | string \| null | `<ele>` text if present. |
| `rawTime` | string \| null | `<time>` text if present. |
| `reason` | string | Human-readable rejection explanation. |

---

## Accepted point object

Each entry in `points`:

```javascript
{
  gpxIndex: number,         // GPX stream order index (0-based, contiguous in stream)
  pointType: string,        // 'wpt' | 'rtept' | 'trkpt'
  lat: number,              // -90..90, finite
  lon: number,              // -180..180, finite
  ele: number | null,       // Parsed <ele> when finite; else null
  eleAbsent: boolean,       // true = no <ele> child
  timeRaw: string | null,   // Trimmed <time> text, or null if absent/empty after trim
  timeAbsent: boolean,      // true = no <time> child
  timeMs: number | null,    // Date.parse(timeRaw) when finite; else null (ingestion-only parse)
  extensions: Element | null // Raw <extensions> DOM node, or null
}
```

**Time channel (ADR-0012):** Only ingestion runs `Date.parse` on GPX `<time>` text. Audits use finite **`timeMs`** and **`timeAbsent`** / **`timeRaw`** for labeling only.

---

## Validation rules

### Coordinates (discard on failure)

1. `lat` / `lon` attributes required; must parse as finite floats.
2. `lat ∈ [-90, 90]`, `lon ∈ [-180, 180]`.

Failed points are **not** pushed to `points`; they append one object to **`rejections.events`**.

### Elevation and time

Missing or unparsable **ele** or **time** does **not** reject the point. Elevation audit and temporal audit classify those channels from `eleAbsent` / `ele` and `timeAbsent` / `timeMs` / `timeRaw`.

### Extensions

`<extensions>` is preserved as a DOM node; contents are not interpreted here.

---

## Processing order

1. All `<wpt>`, then all `<rtept>`, then all `<trkpt>`.
2. **`gpxIndex`** increments once per element processed, whether accepted or rejected—so indices match **full GPX stream order** across types.

---

## Usage example

```javascript
const result = parseGPX(gpxXmlString);
const points = result.points;
const ingestion = result.audit.ingestion;

console.log(ingestion.counts.validPointCount, ingestion.counts.rejectedPointCount);
console.log(ingestion.rejections.events.length); // coordinate rejects only
```

---

## Dependencies

- Browser `DOMParser`, `FileReader`.

## Notes

- Browser-only; does not mutate the input string.
- First-rejection **console logging** in source is disabled; full history is in **`rejections.events`**.
