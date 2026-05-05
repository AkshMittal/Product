'use strict';

/**
 * packages/correction/runner/phase1-loop.js
 *
 * Per-segment Phase 1 multipass loop.
 *
 * Signature:
 *   runPhase1Loop(workingState, auditContext, trkSegIndex, params)
 *
 *   - workingState  : mutable working state object
 *   - auditContext  : { tagIndex: { belowAnchor: number[] } }
 *   - trkSegIndex   : segment to process
 *   - params        : optional params override
 *
 * Exit reasons (locked set):
 *   'no_proposals'  — first pass produced zero proposals
 *   'stable'        — all proposals applied + verify pass found no more work
 *   'stalemate'     — proposals exist but none applied
 *   'max_iterations'— multipassMaxIterations cap reached
 *   'all_applied'   — all applied in a pass but more work found (loop continues)
 *
 * Returns:
 *   { exitReason, iterationsRun, passLog }
 */

var blockProposal     = require('../proposals/block-proposal');
var singletonProposal = require('../proposals/singleton-proposal');
var duplicateProposal = require('../proposals/duplicate-proposal');
var overlapDetection  = require('../gates/overlap-detection');
var couplingDetection = require('../gates/coupling-detection');
var resolutionApply   = require('../apply/resolution-apply');
var spine             = require('../spine/spine-intervals');
var ws                = require('../state/working-state');
var defaults          = require('../params/defaults');

