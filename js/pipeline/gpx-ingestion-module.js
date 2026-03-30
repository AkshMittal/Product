/**
 * GPX Ingestion Module
 * Parses raw GPX files using browser's DOMParser
 * Returns structured point data for all GPX point types (wpt, rtept, trkpt)
 */

/**
 * Helper function to parse a single point element (wpt, rtept, or trkpt)
 * All three types share the same structure.
 * gpxIndex is the absolute position in the original GPX stream (assigned before validation).
 * @param {Element} pointElement - The point XML element
 * @param {number} gpxIndex - Absolute index of this point in the GPX stream (consumed for this point whether valid or not)
 * @param {string} pointType - Type of point: 'wpt', 'rtept', or 'trkpt'
 * @returns {Object} Object with {valid: boolean, point: Object|null, rejectionReason: string|null, rawData: Object}
 */
function parsePointElement(pointElement, gpxIndex, pointType) {
  // Extract raw data for logging rejected points
  const rawLat = pointElement.getAttribute('lat');
  const rawLon = pointElement.getAttribute('lon');
  const rawEle = pointElement.querySelector('ele') ? pointElement.querySelector('ele').textContent : null;
  const rawTime = pointElement.querySelector('time') ? pointElement.querySelector('time').textContent.trim() : null;
  
  const rawData = {
    pointType: pointType,
    gpxIndex: gpxIndex,
    lat: rawLat,
    lon: rawLon,
    ele: rawEle,
    time: rawTime
  };
  
  // lat and lon are required attributes on all point types
  const lat = parseFloat(rawLat);
  const lon = parseFloat(rawLon);
  
  // Skip points with invalid coordinates (not parseable as numbers)
  if (isNaN(lat) || isNaN(lon)) {
    return {
      valid: false,
      point: null,
      rejectionReason: `Invalid coordinates: lat="${rawLat}", lon="${rawLon}" (not parseable as numbers)`,
      rawData: rawData
    };
  }
  
  // Validate coordinate ranges: lat must be between -90 and 90, lon between -180 and 180
  // Also check that coordinates are finite numbers
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return {
      valid: false,
      point: null,
      rejectionReason: `Coordinates out of valid range or non-finite: lat=${lat} (must be -90 to 90), lon=${lon} (must be -180 to 180)`,
      rawData: rawData
    };
  }
  
  // <ele> is optional - keep point even if elevation is missing or invalid, store as null
  const eleElement = pointElement.querySelector('ele');
  const ele = eleElement ? parseFloat(eleElement.textContent) : null;
  // Store as null if parsing failed or element doesn't exist
  const elevation = (ele !== null && !isNaN(ele)) ? ele : null;
  
  // <time> is optional child element, preserve as string if present
  const timeElement = pointElement.querySelector('time');
  let timeRaw = null;
  if (timeElement) {
    const t = timeElement.textContent.trim();
    timeRaw = t === "" ? null : t;
  }

  
  // <extensions> must be preserved as DOM node for future pipeline stages
  // Do not parse or inspect contents - preserve entire node structure
  const extensionsElement = pointElement.querySelector('extensions');
  const extensions = extensionsElement ? extensionsElement : null;
  
  return {
    valid: true,
    point: {
      gpxIndex: gpxIndex,
      pointType: pointType, // 'wpt', 'rtept', or 'trkpt'
      lat: lat,
      lon: lon,
      ele: elevation,
      timeRaw: timeRaw,
      extensions: extensions  // Preserved DOM node, not parsed
    },
    rejectionReason: null,
    rawData: null
  };
}

/**
 * Parses a GPX XML string and extracts all point types (wpt, rtept, trkpt)
 * Pure ingestion: no cleaning, smoothing, or data transformation
 * @param {string} gpxString - The GPX file content as a string
 * @returns {Object} Object containing points array and statistics
 */
