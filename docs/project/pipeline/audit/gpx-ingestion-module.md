<!-- generated-by: gsd-doc-writer -->
# GPX Ingestion Module

## Purpose

`gpx-ingestion-module.js` parses raw GPX XML into a structured `points[]` array and audit metadata. It performs **pure ingestion only** — no cleaning, smoothing, or repair. It applies coordinate validation (accept vs reject) and produces structured time/elevation channels and structural enrichment that downstream audit modules consume.

This module is the pipeline entry point. All other audit modules receive the `points[]` array it produces.

## Public API

### `parseGPX(gpxString)`

**Parameter:** `gpxString` (string) — full GPX XML text.

**Returns:**

```javascript
{
  points: Point[],
  audit: {
    ingestion: {
      counts:           IngestionCounts,
      context:          IngestionContext,
      rejections:       { events: RejectionEvent[] },
      segmentSummaries: SegmentSummary[],  // from export-fault-detection.js
      segmentBoundaries: SegmentBoundary[] // one per trkSegIndex with ≥1 accepted point
    },
    exportFaults: ExportFault[],           // from export-fault-detection.js
    waypoints:    ReferencePoint[],        // parsed <wpt> elements (NOT in points[])
    routes:       Route[]                  // parsed <rte> elements (NOT in points[])
  }
}
```

**Throws:** `Error` if `DOMParser` returns a `parsererror`.

### `parseGPXFile(file)`

Async wrapper for browser `File` objects (uses `FileReader`). Returns the same shape as `parseGPX()`.

## Inputs

- Raw GPX XML string (or `File` object via `parseGPXFile`).
- Requires `detectExportFaults` to be in scope (from `export-fault-detection.js`). If absent, `exportFaults` and `segmentSummaries` are empty arrays.

## Point model

| Collection | Contents | Has `gpxIndex`? |
|------------|----------|-----------------|
| `points[]` | Accepted `<trkpt>` elements only | Yes (trkpt-stream sequential, 0-based) |
| `audit.waypoints[]` | Parsed `<wpt>` elements | No — uses `sequenceIndex` |
| `audit.routes[].points[]` | Parsed `<rtept>` elements | No — uses `sequenceIndex` |

`gpxIndex` is assigned sequentially across all accepted trkpts regardless of track or segment. It is the stable stream identifier for the correction layer (ADR-0013: `toGpxIndex === fromGpxIndex + 1` for stream-adjacent pairs).

## Accepted point shape (`Point`)

```javascript
{
  gpxIndex:    number,          // 0-based, trkpt-stream sequential
  trkSegIndex: number,          // globally 0-based <trkseg> index across all tracks
  pointType:   'trkpt',
  lat:         number,          // finite, validated [-90, 90]
  lon:         number,          // finite, validated [-180, 180]
  ele:         number | null,   // null if absent or unparsable
  eleAbsent:   boolean,         // true = no <ele> element; false = present but null
  timeRaw:     string | null,   // raw <time> text, preserved as-is
  timeAbsent:  boolean,         // true = no <time> element
  timeMs:      number | null,   // Date.parse(timeRaw), or null if absent/unparsable
  extensions:  Element | null   // raw DOM node; not interpreted
}
```

## Coordinate validation

A trkpt is **rejected** (goes to `rejections.events`, not `points[]`) if:
- `lat` or `lon` are not parseable as finite numbers, OR
- `lat` outside `[-90, 90]` or `lon` outside `[-180, 180]`.

Waypoints and routes with invalid coordinates are **still included** in their collections with `coordsValid: false`, so overlay consumers can choose to filter.

## Segment boundaries

After building `points[]`, the module computes `segmentBoundaries[]` — one entry per `trkSegIndex` that has at least one accepted point:

```javascript
{
  trkSegIndex:   number,
  firstGpxIndex: number,
  lastGpxIndex:  number,
  firstTimeMs:   number | null,  // timeMs of the first accepted point
  lastTimeMs:    number | null,  // timeMs of the last accepted point
  minTimeMs:     number | null,  // minimum timeMs across the segment
  maxTimeMs:     number | null   // maximum timeMs across the segment
}
```

Emitted in ascending `trkSegIndex` order. These boundaries are consumed by the correction layer's `boundary-classifier.js` (ADR-0013: raw boundaries; correction layer classifies them).

## Ingestion counts shape

```javascript
{
  counts: {
    totalTrkptCount:    number,   // all <trkpt> elements found
    validTrkptCount:    number,   // accepted into points[]
    rejectedTrkptCount: number,   // failed coordinate validation
    trkSegmentCount:    number,   // total <trkseg> elements across all tracks
    waypointCount:      number,
    routeCount:         number
  },
  context: {
    hasAnyTimestampValues: boolean,  // any accepted point has timeAbsent === false
    hasWaypoints:          boolean,
    hasRoutes:             boolean,
    hasMultipleSegments:   boolean
  }
}
```

## Parsing steps (in order)

1. `DOMParser.parseFromString()` — throws on `parsererror`.
2. `detectExportFaults(xmlDoc)` — segment-level fault detection and `segmentSummaries` before any `gpxIndex` assignment.
3. Parse `<wpt>` elements → `audit.waypoints[]`.
4. Parse `<rte>` / `<rtept>` elements → `audit.routes[]`.
5. Iterate `<trk>` → `<trkseg>` → `<trkpt>` in document order; assign `gpxIndex` and `trkSegIndex`; validate coordinates; build `points[]` and `rejectionEvents[]`.
6. Build `segmentBoundaries[]` from accepted `points[]`.

## Segment awareness

`trkSegIndex` is the key structural field enabling segment-level analysis throughout the pipeline:
- Each accepted point carries `trkSegIndex`.
- `segmentBoundaries[]` provides time windows per segment.
- `segmentSummaries[]` (from `export-fault-detection.js`) provides per-`<trkseg>` point counts and time ranges.
- All downstream audit modules (`timestamp-audit.js`, `motion-audit.js`, `sampling-audit.js`, `elevation-audit.js`) group their `perSegment` outputs using `trkSegIndex`.

## Integration

- **Pipeline position:** first module; all others consume the `points[]` it produces.
- **Calls:** `detectExportFaults(xmlDoc)` from `export-fault-detection.js`.
- **Output consumed by:** all downstream audit modules (direct `points[]`) and `audit-export-module.js` (ingestion audit block).
- **Correction layer:** `correction-runner.js` receives `points[]` as `acceptedPoints` and reads `segmentBoundaries[]` via the audit JSON.
