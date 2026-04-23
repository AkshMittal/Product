'use strict';

/**
 * packages/correction/gates/overlap-detection.js
 *
 * Computes temporal overlap and socket status for block-finding proposals.
 * Independent of coupling-detection — both read snapshot state only (ADR-correction-0010).
 *
 * For each block-finding proposal:
 *   1. Compute B_min and B_max (min/max timeMs of block members).
 *   2. Find bracket anchors (t_prev, t_next): traversal-adjacent spine-trusted points
 *      outside the block in each direction (implementation_plan.md § Bracket vs socket).
 *   3. Numeric closed-socket test: B_min >= t_prev AND B_max <= t_next.
 *   4. Corridor pierce-check: any spine-trusted point with timeMs ∈ (t_prev, t_next)
 *      and gpxIndex NOT in block → overlap (ADR-correction-0006 §5 / structural guard).
 *   5. Emit status: 'socket-ok' | 'overlap' | 'no-bracket'.
 *   6. For socket-ok blocks: populate overlapBlockResolution entry with anchor points.
 *
 * Emits:
 *   overlapVetoedProposalIds[]  — block ids with status 'overlap'
 *   overlapBlockResolution[]    — for socket-ok blocks: bracket + anchor details
 *
 * TODO: Implement full bracket/socket/pierce logic per implementation_plan.md.
 *
 * @param {Array<Object>} proposals - all proposals for this pass
 * @param {Array<Object>} workingOrderedPoints - current traversal snapshot
 * @param {Map<number, Array<Object>>} spineIntervals - trkSegIndex → spine points
 * @returns {{ overlapVetoedProposalIds: string[], overlapBlockResolution: Array }}
 */
function detectOverlap(proposals, workingOrderedPoints, spineIntervals) {
  var overlapVetoedProposalIds = [];
  var overlapBlockResolution = [];

  for (var i = 0; i < proposals.length; i++) {
    var proposal = proposals[i];
    if (proposal.kind !== 'block-finding') continue;

    var segSpine = spineIntervals.get(proposal.trkSegIndex) || [];
    var blockSet = new Set(proposal.gpxIndexes);

    // Step 1: B_min, B_max
    var bMin = Infinity, bMax = -Infinity;
    for (var j = 0; j < proposal.gpxIndexes.length; j++) {
      var pt = findPoint(workingOrderedPoints, proposal.gpxIndexes[j]);
      if (!pt) continue;
      if (typeof pt.timeMs === 'number' && isFinite(pt.timeMs)) {
        if (pt.timeMs < bMin) bMin = pt.timeMs;
        if (pt.timeMs > bMax) bMax = pt.timeMs;
      }
    }
    if (!isFinite(bMin) || !isFinite(bMax)) {
      // Block has no usable timestamps — veto
      overlapVetoedProposalIds.push(proposal.id);
      proposal.overlapStatus = 'overlap';
      continue;
    }

    // Step 2: Find bracket anchors from spine outside block
    var prevAnchor = null, nextAnchor = null;
    // Spine points are ordered by timeMs; find last spine point < bMin not in block
    for (var sp = 0; sp < segSpine.length; sp++) {
      if (!blockSet.has(segSpine[sp].gpxIndex) && segSpine[sp].timeMs < bMin) {
        prevAnchor = segSpine[sp];
      }
    }
    // First spine point > bMax not in block
    for (var sn = 0; sn < segSpine.length; sn++) {
      if (!blockSet.has(segSpine[sn].gpxIndex) && segSpine[sn].timeMs > bMax) {
        nextAnchor = segSpine[sn];
        break;
      }
    }

    if (!prevAnchor && !nextAnchor) {
      // No bracket available — no-bracket status; not socket-ok
      proposal.overlapStatus = 'no-bracket';
      overlapVetoedProposalIds.push(proposal.id);
      continue;
    }

    var tPrev = prevAnchor ? prevAnchor.timeMs : -Infinity;
    var tNext = nextAnchor ? nextAnchor.timeMs : Infinity;

    // Step 3: Numeric closed-socket test
    var socketOk = (bMin >= tPrev) && (bMax <= tNext);

    // Step 4: Corridor pierce-check
    var pierced = false;
    if (socketOk) {
      for (var pc = 0; pc < segSpine.length; pc++) {
        var spt = segSpine[pc];
        if (blockSet.has(spt.gpxIndex)) continue;
        if (spt.timeMs > tPrev && spt.timeMs < tNext) {
          pierced = true;
          break;
        }
      }
    }

    if (!socketOk || pierced) {
      proposal.overlapStatus = 'overlap';
      overlapVetoedProposalIds.push(proposal.id);
    } else {
      proposal.overlapStatus = 'socket-ok';
      proposal.prevGpxIndex = prevAnchor ? prevAnchor.gpxIndex : null;
      proposal.nextGpxIndex = nextAnchor ? nextAnchor.gpxIndex : null;
      proposal.tPrev = tPrev;
      proposal.tNext = tNext;

      overlapBlockResolution.push({
        proposalId: proposal.id,
        trkSegIndex: proposal.trkSegIndex,
        gpxIndexes: proposal.gpxIndexes,
        bMin: bMin,
        bMax: bMax,
        tPrev: tPrev,
        tNext: tNext,
        prevGpxIndex: proposal.prevGpxIndex,
        nextGpxIndex: proposal.nextGpxIndex,
        prevAnchorPoint: prevAnchor,
        nextAnchorPoint: nextAnchor,
        spinePointPierceDetected: false
      });
    }
  }

  return { overlapVetoedProposalIds, overlapBlockResolution };
}

/**
 * @param {Array<Object>} points
 * @param {number} gpxIndex
 * @returns {Object|null}
 */
function findPoint(points, gpxIndex) {
  for (var i = 0; i < points.length; i++) {
    if (points[i].gpxIndex === gpxIndex) return points[i];
  }
  return null;
}

module.exports = { detectOverlap };
