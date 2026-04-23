'use strict';

/**
 * packages/correction/pre-segment/boundary-classifier.js
 *
 * Consumes raw audit.ingestion.segmentBoundaries[] and classifies each boundary.
 * ADR-correction-0013: audit emits raw; correction classifies.
 *
 * Classification is per segment-pair boundary (S[i] → S[i+1]):
 *   same_day        — firstTimeMs of S[i+1] is on the same UTC calendar day as lastTimeMs of S[i]
 *   cross_day       — different UTC calendar day, gap < 24h
 *   gap_large       — gap >= 24h
 *   time_missing    — one or both boundary timestamps null (can't classify)
 *   backward        — firstTimeMs of S[i+1] < lastTimeMs of S[i] (ordering fault candidate)
 *
 * TODO: Implement per ADR-correction-0013.
 *
 * @param {Array<{trkSegIndex, firstGpxIndex, lastGpxIndex, firstTimeMs, lastTimeMs}>} segmentBoundaries
 * @returns {Array<{fromTrkSegIndex, toTrkSegIndex, classification, gapMs}>}
 */
function classifySegmentBoundaries(segmentBoundaries) {
  // TODO: implement
  var results = [];
  for (var i = 0; i < segmentBoundaries.length - 1; i++) {
    var curr = segmentBoundaries[i];
    var next = segmentBoundaries[i + 1];
    var lastMs  = curr.lastTimeMs;
    var firstMs = next.firstTimeMs;
    var classification, gapMs = null;

    if (lastMs === null || firstMs === null) {
      classification = 'time_missing';
    } else {
      gapMs = firstMs - lastMs;
      if (gapMs < 0) {
        classification = 'backward';
      } else {
        var lastDate  = new Date(lastMs);
        var firstDate = new Date(firstMs);
        var sameDay = (
          lastDate.getUTCFullYear() === firstDate.getUTCFullYear() &&
          lastDate.getUTCMonth()    === firstDate.getUTCMonth() &&
          lastDate.getUTCDate()     === firstDate.getUTCDate()
        );
        if (sameDay) {
          classification = 'same_day';
        } else if (gapMs < 24 * 3600 * 1000) {
          classification = 'cross_day';
        } else {
          classification = 'gap_large';
        }
      }
    }

    results.push({
      fromTrkSegIndex: curr.trkSegIndex,
      toTrkSegIndex:   next.trkSegIndex,
      classification,
      gapMs
    });
  }
  return results;
}

module.exports = { classifySegmentBoundaries };
