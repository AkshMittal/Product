/**
 * Motion Audit Module
 * Adjacent-pair label flags only (no kinematic aggregates, no anchored chaining).
 * Exposes: auditMotion(points, params?)
 */

/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
function haversineDistanceMotion(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Instant for motion pair math: finite ingestion `timeMs` only (no Date.parse; use audit.temporal for missing vs unparsable).
 * @param {{timeMs?:number|null}} point
 * @returns {number} ms since epoch, or NaN if no finite timeMs
 */
function endpointTimeMsForMotion(point) {
  if (typeof point.timeMs === 'number' && isFinite(point.timeMs)) {
    return point.timeMs;
  }
  return NaN;
}

/**
 * Endpoint elevation is valid for motion pair eligibility when finite and in [floor, ceiling].
 * undefined treated like null (invalid).
 * @param {unknown} ele
 * @param {number} floorM
 * @param {number} ceilingM
 * @returns {boolean}
 */
function endpointEleValidMotion(ele, floorM, ceilingM) {
  if (ele === undefined || ele === null) {
    return false;
  }
  if (typeof ele !== 'number' || isNaN(ele)) {
    return false;
  }
  return ele >= floorM && ele <= ceilingM;
}

/**
 * @param {Array<{lat:number, lon:number, timeMs:number|null, ele?:number|null, gpxIndex:number}>} points
 * @param {{validFloorM?:number, validCeilingM?:number}|undefined} params
 * @returns {Object}
 */
function auditMotion(points, params) {
  var validFloorM = -500;
  var validCeilingM = 9500;
  if (params && typeof params === 'object') {
    if (typeof params.validFloorM === 'number' && isFinite(params.validFloorM)) {
      validFloorM = params.validFloorM;
    }
    if (typeof params.validCeilingM === 'number' && isFinite(params.validCeilingM)) {
      validCeilingM = params.validCeilingM;
    }
  }

  var tagCounts = {
    backwardTime: 0,
    zeroTimeDelta: 0,
    timeUnresolvable: 0,
    nonFiniteDistance: 0,
    eleUnresolvable: 0
  };
  var tagIndex = {
    backwardTime: [],
    zeroTimeDelta: [],
    timeUnresolvable: [],
    nonFiniteDistance: [],
    eleUnresolvable: []
  };
  var pairAnnotations = [];

  var n = points.length;
  var consecutivePairCount = n > 1 ? n - 1 : 0;

  if (n <= 1) {
    return {
      audit: {
        motion: {
          summary: {
            consecutivePairCount: consecutivePairCount,
            parameters: {
              validFloorM: validFloorM,
              validCeilingM: validCeilingM
            }
          },
          tagCounts: tagCounts,
          tagIndex: tagIndex,
          pairAnnotations: pairAnnotations
        }
      }
    };
  }

  for (var i = 1; i < n; i++) {
    var prev = points[i - 1];
    var curr = points[i];
    var pairRef = { fromGpxIndex: prev.gpxIndex, toGpxIndex: curr.gpxIndex };

    var prevTsMs = endpointTimeMsForMotion(prev);
    var currTsMs = endpointTimeMsForMotion(curr);
    var bothTimestampsFinite = isFinite(prevTsMs) && isFinite(currTsMs);

    var ddMeters = haversineDistanceMotion(prev.lat, prev.lon, curr.lat, curr.lon);

    var prevEleOk = endpointEleValidMotion(prev.ele, validFloorM, validCeilingM);
    var currEleOk = endpointEleValidMotion(curr.ele, validFloorM, validCeilingM);
    var elePairOk = prevEleOk && currEleOk;

    var ann = {
      fromGpxIndex: prev.gpxIndex,
      toGpxIndex: curr.gpxIndex
    };
    var hasAnyTag = false;

    if (!bothTimestampsFinite) {
      ann.timeUnresolvable = true;
      hasAnyTag = true;
      tagCounts.timeUnresolvable++;
      tagIndex.timeUnresolvable.push(pairRef);
    }

    if (bothTimestampsFinite) {
      var dtSec = (currTsMs - prevTsMs) / 1000;
      if (dtSec < 0) {
        ann.backwardTime = true;
        ann.dtSec = dtSec;
        hasAnyTag = true;
        tagCounts.backwardTime++;
        tagIndex.backwardTime.push(pairRef);
      } else if (dtSec === 0) {
        ann.zeroTimeDelta = true;
        ann.dtSec = 0;
        hasAnyTag = true;
        tagCounts.zeroTimeDelta++;
        tagIndex.zeroTimeDelta.push(pairRef);
      }
    }

    if (!isFinite(ddMeters)) {
      ann.nonFiniteDistance = true;
      hasAnyTag = true;
      tagCounts.nonFiniteDistance++;
      tagIndex.nonFiniteDistance.push(pairRef);
    }

    if (!elePairOk) {
      ann.eleUnresolvable = true;
      hasAnyTag = true;
      tagCounts.eleUnresolvable++;
      tagIndex.eleUnresolvable.push(pairRef);
    }

    if (ann.timeUnresolvable && isFinite(ddMeters) && !ann.nonFiniteDistance) {
      ann.ddMeters = ddMeters;
    }

    if (hasAnyTag) {
      pairAnnotations.push(ann);
    }
  }

  return {
    audit: {
      motion: {
        summary: {
          consecutivePairCount: consecutivePairCount,
          parameters: {
            validFloorM: validFloorM,
            validCeilingM: validCeilingM
          }
        },
        tagCounts: tagCounts,
        tagIndex: tagIndex,
        pairAnnotations: pairAnnotations
      }
    }
  };
}
