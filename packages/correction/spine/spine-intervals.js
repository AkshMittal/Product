'use strict';

/**
 * packages/correction/spine/spine-intervals.js
 *
 * Computes correction.spineIntervals[] per segment.
 *
 * A point qualifies as spine-trusted when (ADR-correction-0010, implementation_plan.md):
 *   1. It has a finite, valid timeMs.
 *   2. Its timeMs is strictly greater than the previous spine point's timeMs
 *      (forward-monotonic; Δt > 0).
 *   3. It is not a member of a duplicate-time cluster (cluster = two or more points
 *      with the same timeMs in the segment).
 *
 * Segment boundary is a hard wall (ADR-correction-0014): spine computation does
 * NOT cross trkSegIndex boundaries.
 *
 * Output per segment: an ordered array of spine-trusted points (subset of accepted points).
 *
 * @param {Array<Object>} points - accepted GPX points (may span segments)
 * @returns {Map<number, Array<Object>>} trkSegIndex → sorted array of spine-trusted points
 */
function computeSpineIntervals(points) {
  // Step 1: Group points by segment
  var bySegment = new Map();
  for (var i = 0; i < points.length; i++) {
    var pt = points[i];
    if (!bySegment.has(pt.trkSegIndex)) {
      bySegment.set(pt.trkSegIndex, []);
    }
    bySegment.get(pt.trkSegIndex).push(pt);
  }

  var result = new Map();

  bySegment.forEach(function(segPoints, trkSegIndex) {
    // Step 2: Find duplicate-time gpxIndexes within this segment
    var timeCounts = new Map();
    for (var j = 0; j < segPoints.length; j++) {
      var sp = segPoints[j];
      if (typeof sp.timeMs !== 'number' || !isFinite(sp.timeMs)) continue;
      var count = timeCounts.get(sp.timeMs) || 0;
      timeCounts.set(sp.timeMs, count + 1);
    }
    var duplicateTimesMs = new Set();
    timeCounts.forEach(function(count, timeMs) {
      if (count > 1) duplicateTimesMs.add(timeMs);
    });

    // Step 3: Walk segment in stream order; collect spine-trusted points
    var spinePoints = [];
    var prevSpineTimeMs = -Infinity;

    for (var k = 0; k < segPoints.length; k++) {
      var spt = segPoints[k];
      // Must have finite timeMs
      if (typeof spt.timeMs !== 'number' || !isFinite(spt.timeMs)) continue;
      // Must not be in a duplicate-time cluster
      if (duplicateTimesMs.has(spt.timeMs)) continue;
      // Must be strictly forward relative to previous spine point
      if (spt.timeMs <= prevSpineTimeMs) continue;

      spinePoints.push(spt);
      prevSpineTimeMs = spt.timeMs;
    }

    result.set(trkSegIndex, spinePoints);
  });

  return result;
}

module.exports = { computeSpineIntervals };
