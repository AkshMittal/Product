# GPX Ingestion Module

## Overview

The GPX Ingestion Module parses raw GPX XML using the browser's `DOMParser`. It performs **pure ingestion**: no cleaning, smoothing, or repair — only coordinate validation (accept vs reject) and structured time/ele channel extraction for downstream audits.

**Point model (what goes where):**

| Output path | Content |
|-------------|---------|
| `points[]` | Accepted `<trkpt>` elements only. Each carries `gpxIndex` (trkpt-stream sequential, 0-based) and `trkSegIndex` (which `<trkseg>` they belong to). |
| `audit.waypoints[]` | Parsed `<wpt>` elements as a separate reference collection. **Not** mixed into `points[]`. |
| `audit.routes[]` | Parsed `<rte>` elements as a separate reference collection. **Not** mixed into `points[]`. Each route has `name` + `points[]`. |
| `audit.exportFaults[]` | Structural faults detected at the `<trkseg>` level before `gpxIndex` assignment (see [export-fault-detection.md](./export-fault-detection.md)). |
| `audit.ingestion.segmentSummaries[]` | One compact summary per `<trkseg>` (time range, point count). |

## Purpose

- Produce the **`points`** array passed to temporal, sampling, motion, and elevation audits (accepted trkpt only).
- Assign **`gpxIndex`** — stable, trkpt-only, 0-based stream index — so "adjacent" logic downstream can use `gpxIndex + 1` (see [ADR-0013](../../adr/audit/0013-gpx-stream-adjacency-via-gpxindex.md)).
- Assign **`trkSegIndex`** — which `<trkseg>` element each trkpt belongs to — enabling the correction layer and export-fault-detection to classify anomalies as intra-segment (recording-level) vs inter-segment (export-chunk fault).
- Forward **`waypoints`** and **`routes`** as separate reference collections for overlay / UI layers.
- Emit **`audit.ingestion`** metadata: counts, context flags, coordinate rejection events, and segment summaries.

## Public API

### `parseGPX(gpxString)`

**Parameters**

- `gpxString` (string): Full GPX XML text.

**Returns**

```
{
  points:  Point[],
  audit: {
    ingestion: {
      counts:           IngestionCounts,
      context:          IngestionContext,
      rejections:       { events: RejectionEvent[] },
      segmentSummaries: SegmentSummary[]
    },
    exportFaults: ExportFault[],
    waypoints:    ReferencePoint[],
    routes:       Route[]
  }
}
```

**Throws**

- `Error` if XML is malformed (`parsererror` from `DOMParser`).

### `parseGPXFile(file)`

Same return shape as `parseGPX`, from a browser `File` via `FileReader` (returns a `Promise`).

### `parseTrkptElement(pointElement, gpxIndex, trkSegIndex)` (internal)

Not part of the stable public contract. Parses one `<trkpt>` element into an accepted point or rejection record. Replaces the old `parsePointElement` signature (which handled all three point types).

### `parseReferencePointElement(pointElement, pointType, sequenceIndex)` (internal)

Parses one `<wpt>` or `<rtept>` element into a reference point object. Returns a `ReferencePoint` with `coordsValid: boolean` — invalid-coord points are still included (with `lat: null, lon: null`) so overlay consumers can decide how to handle them.

---

## `audit.ingestion` shape

### `counts`

| Field | Meaning |
|-------|---------|
| `totalTrkptCount` | All `<trkpt>` elements found, before coordinate validation. |
| `validTrkptCount` | Length of accepted `points[]`. |
| `rejectedTrkptCount` | `<trkpt>` elements discarded for invalid/out-of-range coordinates. |
| `trkSegmentCount` | Total `<trkseg>` elements across all tracks. Equals the number of distinct `trkSegIndex` values. |
| `waypointCount` | Total `<wpt>` elements found (all, regardless of `coordsValid`). |
| `routeCount` | Total `<rte>` elements found. |

### `context`

| Field | Meaning |
|-------|---------|
| `hasAnyTimestampValues` | Any accepted trkpt has a non-absent, non-empty `<time>` element. |
| `hasWaypoints` | At least one `<wpt>` element present. |
| `hasRoutes` | At least one `<rte>` element present. |
| `hasMultipleSegments` | `trkSegmentCount > 1`. Primary precondition for inter-segment export fault detection. |

