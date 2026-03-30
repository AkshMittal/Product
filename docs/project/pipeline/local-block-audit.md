# `local-block-audit.js`

## Purpose

`local-block-audit.js` is a diagnostic helper for analyzing a selected GPX index block in the workbench.

## Public API

- `auditLocalBlock(points, fromIndex, toIndex)`

## Core behavior

- Filters ingestion points to an inclusive GPX index range.
- Computes:
  - `cumulativeDistanceM` (sum of segment distances inside block)
  - `netDisplacementM` (first-to-last point displacement)
  - `pointCount`
  - `elapsedTimeSec` (if start/end timestamps parse)
- Uses haversine meters for distance.
- Treats non-finite or negative derived values defensively.

## UI behavior in module

The module also initializes a floating popup tool:

- draggable header
- click-to-collapse body
- viewport clamping
- z-index bump on interaction

## Notes

- This is intentionally diagnostic-only: no thresholding or anomaly classification.
- It reads ingestion points directly and does not depend on precomputed delta tables.
