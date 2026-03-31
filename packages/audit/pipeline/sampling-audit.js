/**
 * Sampling Audit Module
 * Observational audit pass for time sampling behavior in GPX points
 * Does NOT mutate, reorder, or normalize timestamps
 * Collects positive time deltas between consecutive valid timestamps
 * Also collects distance deltas using haversine formula
 */

/**
 * Calculates haversine distance between two points in meters
 * @param {number} lat1 - Latitude of first point in degrees
 * @param {number} lon1 - Longitude of first point in degrees
 * @param {number} lat2 - Latitude of second point in degrees
 * @param {number} lon2 - Longitude of second point in degrees
 * @returns {number} Distance in meters
 */

//IMPORTANT NOTE TO SELF: "Presence of timestamps enables time-conditioned distance audit; does NOT imply time-based sampling."
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Audits time sampling behavior by collecting positive time deltas
 * Also collects distance deltas between consecutive valid points
 * @param {Array} points - Array of point objects with gpxIndex, timeRaw, lat, lon properties
 * @param {string} [gpxFilename] - Optional GPX filename (without extension) to include in download filenames
 * @returns {Object} Object containing time delta and distance delta statistics
 */
function auditSampling(points, gpxFilename) {
  // Global context logging
  // console.log('=== Sampling Audit - Global Context ===');
  // console.log('Total points received:', points.length);
  
  const timeDeltasMs = []; // Array<{ fromIndex, toIndex, dtSec }>
  const distanceDeltasMTimeConditioned = []; // Array<{ fromIndex, toIndex, ddMeters }>
  const distanceDeltasMGeometryConditioned = []; // Array<{ fromIndex, toIndex, ddMeters }> — valid-distance (haversine) consecutive pairs; not time-gated
  let previousTimestampMs = null;
  let previousTimestampGpxIndex = null;
  let previousPoint = null; // Track previous point with valid coordinates (lat, lon, gpxIndex)
  let hasValidTimestamps = false; // Descriptive only: any parseable timestamp present (derived from main loop)
  let hasTimeProgression = false; // true iff at least one positive consecutive time delta (dt > 0)
  
  // Time delta audit counters
  let timestampedPointsCount = 0;
  let consecutiveTimestampPairsCount = 0;
  let positiveTimeDeltasCollected = 0;
  let rejectedTimestampPairsDeltaLeqZero = 0;
  
  // Collect flagged events
  const nonPositiveTimeDeltaEvents = [];
  
  // Distance delta audit counters (geometry-only mode)
  let consecutivePointPairsConsidered = 0;
  let rejectedDistanceNonFiniteOrNegative = 0;
  
  // Iterate through all points in order
  // Note: All points are assumed to have valid coordinates (validated during ingestion)
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const timeRaw = point.timeRaw;
    
    // Process timestamp for time delta calculation
    let currentTimestampMs = null;
    let hasValidTimestamp = false;
    
    if (timeRaw !== null) {
      currentTimestampMs = Date.parse(timeRaw);
      hasValidTimestamp = !isNaN(currentTimestampMs);
    }
    
    // Geometry-only distance: always compute for every consecutive valid coordinate pair (no timestamp dependency)
    // Hoisted to outer scope so time-conditioned block can reuse without recomputing haversine
    let distanceFromPrev = null;
    let distanceFromPrevValid = false;
    if (previousPoint !== null) {
      consecutivePointPairsConsidered++;
      distanceFromPrev = haversineDistance(
        previousPoint.lat,
        previousPoint.lon,
        point.lat,
        point.lon
      );
      distanceFromPrevValid = isFinite(distanceFromPrev) && distanceFromPrev >= 0;
      if (distanceFromPrevValid) {
        distanceDeltasMGeometryConditioned.push({
          fromIndex: previousPoint.gpxIndex,
          toIndex: point.gpxIndex,
          ddMeters: distanceFromPrev
        });
      } else {
        rejectedDistanceNonFiniteOrNegative++;
      }
    }
    
    // Time delta and time-conditioned distance: only when we have positive progression (dt > 0)
    if (hasValidTimestamp) {
      hasValidTimestamps = true;
      timestampedPointsCount++;
      
      if (previousTimestampMs !== null) {
        consecutiveTimestampPairsCount++;
        const delta = currentTimestampMs - previousTimestampMs;
        
        if (delta > 0) {
          positiveTimeDeltasCollected++;
          timeDeltasMs.push({
            fromIndex: previousTimestampGpxIndex,
            toIndex: point.gpxIndex,
            dtSec: delta / 1000
          });
          hasTimeProgression = true;
          
          // Time-conditioned distance delta: reuse already-computed haversine from geometry-only block
          if (previousPoint !== null && distanceFromPrevValid) {
              distanceDeltasMTimeConditioned.push({
                fromIndex: previousPoint.gpxIndex,
                toIndex: point.gpxIndex,
              ddMeters: distanceFromPrev
              });
          }
        } else {
          rejectedTimestampPairsDeltaLeqZero++;
          nonPositiveTimeDeltaEvents.push({
            fromIndex: previousTimestampGpxIndex,
            toIndex: point.gpxIndex,
            delta: delta
          });
        }
      }
      previousTimestampMs = currentTimestampMs;
      previousTimestampGpxIndex = point.gpxIndex;
    }
    
    // Update previous point (coordinates are already validated during ingestion)
    previousPoint = { lat: point.lat, lon: point.lon, gpxIndex: point.gpxIndex };
  }
  
  if (hasValidTimestamps && !hasTimeProgression) {
    // console.log('Timestamps detected but show no positive progression; time-based analysis disabled.');
  }
  
  // Time delta audit summary
  // console.log('=== Time Delta Audit ===');
  // console.log('Timestamped points:', timestampedPointsCount);
  // console.log('Timestamped consecutive pairs:', consecutiveTimestampPairsCount);
  // console.log('Positive deltas collected:', positiveTimeDeltasCollected);
  // console.log('Rejected (delta <= 0):', rejectedTimestampPairsDeltaLeqZero);
  // console.log('========================');
  
  // Primary distance series for charts/exports: time-conditioned when progression exists, else geometry-only
  const distanceDeltasM = hasTimeProgression ? distanceDeltasMTimeConditioned : distanceDeltasMGeometryConditioned;
  
  // Distance delta audit summary
  if (hasTimeProgression) {
    // console.log('=== Distance Delta Audit (time-conditioned) ===');
    // console.log('Distance deltas collected:', distanceDeltasMTimeConditioned.length);
    // console.log('===============================================');
  } else {
    // console.log('=== Distance Delta Audit (geometry-only) ===');
    // console.log('Consecutive point pairs considered:', consecutivePointPairsConsidered);
    // console.log('Distance deltas collected:', distanceDeltasMGeometryConditioned.length);
    // console.log('Rejected (non-finite or negative distance):', rejectedDistanceNonFiniteOrNegative);
    // console.log('============================================');
  }
  
  // Calculate statistics
  const totalDeltaCount = timeDeltasMs.length;
  let minDeltaMs = null;
  let maxDeltaMs = null;
  let medianDeltaMs = null;
  
  if (totalDeltaCount > 0) {
    // Sort deltas for median calculation (by dtSec)
    const sortedDeltas = [...timeDeltasMs].sort((a, b) => a.dtSec - b.dtSec);
    
    minDeltaMs = sortedDeltas[0].dtSec * 1000;
    maxDeltaMs = sortedDeltas[sortedDeltas.length - 1].dtSec * 1000;
    
    // Calculate median
    const mid = Math.floor(sortedDeltas.length / 2);
    if (sortedDeltas.length % 2 === 0) {
      medianDeltaMs = (sortedDeltas[mid - 1].dtSec + sortedDeltas[mid].dtSec) / 2 * 1000;
    } else {
      medianDeltaMs = sortedDeltas[mid].dtSec * 1000;
    }
  }
  
  // Hold clustering outputs for nested return payload
  let timeSamplingClusters = null;
  let timeNormalizationMeta = null;
  
  // Console log the audit results
  // console.log('=== Sampling Audit Results ===');
  // console.log('Total positive deltas collected:', totalDeltaCount);
  // if (totalDeltaCount > 0) {
  //   console.log('Minimum delta (ms):', minDeltaMs);
  //   console.log('Maximum delta (ms):', maxDeltaMs);
  //   console.log('Median delta (ms):', medianDeltaMs);
  //   console.log('Minimum delta (seconds):', Math.round(minDeltaMs / 1000));
  //   console.log('Maximum delta (seconds):', Math.round(maxDeltaMs / 1000));
  //   console.log('Median delta (seconds):', Math.round(medianDeltaMs / 1000));
  // } else {
  //   console.log('No positive deltas found (insufficient valid consecutive timestamps)');
  // }
  // console.log('Total distance deltas collected:', distanceDeltasM.length);
  // console.log('================================');
  
  // ── Time-delta sampling regime detection via 2% relative clustering ──
  var TIME_CLUSTER_ALPHA = 0.02;
  
  if (timeDeltasMs.length === 0) {
    timeSamplingClusters = null;
    timeNormalizationMeta = null;
  } else {
    // Extract dtSec values in original order (does not mutate timeDeltasMs)
    var timeDeltasSec = [];
    for (var ci = 0; ci < timeDeltasMs.length; ci++) {
      timeDeltasSec.push(timeDeltasMs[ci].dtSec);
    }
    // Sorted copy for sorted-regime clustering
    var dtValues = timeDeltasSec.slice();
    dtValues.sort(function (a, b) { return a - b; });
    
    var totalDeltas = dtValues.length;
    
    // Helper: compute median of a sorted array
    function sortedMedian(arr) {
      var len = arr.length;
      if (len === 0) return 0;
      var mid = Math.floor(len / 2);
      if (len % 2 === 0) {
        return (arr[mid - 1] + arr[mid]) / 2;
      }
      return arr[mid];
    }
    
    // 1D insertion-threshold clustering on sorted values.
    // Membership check is performed against center at insertion time.
    var clusters = []; // each: { values, insertionRelativeDeviations, insertionAbsoluteDeviationsSec, insertionCenterSecs }
    var currentClusterValues = [dtValues[0]];
    var currentInsertionRelativeDeviations = [0];
    var currentInsertionAbsoluteDeviationsSec = [0];
    var currentInsertionCenterSecs = [dtValues[0]];
    var currentCenter = dtValues[0]; // median of current cluster (single element = itself)
    
    for (var di = 1; di < dtValues.length; di++) {
      var val = dtValues[di];
      // Check relative distance from current cluster center at insertion time
      var insertionCenterSec = currentCenter;
      var insertionAbsDevSec = Math.abs(val - insertionCenterSec);
      var insertionRelDev = insertionCenterSec > 0 ? insertionAbsDevSec / insertionCenterSec : 0;
      if (insertionCenterSec > 0 && insertionRelDev < TIME_CLUSTER_ALPHA) {
        // Belongs to current cluster
        currentClusterValues.push(val);
        currentInsertionRelativeDeviations.push(insertionRelDev);
        currentInsertionAbsoluteDeviationsSec.push(insertionAbsDevSec);
        currentInsertionCenterSecs.push(insertionCenterSec);
        // Recompute median as center (values are sorted so currentClusterValues stays sorted)
        currentCenter = sortedMedian(currentClusterValues);
      } else {
        // Finalize current cluster and start new one
        clusters.push({
          values: currentClusterValues,
          insertionRelativeDeviations: currentInsertionRelativeDeviations,
          insertionAbsoluteDeviationsSec: currentInsertionAbsoluteDeviationsSec,
          insertionCenterSecs: currentInsertionCenterSecs
        });
        currentClusterValues = [val];
        currentInsertionRelativeDeviations = [0];
        currentInsertionAbsoluteDeviationsSec = [0];
        currentInsertionCenterSecs = [val];
        currentCenter = val;
      }
    }
    // Finalize last cluster
    clusters.push({
      values: currentClusterValues,
      insertionRelativeDeviations: currentInsertionRelativeDeviations,
      insertionAbsoluteDeviationsSec: currentInsertionAbsoluteDeviationsSec,
      insertionCenterSecs: currentInsertionCenterSecs
    });
    
    // Build cluster descriptors
    var clusterDescriptors = [];
    for (var ki = 0; ki < clusters.length; ki++) {
      var vals = clusters[ki].values;
      var count = vals.length;
      var center = sortedMedian(vals);
      var minSec = vals[0];
      var maxSec = vals[vals.length - 1];
      
      // Insertion-time deviations (bounded by threshold by construction)
      var insertionRelativeDeviations = clusters[ki].insertionRelativeDeviations;
      var insertionAbsoluteDeviationsSec = clusters[ki].insertionAbsoluteDeviationsSec;
      var sumInsertionRelDev = 0;
      var maxInsertionRelDev = 0;
      var sumInsertionAbsDev = 0;
      var maxInsertionAbsDev = 0;
      for (var vi = 0; vi < insertionRelativeDeviations.length; vi++) {
        var insRelDev = insertionRelativeDeviations[vi];
        var insAbsDev = insertionAbsoluteDeviationsSec[vi];
        sumInsertionRelDev += insRelDev;
        if (insRelDev > maxInsertionRelDev) maxInsertionRelDev = insRelDev;
        sumInsertionAbsDev += insAbsDev;
        if (insAbsDev > maxInsertionAbsDev) maxInsertionAbsDev = insAbsDev;
      }
      
      // Second pass: deviations from final stabilized centerSec
      var sumAbsDevFinal = 0;
      var maxAbsDevFinal = 0;
      var sumRelDevFinal = 0;
      var maxRelDevFinal = 0;
      for (var vf = 0; vf < vals.length; vf++) {
        var absDevFinal = Math.abs(vals[vf] - center);
        var relDevFinal = center > 0 ? absDevFinal / center : 0;
        sumAbsDevFinal += absDevFinal;
        if (absDevFinal > maxAbsDevFinal) maxAbsDevFinal = absDevFinal;
        sumRelDevFinal += relDevFinal;
        if (relDevFinal > maxRelDevFinal) maxRelDevFinal = relDevFinal;
      }

      clusterDescriptors.push({
        centerSec: center,
        count: count,
        clusterShareOfTotalDeltas: count / totalDeltas,
        minSec: minSec,
        maxSec: maxSec,
        spreadSec: maxSec - minSec,
        meanInsertionRelativeDeviation: sumInsertionRelDev / count,
        maxInsertionRelativeDeviation: maxInsertionRelDev,
        meanInsertionAbsoluteDeviationSec: sumInsertionAbsDev / count,
        maxInsertionAbsoluteDeviationSec: maxInsertionAbsDev,
        finalMeanAbsoluteDeviationSec: sumAbsDevFinal / count,
        finalMaxAbsoluteDeviationSec: maxAbsDevFinal,
        finalMeanRelativeDeviation: sumRelDevFinal / count,
        finalMaxRelativeDeviation: maxRelDevFinal,
        finalSpreadOverCenterRatio: center > 0 ? (maxSec - minSec) / center : 0
      });
    }
    
    // Sort clusters descending by count
    clusterDescriptors.sort(function (a, b) { return b.count - a.count; });

    // Sorted clustering cluster count
    var K_sorted = clusterDescriptors.length;

    // Sequential clustering pass (same logic, original order, no sorting)
    var sequentialClusters = [];
    if (timeDeltasSec.length > 0) {
      var currentSequentialCluster = { values: [timeDeltasSec[0]] };
      for (var si = 1; si < timeDeltasSec.length; si++) {
        var delta = timeDeltasSec[si];
        var currentVals = currentSequentialCluster.values;
        // sortedMedian expects sorted input; use a sorted copy of current values
        var center = sortedMedian(currentVals.slice().sort(function (a, b) { return a - b; }));
        var relDevSeq = center > 0 ? Math.abs(delta - center) / center : 0;

        if (relDevSeq < TIME_CLUSTER_ALPHA) {
          currentSequentialCluster.values.push(delta);
        } else {
          sequentialClusters.push(currentSequentialCluster);
          currentSequentialCluster = { values: [delta] };
        }
      }
      sequentialClusters.push(currentSequentialCluster);
    }
    var K_seq = sequentialClusters.length;

    var sortedClusterCountOverTotalDeltasRatio =
      totalDeltas > 0 ? K_sorted / totalDeltas : 0;
    var sequentialClusterCountOverTotalDeltasRatio =
      totalDeltas > 0 ? K_seq / totalDeltas : 0;
    var sequentialOverSortedClusterCountRatio =
      K_sorted > 0 ? K_seq / K_sorted : 1;
    if (K_sorted <= 1) {
      sequentialOverSortedClusterCountRatio = 1;
    }
    
    // Build normalization metadata (observational only, no mutation)
    // For each dt, find its cluster and compute absolute difference from cluster center
    // Build a lookup: for each cluster, store its center and the min/max range
    // Since dtValues is sorted and clusters were formed in sorted order, we can map each dt
    // back to its cluster by tracking cluster boundaries
    
    // Rebuild cluster boundaries from the original clustering pass (in sorted order)
    var clusterCenters = []; // center for each dt in sorted order
    var boundaryIdx = 0;
    for (var bi = 0; bi < clusters.length; bi++) {
      var clusterCenter = sortedMedian(clusters[bi].values);
      for (var bj = 0; bj < clusters[bi].values.length; bj++) {
        clusterCenters[boundaryIdx] = clusterCenter;
        boundaryIdx++;
      }
    }
    
    var sumFinalAbsDiffSec = 0;
    var maxFinalAbsDiffSec = 0;
    var sumFinalRelDiff = 0;
    var maxFinalRelDiff = 0;
    var nonZeroFinalDeviationCount = 0;
    var zeroFinalDeviationCount = 0;
    
    for (var ni = 0; ni < totalDeltas; ni++) {
      var centerVal = clusterCenters[ni];
      var absDiff = Math.abs(dtValues[ni] - centerVal);
      var relDiff = centerVal > 0 ? absDiff / centerVal : 0;
      sumFinalAbsDiffSec += absDiff;
      if (absDiff > maxFinalAbsDiffSec) maxFinalAbsDiffSec = absDiff;
      sumFinalRelDiff += relDiff;
      if (relDiff > maxFinalRelDiff) maxFinalRelDiff = relDiff;
      if (absDiff > 0) {
        nonZeroFinalDeviationCount++;
      } else {
        zeroFinalDeviationCount++;
      }
    }

    timeSamplingClusters = clusterDescriptors;
    timeNormalizationMeta = {
      insertionRelativeThreshold: TIME_CLUSTER_ALPHA,
      sortedClusterCount: clusters.length,
      sequentialClusterCount: K_seq,
      meanFinalAbsoluteDeviationSec: sumFinalAbsDiffSec / totalDeltas,
      maxFinalAbsoluteDeviationSec: maxFinalAbsDiffSec,
      meanFinalRelativeDeviation: sumFinalRelDiff / totalDeltas,
      maxFinalRelativeDeviation: maxFinalRelDiff,
      sortedClusterCountOverTotalDeltasRatio: sortedClusterCountOverTotalDeltasRatio,
      sequentialClusterCountOverTotalDeltasRatio: sequentialClusterCountOverTotalDeltasRatio,
      sequentialOverSortedClusterCountRatio: sequentialOverSortedClusterCountRatio,
      nonZeroFinalDeviationCount: nonZeroFinalDeviationCount,
      zeroFinalDeviationCount: zeroFinalDeviationCount
    };
    
    // // TEMPORARY: Temporal sampling scheme detection verification
    // console.log('=== Temporal Sampling Scheme Detection ===');
    // console.log('alpha:', TIME_CLUSTER_ALPHA);
    // console.log('totalDeltas:', totalDeltas);
    // console.log('clusterCount:', clusters.length);
    // console.log('');
    // console.log('--- Sorted dtValues (input to clustering) ---');
    // console.log(dtValues);
    // console.log('');
    // console.log('--- Cluster Centers (per-dt mapping) ---');
    // console.log(clusterCenters);
    // console.log('');
    // console.log('--- Per-Cluster Detail (sorted by count desc) ---');
    // for (var cli = 0; cli < clusterDescriptors.length; cli++) {
    //   var cd = clusterDescriptors[cli];
    //   console.log('  cluster ' + cli + ':');
    //   console.log('    centerSec: ' + cd.centerSec);
    //   console.log('    count: ' + cd.count + ' (' + (cd.percentage * 100).toFixed(2) + '%)');
    //   console.log('    minSec: ' + cd.minSec + ', maxSec: ' + cd.maxSec + ', spreadSec: ' + cd.spreadSec);
    //   console.log('    meanRelativeDeviation: ' + cd.meanRelativeDeviation.toFixed(6));
    //   console.log('    maxRelativeDeviation: ' + cd.maxRelativeDeviation.toFixed(6));
    //   console.log('    meanAbsoluteAdjustmentSec: ' + cd.meanAbsoluteAdjustmentSec.toFixed(6));
    //   console.log('    maxAbsoluteAdjustmentSec: ' + cd.maxAbsoluteAdjustmentSec.toFixed(6));
    //   console.log('    finalMeanAbsoluteDeviationSec: ' + cd.finalMeanAbsoluteDeviationSec.toFixed(6));
    //   console.log('    finalMaxAbsoluteDeviationSec: ' + cd.finalMaxAbsoluteDeviationSec.toFixed(6));
    //   console.log('    finalMeanRelativeDeviation: ' + cd.finalMeanRelativeDeviation.toFixed(6));
    //   console.log('    finalMaxRelativeDeviation: ' + cd.finalMaxRelativeDeviation.toFixed(6));
    //   console.log('    clusterGlobalSpreadRatio: ' + cd.clusterGlobalSpreadRatio.toFixed(6));
    // }
    // console.log('');
    // console.log('--- Normalization Metadata ---');
    // console.log('  meanAbsoluteAdjustmentSec:', timeNormalizationMeta.meanAbsoluteAdjustmentSec);
    // console.log('  maxAbsoluteAdjustmentSec:', timeNormalizationMeta.maxAbsoluteAdjustmentSec);
    // console.log('  meanRelativeAdjustment:', timeNormalizationMeta.meanRelativeAdjustment);
    // console.log('  maxRelativeAdjustment:', timeNormalizationMeta.maxRelativeAdjustment);
    // console.log('  sortedCompressionRatio:', timeNormalizationMeta.sortedCompressionRatio);
    // console.log('  sequentialCompressionRatio:', timeNormalizationMeta.sequentialCompressionRatio);
    // console.log('  samplingStabilityRatio:', timeNormalizationMeta.samplingStabilityRatio);
    // console.log('  adjustedCount:', adjustedCount);
    // console.log('  unchangedCount:', unchangedCount);
    // console.log('============================================');
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
            positiveDeltaCount: totalDeltaCount,
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
            consecutivePairCount: consecutivePointPairsConsidered,
            rejections: {
              invalidDistance: {
                count: rejectedDistanceNonFiniteOrNegative
              }
            }
          },
          geometryConditioned: {
            deltaCount: distanceDeltasMGeometryConditioned.length
          },
          timeConditioned: {
            deltaCount: distanceDeltasMTimeConditioned.length
          }
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
