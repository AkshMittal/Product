/**
 * GPX Ingestion Module
 *
 * Parses raw GPX XML using the browser's DOMParser. Pure ingestion: no cleaning,
 * smoothing, or repair — only coordinate validation (accept vs reject), structured
 * time/ele channels, and structural enrichment for downstream audits.
 *
 * Point model (what goes where):
 *   points[]             — accepted <trkpt> elements only. Each carries gpxIndex
 *                          (trkpt-stream sequential, 0-based) and trkSegIndex
 *                          (which <trkseg> the point belongs to, globally 0-based).
 *   audit.waypoints[]    — parsed <wpt> elements as a separate reference collection.
 *                          NOT mixed into points[]. Used as overlay / POI reference.
 *   audit.routes[]       — parsed <rte> elements as a separate reference collection.
 *                          NOT mixed into points[]. Each route has name + points[].
 *   audit.exportFaults[] — structural faults detected at the <trkseg> level before
 *                          gpxIndex assignment (see export-fault-detection.js).
 *
 * gpxIndex is trkpt-only. It is a stable stream identifier for the correction layer
 * (ADR-0013 adjacency: toGpxIndex === fromGpxIndex + 1 for stream-adjacent accepted
 * trkpts). Waypoints and routes use their own sequenceIndex within their collections.
 *
 * Requires export-fault-detection.js to be loaded in scope (detectExportFaults).
 */

// ─── Internal: trkpt parsing ─────────────────────────────────────────────────

/**
 * Parses one <trkpt> element into an accepted point object or a rejection record.
 * Only trkpt elements are parsed here; wpt/rtept use parseReferencePointElement().
 *
 * @param {Element} pointElement
 * @param {number}  gpxIndex    - Sequential index in the trkpt stream (0-based)
 * @param {number}  trkSegIndex - Index of the parent <trkseg> (globally 0-based)
 * @returns {{ valid: boolean, point: Object|null, rejectionReason: string|null, rawData: Object|null }}
 */
function parseTrkptElement(pointElement, gpxIndex, trkSegIndex) {
  const rawLat = pointElement.getAttribute('lat');
  const rawLon = pointElement.getAttribute('lon');
  const rawEle  = pointElement.querySelector('ele')  ? pointElement.querySelector('ele').textContent        : null;
  const rawTime = pointElement.querySelector('time') ? pointElement.querySelector('time').textContent.trim() : null;

  const rawData = { pointType: 'trkpt', gpxIndex, trkSegIndex, lat: rawLat, lon: rawLon, ele: rawEle, time: rawTime };

  const lat = parseFloat(rawLat);
  const lon = parseFloat(rawLon);

  if (isNaN(lat) || isNaN(lon)) {
    return {
      valid: false, point: null,
      rejectionReason: `Invalid coordinates: lat="${rawLat}", lon="${rawLon}" (not parseable as numbers)`,
      rawData
    };
  }

  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return {
      valid: false, point: null,
      rejectionReason: `Coordinates out of valid range or non-finite: lat=${lat} (must be -90 to 90), lon=${lon} (must be -180 to 180)`,
      rawData
    };
  }

  // <ele> — optional; distinguish absent vs present-but-unparseable for elevation audit
  const eleElement = pointElement.querySelector('ele');
  let eleAbsent  = true;
  let elevation  = null;
  if (eleElement) {
    eleAbsent = false;
    const parsedEle = parseFloat(eleElement.textContent);
    elevation = (!isNaN(parsedEle) && isFinite(parsedEle)) ? parsedEle : null;
  }

  // <time> — optional; preserve raw string; parse once (ADR-0012)
  const timeElement = pointElement.querySelector('time');
  let timeAbsent = true;
  let timeRaw    = null;
  let timeMs     = null;
  if (timeElement) {
    timeAbsent = false;
    const t = timeElement.textContent.trim();
    timeRaw = t === '' ? null : t;
    if (timeRaw !== null) {
      const parsedMs = Date.parse(timeRaw);
      timeMs = isNaN(parsedMs) ? null : parsedMs;
    }
  }

  // <extensions> — preserved as DOM node; not interpreted here
  const extensionsElement = pointElement.querySelector('extensions');

  return {
    valid: true,
    point: {
      gpxIndex,
      trkSegIndex,
      pointType: 'trkpt',
      lat,
      lon,
      ele:       elevation,
      eleAbsent,
      timeRaw,
      timeAbsent,
      timeMs,
      extensions: extensionsElement || null
    },
    rejectionReason: null,
    rawData: null
  };
}

// ─── Internal: reference point parsing (wpt / rtept) ────────────────────────