### `rejections.events`

Each element is a **coordinate rejection** event for a `<trkpt>` that failed validation.

| Field | Type | Meaning |
|-------|------|---------|
| `gpxIndex` | number | trkpt stream index this slot would have occupied. |
| `trkSegIndex` | number | `<trkseg>` membership of the rejected point. |
| `pointType` | string | Always `'trkpt'` (wpt/rtept rejections are not surfaced here). |
| `rawLat` | string | Attribute text as read from XML. |
| `rawLon` | string | Attribute text as read from XML. |
| `rawEle` | string \| null | `<ele>` text if present. |
| `rawTime` | string \| null | `<time>` text if present. |
| `reason` | string | Human-readable rejection explanation. |

### `segmentSummaries[]`

One entry per `<trkseg>` element across all tracks. `globalSegIndex` matches `trkSegIndex` on accepted trkpt points.

| Field | Type | Meaning |
|-------|------|---------|
| `trackIndex` | number | 0-based index of the parent `<trk>`. |
| `segIndex` | number | 0-based index within that track. |
| `globalSegIndex` | number | 0-based index across all tracks. |
| `pointCount` | number | Total `<trkpt>` elements in this segment. |
| `usableTimeCount` | number | How many trkpts have a parseable `timeMs`. |
| `firstTimeMs` | number \| null | `timeMs` of the first parseable timestamp. |
| `lastTimeMs` | number \| null | `timeMs` of the last parseable timestamp. |
| `minTimeMs` | number \| null | Minimum `timeMs` over the segment. |
| `maxTimeMs` | number \| null | Maximum `timeMs` over the segment. |

---

## Accepted point object (`points[]`)

Each entry in `points[]` is an accepted `<trkpt>`:

```javascript
{
  gpxIndex:   number,         // trkpt-stream sequential index (0-based; trkpt-only)
  trkSegIndex: number,        // which <trkseg> this point belongs to (globally 0-based)
  pointType:  'trkpt',
  lat:        number,         // -90..90, finite
  lon:        number,         // -180..180, finite
  ele:        number | null,  // parsed <ele> when finite; else null
  eleAbsent:  boolean,        // true = no <ele> child element
  timeRaw:    string | null,  // trimmed <time> text, or null if absent/empty
  timeAbsent: boolean,        // true = no <time> child element
  timeMs:     number | null,  // Date.parse(timeRaw) when finite; else null
  extensions: Element | null  // raw <extensions> DOM node, or null
}
```

**`gpxIndex` is trkpt-only.** It is NOT assigned to `<wpt>` or `<rtept>` elements. The correction layer's ADR-0013 adjacency (`toGpxIndex === fromGpxIndex + 1`) holds exactly within the trkpt stream.

**`trkSegIndex`** is the primary signal for the export-fault-detection module and for the correction layer's classification of temporal anomalies:
- Anomaly spans a `trkSegIndex` boundary → inter-segment → likely export-chunk fault candidate.
- Anomaly is within one `trkSegIndex` value → intra-segment → recording-level (GPS glitch, pause/resume, genuine backtrack).

---

## Waypoints (`audit.waypoints[]`)

Each entry is a parsed `<wpt>` element. Not in `points[]`.

```javascript
{
  sequenceIndex: number,     // 0-based position in the waypoints collection
  pointType:     'wpt',
  coordsValid:   boolean,    // false = invalid/out-of-range coords; lat/lon set to null
  lat:           number | null,
  lon:           number | null,
  rawLat:        string,
  rawLon:        string,
  ele:           number | null,
  eleAbsent:     boolean,
  name:          string | null,
  desc:          string | null,
  sym:           string | null,  // <sym> element text (icon name)
  type:          string | null,  // <type> element text (e.g. 'Geocache|Traditional')
  timeRaw:       string | null,
  timeAbsent:    boolean,
  timeMs:        number | null
}
```

---

## Routes (`audit.routes[]`)

Each entry is one `<rte>` element. Not in `points[]`.

```javascript
{
  routeIndex: number,   // 0-based position in the routes collection
  name:       string | null,
  desc:       string | null,
  points:     ReferencePoint[]  // parsed <rtept> elements (same shape as wpt, pointType: 'rtept')
}
```

