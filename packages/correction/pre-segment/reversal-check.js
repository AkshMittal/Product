'use strict';

/**
 * packages/correction/pre-segment/reversal-check.js
 *
 * Two-stage reversal handling per ADR-0005 / plan §Reversal-check.
 *
 * 1. Global full-array reversal hypothesis:
 *      Reverse workingOrderedPoints; recompute per-segment correction-idle.
 *      Accept iff every segment becomes correction-idle on the reversed snapshot.
 *      Else revert; emit session annotation 'reversal_unconfirmed'.
 *
 * 2. Per-segment reversal (only for profiles with isFullyReversed === true):
 *      Reverse the segment's points within workingOrderedPoints (gpxIndex unchanged).
 *      Accept iff:
 *        - reversed segment is internally monotonic (Δt > 0 for every consecutive pair)
 *        - reversed segment's new (min/max)TimeMs sits at the seam against its
 *          neighbours: reversedSeg.minTimeMs >= prevSeg.maxTimeMs AND
 *                      reversedSeg.maxTimeMs <= nextSeg.minTimeMs (equality allowed)
 *      Accepted: log rearrangement {kind:'segment-reversal'} + segment annotation
 *                'is_fully_reversed'.
 *      Rejected: revert; segment annotation 'segment_reversal_unconfirmed';
 *                members → excludedFromTrust 'reversal_unconfirmed_member'.
 *
 * Order: global first; per-segment second (on whatever remains).
 *
 * @param {Object} workingState
 * @param {Array<Object>} segmentParticipationProfiles  - mutated (mode/exitReason updated)
 * @param {Map<number, Object>} perSegmentTags          - from participation-check perSegmentView
 * @returns {{
 *   globalAccepted: boolean,
 *   perSegmentAccepted: number[],
 *   perSegmentRejected: number[]
 * }}
 */
var ws = require('../state/working-state');
var idle = require('../state/correction-idle');

function checkAndApplyReversals(workingState, segmentParticipationProfiles, perSegmentTags) {
  var stage = 'reversal-check';
  var result = {
    globalAccepted: false,
    perSegmentAccepted: [],
    perSegmentRejected: []
  };

  // ── 1) Global hypothesis ────────────────────────────────────────────────────
  var snapshot = workingState.workingOrderedPoints.slice();
  var reversed = snapshot.slice().reverse();
  workingState.workingOrderedPoints = reversed;
  // We must recompute "consecutivePairs / positiveDeltas" from the reversed list.
  // Cheapest path: synthesize a per-segment-tags surrogate from current points and
  // reuse the correction-idle predicate.
  var allIdleOnReversed = isAllSegmentsCorrectionIdleOnSnapshot(reversed, perSegmentTags, segmentParticipationProfiles);
  if (allIdleOnReversed) {
    // Accept the global reversal.
    ws.addRearrangement(workingState, {
      kind: 'full-array-reversal',
      passIndex: 0,
      stage: stage,
      countMoved: snapshot.length
    });
    result.globalAccepted = true;
    return result; // mutually exclusive with per-segment reversal in practice
  }
  // Reject — revert.
  workingState.workingOrderedPoints = snapshot;
  ws.addAnnotation(workingState, {
    scope: 'session',
    kind:  'reversal_unconfirmed',
    details: { reason: 'reversed-snapshot-not-correction-idle' }
  });

  // ── 2) Per-segment reversal for isFullyReversed profiles ────────────────────
  if (!segmentParticipationProfiles || segmentParticipationProfiles.length === 0) return result;

  // Group current points by segment.
  function groupBySeg(pts) {
    var m = new Map();
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!m.has(p.trkSegIndex)) m.set(p.trkSegIndex, []);
      m.get(p.trkSegIndex).push(p);
    }
    return m;
  }
  var bySeg = groupBySeg(workingState.workingOrderedPoints);

  // Compute per-segment min/max in current order (pre-reversal).
  var rangeBySeg = new Map();
  bySeg.forEach(function(pts, segIdx) {
    var minT = null, maxT = null;
    for (var i = 0; i < pts.length; i++) {
      var t = pts[i].timeMs;
      if (typeof t !== 'number' || !isFinite(t) || t <= 0) continue;
      if (minT === null || t < minT) minT = t;
      if (maxT === null || t > maxT) maxT = t;
    }
    rangeBySeg.set(segIdx, { minTimeMs: minT, maxTimeMs: maxT });
  });

  // Sort segments by trkSegIndex to know neighbour positions.
  var segOrder = Array.from(bySeg.keys()).sort(function(a, b) { return a - b; });
  var posInOrder = new Map();
  for (var z = 0; z < segOrder.length; z++) posInOrder.set(segOrder[z], z);

  for (var i = 0; i < segmentParticipationProfiles.length; i++) {
    var prof = segmentParticipationProfiles[i];
    if (!prof.isFullyReversed) continue;
    var segIdx = prof.trkSegIndex;
    var segPts = bySeg.get(segIdx);
    if (!segPts || segPts.length < 2) continue;

    // Reverse segment-local order in-place within workingOrderedPoints.
    var reversedSegPts = segPts.slice().reverse();
    spliceSegment(workingState, segIdx, reversedSegPts);

    // Internal monotonicity check on reversed segment.
    var monotonic = true;
    var prevT = -Infinity;
    for (var j = 0; j < reversedSegPts.length; j++) {
      var rt = reversedSegPts[j].timeMs;
      if (typeof rt !== 'number' || !isFinite(rt) || rt <= 0) continue;
      if (rt <= prevT) { monotonic = false; break; }
      prevT = rt;
    }
    // Reversed range
    var revMin = null, revMax = null;
    for (var k = 0; k < reversedSegPts.length; k++) {
      var rk = reversedSegPts[k].timeMs;
      if (typeof rk !== 'number' || !isFinite(rk) || rk <= 0) continue;
      if (revMin === null || rk < revMin) revMin = rk;
      if (revMax === null || rk > revMax) revMax = rk;
    }
    // Neighbour seam consistency
    var seamOk = true;
    var pos = posInOrder.get(segIdx);
    if (pos > 0) {
      var prevSegRange = rangeBySeg.get(segOrder[pos - 1]);
      if (prevSegRange && prevSegRange.maxTimeMs !== null && revMin !== null) {
        if (revMin < prevSegRange.maxTimeMs) seamOk = false;
      }
    }
    if (pos < segOrder.length - 1 && seamOk) {
      var nextSegRange = rangeBySeg.get(segOrder[pos + 1]);
      if (nextSegRange && nextSegRange.minTimeMs !== null && revMax !== null) {
        if (revMax > nextSegRange.minTimeMs) seamOk = false;
      }
    }

    if (monotonic && seamOk) {
      // Accept
      ws.addRearrangement(workingState, {
        kind: 'segment-reversal',
        passIndex: 0,
        stage: stage,
        trkSegIndex: segIdx,
        countMoved: reversedSegPts.length
      });
      ws.addAnnotation(workingState, {
        scope:    'segment',
        scopeRef: { trkSegIndex: segIdx },
        kind:     'is_fully_reversed',
        details:  { countMoved: reversedSegPts.length }
      });
      // Update local range record so downstream segments see the post-reversal range.
      rangeBySeg.set(segIdx, { minTimeMs: revMin, maxTimeMs: revMax });
      result.perSegmentAccepted.push(segIdx);
    } else {
      // Revert
      spliceSegment(workingState, segIdx, segPts);
      ws.addAnnotation(workingState, {
        scope:    'segment',
        scopeRef: { trkSegIndex: segIdx },
        kind:     'segment_reversal_unconfirmed',
        details:  { internalMonotonic: monotonic, seamOk: seamOk }
      });
      for (var m = 0; m < segPts.length; m++) {
        ws.addExcludedFromTrust(workingState, segPts[m].gpxIndex,
          'reversal_unconfirmed_member', 'pre-segment', { trkSegIndex: segIdx });
      }
      result.perSegmentRejected.push(segIdx);
    }
  }
  return result;
}