/**
 * Parses one <wpt> or <rtept> element into a reference point object.
 * Reference points are NOT part of the audit pipeline points[] array and do NOT
 * receive a gpxIndex. They are forwarded as audit.waypoints[] / audit.routes[].
 *
 * Coordinate validation follows the same rules as trkpt. Invalid-coord points are
 * still included with coordsValid: false so overlay consumers can choose to filter.
 *
 * @param {Element} pointElement
 * @param {string}  pointType      - 'wpt' or 'rtept'
 * @param {number}  sequenceIndex  - 0-based position within this element's collection
 * @returns {ReferencePoint}
 */
function parseReferencePointElement(pointElement, pointType, sequenceIndex) {
  const rawLat = pointElement.getAttribute('lat');
  const rawLon = pointElement.getAttribute('lon');
  const lat    = parseFloat(rawLat);
  const lon    = parseFloat(rawLon);

  const coordsValid = (
    !isNaN(lat) && !isNaN(lon) &&
    isFinite(lat) && isFinite(lon) &&
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180
  );

  const eleElement = pointElement.querySelector('ele');
  let eleAbsent = true;
  let elevation = null;
  if (eleElement) {
    eleAbsent = false;
    const parsedEle = parseFloat(eleElement.textContent);
    elevation = (!isNaN(parsedEle) && isFinite(parsedEle)) ? parsedEle : null;
  }

  const timeElement = pointElement.querySelector('time');
  let timeAbsent = true;
  let timeRaw    = null;
  let timeMs     = null;
  if (timeElement) {
    timeAbsent = false;
    const t = timeElement.textContent.trim();
    timeRaw = t === '' ? null : t;
    if (timeRaw !== null) {
      const parsedMs = Date.parse(timeRaw);
      timeMs = isNaN(parsedMs) ? null : parsedMs;
    }
  }

  // Name / desc — present on both wpt and rtept
  const nameEl = pointElement.querySelector('name');
  const descEl = pointElement.querySelector('desc');
  const name   = nameEl ? (nameEl.textContent.trim() || null) : null;
  const desc   = descEl ? (descEl.textContent.trim() || null) : null;

  // sym / type — primarily wpt fields, harmless to read from rtept
  const symEl        = pointElement.querySelector('sym');
  const typeFieldEl  = pointElement.querySelector('type');
  const sym          = symEl       ? (symEl.textContent.trim()       || null) : null;
  const typeField    = typeFieldEl ? (typeFieldEl.textContent.trim() || null) : null;

  return {
    sequenceIndex,
    pointType,
    coordsValid,
    lat:       coordsValid ? lat : null,
    lon:       coordsValid ? lon : null,
    rawLat,
    rawLon,
    ele:       elevation,
    eleAbsent,
    name,
    desc,
    sym,
    type:      typeField,
    timeRaw,
    timeAbsent,
    timeMs
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parses a GPX XML string.
 *
 * @param {string} gpxString - Full GPX XML text
 * @returns {{
 *   points: Point[],
 *   audit: {
 *     ingestion: {
 *       counts:   IngestionCounts,
 *       context:  IngestionContext,
 *       rejections: { events: RejectionEvent[] },
 *       segmentSummaries: SegmentSummary[]
 *     },
 *     exportFaults: ExportFault[],
 *     waypoints: ReferencePoint[],
 *     routes:    Route[]
 *   }
 * }}
 * @throws {Error} If XML is malformed (parsererror from DOMParser)
 */
function parseGPX(gpxString) {
  const parser = new DOMParser();
  const xmlDoc  = parser.parseFromString(gpxString, 'text/xml');

  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error('GPX parsing error: ' + parseError.textContent);
  }

  // ── Step 1: Export fault detection (XML/segment level, before gpxIndex assignment)
  // detectExportFaults() also returns segmentSummaries (one per <trkseg>).
  const exportFaultResult = (typeof detectExportFaults === 'function')
    ? detectExportFaults(xmlDoc)
    : { faults: [], segmentSummaries: [] };

  // ── Step 2: Parse <wpt> elements as reference collection (not into points[])
  const waypointElements = xmlDoc.querySelectorAll('wpt');
  const waypointCollection = [];
  waypointElements.forEach((wpt, i) => {
    waypointCollection.push(parseReferencePointElement(wpt, 'wpt', i));
  });

  // ── Step 3: Parse <rte> elements as reference collection (not into points[])
  const routeElements = xmlDoc.querySelectorAll('rte');
  const routeCollection = [];
  routeElements.forEach((rte, routeIdx) => {
    const routeNameEl = rte.querySelector('name');
    const routeDescEl = rte.querySelector('desc');
    const routeName   = routeNameEl ? (routeNameEl.textContent.trim() || null) : null;
    const routeDesc   = routeDescEl ? (routeDescEl.textContent.trim() || null) : null;

    const rtepts = rte.querySelectorAll('rtept');
    const routePoints = [];
    rtepts.forEach((rtept, ptIdx) => {
      routePoints.push(parseReferencePointElement(rtept, 'rtept', ptIdx));
    });

    routeCollection.push({
      routeIndex: routeIdx,
      name:       routeName,
      desc:       routeDesc,
      points:     routePoints
    });
  });

  // ── Step 4: Parse <trkpt> elements per <trkseg> to assign trkSegIndex + gpxIndex
  const points = [];
  let gpxIndex            = 0;   // trkpt-stream sequential (0-based); trkpt-only
  let trkSegIndexCounter  = 0;   // globally 0-based across all tracks
  let totalTrkptFound     = 0;
  let trkptDiscarded      = 0;
  const rejectionEvents   = [];
  let hasAnyTimestamps    = false;

  const tracks = xmlDoc.querySelectorAll('trk');
  tracks.forEach(trk => {
    const segments = trk.querySelectorAll('trkseg');
    segments.forEach(seg => {
      const trkpts = seg.querySelectorAll('trkpt');
      totalTrkptFound += trkpts.length;

      trkpts.forEach(trkpt => {
        const result = parseTrkptElement(trkpt, gpxIndex, trkSegIndexCounter);
        gpxIndex++;

        if (result.valid) {
          points.push(result.point);
          if (!result.point.timeAbsent) hasAnyTimestamps = true;
        } else {
          trkptDiscarded++;
          rejectionEvents.push({
            gpxIndex:    result.rawData.gpxIndex,
            trkSegIndex: result.rawData.trkSegIndex,
            pointType:   result.rawData.pointType,
            rawLat:      result.rawData.lat,
            rawLon:      result.rawData.lon,
            rawEle:      result.rawData.ele,
            rawTime:     result.rawData.time,
            reason:      result.rejectionReason
          });
        }
      });

      trkSegIndexCounter++;
    });
  });

  const trkSegmentCount = trkSegIndexCounter; // total <trkseg> elements across all tracks

  // ── Step 5: Build segmentBoundaries[] from accepted points
  // One entry per trkSegIndex that has at least one accepted point.
  // ADR-correction-0013: raw boundaries; correction layer classifies them.
  // Shape: { trkSegIndex, firstGpxIndex, lastGpxIndex, firstTimeMs, lastTimeMs }
  const segBoundaryMap = new Map();
  for (var i = 0; i < points.length; i++) {
    var pt = points[i];
    var seg = pt.trkSegIndex;
    if (!segBoundaryMap.has(seg)) {
      segBoundaryMap.set(seg, {
        trkSegIndex:   seg,
        firstGpxIndex: pt.gpxIndex,
        lastGpxIndex:  pt.gpxIndex,
        firstTimeMs:   pt.timeMs,
        lastTimeMs:    pt.timeMs,
        minTimeMs:     pt.timeMs,
        maxTimeMs:     pt.timeMs
      });
    } else {
      var entry = segBoundaryMap.get(seg);
      entry.lastGpxIndex = pt.gpxIndex;
      entry.lastTimeMs   = pt.timeMs;
      if (pt.timeMs !== null && pt.timeMs !== undefined) {
        if (entry.minTimeMs === null || entry.minTimeMs === undefined || pt.timeMs < entry.minTimeMs) entry.minTimeMs = pt.timeMs;
        if (entry.maxTimeMs === null || entry.maxTimeMs === undefined || pt.timeMs > entry.maxTimeMs) entry.maxTimeMs = pt.timeMs;
      }
    }
  }
  // Emit in trkSegIndex order
  const segmentBoundaries = Array.from(segBoundaryMap.values()).sort(function(a, b) {
    return a.trkSegIndex - b.trkSegIndex;
  });

  return {
    points,
    audit: {
      ingestion: {
        counts: {
          totalTrkptCount:    totalTrkptFound,
          validTrkptCount:    points.length,
          rejectedTrkptCount: trkptDiscarded,
          trkSegmentCount,
          waypointCount:      waypointCollection.length,
          routeCount:         routeCollection.length
        },
        context: {
          hasAnyTimestampValues: hasAnyTimestamps,
          hasWaypoints:          waypointCollection.length > 0,
          hasRoutes:             routeCollection.length > 0,
          hasMultipleSegments:   trkSegmentCount > 1
        },
        rejections: {
          events: rejectionEvents
        },
        segmentSummaries:  exportFaultResult.segmentSummaries,
        segmentBoundaries: segmentBoundaries
      },
      exportFaults: exportFaultResult.faults,
      waypoints:    waypointCollection,
      routes:       routeCollection
    }
  };
}

/**
 * Helper: safely get trimmed text content from a child element.
 * @param {Element} parent
 * @param {string}  selector
 * @returns {string|null}
 */
function getTextContent(parent, selector) {
  const element = parent.querySelector(selector);
  return element ? element.textContent.trim() : null;
}

/**
 * Parses a GPX File object (from a browser file input).
 * @param {File} file
 * @returns {Promise<Object>} Same shape as parseGPX()
 */
async function parseGPXFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        resolve(parseGPX(e.target.result));
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read GPX file'));
    };

    reader.readAsText(file);
  });
}
