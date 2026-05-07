'use strict';

/**
 * packages/correction/pre-segment/boundary-classifier.js
 *
 * Classifies inter-segment boundaries.
 *
 * Input: array of segment summaries, each:
 *   { trkSegIndex, firstGpxIndex, lastGpxIndex, firstTimeMs, lastTimeMs }
 *   — may also include minTimeMs / maxTimeMs (used for overlap detection)
 *
 * For each consecutive pair (curr, next), emits one boundary record:
 *   { fromTrkSegIndex, toTrkSegIndex, gapMs, classification, isBoundaryGap,
 *     suspectedTimezoneOffsetHours, impliedDistanceM, impliedSpeedKph, raw }
 *
 * Classification is AT MOST ONE of:
 *   'same_day'               — forward gap, same UTC calendar day
 *   'cross_day'              — forward gap, different calendar days
 *   'chunk_ordering'         — backward boundary, ranges non-overlapping
 *   'duplicate_chunk'        — backward boundary, ranges overlapping
 *   'timestamp_discontinuity'— backward jump ≈ whole hours (timezone artifact)
 *   null                     — no usable timestamp data
 *
 * @param {Array<Object>} segmentSummaries
 * @param {{timezoneShiftTolerance?: number}} [params]
 * @returns {Array<Object>}
 */
function classifySegmentBoundaries(segmentSummaries, params) {
  var defaults = require('../params/defaults');
  var tzTol = (params && typeof params.timezoneShiftTolerance === 'number')
    ? params.timezoneShiftTolerance
    : defaults.timezoneShiftTolerance;

  // Accept pre-computed boundary objects (from deriveInterSegmentBoundaries) as a
  // pass-through when they already carry fromTrkSegIndex/toTrkSegIndex.
  // Detect by checking first element's shape.
  if (segmentSummaries.length > 0 &&
      segmentSummaries[0].fromTrkSegIndex !== undefined) {
    return classifyBoundaryObjects(segmentSummaries, tzTol);
  }

  // Default: treat input as segment summaries and derive pairwise boundaries.
  var sorted = segmentSummaries.slice().sort(function(a, b) {
    var ai = a.trkSegIndex !== undefined ? a.trkSegIndex : 0;
    var bi = b.trkSegIndex !== undefined ? b.trkSegIndex : 0;
    return ai - bi;
  });

  var results = [];
  for (var i = 0; i < sorted.length - 1; i++) {
    var curr = sorted[i];
    var next = sorted[i + 1];

    var lastT  = typeof curr.lastTimeMs  === 'number' ? curr.lastTimeMs  : null;
    var firstT = typeof next.firstTimeMs === 'number' ? next.firstTimeMs : null;
    var gapMs  = (lastT !== null && firstT !== null) ? firstT - lastT : null;

    var classification = null;
    var suspectedTzOffset = null;
    var isBoundaryGap = false;

    if (lastT !== null && firstT !== null) {
      if (firstT < lastT) {
        // Backward jump.
        var deltaHours = (lastT - firstT) / (3600 * 1000);
        var nearestWhole = Math.round(deltaHours);
        if (nearestWhole >= 1 && Math.abs(deltaHours - nearestWhole) <= tzTol) {
          classification = 'timestamp_discontinuity';
          suspectedTzOffset = nearestWhole;
        } else {
          // Use min/max for overlap; fall back to first/last.
          var currMin = typeof curr.minTimeMs === 'number' ? curr.minTimeMs : curr.firstTimeMs;
          var currMax = typeof curr.maxTimeMs === 'number' ? curr.maxTimeMs : curr.lastTimeMs;
          var nextMin = typeof next.minTimeMs === 'number' ? next.minTimeMs : next.firstTimeMs;
          var nextMax = typeof next.maxTimeMs === 'number' ? next.maxTimeMs : next.lastTimeMs;
          if (currMin != null && currMax != null && nextMin != null && nextMax != null) {
            var overlaps = (nextMin < currMax && nextMax > currMin);
            classification = overlaps ? 'duplicate_chunk' : 'chunk_ordering';
          } else {
            classification = 'chunk_ordering';
          }
        }
      } else if (gapMs > 0) {
        isBoundaryGap = true;
        classification = sameUtcDay(lastT, firstT) ? 'same_day' : 'cross_day';
      }
    }

    results.push({
      fromTrkSegIndex:              curr.trkSegIndex,
      toTrkSegIndex:                next.trkSegIndex,
      trackIndex:                   null,
      classification:               classification,
      isBoundaryGap:                isBoundaryGap,
      gapMs:                        gapMs,
      impliedDistanceM:             null,
      impliedSpeedKph:              null,
      suspectedTimezoneOffsetHours: suspectedTzOffset,
      raw:                          { curr: curr, next: next }
    });
  }
  return results;
}

/**
 * Pass-through classifier for pre-computed boundary objects
 * (output of auditAdapter.deriveInterSegmentBoundaries).
 */
function classifyBoundaryObjects(boundaries, tzTol) {
  var results = [];
  for (var i = 0; i < boundaries.length; i++) {
    var b = boundaries[i];
    var lastT  = b.currLastTimeMs;
    var firstT = b.nextFirstTimeMs;
    var gapMs  = b.gapMs;

    var classification = null;
    var suspectedTzOffset = null;
    var isBoundaryGap = false;

    if (lastT !== null && lastT !== undefined &&
        firstT !== null && firstT !== undefined) {
      if (firstT < lastT) {
        var deltaHours = (lastT - firstT) / (3600 * 1000);
        var nearestWhole = Math.round(deltaHours);
        if (nearestWhole >= 1 && Math.abs(deltaHours - nearestWhole) <= tzTol) {
          classification = 'timestamp_discontinuity';
          suspectedTzOffset = nearestWhole;
        } else {
          var canCompare = (b.currMinTimeMs != null && b.currMaxTimeMs != null &&
                            b.nextMinTimeMs != null && b.nextMaxTimeMs != null);
          if (canCompare) {
            var overlaps = (b.nextMinTimeMs < b.currMaxTimeMs && b.nextMaxTimeMs > b.currMinTimeMs);
            classification = overlaps ? 'duplicate_chunk' : 'chunk_ordering';
          } else {
            classification = 'chunk_ordering';
          }
        }
      } else if (gapMs !== null && gapMs > 0) {
        isBoundaryGap = true;
        classification = sameUtcDay(lastT, firstT) ? 'same_day' : 'cross_day';
      }
    }

    results.push({
      fromTrkSegIndex:              b.fromTrkSegIndex,
      toTrkSegIndex:                b.toTrkSegIndex,
      trackIndex:                   (b.trackIndex !== undefined ? b.trackIndex : null),
      classification:               classification,
      isBoundaryGap:                isBoundaryGap,
      gapMs:                        gapMs,
      impliedDistanceM:             (b.impliedDistanceM !== undefined ? b.impliedDistanceM : null),
      impliedSpeedKph:              (b.impliedSpeedKph !== undefined ? b.impliedSpeedKph : null),
      suspectedTimezoneOffsetHours: suspectedTzOffset,
      raw:                          b
    });
  }
  return results;
}

function sameUtcDay(t1, t2) {
  var d1 = new Date(t1); var d2 = new Date(t2);
  return d1.getUTCFullYear() === d2.getUTCFullYear() &&
    d1.getUTCMonth() === d2.getUTCMonth() &&
    d1.getUTCDate() === d2.getUTCDate();
}

module.exports = { classifySegmentBoundaries };
