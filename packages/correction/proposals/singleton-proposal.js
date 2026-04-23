'use strict';

/**
 * packages/correction/proposals/singleton-proposal.js
 *
 * Emits 'insert' proposals for singleton backtrack candidates.
 *
 * A singleton (ADR-correction-0010, implementation_plan.md):
 *   A single point that is belowAnchor but is NOT part of a block-finding run.
 *   It has a timeMs that, when placed in the correct chronological position,
 *   produces a valid forward-monotonic insertion.
 *
 * This module:
 *   1. Identifies singleton candidates (belowAnchor, not in any block run, length=1 in
 *      their "run").
 *   2. Finds the traversal-adjacent bracket (tPrev, tNext) — the nearest points in
 *      workingOrderedPoints with usable timeMs on each side of the candidate's
 *      correct insertion position. ADR-correction-0010: traversal-adjacent, NOT
 *      gpxIndex-adjacent.
 *   3. Emits an 'insert' proposal with bracketGpxIndexes for coupling-detection.
 *
 * TODO: Implement full singleton identification and bracket derivation.
 *
 * @param {Array<Object>} workingOrderedPoints - current traversal snapshot (one segment)
 * @param {Set<number>}   belowAnchorGpxIndexes
 * @param {Set<number>}   blockMemberGpxIndexes - gpxIndexes already assigned to blocks
 * @param {number}        trkSegIndex
 * @returns {Array<Object>} array of 'insert' proposal objects
 */

var schema = require('../state/proposal-schema');

function buildSingletonProposals(workingOrderedPoints, belowAnchorGpxIndexes, blockMemberGpxIndexes, trkSegIndex) {
  var proposals = [];

  // Candidates: belowAnchor points that are not block members
  var candidates = [];
  for (var i = 0; i < workingOrderedPoints.length; i++) {
    var pt = workingOrderedPoints[i];
    if (pt.trkSegIndex !== trkSegIndex) continue;
    if (belowAnchorGpxIndexes.has(pt.gpxIndex) && !blockMemberGpxIndexes.has(pt.gpxIndex)) {
      candidates.push(pt);
    }
  }

  // For each candidate: find traversal-adjacent bracket points with usable timeMs
  for (var c = 0; c < candidates.length; c++) {
    var candidate = candidates[c];
    var candidateMs = candidate.timeMs;
    if (typeof candidateMs !== 'number' || !isFinite(candidateMs)) continue;

    // Find traversal position of candidate in workingOrderedPoints (current position)
    var idx = -1;
    for (var j = 0; j < workingOrderedPoints.length; j++) {
      if (workingOrderedPoints[j].gpxIndex === candidate.gpxIndex) { idx = j; break; }
    }
    if (idx < 0) continue;

    // Walk left for tPrev: nearest point with finite timeMs in the same segment
    var tPrev = null;
    var prevGpxIndex = null;
    for (var l = idx - 1; l >= 0; l--) {
      var lpt = workingOrderedPoints[l];
      if (lpt.trkSegIndex !== trkSegIndex) break;
      if (typeof lpt.timeMs === 'number' && isFinite(lpt.timeMs)) {
        tPrev = lpt.timeMs;
        prevGpxIndex = lpt.gpxIndex;
        break;
      }
    }

    // Walk right for tNext: nearest point with finite timeMs in the same segment
    var tNext = null;
    var nextGpxIndex = null;
    for (var r = idx + 1; r < workingOrderedPoints.length; r++) {
      var rpt = workingOrderedPoints[r];
      if (rpt.trkSegIndex !== trkSegIndex) break;
      if (typeof rpt.timeMs === 'number' && isFinite(rpt.timeMs)) {
        tNext = rpt.timeMs;
        nextGpxIndex = rpt.gpxIndex;
        break;
      }
    }

    var bracketGpxIndexes = [];
    if (prevGpxIndex !== null) bracketGpxIndexes.push(prevGpxIndex);
    if (nextGpxIndex !== null) bracketGpxIndexes.push(nextGpxIndex);

    proposals.push(schema.makeInsertProposal({
      trkSegIndex: trkSegIndex,
      candidateGpxIndexes: [candidate.gpxIndex],
      isExactGroup: false,
      tPrev: tPrev,
      tNext: tNext,
      bracketGpxIndexes: bracketGpxIndexes
    }));
  }

  return proposals;
}

module.exports = { buildSingletonProposals };
