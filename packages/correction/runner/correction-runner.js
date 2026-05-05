'use strict';

/**
 * packages/correction/runner/correction-runner.js
 *
 * Top-level orchestrator for the three-phase correction pipeline.
 *
 * Signature:
 *   runCorrection(auditJson, acceptedPoints, params) → correctionPayload
 *   runCorrection(acceptedPoints)                    → correctionPayload (minimal form)
 */

var workingStateModule  = require('../state/working-state');
var participation       = require('../pre-segment/participation-check');
var boundaryClassifier  = require('../pre-segment/boundary-classifier');
var objectiveDedupe     = require('../pre-segment/objective-adjacent-dedupe');
var reversalCheck       = require('../pre-segment/reversal-check');
var exportFix           = require('../pre-segment/deterministic-export-fix');
var duplicateProposalMod = require('../proposals/duplicate-proposal');
var spineModule         = require('../spine/spine-intervals');
var idleModule          = require('../state/correction-idle');
var phase1Loop          = require('./phase1-loop');
var edgeRecon           = require('../phase2/edge-reconciliation');
var residualSweep       = require('../phase3/residual-diagnostic-sweep');
var correctionExport    = require('../export/correction-export');

function runCorrection(auditJson, acceptedPoints, params) {
  // Parameter normalisation.
  var resolvedAudit  = auditJson || {};
  var resolvedPoints = acceptedPoints;
  var resolvedParams = params || {};
  if (Array.isArray(auditJson) && !acceptedPoints) {
    resolvedPoints = auditJson;
    resolvedAudit  = {};
  }
  if (!Array.isArray(resolvedPoints)) {
    throw new Error('runCorrection: acceptedPoints[] required');
  }

  // ── Initial state ──────────────────────────────────────────────────────────
  var workingState = workingStateModule.createWorkingState(resolvedPoints);

  // ── 1) Participation + per-segment profiles ────────────────────────────────
  var partResult = participation.checkParticipation(resolvedPoints, resolvedAudit, resolvedParams);
  var segmentProfiles = partResult.segmentParticipationProfiles;
  var perSegmentView  = partResult.perSegmentView;
  var perSegmentTags  = perSegmentView.perSegmentTags;

  // ── 2) Boundary classifications ───────────────────────────────────────────
  var interSegBoundaries = deriveInterSegmentBoundaries(resolvedAudit);
  var boundaryClassifications = boundaryClassifier.classifySegmentBoundaries(
    interSegBoundaries, resolvedParams
  );

  // ── 3) Cross-segment duplicate detection ──────────────────────────────────
  duplicateProposalMod.detectCrossSegmentDuplicates(
    workingState.workingOrderedPoints, workingState
  );

  // ── 4) Objective adjacent dedupe ──────────────────────────────────────────
  objectiveDedupe.applyObjectiveAdjacentDedupe(workingState, resolvedParams);
  idleModule.recomputeAllCorrectionIdle(segmentProfiles, perSegmentTags, workingState.workingOrderedPoints);
  if (allSegmentsIdle(segmentProfiles)) {
    return buildEarlyExport(workingState, partResult, segmentProfiles, boundaryClassifications, resolvedParams, perSegmentTags);
  }

  // ── 5) Reversal check ─────────────────────────────────────────────────────
  reversalCheck.checkAndApplyReversals(workingState, segmentProfiles, perSegmentTags);
  idleModule.recomputeAllCorrectionIdle(segmentProfiles, perSegmentTags, workingState.workingOrderedPoints);
  if (allSegmentsIdle(segmentProfiles)) {
    return buildEarlyExport(workingState, partResult, segmentProfiles, boundaryClassifications, resolvedParams, perSegmentTags);
  }

  // ── 6) Deterministic export fixes ─────────────────────────────────────────
  var ingestion = (resolvedAudit && resolvedAudit.audit && resolvedAudit.audit.ingestion) || {};
  var segmentSummaries = ingestion.segmentSummaries || [];
  exportFix.applyDeterministicExportFixes(
    workingState, boundaryClassifications, segmentSummaries, segmentProfiles
  );
  idleModule.recomputeAllCorrectionIdle(segmentProfiles, perSegmentTags, workingState.workingOrderedPoints);
  if (allSegmentsIdle(segmentProfiles)) {
    return buildEarlyExport(workingState, partResult, segmentProfiles, boundaryClassifications, resolvedParams, perSegmentTags);
  }

  // ── 7) Initial spine + envelopes ──────────────────────────────────────────
  var spineResult = spineModule.computeSpineResult(workingState.workingOrderedPoints);
  spineModule.attachSpineEnvelopes(segmentProfiles, spineResult.envelopeBySegment);

  // ── Phase 1: per-segment multipass loop ───────────────────────────────────
  var passLog = [];
  var allCoupledRegions = [];
  var allOverlapBlockResolution = [];

  var sortedProfiles = segmentProfiles.slice().sort(function(a, b) {
    return a.trkSegIndex - b.trkSegIndex;
  });

  for (var si = 0; si < sortedProfiles.length; si++) {
    var prof = sortedProfiles[si];

    // Segments that are geometry-only or idle before Phase 1 get a no_proposals entry.
    var skipReasons = prof.correctionIdle === true ||
                      (prof.mode === 'geometry-only' && prof.exitReason === 'duplicate-chunk-excluded') ||
                      prof.mode === 'geometry-only';

    if (skipReasons) {
      passLog.push({
        trkSegIndex:   prof.trkSegIndex,
        exitReason:    'no_proposals',
        iterationsRun: 0,
        passes:        []
      });
      continue;
    }

    var segTags = perSegmentTags.get(prof.trkSegIndex) || {};
    var auditCtx = { tagIndex: { belowAnchor: segTags.belowAnchor || [] } };

    var loopResult = phase1Loop.runPhase1Loop(
      workingState, auditCtx, prof.trkSegIndex, resolvedParams
    );

    passLog.push({
      trkSegIndex:   prof.trkSegIndex,
      exitReason:    loopResult.exitReason,
      iterationsRun: loopResult.iterationsRun,
      passes:        loopResult.passLog
    });

    // Update profile from loop result.
    prof.exitReason    = loopResult.exitReason;
    prof.iterationsRun = loopResult.iterationsRun;

    // Recompute correction-idle after each segment's Phase 1.
    idleModule.recomputeAllCorrectionIdle(
      segmentProfiles, perSegmentTags, workingState.workingOrderedPoints
    );
  }

  // ── Phase 2: Edge reconciliation ──────────────────────────────────────────
  var spineForP2 = spineModule.computeSpineResult(workingState.workingOrderedPoints);
  var phase2Result = edgeRecon.runEdgeReconciliation(
    workingState, spineForP2, boundaryClassifications
  );

  // ── Phase 3: Residual diagnostic sweep ────────────────────────────────────
  var spineForP3 = spineModule.computeSpineResult(workingState.workingOrderedPoints);
  var diagnostics = residualSweep.runResidualDiagnosticSweep(
    workingState, spineForP3, segmentProfiles
  );

  // ── Export ────────────────────────────────────────────────────────────────
  return correctionExport.buildCorrectionExport({
    workingState:            workingState,
    participation:           partResult.participation,
    segmentProfiles:         segmentProfiles,
    boundaryClassifications: boundaryClassifications,
    spineResult:             spineForP3,
    passLog:                 passLog,
    coupledRegions:          allCoupledRegions,
    overlapBlockResolution:  allOverlapBlockResolution,
    phase2Result:            phase2Result,
    diagnostics:             diagnostics,
    paramsSnapshot:          resolvedParams,
    auditPerSegmentTags:     perSegmentTags
  });
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Derives inter-segment boundary objects directly from audit.ingestion.segmentBoundaries[].
 * Each boundary now carries minTimeMs/maxTimeMs from gpx-ingestion-module (Phase B).
 */
function deriveInterSegmentBoundaries(auditJson) {
  var ingestion = (auditJson && auditJson.audit && auditJson.audit.ingestion) || {};
  var segBoundaries = (ingestion.segmentBoundaries || []).slice().sort(function(a, b) {
    return a.trkSegIndex - b.trkSegIndex;
  });
  var boundaries = [];
  for (var i = 0; i < segBoundaries.length - 1; i++) {
    var curr = segBoundaries[i];
    var next = segBoundaries[i + 1];
    var gap = (curr.lastTimeMs !== null && curr.lastTimeMs !== undefined &&
               next.firstTimeMs !== null && next.firstTimeMs !== undefined)
      ? next.firstTimeMs - curr.lastTimeMs : null;
    boundaries.push({
      fromTrkSegIndex:  curr.trkSegIndex,
      toTrkSegIndex:    next.trkSegIndex,
      trackIndex:       null,
      gapMs:            gap,
      impliedDistanceM: null,
      impliedSpeedKph:  null,
      currFirstTimeMs:  curr.firstTimeMs,
      currLastTimeMs:   curr.lastTimeMs,
      currMinTimeMs:    curr.minTimeMs !== undefined ? curr.minTimeMs : null,
      currMaxTimeMs:    curr.maxTimeMs !== undefined ? curr.maxTimeMs : null,
      nextFirstTimeMs:  next.firstTimeMs,
      nextLastTimeMs:   next.lastTimeMs,
      nextMinTimeMs:    next.minTimeMs !== undefined ? next.minTimeMs : null,
      nextMaxTimeMs:    next.maxTimeMs !== undefined ? next.maxTimeMs : null
    });
  }
  return boundaries;
}

function allSegmentsIdle(segmentProfiles) {
  for (var i = 0; i < segmentProfiles.length; i++) {
    if (!segmentProfiles[i].correctionIdle) return false;
  }
  return true;
}

function buildEarlyExport(workingState, partResult, segmentProfiles, boundaryClassifications, resolvedParams, perSegmentTags) {
  var spineResult = spineModule.computeSpineResult(workingState.workingOrderedPoints);
  var diagnostics = residualSweep.runResidualDiagnosticSweep(workingState, spineResult, segmentProfiles);
  return correctionExport.buildCorrectionExport({
    workingState:            workingState,
    participation:           partResult.participation,
    segmentProfiles:         segmentProfiles,
    boundaryClassifications: boundaryClassifications,
    spineResult:             spineResult,
    passLog:                 [],
    coupledRegions:          [],
    overlapBlockResolution:  [],
    phase2Result:            null,
    diagnostics:             diagnostics,
    paramsSnapshot:          resolvedParams,
    auditPerSegmentTags:     perSegmentTags
  });
}

module.exports = { runCorrection };
