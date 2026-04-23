'use strict';

/**
 * packages/correction/proposals/block-proposal.js
 *
 * Emits 'block-finding' proposals for runs of belowAnchor points.
 *
 * A "block" (ADR-correction-0006):
 *   - Is a contiguous run of points within one trkSegIndex where every point
 *     has belowAnchor = true in the temporal audit.
 *   - Has internal monotonicity: no intra-block backward time step vs the
 *     previous point within the block.
 *   - The first point MAY have belowPrevValid when its predecessor is outside the run.
 *
 * Socket/bracket computation is NOT done here — that is overlap-detection's job.
 * This module: run span + internal monotonicity only.
 *
 * ADR-correction-0006: block-finding (run detection) owned here;
 *   overlap-detection owns B_min/B_max, brackets, closed socket, overlapBlockResolution.
 *
 * @param {Array<Object>} workingOrderedPoints - current traversal snapshot (one segment)
 * @param {Set<number>}   belowAnchorGpxIndexes - from temporal audit tagIndex.belowAnchor
 * @param {number}        trkSegIndex
 * @returns {Array<Object>} array of block-finding proposal objects (via proposal-schema.js)
 */

var schema = require('../state/proposal-schema');

function buildBlockProposals(workingOrderedPoints, belowAnchorGpxIndexes, trkSegIndex) {
  var proposals = [];
  var inBlock = false;
  var currentBlock = [];

  function finaliseBlock() {
    if (currentBlock.length === 0) return;

    // Check internal monotonicity: no backward time step within block
    var hasInternalViolation = false;
    for (var k = 1; k < currentBlock.length; k++) {
      var prevMs = currentBlock[k - 1].timeMs;
      var currMs = currentBlock[k].timeMs;
      if (typeof prevMs === 'number' && isFinite(prevMs) &&
          typeof currMs === 'number' && isFinite(currMs) &&
          currMs < prevMs) {
        hasInternalViolation = true;
        break;
      }
    }

    proposals.push(schema.makeBlockFindingProposal({
      trkSegIndex: trkSegIndex,
      gpxIndexes: currentBlock.map(function(p) { return p.gpxIndex; }),
      hasInternalMonotonicityViolation: hasInternalViolation
    }));

    currentBlock = [];
  }

  for (var i = 0; i < workingOrderedPoints.length; i++) {
    var pt = workingOrderedPoints[i];
    if (pt.trkSegIndex !== trkSegIndex) continue;

    if (belowAnchorGpxIndexes.has(pt.gpxIndex)) {
      inBlock = true;
      currentBlock.push(pt);
    } else {
      if (inBlock) {
        finaliseBlock();
        inBlock = false;
      }
    }
  }
  if (inBlock) {
    finaliseBlock();
  }

  return proposals;
}

module.exports = { buildBlockProposals };
