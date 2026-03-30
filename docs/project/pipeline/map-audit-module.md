# `map-audit-module.js`

## Purpose

`map-audit-module.js` provides a standalone Leaflet diagnostics map for a loaded track.

## Public API

- `initializeAuditMap(points)`

## Core behavior

- Re-initializes map instance on each track load.
- Builds route polyline from processed points.
- Fits route bounds and supports recenter.
- Supports nearest-point lookup on hover/click for `gpxIndex` tooltips.
- Supports index search to focus map on a specific point.

## UI interaction model

- Map drag/toggle shell is controlled by `index.html`.
- Module focuses on map creation, route rendering, and point lookup behavior.
- Safely handles repeated loads by removing old map instance before creating a new one.

## Notes

- This module is workbench-facing and read-only with respect to pipeline outputs.
- It does not change ingestion/audit logic; it visualizes already computed points.