/**
 * Replace the contiguous slot of segment `trkSegIndex` in workingOrderedPoints
 * with `newSegPts` (in the supplied order). Caller guarantees `newSegPts` has
 * the same gpxIndex set as currently present.
 */
function spliceSegment(state, trkSegIndex, newSegPts) {
  var pts = state.workingOrderedPoints;
  var firstPos = -1, lastPos = -1;
  for (var i = 0; i < pts.length; i++) {
    if (pts[i].trkSegIndex === trkSegIndex) {
      if (firstPos < 0) firstPos = i;
      lastPos = i;
    }
  }
  if (firstPos < 0) return;
  var rebuilt = pts.slice(0, firstPos).concat(newSegPts).concat(pts.slice(lastPos + 1));
  state.workingOrderedPoints = rebuilt;
}

/**
 * Synthesizes per-segment tag-shaped objects from the current snapshot and
 * runs the correction-idle predicate over each segment. Returns true iff every
 * segment is correction-idle.
 *
 * Note: the `belowAnchor`/`belowPrevValid`/`nonAdjacentRepeat` tag arrays from
 * the audit are not re-derivable from points alone — but on a successful global
 * reversal hypothesis they cease to exist by definition (we are testing
 * "would this snapshot be clean if we accepted it?"). So we rebuild only the
 * Δt counters from the reversed snapshot and assume the original tag arrays
 * apply to the original (un-reversed) sequence. For the global hypothesis,
 * "all idle" therefore reduces to:
 *   - every consecutive pair has Δt > 0 (positiveTimeDeltaCount === pairs)
 *   - no same-time-different-coords groups
 * The audit-derived anomaly tags do NOT carry over to the reversed snapshot
 * (they pointed at the original ordering); per ADR-0005 the cheap hypothesis
 * looks only at the time/geometry of the new snapshot.
 */
function isAllSegmentsCorrectionIdleOnSnapshot(reversedPoints, _perSegmentTagsOriginal, profiles) {
  // Group reversed points by segment.
  var bySeg = new Map();
  for (var i = 0; i < reversedPoints.length; i++) {
    var p = reversedPoints[i];
    if (!bySeg.has(p.trkSegIndex)) bySeg.set(p.trkSegIndex, []);
    bySeg.get(p.trkSegIndex).push(p);
  }

  // Build synthetic tag objects (no anomaly arrays — see note above) and check idle.
  for (var s = 0; s < profiles.length; s++) {
    var prof = profiles[s];
    var segPts = bySeg.get(prof.trkSegIndex) || [];
    var pairs = 0, positives = 0;
    var prev = null;
    for (var k = 0; k < segPts.length; k++) {
      var t = segPts[k].timeMs;
      if (typeof t !== 'number' || !isFinite(t) || t <= 0) continue;
      if (prev !== null) {
        pairs++;
        if (t > prev) positives++;
      }
      prev = t;
    }
    var syntheticTags = {
      belowAnchor: [],
      belowPrevValid: [],
      nonAdjacentRepeat: [],
      positiveTimeDeltaCount: positives,
      consecutiveTimestampPairsCount: pairs
    };
    if (!idle.isSegmentCorrectionIdle(syntheticTags, segPts)) return false;
  }
  return true;
}

module.exports = { checkAndApplyReversals };
