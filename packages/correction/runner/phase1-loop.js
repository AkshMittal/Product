'use strict';

/**
 * packages/correction/runner/phase1-loop.js
 *
 * Per-segment multipass Phase 1 loop.
 * ADR-correction-0011: five exit reasons, multipassMaxIterations = 500.
 *
 * Exit reasons:
 *   'stable'            — pass produced zero applicable proposals
 *   'all_applied'       — all proposals applied (none vetoed or blocked)
 *   'stalemate'         — all proposals either vetoed or coupling-blocked
 *   'max_iterations'    — multipassMaxIterations reached
 *   'no_proposals'      — no proposals generated on first pass
 */

var blockProposal    = require('../proposals/block-proposal');
var singletonProposal = require('../proposals/singleton-proposal');
var duplicateProposal = require('../proposals/duplicate-proposal');
var overlapDetection = require('../gates/overlap-detection');
var couplingDetection = require('../gates/coupling-detection');
var resolutionApply  = require('../apply/resolution-apply');
var spine            = require('../spine/spine-intervals');
var defaults         = require('../params/defaults');

/**
 * @param {Object} workingState        - mutable working state for this segment
 * @param {Object} temporalAudit       - audit.temporal for this segment's points
 * @param {number} trkSegIndex
 * @param {Object} params              - override defaults
 * @returns {{ exitReason: string, passLog: Array }}
 */
function runPhase1Loop(workingState, temporalAudit, trkSegIndex, params) {
  var maxIter = (params && params.multipassMaxIterations) || defaults.multipassMaxIterations;
  var threshold = (params && params.lenientMaxImpliedSpeedKph) || defaults.lenientMaxImpliedSpeedKph;

  var passLog = [];

  // Build belowAnchor set from temporal audit
  var belowAnchorSet = new Set(
    (temporalAudit && temporalAudit.tagIndex && temporalAudit.tagIndex.belowAnchor) || []
  );

  for (var iter = 1; iter <= maxIter; iter++) {
    workingState.passNumber = iter;
    var passLabel = 'phase1_pass_' + iter;

    // Recompute spine intervals from current snapshot
    var spineMap = spine.computeSpineIntervals(workingState.workingOrderedPoints);

    // ── Generate proposals ──────────────────────────────────────────────────
    var segPoints = workingState.workingOrderedPoints.filter(function(p) {
      return p.trkSegIndex === trkSegIndex;
    });

    // Block proposals
    var blockProps = blockProposal.buildBlockProposals(
      workingState.workingOrderedPoints, belowAnchorSet, trkSegIndex
    );

    // Singleton proposals (not block members)
    var blockMemberSet = new Set();
    blockProps.forEach(function(bp) {
      bp.gpxIndexes.forEach(function(gi) { blockMemberSet.add(gi); });
    });
    var singletonProps = singletonProposal.buildSingletonProposals(
      workingState.workingOrderedPoints, belowAnchorSet, blockMemberSet, trkSegIndex
    );

    // Duplicate proposals
    var dupProps = duplicateProposal.buildDuplicateProposals(
      workingState.workingOrderedPoints, trkSegIndex
    );

    var proposals = [].concat(blockProps, singletonProps, dupProps);

    if (proposals.length === 0) {
      passLog.push({ passNumber: iter, exitReason: 'no_proposals', proposalCounts: { total: 0 } });
      return { exitReason: iter === 1 ? 'no_proposals' : 'stable', passLog };
    }

    // ── Run gates ───────────────────────────────────────────────────────────
    var overlapResult = overlapDetection.detectOverlap(proposals, workingState.workingOrderedPoints, spineMap);
    var couplingResult = couplingDetection.detectCoupling(proposals, workingState.workingOrderedPoints);

    // ── Apply ────────────────────────────────────────────────────────────────
    resolutionApply.applyProposals(
      proposals,
      overlapResult.overlapVetoedProposalIds,
      couplingResult.couplingBlockedProposalIds,
      overlapResult.overlapBlockResolution,
      workingState,
      threshold,
      passLabel
    );

    // ── Exit condition analysis ─────────────────────────────────────────────
    var applied    = proposals.filter(function(p) { return p.applied === true; });
    var notApplied = proposals.filter(function(p) { return p.applied === false; });

    passLog.push({
      passNumber: iter,
      proposalCounts: {
        total: proposals.length,
        applied: applied.length,
        vetoed: overlapResult.overlapVetoedProposalIds.length,
        couplingBlocked: couplingResult.couplingBlockedProposalIds.length,
        notApplied: notApplied.length
      }
    });

    if (applied.length === 0) {
      // Nothing applied — stalemate or stable
      var allBlocked = notApplied.every(function(p) {
        return p.skipReason === 'overlap_vetoed' || p.skipReason === 'coupling_blocked';
      });
      passLog[passLog.length - 1].exitReason = allBlocked ? 'stalemate' : 'stable';
      return { exitReason: allBlocked ? 'stalemate' : 'stable', passLog };
    }

    if (notApplied.length === 0) {
      passLog[passLog.length - 1].exitReason = 'all_applied';
      return { exitReason: 'all_applied', passLog };
    }
    // Continue to next pass
  }

  passLog.push({ passNumber: maxIter, exitReason: 'max_iterations' });
  return { exitReason: 'max_iterations', passLog };
}

module.exports = { runPhase1Loop };