Each `ReferencePoint` in `route.points[]` has the same shape as a waypoint object (see above) with `pointType: 'rtept'` and its own `sequenceIndex` (0-based within the route).

---

## `audit.exportFaults[]`

See [export-fault-detection.md](./export-fault-detection.md) for the full fault type reference. Common fault fields:

| Field | Meaning |
|-------|---------|
| `type` | `'chunk_ordering_fault'` \| `'duplicate_chunk_fault'` \| `'missing_chunk_fault'` \| `'timestamp_discontinuity_fault'` \| `'intra_segment_timestamp_violation'` |
| `severity` | `'critical'` \| `'high'` \| `'medium'` |
| `confidence` | 0–1 (chunk ordering = 1.0 deterministic; missing chunk = 0.85) |
| `trackIndex` | Parent `<trk>` index |
| `fromTrkSegIndex` / `toTrkSegIndex` | Segment boundary (inter-segment faults) |
| `trkSegIndex` | Containing segment (intra-segment violation) |
| `gapMs` | Time gap in milliseconds at the boundary |
| `details` | Human-readable description |

---

## Validation rules

### Coordinates (trkpt — discard on failure)

1. `lat` / `lon` attributes required; must parse as finite floats.
2. `lat ∈ [-90, 90]`, `lon ∈ [-180, 180]`.

Failed trkpts are **not** pushed to `points[]`; they append one object to `rejections.events`.

### Coordinates (wpt / rtept — include with flag)

Same validation rules applied, but invalid-coord reference points are still included in `waypoints[]` / `routes[].points[]` with `coordsValid: false` and `lat: null, lon: null`. They are not added to `rejections.events`.

### Elevation and time

Missing or unparsable `ele` or `time` does **not** reject any point type. Elevation and temporal audits classify those channels from `eleAbsent` / `ele` and `timeAbsent` / `timeMs` / `timeRaw`.

### Extensions

`<extensions>` is preserved as a DOM node on trkpt; contents are not interpreted here.

---

## Processing order (inside `parseGPX`)

1. **Export fault detection** — `detectExportFaults(xmlDoc)` on the raw XML doc before gpxIndex assignment. Produces `audit.exportFaults[]` and `segmentSummaries[]`.
2. **Waypoints** — `xmlDoc.querySelectorAll('wpt')` → `audit.waypoints[]`.
3. **Routes** — `xmlDoc.querySelectorAll('rte')` → `audit.routes[]`.
4. **Track points** — iterate `<trk> → <trkseg> → <trkpt>` with incrementing `trkSegIndexCounter` per segment and `gpxIndex` per trkpt. Accepted trkpts → `points[]`; rejected → `rejections.events`.

**`trkSegIndex` is assigned globally** (across all `<trk>` elements in document order), not per-track. This matches the `globalSegIndex` in `segmentSummaries[]` and the fault indexes in `exportFaults[]`.

---

## Usage example

```javascript
const result = parseGPX(gpxXmlString);
const points    = result.points;
const ingestion = result.audit.ingestion;

console.log(ingestion.counts.validTrkptCount, ingestion.counts.rejectedTrkptCount);
console.log('Segments:', ingestion.counts.trkSegmentCount);
console.log('Export faults:', result.audit.exportFaults.length);
console.log('Waypoints:', result.audit.waypoints.length);
console.log('Routes:', result.audit.routes.length);

// trkSegIndex on each point:
points.forEach(p => console.log(p.gpxIndex, p.trkSegIndex, p.timeMs));

// Route overlay:
result.audit.routes.forEach(r => {
  console.log('Route:', r.name, r.points.length, 'pts');
});
```

---

## Dependencies

- Browser `DOMParser`, `FileReader`.
- `export-fault-detection.js` must be loaded in scope (provides `detectExportFaults`). If absent, export fault detection is skipped gracefully and `audit.exportFaults` is `[]`.

## Notes

- Browser-only; does not mutate the input string.
- `gpxIndex` is trkpt-only — it no longer includes `wpt` or `rtept` slots. Downstream correction logic (ADR-0013) remains valid within the trkpt stream.
- `trkSegIndex` values are contiguous integers starting at 0 and match `segmentSummaries[i].globalSegIndex`. They are stable identifiers for the duration of a session.
