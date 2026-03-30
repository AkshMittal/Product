# GPX Ingestion Module

## Overview

The GPX Ingestion Module is responsible for parsing raw GPX (GPS Exchange Format) XML files and extracting structured point data. It uses the browser's native `DOMParser` API to parse XML and extracts all three GPX point types: waypoints (`<wpt>`), route points (`<rtept>`), and track points (`<trkpt>`).

## Purpose

This module serves as the first stage of the GPX correction pipeline. It performs pure ingestion - reading and extracting data without any cleaning, smoothing, or transformation. The module focuses on data integrity by validating coordinates and discarding invalid points while preserving valid data as-is.

## Functions

### `parseGPX(gpxString)`

Parses a GPX XML string and extracts all point types.

**Parameters:**
- `gpxString` (string): The GPX file content as a string

**Returns:**
- `Object` containing:
  - `points` (Array): Array of parsed point objects in original GPX order
  - `stats` (Object): Statistics object with:
    - `totalPointsFound` (number): Total number of points found in the GPX file (before validation)
    - `pointsDiscarded` (number): Number of points discarded due to validation failures
    - `remainingPoints` (number): Number of valid points returned
    - `rejectedCoordinates` (Array): Array of rejected coordinate events, each containing:
      - `index` (number): Index of the rejected point
      - `reason` (string): Rejection reason explaining why the point was discarded

**Throws:**
- `Error`: If XML parsing fails (malformed XML)

### `parseGPXFile(file)`

Convenience function to parse a GPX file from a browser File object (typically from a file input element).

**Parameters:**
- `file` (File): File object from input element

**Returns:**
- `Promise<Object>`: Promise that resolves to the same object structure as `parseGPX()`

**Throws:**
- `Error`: If file reading fails or XML parsing fails

### `parsePointElement(pointElement, index, pointType)` (Internal)

Helper function that parses a single point element and validates it.

**Parameters:**
- `pointElement` (Element): The point XML element
- `index` (number): Index of the point
- `pointType` (string): Type of point: 'wpt', 'rtept', or 'trkpt'

**Returns:**
- `Object` with:
  - `valid` (boolean): Whether the point passed validation
  - `point` (Object|null): Parsed point object if valid, null otherwise
  - `rejectionReason` (string|null): Explanation if rejected
  - `rawData` (Object): Raw XML data for logging rejected points

## Point Object Structure

Each valid point object contains:

```javascript
{
  index: number,           // Sequential index across all point types
  pointType: string,       // 'wpt', 'rtept', or 'trkpt'
  lat: number,            // Latitude (-90 to 90)
  lon: number,            // Longitude (-180 to 180)
  ele: number|null,       // Elevation in meters, or null if missing/invalid
  timeRaw: string|null,   // Raw timestamp string, or null if missing/empty
  extensions: Element|null // Raw DOM node for extensions, or null
}
```

## Validation Rules

### Coordinate Validation

1. **Required Attributes**: `lat` and `lon` must be present as attributes on all point types
2. **Numeric Parsing**: Coordinates must be parseable as floating-point numbers
3. **Range Validation**:
   - Latitude must be between -90 and 90 (inclusive)
   - Longitude must be between -180 and 180 (inclusive)

**Points failing coordinate validation are discarded.**

### Elevation Handling

- Elevation (`<ele>`) is optional
- If present, must be parseable as a number
- Invalid or missing elevation is stored as `null` (point is **not** discarded)
- Points without elevation data are kept in the output

### Timestamp Handling

- Timestamp (`<time>`) is optional
- If the `<time>` element is absent → `timeRaw = null`
- If the `<time>` element exists but is empty or whitespace-only → `timeRaw = null`
- Only non-empty timestamp strings are preserved
- Empty timestamps are treated as missing (not unparsable)

### Extensions Handling

- Extensions (`<extensions>`) are preserved as raw DOM nodes
- No parsing or inspection of extension contents
- Stored as `null` if not present
- Preserved for future pipeline stages that may need to process extensions

## Point Type Processing Order

Points are extracted and processed in the following order:

1. **Waypoints (`<wpt>`)**: Standalone points
2. **Route Points (`<rtept>`)**: Points within routes
3. **Track Points (`<trkpt>`)**: Points within tracks

All points maintain a global sequential index across all types, preserving their original order within each type.

## Error Handling and Logging

### Rejected Coordinate Collection

When a point is rejected, the module:
- Collects all rejected coordinate events in `stats.rejectedCoordinates` array
- Logs the first rejected point to the console with:
  - Raw data (pointType, index, lat, lon, ele, time)
  - Rejection reason (explanation of why it was rejected)

This helps diagnose data quality issues without overwhelming the console with duplicate errors, while preserving all rejection events for downstream flagged events display.

### Statistics Tracking

The module tracks and returns:
- Total points found (before validation)
- Points discarded (validation failures)
- Remaining points (valid points in output)

## Important Behaviors

1. **No Data Transformation**: This module does not modify, clean, or normalize data. It only validates and extracts.
2. **Preserves Order**: Points are returned in the same order they appear in the GPX file.
3. **Preserves Extensions**: Extension DOM nodes are kept intact for downstream processing.
4. **Coordinate-Only Validation**: Only coordinates are validated for discarding points. Missing elevation or timestamps do not cause rejection.
5. **Empty Timestamp Handling**: Empty or whitespace-only timestamps are normalized to `null` to ensure proper classification in downstream audit stages.

## Usage Example

```javascript
// Parse from string
const result = parseGPX(gpxXmlString);
console.log(result.points);      // Array of point objects
console.log(result.stats);        // Statistics object

// Parse from file
const file = document.getElementById('fileInput').files[0];
const result = await parseGPXFile(file);
console.log(`Parsed ${result.stats.remainingPoints} valid points`);
```

## Dependencies

- Browser `DOMParser` API (native, no external dependencies)
- Browser `FileReader` API (for `parseGPXFile`)

## Notes

- This module is designed for browser environments only
- The module does not mutate input data
- All validation is performed during parsing
- Points are indexed sequentially starting from 0