function parseGPX(gpxString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(gpxString, 'text/xml');
  
  // Check for XML parsing errors (DOMParser may return parsererror element)
  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error('GPX parsing error: ' + parseError.textContent);
  }
  
  const points = [];
  let gpxIndex = 0;
  let totalPointsFound = 0;
  let pointsDiscarded = 0;
  let firstRejectionLogged = false;
  const rejectedCoordinates = [];
  const pointTypeCounts = { wpt: 0, rtept: 0, trkpt: 0 };
  let hasAnyTimestamps = false;
  
  // Helper: increment gpxIndex for every GPX point encountered (accepted or rejected)
  const processPoint = (pointElement, pointType) => {
    const result = parsePointElement(pointElement, gpxIndex++, pointType);
    if (result.valid) {
      points.push(result.point);
      if (result.point.timeRaw !== null) {
        hasAnyTimestamps = true;
      }
    } else {
      pointsDiscarded++;
      // Log the first rejected point
      if (!firstRejectionLogged) {
        // console.log('First rejected point:', result.rawData);
        // console.log('Rejection reason:', result.rejectionReason);
        firstRejectionLogged = true;
      }
      // Collect all rejected coordinates for flagged events
      rejectedCoordinates.push({
        gpxIndex: result.rawData.gpxIndex,
        pointType: result.rawData.pointType,
        rawLat: result.rawData.lat,
        rawLon: result.rawData.lon,
        rawEle: result.rawData.ele,
        rawTime: result.rawData.time,
        reason: result.rejectionReason
      });
    }
  };
  
  // Extract all <wpt> elements (waypoints) - standalone points
  const waypoints = xmlDoc.querySelectorAll('wpt');
  pointTypeCounts.wpt = waypoints.length;
  totalPointsFound += waypoints.length;
  waypoints.forEach((wpt) => {
    processPoint(wpt, 'wpt');
  });
  
  // Extract all <rtept> elements (route points) - points within routes
  const routePoints = xmlDoc.querySelectorAll('rtept');
  pointTypeCounts.rtept = routePoints.length;
  totalPointsFound += routePoints.length;
  routePoints.forEach((rtept) => {
    processPoint(rtept, 'rtept');
  });
  
  // Extract all <trkpt> elements (track points) - points within tracks
  const trackPoints = xmlDoc.querySelectorAll('trkpt');
  pointTypeCounts.trkpt = trackPoints.length;
  totalPointsFound += trackPoints.length;
  trackPoints.forEach((trkpt) => {
    processPoint(trkpt, 'trkpt');
  });
  
  const hasMultiplePointTypes =
    (pointTypeCounts.wpt > 0 ? 1 : 0) +
    (pointTypeCounts.rtept > 0 ? 1 : 0) +
    (pointTypeCounts.trkpt > 0 ? 1 : 0) > 1;
  
  // Return object with points array and statistics
  return {
    points: points,
    audit: {
      ingestion: {
        counts: {
          totalPointCount: totalPointsFound,
          validPointCount: points.length,
          rejectedPointCount: pointsDiscarded,
          pointTypeCounts: pointTypeCounts
        },
        context: {
          hasMultiplePointTypes: hasMultiplePointTypes,
          hasAnyTimestampValues: hasAnyTimestamps
        },
        rejections: {
          events: rejectedCoordinates
        }
      }
    }
  };
}

/**
 * Helper function to safely get text content from XML elements
 * @param {Element} parent - Parent XML element
 * @param {string} selector - CSS selector for the child element
 * @returns {string|null} Text content or null if not found
 */
function getTextContent(parent, selector) {
  const element = parent.querySelector(selector);
  return element ? element.textContent.trim() : null;
}

/**
 * Parses GPX file from File object (from file input)
 * @param {File} file - File object from input element
 * @returns {Promise<Object>} Object containing points array and statistics
 */
async function parseGPXFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const result = parseGPX(e.target.result);
        resolve(result);
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
