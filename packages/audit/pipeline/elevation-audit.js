/**
 * Elevation Audit Module
 * Observational audit pass for recorded elevation data in GPX points.
 * Does NOT mutate, reorder, smooth, or normalize elevation values.
 * Does NOT compute vertical speed, gain/loss accumulation, or any
 * time-conditioned rate — those belong in the motion audit module.
 *
 * Explicit parameters:
 * @param {number} [validFloorM=-500]  Lower bound for deterministically valid elevation (meters)
 * @param {number} [validCeilingM=9500] Upper bound for deterministically valid elevation (meters)
 */

/**
 * Audits elevation channel in an array of points.
 * @param {Array<{gpxIndex: number, ele: number|null, timeRaw: string|null}>} points
 * @param {Object} [params]
 * @param {number} [params.validFloorM=-500]
 * @param {number} [params.validCeilingM=9500]
 * @returns {Object} Audit metadata under { audit: { elevation: { ... } } }
 */
function auditElevation(points, params) {
  var validFloorM = (params && typeof params.validFloorM === 'number') ? params.validFloorM : -500;
  var validCeilingM = (params && typeof params.validCeilingM === 'number') ? params.validCeilingM : 9500;

  var totalPointsEvaluated = points.length;

  // --- Counters ---
  var missingElevationCount = 0;
  var outOfBoundsCount = 0;
  var validElevationCount = 0;
  var adjacentDuplicateCount = 0;

  // --- Events ---
  var missingElevationEvents = [];
  var outOfBoundsEvents = [];
  var adjacentDuplicateEvents = [];

  // --- Block tracking: missing ---
  var missingBlocks = [];
  var inMissingBlock = false;
  var missingBlockStartIndex = null;
  var missingBlockEndIndex = null;
  var missingBlockLength = 0;

  // --- Block tracking: out-of-bounds ---
  var outOfBoundsBlocks = [];
  var inOobBlock = false;
  var oobBlockStartIndex = null;
  var oobBlockEndIndex = null;
  var oobBlockLength = 0;

  // --- Block tracking: adjacent duplicate ---
  var adjacentDuplicateBlocks = [];
  var inDupBlock = false;
  var dupBlockStartIndex = null;
  var dupBlockEndIndex = null;
  var dupBlockLength = 0;
  var dupBlockValue = null;

  // --- Channel statistics ---
  var firstValidEle = null;
  var firstValidEleIndex = null;
  var lastValidEle = null;
  var lastValidEleIndex = null;
  var minEle = null;
  var maxEle = null;

  // --- Consecutive delta tracking ---
  var prevValidEle = null;
  var prevValidEleIndex = null;
  var consecutiveDeltaCount = 0;
  var zeroDeltaCount = 0;
  var maxPositiveDelta = null;
  var maxNegativeDelta = null;
  var maxAbsoluteDelta = null;
  // Tracks whether the immediately previous array position had valid elevation.
  // Used to detect skipped pairs: current point is valid-ele but previous array position was not.
  var prevArrayPointHadValidEle = false;
  var skippedPairsDueToMissingOrOob = 0;

  // --- Co-presence with time ---
  var pointsWithBothValidEleAndParseableTime = 0;
  var pointsWithValidEleButNoTime = 0;
  var pointsWithParseableTimeButNoEle = 0;
  var consecutivePairsWithBothValidEleAndPositiveDt = 0;
  var prevHadValidEle = false;
  var prevParseableTimeMs = null;

  // --- Helper: close a block if open and length > 1 ---
  function closeMissingBlock() {
    if (inMissingBlock) {
      if (missingBlockLength > 1) {
        missingBlocks.push({
          startIndex: missingBlockStartIndex,
          endIndex: missingBlockEndIndex,
          length: missingBlockLength
        });
      }
      inMissingBlock = false;
      missingBlockStartIndex = null;
      missingBlockEndIndex = null;
      missingBlockLength = 0;
    }
  }

  function closeOobBlock() {
    if (inOobBlock) {
      if (oobBlockLength > 1) {
        outOfBoundsBlocks.push({
          startIndex: oobBlockStartIndex,
          endIndex: oobBlockEndIndex,
          length: oobBlockLength
        });
      }
      inOobBlock = false;
      oobBlockStartIndex = null;
      oobBlockEndIndex = null;
      oobBlockLength = 0;
    }
  }

  function closeDupBlock() {
    if (inDupBlock) {
      if (dupBlockLength > 1) {
        adjacentDuplicateBlocks.push({
          startIndex: dupBlockStartIndex,
          endIndex: dupBlockEndIndex,
          length: dupBlockLength,
          value: dupBlockValue
        });
      }
      inDupBlock = false;
      dupBlockStartIndex = null;
      dupBlockEndIndex = null;
      dupBlockLength = 0;
      dupBlockValue = null;
    }
  }

  // --- Main loop ---
  for (var i = 0; i < points.length; i++) {
    var point = points[i];
    var gpxIndex = point.gpxIndex;
    var ele = point.ele;

    // Co-presence: determine time parseability for this point
    var timeParseableMs = null;
    if (point.timeRaw !== null) {
      var parsed = Date.parse(point.timeRaw);
      if (!isNaN(parsed)) {
        timeParseableMs = parsed;
      }
    }

    // --- Missing elevation ---
    if (ele === null) {
      missingElevationCount++;
      missingElevationEvents.push({ index: gpxIndex });

      if (!inMissingBlock) {
        inMissingBlock = true;
        missingBlockStartIndex = gpxIndex;
        missingBlockEndIndex = gpxIndex;
        missingBlockLength = 1;
      } else {
        missingBlockEndIndex = gpxIndex;
        missingBlockLength++;
      }

      // Close other blocks
      closeOobBlock();
      closeDupBlock();

      // Co-presence: parseable time but no ele
      if (timeParseableMs !== null) {
        pointsWithParseableTimeButNoEle++;
      }

      // Reset consecutive-delta anchor (missing breaks the chain)
      prevHadValidEle = false;
      prevArrayPointHadValidEle = false;
      prevParseableTimeMs = timeParseableMs;
      continue;
    }

    // Non-null elevation from here
    closeMissingBlock();

    // --- Out-of-bounds check ---
    if (ele < validFloorM || ele > validCeilingM) {
      outOfBoundsCount++;
      outOfBoundsEvents.push({
        index: gpxIndex,
        value: ele,
        bound: ele < validFloorM ? 'belowFloor' : 'aboveCeiling'
      });

      if (!inOobBlock) {
        inOobBlock = true;
        oobBlockStartIndex = gpxIndex;
        oobBlockEndIndex = gpxIndex;
        oobBlockLength = 1;
      } else {
        oobBlockEndIndex = gpxIndex;
        oobBlockLength++;
      }

      // Close dup block
      closeDupBlock();

      // Co-presence: out-of-bounds points are not counted as "valid ele"
      if (timeParseableMs !== null) {
        pointsWithParseableTimeButNoEle++;
      }

      prevHadValidEle = false;
      prevArrayPointHadValidEle = false;
      prevParseableTimeMs = timeParseableMs;
      continue;
    }

    // Non-null, in-bounds elevation from here — this is a "valid" elevation point
    closeOobBlock();
    validElevationCount++;

    // Channel statistics
    if (firstValidEle === null) {
      firstValidEle = ele;
      firstValidEleIndex = gpxIndex;
    }
    lastValidEle = ele;
    lastValidEleIndex = gpxIndex;

    if (minEle === null || ele < minEle) {
      minEle = ele;
    }
    if (maxEle === null || ele > maxEle) {
      maxEle = ele;
    }

    // Co-presence tracking
    if (timeParseableMs !== null) {
      pointsWithBothValidEleAndParseableTime++;
    } else {
      pointsWithValidEleButNoTime++;
    }

    // Skipped pair: this point is valid-ele, a prior valid-ele point exists, but the
    // immediately previous array position was not valid-ele (missing or OOB broke the chain).
    if (prevValidEle !== null && !prevArrayPointHadValidEle) {
      skippedPairsDueToMissingOrOob++;
    }

    // --- Consecutive elevation delta (geometry-conditioned: both points have valid ele) ---
    if (prevValidEle !== null) {
      var delta = ele - prevValidEle;
      consecutiveDeltaCount++;

      if (delta === 0) {
        zeroDeltaCount++;

        // Adjacent duplicate
        adjacentDuplicateCount++;
        adjacentDuplicateEvents.push({
          index: gpxIndex,
          prevIndex: prevValidEleIndex,
          value: ele
        });

        if (!inDupBlock) {
          inDupBlock = true;
          dupBlockStartIndex = gpxIndex;
          dupBlockEndIndex = gpxIndex;
          dupBlockLength = 1;
          dupBlockValue = ele;
        } else {
          dupBlockEndIndex = gpxIndex;
          dupBlockLength++;
        }
      } else {
        // Non-zero delta: close any open dup block
        closeDupBlock();

        if (delta > 0) {
          if (maxPositiveDelta === null || delta > maxPositiveDelta) {
            maxPositiveDelta = delta;
          }
        } else {
          if (maxNegativeDelta === null || delta < maxNegativeDelta) {
            maxNegativeDelta = delta;
          }
        }
      }

      var absDelta = Math.abs(delta);
      if (delta !== 0 && (maxAbsoluteDelta === null || absDelta > maxAbsoluteDelta)) {
        maxAbsoluteDelta = absDelta;
      }

      // Co-presence: consecutive pairs with both valid ele AND positive dt
      if (prevHadValidEle && prevParseableTimeMs !== null && timeParseableMs !== null) {
        var dt = timeParseableMs - prevParseableTimeMs;
        if (dt > 0) {
          consecutivePairsWithBothValidEleAndPositiveDt++;
        }
      }
    }

    prevValidEle = ele;
    prevValidEleIndex = gpxIndex;
    prevHadValidEle = true;
    prevArrayPointHadValidEle = true;
    prevParseableTimeMs = timeParseableMs;
  }

  // --- Close any open blocks at end of stream ---
  closeMissingBlock();
  closeOobBlock();
  closeDupBlock();

  // --- Compute largest block lengths ---
  var largestMissingBlockLength = 0;
  for (var mi = 0; mi < missingBlocks.length; mi++) {
    if (missingBlocks[mi].length > largestMissingBlockLength) {
      largestMissingBlockLength = missingBlocks[mi].length;
    }
  }

  var largestOobBlockLength = 0;
  for (var oi = 0; oi < outOfBoundsBlocks.length; oi++) {
    if (outOfBoundsBlocks[oi].length > largestOobBlockLength) {
      largestOobBlockLength = outOfBoundsBlocks[oi].length;
    }
  }

  var largestDupBlockLength = 0;
  for (var di = 0; di < adjacentDuplicateBlocks.length; di++) {
    if (adjacentDuplicateBlocks[di].length > largestDupBlockLength) {
      largestDupBlockLength = adjacentDuplicateBlocks[di].length;
    }
  }

  // --- Singleton filtering (events not in any length>1 block) ---
  var collectBlockIndices = function (blocks) {
    var s = new Set();
    for (var bi = 0; bi < blocks.length; bi++) {
      var block = blocks[bi];
      for (var idx = block.startIndex; idx <= block.endIndex; idx++) {
        s.add(idx);
      }
    }
    return s;
  };

  var filterSingletonEvents = function (events, blocks) {
    var blocked = collectBlockIndices(blocks);
    var singletons = [];
    for (var ei = 0; ei < events.length; ei++) {
      if (!blocked.has(events[ei].index)) {
        singletons.push(events[ei]);
      }
    }
    return singletons;
  };

  var missingSingletonEvents = filterSingletonEvents(missingElevationEvents, missingBlocks);
  var oobSingletonEvents = filterSingletonEvents(outOfBoundsEvents, outOfBoundsBlocks);
  var dupSingletonEvents = filterSingletonEvents(adjacentDuplicateEvents, adjacentDuplicateBlocks);

  // --- Ratios ---
  var missingRatio = totalPointsEvaluated > 0 ? missingElevationCount / totalPointsEvaluated : 0;
  var outOfBoundsRatio = totalPointsEvaluated > 0 ? outOfBoundsCount / totalPointsEvaluated : 0;
  var adjacentDuplicateRatio = totalPointsEvaluated > 0 ? adjacentDuplicateCount / totalPointsEvaluated : 0;
  var elevationSpan = (minEle !== null && maxEle !== null) ? maxEle - minEle : null;

  return {
    audit: {
      elevation: {
        totalPointsEvaluated: totalPointsEvaluated,
        validElevationPointCount: validElevationCount,
        parameters: {
          validFloorM: validFloorM,
          validCeilingM: validCeilingM
        },
        channelStatistics: {
          minEle: minEle,
          maxEle: maxEle,
          elevationSpanM: elevationSpan,
          firstValidEle: firstValidEle,
          firstValidEleIndex: firstValidEleIndex,
          lastValidEle: lastValidEle,
          lastValidEleIndex: lastValidEleIndex
        },
        missing: {
          pointCount: missingElevationCount,
          pointCountOverTotalPointsRatio: missingRatio,
          maxBlockLength: largestMissingBlockLength,
          blocks: missingBlocks,
          isolatedPointCount: missingSingletonEvents.length,
          isolatedPointEvents: missingSingletonEvents
        },
        outOfBounds: {
          pointCount: outOfBoundsCount,
          pointCountOverTotalPointsRatio: outOfBoundsRatio,
          maxBlockLength: largestOobBlockLength,
          blocks: outOfBoundsBlocks,
          isolatedPointCount: oobSingletonEvents.length,
          isolatedPointEvents: oobSingletonEvents
        },
        adjacentDuplicate: {
          pointCount: adjacentDuplicateCount,
          pointCountOverTotalPointsRatio: adjacentDuplicateRatio,
          maxBlockLength: largestDupBlockLength,
          blocks: adjacentDuplicateBlocks,
          isolatedPointCount: dupSingletonEvents.length,
          isolatedPointEvents: dupSingletonEvents
        },
        consecutiveDeltas: {
          pairCount: consecutiveDeltaCount,
          skippedPairsDueToMissingOrOob: skippedPairsDueToMissingOrOob,
          zeroDeltaCount: zeroDeltaCount,
          maxPositiveDeltaM: maxPositiveDelta,
          maxNegativeDeltaM: maxNegativeDelta,
          maxAbsoluteDeltaM: maxAbsoluteDelta
        },
        coPresenceWithTime: {
          pointsWithBothValidEleAndParseableTime: pointsWithBothValidEleAndParseableTime,
          pointsWithValidEleButNoTime: pointsWithValidEleButNoTime,
          pointsWithParseableTimeButNoEle: pointsWithParseableTimeButNoEle,
          consecutivePairsWithBothValidEleAndPositiveDt: consecutivePairsWithBothValidEleAndPositiveDt
        }
      }
    }
  };
}
