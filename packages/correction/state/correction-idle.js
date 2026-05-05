'use strict';

/**
 * packages/correction/state/correction-idle.js
 *
 * Per-segment correction-idle predicate (plan §Correction-idle predicate, ADR-0002 A9).
 *
 * A segment is correction-idle when ALL of:
 *   1. perSegment[seg].belowAnchor.length === 0
 *   2. perSegment[seg].belowPrevValid.length === 0
 *   3. perSegment[seg].nonAdjacentRepeat.length === 0
 *   4. perSegment[seg].positiveTimeDeltaCount === perSegment[seg].consecutiveTimestampPairsCount
 *      (every consecutive pair has Δt > 0)
 *   5. No same-time different-coords groups remain in the segment's working points.
 *
 * Used:
 *   - After participation-check, objective-dedupe, reversal-check, deterministic-export-fix:
 *     if all segments idle → short-circuit to correction-export.
 *   - Inside Phase 1 multipass: after each resolution-apply, recompute the segment's
 *     idle status; on true → exit with reason 'correction-idle'.
 */

/**
 * @param {{
 *   belowAnchor: number[], belowPrevValid: number[], nonAdjacentRepeat: number[],
 *   positiveTimeDeltaCount: number, consecutiveTimestampPairsCount: number
 * }} segTags                                     - from participation-check perSegmentTags map
 * @param {Array<Object>} segWorkingPoints        - workingOrderedPoints filtered to this segment
 * @returns {boolean}
 */
function isSegmentCorrectionIdle(segTags, segWorkingPoints) {
  if (!segTags) return true; // unknown → assume idle (no audit data)
  if ((segTags.belowAnchor || []).length > 0)        return false;
  if ((segTags.belowPrevValid || []).length > 0)     return false;
  if ((segTags.nonAdjacentRepeat || []).length > 0)  return false;
  if (segTags.positiveTimeDeltaCount !== segTags.consecutiveTimestampPairsCount) return false;
  // Same-time different-coords groups in current working snapshot
  if (segWorkingPoints && segWorkingPoints.length > 0) {
    var byTime = new Map();
    for (var i = 0; i < segWorkingPoints.length; i++) {
      var p = segWorkingPoints[i];
      if (typeof p.timeMs !== 'number' || !isFinite(p.timeMs) || p.timeMs <= 0) continue;
      if (!byTime.has(p.timeMs)) byTime.set(p.timeMs, []);
      byTime.get(p.timeMs).push(p);
    }
    var has = false;
    byTime.forEach(function(group) {
      if (has || group.length < 2) return;
      // Different-coords subgroup?
      var first = group[0];
      for (var k = 1; k < group.length; k++) {
        if (group[k].lat !== first.lat || group[k].lon !== first.lon) { has = true; return; }
      }
    });
    if (has) return false;
  }
  return true;
}

/**
 * Recompute per-segment correction-idle map after a mutation.
 * Mutates the supplied per-segment view by updating its `correctionIdle` field.
 *
 * @param {Array<{trkSegIndex:number, correctionIdle:boolean}>} segmentProfiles
 * @param {Map<number, Object>} perSegmentTags - from buildPerSegmentView
 * @param {Array<Object>} workingOrderedPoints
 * @returns {boolean} allIdle - true iff every segment is correction-idle
 */
function recomputeAllCorrectionIdle(segmentProfiles, perSegmentTags, workingOrderedPoints) {
  // Group working points by segment once
  var bySeg = new Map();
  for (var i = 0; i < workingOrderedPoints.length; i++) {
    var p = workingOrderedPoints[i];
    if (!bySeg.has(p.trkSegIndex)) bySeg.set(p.trkSegIndex, []);
    bySeg.get(p.trkSegIndex).push(p);
  }
  var allIdle = true;
  for (var s = 0; s < segmentProfiles.length; s++) {
    var prof = segmentProfiles[s];
    var idle = isSegmentCorrectionIdle(perSegmentTags.get(prof.trkSegIndex), bySeg.get(prof.trkSegIndex) || []);
    prof.correctionIdle = idle;
    if (!idle) allIdle = false;
  }
  return allIdle;
}

module.exports = { isSegmentCorrectionIdle, recomputeAllCorrectionIdle };
