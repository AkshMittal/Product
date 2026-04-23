'use strict';

/**
 * packages/correction/pre-segment/reversal-check.js
 *
 * Segment-level reversal detection.
 * A segment is a reversal candidate when its raw time sequence is globally decreasing
 * (i.e. would be monotone-increasing if reversed) AND no other segment's time range
 * overlaps with the reversed range.
 *
 * This is a diagnostic pass — it emits flags but does NOT apply reversals.
 * Reversal application is decided by correction-runner based on segment context.
 *
 * TODO: Implement full reversal detection logic per implementation_plan.md.
 *
 * @param {Array<Object>} points - accepted GPX points (may span multiple segments)
 * @param {Array<Object>} segmentBoundaries - from audit.ingestion.segmentBoundaries
 * @returns {Array<{trkSegIndex: number, isReversalCandidate: boolean, confidence: number}>}
 */
function checkReversals(points, segmentBoundaries) {
  // TODO: implement full reversal detection
  // Stub: no reversals detected
  return segmentBoundaries.map(function(sb) {
    return {
      trkSegIndex: sb.trkSegIndex,
      isReversalCandidate: false,
      confidence: 0
    };
  });
}

module.exports = { checkReversals };