function runPhase1Loop(workingState, auditContext, trkSegIndex, params) {
  var belowAnchor = (auditContext && auditContext.tagIndex && auditContext.tagIndex.belowAnchor) || [];
  var maxIter = (params && typeof params.multipassMaxIterations === 'number')
    ? params.multipassMaxIterations
    : defaults.multipassMaxIterations;

  var passLog = [];
  var lastExitReason = null;
  var iter = 0;

  function isEdgeAlreadyStaged(side) {
    var entry = workingState.stagedEdgeProposals.get(trkSegIndex);
    return !!(entry && entry[side]);
  }

  for (iter = 1; iter <= maxIter; iter++) {
    workingState.passNumber = iter;
    var passLabel = 'phase1_pass_' + iter;

    // ── 1. Spine + envelope ────────────────────────────────────────────────
    var spineRes = spine.computeSpineResult(workingState.workingOrderedPoints);
    var envelope = spineRes.envelopeBySegment.get(trkSegIndex)
                    || { minTimeMs: null, maxTimeMs: null };

    // ── 2. Build proposals ─────────────────────────────────────────────────
    var excludedSet = new Set();
    (workingState.excludedFromTrust || []).forEach(function(e) { excludedSet.add(e.gpxIndex); });
    // Also skip points whose anomaly has been resolved by a prior successful apply.
    (workingState.resolvedAnomalies || new Set()).forEach(function(gi) { excludedSet.add(gi); });

    var blockProps = blockProposal.buildBlockProposals(
      workingState.workingOrderedPoints, belowAnchor, trkSegIndex, envelope, null, excludedSet
    );
    var blockMemberSet = new Set();
    blockProps.forEach(function(bp) {
      bp.gpxIndexes.forEach(function(gi) { blockMemberSet.add(gi); });
    });

    var singletonProps = singletonProposal.buildSingletonProposals(
      workingState.workingOrderedPoints, belowAnchor, blockMemberSet, trkSegIndex,
      envelope, params, excludedSet
    );

    var dupProps = duplicateProposal.buildDuplicateProposals(
      workingState.workingOrderedPoints, trkSegIndex, envelope, params, excludedSet
    );

    var allProposals = [].concat(blockProps, singletonProps, dupProps);

    // ── First-pass short-circuit ──────────────────────────────────────────
    if (allProposals.length === 0) {
      var reasonNo = (iter === 1) ? 'no_proposals' : 'stable';
      passLog.push({
        passNumber: iter,
        proposalCounts: { total: 0, applyable: 0, applied: 0, vetoed: 0,
                          couplingBlocked: 0, edgeStaged: 0, outOfScope: 0 },
        exitReason: reasonNo
      });
      lastExitReason = reasonNo;
      break;
    }

    // ── 3. Scope gate ──────────────────────────────────────────────────────
    var inScope = [];
    var edgeStagedCount = 0;
    var outOfScopeCount = 0;
    for (var sgi = 0; sgi < allProposals.length; sgi++) {
      var prop = allProposals[sgi];
      var side = classifyEdgeSide(prop, envelope);
      if (prop.isEdgeProposal && side) {
        if (isEdgeAlreadyStaged(side)) {
          markOutOfSegmentScope(prop, workingState, passLabel);
          outOfScopeCount++;
        } else {
          ws.stageEdgeProposal(workingState, trkSegIndex, side, prop);
          edgeStagedCount++;
        }
        continue;
      }
      inScope.push(prop);
    }

    if (inScope.length === 0) {
      passLog.push({
        passNumber: iter,
        proposalCounts: {
          total: allProposals.length, applyable: 0, applied: 0, vetoed: 0,
          couplingBlocked: 0, edgeStaged: edgeStagedCount, outOfScope: outOfScopeCount
        },
        exitReason: 'stable'
      });
      lastExitReason = 'stable';
      break;
    }

    // ── 4. Gates ───────────────────────────────────────────────────────────
    var overlapResult = overlapDetection.detectOverlap(
      inScope, workingState.workingOrderedPoints, spineRes.spinePointsBySegment
    );
    if (overlapResult.annotations) {
      overlapResult.annotations.forEach(function(a) {
        try { ws.addAnnotation(workingState, a); } catch (_e) { /* invalid kind: ignore */ }
      });
    }
    var couplingResult = couplingDetection.detectCoupling(
      inScope, workingState.workingOrderedPoints
    );

    // ── 5. Apply ───────────────────────────────────────────────────────────
    resolutionApply.applyProposals(
      inScope,
      overlapResult.overlapVetoedProposalIds,
      couplingResult.couplingBlockedProposalIds,
      overlapResult.overlapBlockResolution,
      workingState,
      params,
      passLabel,
      iter
    );

    var applied    = inScope.filter(function(p) { return p.applied === true; });
    var notApplied = inScope.filter(function(p) { return p.applied === false; });

    var passFrame = {
      passNumber: iter,
      proposalCounts: {
        total:           allProposals.length,
        applyable:       inScope.length,
        applied:         applied.length,
        vetoed:          overlapResult.overlapVetoedProposalIds.length,
        couplingBlocked: couplingResult.couplingBlockedProposalIds.length,
        edgeStaged:      edgeStagedCount,
        outOfScope:      outOfScopeCount
      }
    };

    // ── 6. Loop-exit decision ──────────────────────────────────────────────
    if (applied.length === 0 && inScope.length > 0) {
      passFrame.exitReason = 'stalemate';
      lastExitReason = 'stalemate';
      passLog.push(passFrame);
      break;
    }

    if (notApplied.length === 0) {
      // Verification pass: rebuild proposals + run gates without applying.
      var verifySpineRes = spine.computeSpineResult(workingState.workingOrderedPoints);
      var verifyEnv = verifySpineRes.envelopeBySegment.get(trkSegIndex)
                       || { minTimeMs: null, maxTimeMs: null };
      var verifyExcluded = new Set();
      (workingState.excludedFromTrust || []).forEach(function(e) { verifyExcluded.add(e.gpxIndex); });
      (workingState.resolvedAnomalies || new Set()).forEach(function(gi) { verifyExcluded.add(gi); });
      var vBlock = blockProposal.buildBlockProposals(
        workingState.workingOrderedPoints, belowAnchor, trkSegIndex, verifyEnv, null, verifyExcluded
      );
      var vBlockMembers = new Set();
      vBlock.forEach(function(bp) { bp.gpxIndexes.forEach(function(gi) { vBlockMembers.add(gi); }); });
      var vSingle = singletonProposal.buildSingletonProposals(
        workingState.workingOrderedPoints, belowAnchor, vBlockMembers, trkSegIndex,
        verifyEnv, params, verifyExcluded
      );
      var vDup = duplicateProposal.buildDuplicateProposals(
        workingState.workingOrderedPoints, trkSegIndex, verifyEnv, params, verifyExcluded
      );
      var verifyAll = [].concat(vBlock, vSingle, vDup);

      var verifyActive = verifyAll.filter(function(p) {
        if (!p.isEdgeProposal) return true;
        var side2 = classifyEdgeSide(p, verifyEnv);
        return !!side2 && !isEdgeAlreadyStaged(side2);
      });

      if (verifyActive.length === 0) {
        passFrame.exitReason = 'stable';
        passFrame.verification = { rebuiltCount: verifyAll.length, activeCount: 0 };
        lastExitReason = 'stable';
        passLog.push(passFrame);
        break;
      }
      passFrame.verification = { rebuiltCount: verifyAll.length, activeCount: verifyActive.length };
    }

    passLog.push(passFrame);
  }

  if (lastExitReason === null) {
    lastExitReason = 'max_iterations';
    passLog.push({ passNumber: iter, exitReason: 'max_iterations' });
    try {
      ws.addAnnotation(workingState, {
        scope: 'segment',
        scopeRef: { trkSegIndex: trkSegIndex },
        kind: 'multipass_cap_hit',
        details: { iterations: iter, cap: maxIter }
      });
    } catch (_e) { /* enum-guard */ }
  }

  return {
    exitReason:    lastExitReason,
    iterationsRun: passLog.length,
    passLog:       passLog
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function classifyEdgeSide(proposal, envelope) {
  if (!proposal.isEdgeProposal) return null;
  if (proposal.kind === 'adjacent-exact-drop') return null;
  if (!envelope || envelope.minTimeMs === null || envelope.maxTimeMs === null) {
    return 'firstEdge';
  }
  if (proposal.kind === 'insert') {
    var tms = proposal.targetTimeMs;
    if (typeof tms !== 'number') tms = proposal.tPrev;
    if (typeof tms !== 'number') return 'firstEdge';
    if (tms <= envelope.minTimeMs) return 'firstEdge';
    if (tms >= envelope.maxTimeMs) return 'lastEdge';
    return 'firstEdge';
  }
  if (proposal.kind === 'block-finding') {
    var lo = (typeof proposal.bMin === 'number') ? proposal.bMin : null;
    var hi = (typeof proposal.bMax === 'number') ? proposal.bMax : null;
    if (lo !== null && lo <= envelope.minTimeMs) return 'firstEdge';
    if (hi !== null && hi >= envelope.maxTimeMs) return 'lastEdge';
    return 'firstEdge';
  }
  return null;
}

function markOutOfSegmentScope(proposal, workingState, passLabel) {
  function mark(gi) {
    ws.addExcludedFromTrust(workingState, gi, 'out_of_segment_scope', {
      proposalId: proposal.id, stage: passLabel
    });
  }
  if (proposal.kind === 'insert') {
    (proposal.candidateGpxIndexes || []).forEach(mark);
  } else if (proposal.kind === 'block-finding') {
    (proposal.gpxIndexes || []).forEach(mark);
  }
  proposal.applied    = false;
  proposal.skipReason = 'out_of_segment_scope';
  workingState.proposals.push(proposal);
}

module.exports = { runPhase1Loop };
