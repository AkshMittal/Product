/**
 * Motion Audit Module
 * Computes motion metrics independently from sampling audit.
 * Exposes: auditMotion(points)
 */

/**
 * Calculates haversine distance between two points in meters.
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
 * Audits motion metrics from consecutive points.
 * @param {Array<{lat:number, lon:number, timeRaw:string|null}>} points
 * @returns {Object}
 */
function auditMotion(points) {
  // Joint (time + distance) counters using valid-timestamp anchor chaining.
  var consecutivePairCount = 0;
  var forwardValidCount = 0;
  var backwardCount = 0;
  var zeroTimeDeltaCount = 0;

  // Explicit rejection counters for anchored pair auditing.
  var missingTimestampCount = 0;
  var unparsableTimestampCount = 0;
  var nonFiniteDistanceCount = 0;
  var missingTimestampEvents = [];
  var unparsableTimestampEvents = [];
  var nonFiniteDistanceEvents = [];
  var backwardEvents = [];
  var zeroTimeDeltaEvents = [];

  var validMotionTimeSeconds = 0;
  var invalidTimeSeconds = 0;
  var totalValidDistanceMeters = 0;

  var speedSamples = [];

  var prevPoint = null;
  var prevTimestampMs = null;

  for (var i = 0; i < points.length; i++) {
    var curr = points[i];

    var currentTimestampMs = null;
    var currentTimestampState = 'valid';

    if (curr.timeRaw === null) {
      currentTimestampState = 'missing';
    } else {
      currentTimestampMs = Date.parse(curr.timeRaw);
      if (isNaN(currentTimestampMs)) {
        currentTimestampState = 'unparsable';
        currentTimestampMs = null;
      }
    }

    if (prevPoint !== null) {
      consecutivePairCount++;
    }

    if (currentTimestampMs !== null && prevTimestampMs !== null && prevPoint !== null) {
      var deltaTSec = (currentTimestampMs - prevTimestampMs) / 1000;
      var distanceMeters = haversineDistanceMotion(prevPoint.lat, prevPoint.lon, curr.lat, curr.lon);

      // Reject distance only if non-finite.
      if (!isFinite(distanceMeters)) {
        nonFiniteDistanceCount++;
        nonFiniteDistanceEvents.push({
          fromIndex: prevPoint.gpxIndex,
          toIndex: curr.gpxIndex,
          dtSec: deltaTSec,
          ddMeters: distanceMeters
        });
      } else if (deltaTSec > 0) {
        forwardValidCount++;
        validMotionTimeSeconds += deltaTSec;
        totalValidDistanceMeters += distanceMeters;
        speedSamples.push(distanceMeters / deltaTSec);
      } else if (deltaTSec === 0) {
        zeroTimeDeltaCount++;
        invalidTimeSeconds += 0;
        zeroTimeDeltaEvents.push({
          fromIndex: prevPoint.gpxIndex,
          toIndex: curr.gpxIndex,
          dtSec: deltaTSec,
          ddMeters: distanceMeters
        });
      } else {
        backwardCount++;
        invalidTimeSeconds += Math.abs(deltaTSec);
        backwardEvents.push({
          fromIndex: prevPoint.gpxIndex,
          toIndex: curr.gpxIndex,
          dtSec: deltaTSec,
          ddMeters: distanceMeters
        });
      }
    } else if (prevPoint !== null) {
      var distanceMetersNoTime = haversineDistanceMotion(prevPoint.lat, prevPoint.lon, curr.lat, curr.lon);
      if (currentTimestampState === 'missing') {
        missingTimestampCount++;
        missingTimestampEvents.push({
          fromIndex: prevPoint.gpxIndex,
          toIndex: curr.gpxIndex,
          rawTime: curr.timeRaw,
          ddMeters: distanceMetersNoTime
        });
      } else if (currentTimestampState === 'unparsable') {
        unparsableTimestampCount++;
        unparsableTimestampEvents.push({
          fromIndex: prevPoint.gpxIndex,
          toIndex: curr.gpxIndex,
          rawTime: curr.timeRaw,
          ddMeters: distanceMetersNoTime
        });
      }
    }

    // Anchor update: only valid timestamps advance anchor pair reference.
    if (currentTimestampMs !== null) {
      prevPoint = { lat: curr.lat, lon: curr.lon, gpxIndex: curr.gpxIndex };
      prevTimestampMs = currentTimestampMs;
    }
  }

  var invalidTimeRatioDenominator = validMotionTimeSeconds + invalidTimeSeconds;
  var invalidTimeRatio = invalidTimeRatioDenominator > 0
    ? invalidTimeSeconds / invalidTimeRatioDenominator
    : 0;

  var meanSpeedMs = null;
  var medianSpeedMs = null;
  var maxSpeedMs = null;

  if (speedSamples.length > 0) {
    var sortedSpeeds = speedSamples.slice().sort(function (a, b) { return a - b; });
    meanSpeedMs = validMotionTimeSeconds > 0 ? totalValidDistanceMeters / validMotionTimeSeconds : null;
    maxSpeedMs = sortedSpeeds[sortedSpeeds.length - 1];

    var mid = Math.floor(sortedSpeeds.length / 2);
    if (sortedSpeeds.length % 2 === 0) {
      medianSpeedMs = (sortedSpeeds[mid - 1] + sortedSpeeds[mid]) / 2;
    } else {
      medianSpeedMs = sortedSpeeds[mid];
    }
  }

  return {
    audit: {
      motion: {
        evaluatedPairs: {
          consecutivePairCount: consecutivePairCount,
          forwardValidPairCount: forwardValidCount
        },
        rejections: {
          missingTimestampPairCount: missingTimestampCount,
          unparsableTimestampPairCount: unparsableTimestampCount,
          nonFiniteDistancePairCount: nonFiniteDistanceCount,
          backwardTimePairCount: backwardCount,
          zeroTimeDeltaPairCount: zeroTimeDeltaCount,
          events: {
            missingTimestamp: missingTimestampEvents,
            unparsableTimestamp: unparsableTimestampEvents,
            nonFiniteDistance: nonFiniteDistanceEvents,
            backward: backwardEvents,
            zeroTimeDelta: zeroTimeDeltaEvents
          }
        },
        time: {
          validMotionTimeSeconds: validMotionTimeSeconds,
          invalidTimeSeconds: invalidTimeSeconds,
          invalidTimeShareOfEvaluatedTime: invalidTimeRatio
        },
        distance: {
          totalForwardValidDistanceMeters: totalValidDistanceMeters
        },
        speed: {
          meanSpeedMps: meanSpeedMs,
          medianSpeedMps: medianSpeedMs,
          maxSpeedMps: maxSpeedMs
        }
      }
    }
  };
}
