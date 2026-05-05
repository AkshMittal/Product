'use strict';

/**
 * packages/correction/proposals/singleton-proposal.js
 *
 * Emits unified `insert` proposals (kind = 'insert') for singleton backtrack
 * candidates per plan §singleton-proposal / ADR-correction-0010.
 *
 * Singleton candidate (this module):
 *   - belowAnchor === true (per-segment audit tag)
 *   - NOT a member of a block-finding run
 *   - has a usable timeMs (>0, finite)
 *
 * For each candidate, walk traversal-adjacent neighbours within the SAME
 * trkSegIndex to find tPrev, tNext (the nearest points with usable timeMs on
 * each side of the candidate's apply position). The apply position is "where
 * the candidate's timeMs slots in chronologically" — but for the bracket we
 * use the candidate's CURRENT traversal-adjacent neighbours with usable times,
 * which is what coupling-detection consumes.
 *
 * Output insert proposal carries:
 *   - targetTimeMs                = candidate.timeMs
 *   - isExactGroup                = false
 *   - candidates: [{ gpxIndex, lat, lon, tPrev, tNext, bracketGpxIndexes,
 *                    kinematics: KinematicCheck }]
 *   - isEdgeProposal              = true iff targetTimeMs lands at/past the
 *                                   segment's spine envelope edge.
 *
 * @param {Array<Object>} workingOrderedPoints
 * @param {Set<number>|Array<number>} belowAnchorGpxIndexes - per-segment audit tag
 * @param {Set<number>}   blockMemberGpxIndexes
 * @param {number}        trkSegIndex
 * @param {{minTimeMs:number|null, maxTimeMs:number|null}|null} spineEnvelope
 * @param {{lenientMaxImpliedSpeedKph?:number}} [params]
 * @returns {Array<Object>} insert proposals
 */
var schema   = require('../state/proposal-schema');
var defaults = require('../params/defaults');

function buildSingletonProposals(workingOrderedPoints, belowAnchorGpxIndexes,
                                  blockMemberGpxIndexes, trkSegIndex,
                                  spineEnvelope, params, excludedSet) {
  if (!belowAnchorGpxIndexes) return [];
  var anchorSet = (belowAnchorGpxIndexes instanceof Set)
    ? belowAnchorGpxIndexes
    : new Set(belowAnchorGpxIndexes);
  var blockSet = blockMemberGpxIndexes instanceof Set
    ? blockMemberGpxIndexes
    : new Set(blockMemberGpxIndexes || []);
  var excluded = (excludedSet instanceof Set) ? excludedSet : new Set(excludedSet || []);

  var proposals = [];

  for (var i = 0; i < workingOrderedPoints.length; i++) {
    var pt = workingOrderedPoints[i];
    if (pt.trkSegIndex !== trkSegIndex) continue;
    if (!anchorSet.has(pt.gpxIndex)) continue;
    if (blockSet.has(pt.gpxIndex)) continue;
    if (excluded.has(pt.gpxIndex)) continue;
    if (typeof pt.timeMs !== 'number' || !isFinite(pt.timeMs) || pt.timeMs <= 0) continue;

    // Walk left (within same segment) for tPrev anchor.
    var prevAnchor = null;
    for (var l = i - 1; l >= 0; l--) {
      var lp = workingOrderedPoints[l];
      if (lp.trkSegIndex !== trkSegIndex) break;
      if (typeof lp.timeMs === 'number' && isFinite(lp.timeMs) && lp.timeMs > 0) {
        prevAnchor = lp;
        break;
      }
    }
    // Walk right (within same segment) for tNext anchor.
    var nextAnchor = null;
    for (var r = i + 1; r < workingOrderedPoints.length; r++) {
      var rp = workingOrderedPoints[r];
      if (rp.trkSegIndex !== trkSegIndex) break;
      if (typeof rp.timeMs === 'number' && isFinite(rp.timeMs) && rp.timeMs > 0) {
        nextAnchor = rp;
        break;
      }
    }

    var bracketGpxIndexes = [];
    if (prevAnchor) bracketGpxIndexes.push(prevAnchor.gpxIndex);
    if (nextAnchor) bracketGpxIndexes.push(nextAnchor.gpxIndex);

    // Edge classification.
    var isEdgeProposal;
    if (!spineEnvelope || spineEnvelope.minTimeMs === null || spineEnvelope.maxTimeMs === null) {
      isEdgeProposal = true;
    } else {
      isEdgeProposal = (pt.timeMs <= spineEnvelope.minTimeMs) ||
                       (pt.timeMs >= spineEnvelope.maxTimeMs);
    }

    proposals.push(schema.makeInsertProposal({
      trkSegIndex:         trkSegIndex,
      candidateGpxIndexes: [pt.gpxIndex],
      isExactGroup:        false,
      isEdgeProposal:      isEdgeProposal,
      tPrev:               prevAnchor ? prevAnchor.timeMs : null,
      tNext:               nextAnchor ? nextAnchor.timeMs : null,
      bracketGpxIndexes:   bracketGpxIndexes,
      targetTimeMs:        pt.timeMs
    }));
  }

  return proposals;
}

module.exports = { buildSingletonProposals };
