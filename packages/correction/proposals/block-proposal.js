'use strict';

/**
 * packages/correction/proposals/block-proposal.js
 *
 * Emits 'block-finding' proposals — one per maximal contiguous run of
 * `belowAnchor` points within a single trkSegIndex (plan §block-proposal,
 * ADR-correction-0006).
 *
 * Skipped entirely when the segment has `hasAnomalies: false` (per plan).
 *
 * This module:
 *   - Owns: run span, internal monotonicity bit, edge-proposal classification
 *           against the segment's spineEnvelope.
 *   - Does NOT own: B_min/B_max numeric values (overlap-detection computes
 *           those), bracket selection, socket gating, kinematic guard.
 *
 * Edge-proposal rule (plan §Edge proposals):
 *   A block-finding is `isEdgeProposal === true` iff the block's
 *   [minBlockTime, maxBlockTime] (computed from its members' timeMs)
 *   overlaps or extends past the segment envelope on either side. Concretely:
 *     - If envelope is null (no spine), every proposal is an edge proposal.
 *     - Else if blockMin <= envelope.minTimeMs OR blockMax >= envelope.maxTimeMs
 *       → edge.
 *
 * @param {Array<Object>} workingOrderedPoints  - current traversal snapshot
 * @param {Array<number>} belowAnchorGpxIndexes - per-segment audit tag (gpxIndexes)
 * @param {number}        trkSegIndex
 * @param {{minTimeMs:number|null, maxTimeMs:number|null}|null} spineEnvelope
 *                                              - segment spine envelope (may be null)
 * @param {{hasAnomalies:boolean}} [profile]    - SegmentParticipationProfile (optional)
 * @returns {Array<Object>} block-finding proposal objects
 */
var schema = require('../state/proposal-schema');

function buildBlockProposals(workingOrderedPoints, belowAnchorGpxIndexes, trkSegIndex, spineEnvelope, profile, excludedSet) {
  // Skip if profile says segment has no anomalies.
  if (profile && profile.hasAnomalies === false) return [];
  if (!belowAnchorGpxIndexes || belowAnchorGpxIndexes.length === 0) return [];

  var anchorSet = (belowAnchorGpxIndexes instanceof Set)
    ? belowAnchorGpxIndexes
    : new Set(belowAnchorGpxIndexes);
  var excluded = (excludedSet instanceof Set) ? excludedSet : new Set(excludedSet || []);

  var proposals = [];
  var currentBlock = [];

  function finaliseBlock() {
    if (currentBlock.length === 0) return;
    // Length-1 runs are singletons, not blocks — let singleton-proposal handle them.
    if (currentBlock.length === 1) { currentBlock = []; return; }

    // hasInternalMonotonicityViolation: true iff any consecutive pair has Δt <= 0.
    var hasInternalMonotonicityViolation = false;
    for (var k = 1; k < currentBlock.length; k++) {
      var pT = currentBlock[k - 1].timeMs;
      var cT = currentBlock[k].timeMs;
      if (typeof pT !== 'number' || typeof cT !== 'number' ||
          !isFinite(pT) || !isFinite(cT) || cT <= pT) {
        hasInternalMonotonicityViolation = true;
        break;
      }
    }

    // Block time range (over members with usable timeMs).
    var blockMin = null, blockMax = null;
    for (var m = 0; m < currentBlock.length; m++) {
      var t = currentBlock[m].timeMs;
      if (typeof t === 'number' && isFinite(t) && t > 0) {
        if (blockMin === null || t < blockMin) blockMin = t;
        if (blockMax === null || t > blockMax) blockMax = t;
      }
    }

    // Edge-proposal classification.
    var isEdgeProposal;
    if (!spineEnvelope || spineEnvelope.minTimeMs === null || spineEnvelope.maxTimeMs === null) {
      // No spine yet → every block touches the (empty) edge.
      isEdgeProposal = true;
    } else if (blockMin === null || blockMax === null) {
      // Block has no usable time → can't reason; assume not edge (overlap-detection will veto).
      isEdgeProposal = false;
    } else {
      isEdgeProposal = (blockMin <= spineEnvelope.minTimeMs) ||
                       (blockMax >= spineEnvelope.maxTimeMs);
    }

    proposals.push(schema.makeBlockFindingProposal({
      trkSegIndex:                     trkSegIndex,
      gpxIndexes:                      currentBlock.map(function(p) { return p.gpxIndex; }),
      hasInternalMonotonicityViolation: hasInternalMonotonicityViolation,
      isEdgeProposal:                  isEdgeProposal,
      bMin:                            blockMin,
      bMax:                            blockMax
    }));

    currentBlock = [];
  }

  for (var i = 0; i < workingOrderedPoints.length; i++) {
    var pt = workingOrderedPoints[i];
    if (pt.trkSegIndex !== trkSegIndex) continue;
    // Excluded points break block continuity but are themselves not block members.
    if (excluded.has(pt.gpxIndex)) {
      if (currentBlock.length > 0) finaliseBlock();
      continue;
    }
    if (anchorSet.has(pt.gpxIndex)) {
      currentBlock.push(pt);
    } else if (currentBlock.length > 0) {
      finaliseBlock();
    }
  }
  if (currentBlock.length > 0) finaliseBlock();

  return proposals;
}

module.exports = { buildBlockProposals };
