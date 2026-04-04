/**
 * Sampling Audit Module
 * Observational audit pass for time and distance sampling behavior in GPX points.
 * Does NOT mutate, reorder, or normalize any data.
 * Collects positive time deltas only for physically adjacent point pairs where both
 * endpoints have finite ingestion timeMs (no bridging across missing/unparsable gaps).
 * Collects distance deltas between every consecutive coordinate pair.
 */

/**
 * Calculates haversine distance between two points in meters
 * @param {number} lat1 - Latitude of first point in degrees
 * @param {number} lon1 - Longitude of first point in degrees
 * @param {number} lat2 - Latitude of second point in degrees
 * @param {number} lon2 - Longitude of second point in degrees
 * @returns {number} Distance in meters
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Audits time and distance sampling behavior.
 * Time deltas: positive-only, physically adjacent pairs only (both endpoints finite timeMs).
 * Distance deltas: every consecutive coordinate pair, no timestamp dependency.
 * @param {Array} points - Array of point objects with gpxIndex, timeMs, lat, lon (finite timeMs from ingestion only)
 * @param {string} [gpxFilename] - Optional GPX filename (without extension)
 * @returns {Object} Sampling audit payload
 */
function auditSampling(points, gpxFilename) {
  const timeDeltasMs = []; // Array<{ fromIndex, toIndex, dtSec }>
  const distanceDeltas = []; // Array<{ fromIndex, toIndex, ddMeters }> — every consecutive pair
  const timeConditionedDistanceDeltas = []; // Array<{ fromIndex, toIndex, ddMeters }> — subset with positive dt
  let previousPoint = null;
  let hasValidTimestamps = false;
  let hasTimeProgression = false;

  // Time delta counters
  let timestampedPointsCount = 0;
  let consecutiveTimestampPairsCount = 0;
  let positiveTimeDeltasCollected = 0;
  let rejectedTimestampPairsDeltaLeqZero = 0;
  const nonPositiveTimeDeltaEvents = [];

  // Distance delta counters
  let consecutivePairCount = 0;
  let rejectedDistanceCount = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];

    const hasValidTimestamp =
      typeof point.timeMs === 'number' && isFinite(point.timeMs);
    const currentTimestampMs = hasValidTimestamp ? point.timeMs : null;

    // Distance delta: computed for every consecutive coordinate pair
    let distanceFromPrev = null;
    let distanceFromPrevValid = false;
    if (previousPoint !== null) {
      consecutivePairCount++;
      distanceFromPrev = haversineDistance(
        previousPoint.lat,
        previousPoint.lon,
        point.lat,
        point.lon
      );
      distanceFromPrevValid = isFinite(distanceFromPrev) && distanceFromPrev >= 0;
      if (distanceFromPrevValid) {
        distanceDeltas.push({
          fromIndex: previousPoint.gpxIndex,
          toIndex: point.gpxIndex,
          ddMeters: distanceFromPrev
        });
      } else {
        rejectedDistanceCount++;
      }
    }

    // Time delta: physically adjacent pair (i-1, i) only when both have finite timeMs — no gap bridging
    if (i >= 1) {
      const prev = points[i - 1];
      const prevTimeOk =
        typeof prev.timeMs === 'number' && isFinite(prev.timeMs);
      if (prevTimeOk && hasValidTimestamp) {
        consecutiveTimestampPairsCount++;
        const delta = currentTimestampMs - prev.timeMs;

        if (delta > 0) {
          positiveTimeDeltasCollected++;
          timeDeltasMs.push({
            fromIndex: prev.gpxIndex,
            toIndex: point.gpxIndex,
            dtSec: delta / 1000
          });
          hasTimeProgression = true;

          if (distanceFromPrevValid) {
            timeConditionedDistanceDeltas.push({
              fromIndex: previousPoint.gpxIndex,
              toIndex: point.gpxIndex,
              ddMeters: distanceFromPrev
            });
          }
        } else {
          rejectedTimestampPairsDeltaLeqZero++;
          nonPositiveTimeDeltaEvents.push({
            fromIndex: prev.gpxIndex,
            toIndex: point.gpxIndex,
            delta: delta
          });
        }
      }
    }

    if (hasValidTimestamp) {
      hasValidTimestamps = true;
      timestampedPointsCount++;
    }

    previousPoint = { lat: point.lat, lon: point.lon, gpxIndex: point.gpxIndex };
  }

  // Time delta statistics
  const dtTotalCount = timeDeltasMs.length;
  let minDeltaMs = null;
  let maxDeltaMs = null;
  let medianDeltaMs = null;

  if (dtTotalCount > 0) {
    const sortedDeltas = [...timeDeltasMs].sort((a, b) => a.dtSec - b.dtSec);
    minDeltaMs = sortedDeltas[0].dtSec * 1000;
    maxDeltaMs = sortedDeltas[sortedDeltas.length - 1].dtSec * 1000;
    const mid = Math.floor(sortedDeltas.length / 2);
    if (sortedDeltas.length % 2 === 0) {
      medianDeltaMs = (sortedDeltas[mid - 1].dtSec + sortedDeltas[mid].dtSec) / 2 * 1000;
    } else {
      medianDeltaMs = sortedDeltas[mid].dtSec * 1000;
    }
  }

  let timeSamplingClusters = null;
  let timeNormalizationMeta = null;

  // ── Time-delta sampling regime detection via 2% relative clustering ──
  var TIME_CLUSTER_ALPHA = 0.02;

  if (timeDeltasMs.length === 0) {
    timeSamplingClusters = null;
    timeNormalizationMeta = null;
  } else {
    // Original-order dtSec values
    var dtValues = [];
    for (var ci = 0; ci < timeDeltasMs.length; ci++) {
      dtValues.push(timeDeltasMs[ci].dtSec);
    }
    // Sorted copy for sorted-regime clustering
    var dtSorted = dtValues.slice();
    dtSorted.sort(function (a, b) { return a - b; });

    // Helper: compute median of a sorted array
    function sortedMedian(arr) {
      var len = arr.length;
      if (len === 0) return 0;
      var mid = Math.floor(len / 2);
      if (len % 2 === 0) return (arr[mid - 1] + arr[mid]) / 2;
      return arr[mid];
    }

    // Sorted clustering pass
    var dtClusters = [];
    var dtCurrentValues = [dtSorted[0]];
    var dtCurrentInsertionRelDevs = [0];
    var dtCurrentInsertionAbsDevs = [0];
    var dtCurrentCenter = dtSorted[0];

    for (var di = 1; di < dtSorted.length; di++) {
      var val = dtSorted[di];
      var dtInsertionCenter = dtCurrentCenter;
      var dtInsertionAbsDev = Math.abs(val - dtInsertionCenter);
      var dtInsertionRelDev = dtInsertionCenter > 0 ? dtInsertionAbsDev / dtInsertionCenter : 0;

      if (dtInsertionCenter > 0 && dtInsertionRelDev < TIME_CLUSTER_ALPHA) {
        dtCurrentValues.push(val);
        dtCurrentInsertionRelDevs.push(dtInsertionRelDev);
        dtCurrentInsertionAbsDevs.push(dtInsertionAbsDev);
        dtCurrentCenter = sortedMedian(dtCurrentValues);
      } else {
        dtClusters.push({
          values: dtCurrentValues,
          insertionRelativeDeviations: dtCurrentInsertionRelDevs,
          insertionAbsoluteDeviationsSec: dtCurrentInsertionAbsDevs
        });
        dtCurrentValues = [val];
        dtCurrentInsertionRelDevs = [0];
        dtCurrentInsertionAbsDevs = [0];
        dtCurrentCenter = val;
      }
    }
    dtClusters.push({
      values: dtCurrentValues,
      insertionRelativeDeviations: dtCurrentInsertionRelDevs,
      insertionAbsoluteDeviationsSec: dtCurrentInsertionAbsDevs
    });

    // Build cluster descriptors
    var dtClusterDescriptors = [];
    for (var ki = 0; ki < dtClusters.length; ki++) {
      var vals = dtClusters[ki].values;
      var count = vals.length;
      var center = sortedMedian(vals);
      var minSec = vals[0];
      var maxSec = vals[vals.length - 1];

      var dtInsRelDevs = dtClusters[ki].insertionRelativeDeviations;
      var dtInsAbsDevs = dtClusters[ki].insertionAbsoluteDeviationsSec;
      var dtSumInsRel = 0, dtMaxInsRel = 0, dtSumInsAbs = 0, dtMaxInsAbs = 0;
      for (var vi = 0; vi < dtInsRelDevs.length; vi++) {
        dtSumInsRel += dtInsRelDevs[vi];
        if (dtInsRelDevs[vi] > dtMaxInsRel) dtMaxInsRel = dtInsRelDevs[vi];
        dtSumInsAbs += dtInsAbsDevs[vi];
        if (dtInsAbsDevs[vi] > dtMaxInsAbs) dtMaxInsAbs = dtInsAbsDevs[vi];
      }

      var dtSumAbsFinal = 0, dtMaxAbsFinal = 0, dtSumRelFinal = 0, dtMaxRelFinal = 0;
      for (var vf = 0; vf < vals.length; vf++) {
        var dtAbsFinal = Math.abs(vals[vf] - center);
        var dtRelFinal = center > 0 ? dtAbsFinal / center : 0;
        dtSumAbsFinal += dtAbsFinal;
        if (dtAbsFinal > dtMaxAbsFinal) dtMaxAbsFinal = dtAbsFinal;
        dtSumRelFinal += dtRelFinal;
        if (dtRelFinal > dtMaxRelFinal) dtMaxRelFinal = dtRelFinal;
      }

      dtClusterDescriptors.push({
        centerSec: center,
        count: count,
        clusterShareOfTotalDeltas: count / dtTotalCount,
        minSec: minSec,
        maxSec: maxSec,
        spreadSec: maxSec - minSec,
        meanInsertionRelativeDeviation: dtSumInsRel / count,
        maxInsertionRelativeDeviation: dtMaxInsRel,
        meanInsertionAbsoluteDeviationSec: dtSumInsAbs / count,
        maxInsertionAbsoluteDeviationSec: dtMaxInsAbs,
        finalMeanAbsoluteDeviationSec: dtSumAbsFinal / count,
        finalMaxAbsoluteDeviationSec: dtMaxAbsFinal,
        finalMeanRelativeDeviation: dtSumRelFinal / count,
        finalMaxRelativeDeviation: dtMaxRelFinal,
        finalSpreadOverCenterRatio: center > 0 ? (maxSec - minSec) / center : 0
      });
    }

    dtClusterDescriptors.sort(function (a, b) { return b.count - a.count; });
    var dtKSorted = dtClusterDescriptors.length;

    // Sequential clustering pass (original collection order)
    var dtSeqClusters = [];
    if (dtValues.length > 0) {
      var dtSeqCurrent = { values: [dtValues[0]] };
      for (var si = 1; si < dtValues.length; si++) {
        var delta = dtValues[si];
        var dtSeqCenter = sortedMedian(dtSeqCurrent.values.slice().sort(function (a, b) { return a - b; }));
        var dtSeqRelDev = dtSeqCenter > 0 ? Math.abs(delta - dtSeqCenter) / dtSeqCenter : 0;
        if (dtSeqRelDev < TIME_CLUSTER_ALPHA) {
          dtSeqCurrent.values.push(delta);
        } else {
          dtSeqClusters.push(dtSeqCurrent);
          dtSeqCurrent = { values: [delta] };
        }
      }
      dtSeqClusters.push(dtSeqCurrent);
    }
    var dtKSeq = dtSeqClusters.length;

    var dtSortedOverTotal = dtTotalCount > 0 ? dtKSorted / dtTotalCount : 0;
    var dtSeqOverTotal = dtTotalCount > 0 ? dtKSeq / dtTotalCount : 0;
    var dtSeqOverSorted = dtKSorted > 1 ? dtKSeq / dtKSorted : 1;

    // Normalization: per-delta final deviation from cluster center
    var dtClusterCenters = [];
    var dtBoundaryIdx = 0;
    for (var bi = 0; bi < dtClusters.length; bi++) {
      var dtClusterCenter = sortedMedian(dtClusters[bi].values);
      for (var bj = 0; bj < dtClusters[bi].values.length; bj++) {
        dtClusterCenters[dtBoundaryIdx] = dtClusterCenter;
        dtBoundaryIdx++;
      }
    }

    var dtSumFinalAbs = 0, dtMaxFinalAbs = 0, dtSumFinalRel = 0, dtMaxFinalRel = 0;
    var dtNonZeroFinal = 0, dtZeroFinal = 0;
    for (var ni = 0; ni < dtTotalCount; ni++) {
      var dtAbsDiff = Math.abs(dtSorted[ni] - dtClusterCenters[ni]);
      var dtRelDiff = dtClusterCenters[ni] > 0 ? dtAbsDiff / dtClusterCenters[ni] : 0;
      dtSumFinalAbs += dtAbsDiff;
      if (dtAbsDiff > dtMaxFinalAbs) dtMaxFinalAbs = dtAbsDiff;
      dtSumFinalRel += dtRelDiff;
      if (dtRelDiff > dtMaxFinalRel) dtMaxFinalRel = dtRelDiff;
      if (dtAbsDiff > 0) dtNonZeroFinal++; else dtZeroFinal++;
    }

    timeSamplingClusters = dtClusterDescriptors;
    timeNormalizationMeta = {
      insertionRelativeThreshold: TIME_CLUSTER_ALPHA,
      totalDeltaCount: dtTotalCount,
      sortedClusterCount: dtClusters.length,
      sequentialClusterCount: dtKSeq,
      meanFinalAbsoluteDeviationSec: dtSumFinalAbs / dtTotalCount,
      maxFinalAbsoluteDeviationSec: dtMaxFinalAbs,
      meanFinalRelativeDeviation: dtSumFinalRel / dtTotalCount,
      maxFinalRelativeDeviation: dtMaxFinalRel,
      sortedClusterCountOverTotalDeltasRatio: dtSortedOverTotal,
      sequentialClusterCountOverTotalDeltasRatio: dtSeqOverTotal,
      sequentialOverSortedClusterCountRatio: dtSeqOverSorted,
      nonZeroFinalDeviationCount: dtNonZeroFinal,
      zeroFinalDeviationCount: dtZeroFinal
    };
  }

  // ── Distance-delta sampling regime detection via 2% relative clustering ──
  // Operates on the complete population of consecutive spatial steps.
  var DISTANCE_CLUSTER_ALPHA = 0.02;

  var distanceSamplingClusters = null;
  var distanceNormalizationMeta = null;
  var distanceDeltaStatistics = null;

  var ddValues = distanceDeltas.map(function (d) { return d.ddMeters; });

  if (ddValues.length > 0) {
    var ddSorted = ddValues.slice().sort(function (a, b) { return a - b; });
    var ddTotalCount = ddValues.length;
    var ddMin = ddSorted[0];
    var ddMax = ddSorted[ddSorted.length - 1];
    var ddMidIdx = Math.floor(ddSorted.length / 2);
    var ddMedian = ddSorted.length % 2 === 0
      ? (ddSorted[ddMidIdx - 1] + ddSorted[ddMidIdx]) / 2
      : ddSorted[ddMidIdx];

    distanceDeltaStatistics = {
      deltaCount: ddTotalCount,
      minMeters: ddMin,
      maxMeters: ddMax,
      medianMeters: ddMedian
    };

    function sortedMedianDist(arr) {
      var len = arr.length;
      if (len === 0) return 0;
      var mid = Math.floor(len / 2);
      if (len % 2 === 0) return (arr[mid - 1] + arr[mid]) / 2;
      return arr[mid];
    }

    // Sorted clustering pass
    var ddClusters = [];
    var ddCurrentValues = [ddSorted[0]];
    var ddCurrentInsertionRelDevs = [0];
    var ddCurrentInsertionAbsDevs = [0];
    var ddCurrentCenter = ddSorted[0];

    for (var ddi = 1; ddi < ddSorted.length; ddi++) {
      var ddVal = ddSorted[ddi];
      var ddInsertionCenter = ddCurrentCenter;
      var ddInsertionAbsDev = Math.abs(ddVal - ddInsertionCenter);
      var ddInsertionRelDev = ddInsertionCenter > 0 ? ddInsertionAbsDev / ddInsertionCenter : 0;

      if (ddInsertionCenter > 0 && ddInsertionRelDev < DISTANCE_CLUSTER_ALPHA) {
        ddCurrentValues.push(ddVal);
        ddCurrentInsertionRelDevs.push(ddInsertionRelDev);
        ddCurrentInsertionAbsDevs.push(ddInsertionAbsDev);
        ddCurrentCenter = sortedMedianDist(ddCurrentValues);
      } else {
        ddClusters.push({
          values: ddCurrentValues,
          insertionRelativeDeviations: ddCurrentInsertionRelDevs,
          insertionAbsoluteDeviationsMeters: ddCurrentInsertionAbsDevs
        });
        ddCurrentValues = [ddVal];
        ddCurrentInsertionRelDevs = [0];
        ddCurrentInsertionAbsDevs = [0];
        ddCurrentCenter = ddVal;
      }
    }
    ddClusters.push({
      values: ddCurrentValues,
      insertionRelativeDeviations: ddCurrentInsertionRelDevs,
      insertionAbsoluteDeviationsMeters: ddCurrentInsertionAbsDevs
    });

    // Build cluster descriptors
    var ddClusterDescriptors = [];
    for (var dki = 0; dki < ddClusters.length; dki++) {
      var ddVals = ddClusters[dki].values;
      var ddCount = ddVals.length;
      var ddCenter = sortedMedianDist(ddVals);
      var ddMinC = ddVals[0];
      var ddMaxC = ddVals[ddVals.length - 1];

      var ddInsRelDevs = ddClusters[dki].insertionRelativeDeviations;
      var ddInsAbsDevs = ddClusters[dki].insertionAbsoluteDeviationsMeters;
      var ddSumInsRel = 0, ddMaxInsRel = 0, ddSumInsAbs = 0, ddMaxInsAbs = 0;
      for (var dvi = 0; dvi < ddInsRelDevs.length; dvi++) {
        ddSumInsRel += ddInsRelDevs[dvi];
        if (ddInsRelDevs[dvi] > ddMaxInsRel) ddMaxInsRel = ddInsRelDevs[dvi];
        ddSumInsAbs += ddInsAbsDevs[dvi];
        if (ddInsAbsDevs[dvi] > ddMaxInsAbs) ddMaxInsAbs = ddInsAbsDevs[dvi];
      }

      var ddSumAbsFinal = 0, ddMaxAbsFinal = 0, ddSumRelFinal = 0, ddMaxRelFinal = 0;
      for (var dvf = 0; dvf < ddVals.length; dvf++) {
        var ddAbsFinal = Math.abs(ddVals[dvf] - ddCenter);
        var ddRelFinal = ddCenter > 0 ? ddAbsFinal / ddCenter : 0;
        ddSumAbsFinal += ddAbsFinal;
        if (ddAbsFinal > ddMaxAbsFinal) ddMaxAbsFinal = ddAbsFinal;
        ddSumRelFinal += ddRelFinal;
        if (ddRelFinal > ddMaxRelFinal) ddMaxRelFinal = ddRelFinal;
      }

      ddClusterDescriptors.push({
        centerMeters: ddCenter,
        count: ddCount,
        clusterShareOfTotalDeltas: ddCount / ddTotalCount,
        minMeters: ddMinC,
        maxMeters: ddMaxC,
        spreadMeters: ddMaxC - ddMinC,
        meanInsertionRelativeDeviation: ddSumInsRel / ddCount,
        maxInsertionRelativeDeviation: ddMaxInsRel,
        meanInsertionAbsoluteDeviationMeters: ddSumInsAbs / ddCount,
        maxInsertionAbsoluteDeviationMeters: ddMaxInsAbs,
        finalMeanAbsoluteDeviationMeters: ddSumAbsFinal / ddCount,
        finalMaxAbsoluteDeviationMeters: ddMaxAbsFinal,
        finalMeanRelativeDeviation: ddSumRelFinal / ddCount,
        finalMaxRelativeDeviation: ddMaxRelFinal,
        finalSpreadOverCenterRatio: ddCenter > 0 ? (ddMaxC - ddMinC) / ddCenter : 0
      });
    }

    ddClusterDescriptors.sort(function (a, b) { return b.count - a.count; });
    var ddKSorted = ddClusterDescriptors.length;

    // Sequential clustering pass (original collection order)
    var ddSeqClusters = [];
    var ddSeqCurrent = { values: [ddValues[0]] };
    for (var dsi = 1; dsi < ddValues.length; dsi++) {
      var ddDelta = ddValues[dsi];
      var ddSeqCenter = sortedMedianDist(ddSeqCurrent.values.slice().sort(function (a, b) { return a - b; }));
      var ddSeqRelDev = ddSeqCenter > 0 ? Math.abs(ddDelta - ddSeqCenter) / ddSeqCenter : 0;
      if (ddSeqRelDev < DISTANCE_CLUSTER_ALPHA) {
        ddSeqCurrent.values.push(ddDelta);
      } else {
        ddSeqClusters.push(ddSeqCurrent);
        ddSeqCurrent = { values: [ddDelta] };
      }
    }
    ddSeqClusters.push(ddSeqCurrent);
    var ddKSeq = ddSeqClusters.length;

    var ddSortedOverTotal = ddTotalCount > 0 ? ddKSorted / ddTotalCount : 0;
    var ddSeqOverTotal = ddTotalCount > 0 ? ddKSeq / ddTotalCount : 0;
    var ddSeqOverSorted = ddKSorted > 1 ? ddKSeq / ddKSorted : 1;

    // Normalization: per-delta final deviation from cluster center
    var ddClusterCenters = [];
    var ddBoundaryIdx = 0;
    for (var dbi = 0; dbi < ddClusters.length; dbi++) {
      var ddClusterCenter = sortedMedianDist(ddClusters[dbi].values);
      for (var dbj = 0; dbj < ddClusters[dbi].values.length; dbj++) {
        ddClusterCenters[ddBoundaryIdx] = ddClusterCenter;
        ddBoundaryIdx++;
      }
    }

    var ddSumFinalAbs = 0, ddMaxFinalAbs = 0, ddSumFinalRel = 0, ddMaxFinalRel = 0;
    var ddNonZeroFinal = 0, ddZeroFinal = 0;
    for (var dni = 0; dni < ddTotalCount; dni++) {
      var ddAbsDiff = Math.abs(ddSorted[dni] - ddClusterCenters[dni]);
      var ddRelDiff = ddClusterCenters[dni] > 0 ? ddAbsDiff / ddClusterCenters[dni] : 0;
      ddSumFinalAbs += ddAbsDiff;
      if (ddAbsDiff > ddMaxFinalAbs) ddMaxFinalAbs = ddAbsDiff;
      ddSumFinalRel += ddRelDiff;
      if (ddRelDiff > ddMaxFinalRel) ddMaxFinalRel = ddRelDiff;
      if (ddAbsDiff > 0) ddNonZeroFinal++; else ddZeroFinal++;
    }

    distanceSamplingClusters = ddClusterDescriptors;
    distanceNormalizationMeta = {
      insertionRelativeThreshold: DISTANCE_CLUSTER_ALPHA,
      totalDeltaCount: ddTotalCount,
      sortedClusterCount: ddKSorted,
      sequentialClusterCount: ddKSeq,
      meanFinalAbsoluteDeviationMeters: ddSumFinalAbs / ddTotalCount,
      maxFinalAbsoluteDeviationMeters: ddMaxFinalAbs,
      meanFinalRelativeDeviation: ddSumFinalRel / ddTotalCount,
      maxFinalRelativeDeviation: ddMaxFinalRel,
      sortedClusterCountOverTotalDeltasRatio: ddSortedOverTotal,
      sequentialClusterCountOverTotalDeltasRatio: ddSeqOverTotal,
      sequentialOverSortedClusterCountRatio: ddSeqOverSorted,
      nonZeroFinalDeviationCount: ddNonZeroFinal,
      zeroFinalDeviationCount: ddZeroFinal
    };
  }

  return {
    audit: {
      sampling: {
        time: {
          timestampContext: {
            hasAnyParseableTimestamp: hasValidTimestamps,
            hasAnyPositiveTimeDelta: hasTimeProgression,
            timestampedPointsCount: timestampedPointsCount,
            consecutiveTimestampPairsCount: consecutiveTimestampPairsCount,
            positiveTimeDeltaCount: positiveTimeDeltasCollected,
            rejections: {
              nonPositiveTimeDeltaPairs: {
                nonPositivePairCount: rejectedTimestampPairsDeltaLeqZero,
                events: nonPositiveTimeDeltaEvents
              }
            }
          },
          deltaStatistics: {
            positiveDeltaCount: dtTotalCount,
            minMs: minDeltaMs,
            maxMs: maxDeltaMs,
            medianMs: medianDeltaMs
          },
          clustering: {
            insertionRelativeThreshold: TIME_CLUSTER_ALPHA,
            sortedClusterCount: timeNormalizationMeta ? timeNormalizationMeta.sortedClusterCount : 0,
            sequentialClusterCount: timeNormalizationMeta ? timeNormalizationMeta.sequentialClusterCount : 0,
            sortedClusterCountOverTotalDeltasRatio: timeNormalizationMeta ? timeNormalizationMeta.sortedClusterCountOverTotalDeltasRatio : 0,
            sequentialClusterCountOverTotalDeltasRatio: timeNormalizationMeta ? timeNormalizationMeta.sequentialClusterCountOverTotalDeltasRatio : 0,
            sequentialOverSortedClusterCountRatio: timeNormalizationMeta ? timeNormalizationMeta.sequentialOverSortedClusterCountRatio : 0,
            clusters: timeSamplingClusters || []
          },
          normalization: timeNormalizationMeta || null
        },
        distance: {
          pairInspection: {
            consecutivePairCount: consecutivePairCount,
            rejections: {
              invalidDistance: {
                count: rejectedDistanceCount
              }
            }
          },
          deltaStatistics: distanceDeltaStatistics,
          clustering: distanceSamplingClusters !== null ? {
            insertionRelativeThreshold: DISTANCE_CLUSTER_ALPHA,
            totalDeltaCount: distanceNormalizationMeta.totalDeltaCount,
            sortedClusterCount: distanceNormalizationMeta.sortedClusterCount,
            sequentialClusterCount: distanceNormalizationMeta.sequentialClusterCount,
            sortedClusterCountOverTotalDeltasRatio: distanceNormalizationMeta.sortedClusterCountOverTotalDeltasRatio,
            sequentialClusterCountOverTotalDeltasRatio: distanceNormalizationMeta.sequentialClusterCountOverTotalDeltasRatio,
            sequentialOverSortedClusterCountRatio: distanceNormalizationMeta.sequentialOverSortedClusterCountRatio,
            clusters: distanceSamplingClusters
          } : null,
          normalization: distanceNormalizationMeta,
          timeConditionedDeltaCount: timeConditionedDistanceDeltas.length
        }
      }
    }
  };
}

/**
 * Exports time deltas to JSON file
 * @param {Array<number>} timeDeltasMs - Array of time deltas in milliseconds
 * @param {string} filename - Filename for download
 */
function exportTimeDeltasJSON(timeDeltasMs, filename) {
  const exportPayload = {
    deltas: timeDeltasMs,
    count: timeDeltasMs.length
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports distance deltas to JSON file
 * @param {Array<number>} distanceDeltasM - Array of distance deltas in meters
 * @param {string} filename - Filename for download
 */
function exportDistanceDeltasJSON(distanceDeltasM, filename) {
  const exportPayload = {
    deltas: distanceDeltasM,
    count: distanceDeltasM.length
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports time-distance pairs to JSON file
 * @param {Array<{dtSec: number, ddMeters: number}>} timeDistancePairs - Array of time-distance pairs
 * @param {string} filename - Filename for download
 */
function exportTimeDistancePairsJSON(timeDistancePairs, filename) {
  const exportPayload = {
    pairs: timeDistancePairs,
    count: timeDistancePairs.length
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
