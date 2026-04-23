'use strict';

/**
 * packages/correction/runner/correction-runner.js
 *
 * Top-level 3-phase correction orchestrator.
 *
 * Phase 1: Per-segment terminal solve (multipass loop per trkSegIndex)
 * Phase 2: Edge reconciliation (cross-segment)
 * Phase 3: Residual diagnostic sweep (full canonical traversal, no mutations)
 *
 * @param {Object} auditJson    - full audit payload (from audit-export-module)
 * @param {Object} params       - override params (optional)
 * @returns {Object} correction payload
 */

var workingStateModule  = require('../state/working-state');
var preSegBoundary      = require('../pre-segment/boundary-classifier');
var participation       = require('../pre-segment/participation-check');
var objectiveDedupe     = require('../pre-segment/objective-adjacent-dedupe');
var reversalCheck       = require('../pre-segment/reversal-check');
var exportFix           = require('../pre-segment/deterministic-export-fix');
var spineModule         = require('../spine/spine-intervals');
var phase1Loop          = require('./phase1-loop');
var edgeRecon           = require('../phase2/edge-reconciliation');
var residualSweep       = require('../phase3/residual-diagnostic-sweep');
var correctionExport    = require('../export/correction-export');

/**
 * @param {Object} auditJson
 * @param {Object} [params]
 * @returns {Object}
 */
function runCorrection(auditJson, params) {
  var ingestion   = (auditJson && auditJson.audit && auditJson.audit.ingestion) || {};
  var temporal    = (auditJson && auditJson.audit && auditJson.audit.temporal)  || {};
  var exportFaults = (auditJson && auditJson.audit && auditJson.audit.exportFaults) || [];

  // All accepted points (from ingestion — in practice the caller passes these too)
  // For now we reconstruct from auditJson if available; full wiring in Phase I.
  // The correction runner receives the accepted points array as a separate argument.
  // This stub uses an empty array; runCorrection is called as:
  //   runCorrection(auditJson, acceptedPoints, params)
  // We handle the overloaded signature below.
  var acceptedPoints = [];
  var resolvedParams = params;
  if (Array.isArray(params)) {
    // Called as runCorrection(auditJson, acceptedPoints, paramsObj)
    acceptedPoints  = params;
    resolvedParams  = arguments[2] || {};
  } else if (Array.isArray(auditJson)) {
    // Called as runCorrection(acceptedPoints) — minimal form
    acceptedPoints  = auditJson;
    auditJson       = {};
    resolvedParams  = params || {};
  }

  // ── Pre-segment phase ──────────────────────────────────────────────────────
  var segmentBoundaries = ingestion.segmentBoundaries || [];
  var boundaryClassifications = preSegBoundary.classifySegmentBoundaries(segmentBoundaries);
  participation.checkParticipation(acceptedPoints);

  // Objective adjacent dedupe (stream-adjacent, pre-mutation)
  var objDrops = objectiveDedupe.findObjectiveAdjacentDuplicates(acceptedPoints);

  // Reversal check
  var reversalFlags = reversalCheck.checkReversals(acceptedPoints, segmentBoundaries);

  // Deterministic export fixes
  exportFix.applyDeterministicExportFixes(exportFaults, acceptedPoints);

  // Create working state from accepted points minus objective drops
  var droppedGpxIndexes = new Set(objDrops.map(function(d) { return d.dropGpxIndex; }));
  var initialPoints = acceptedPoints.filter(function(p) { return !droppedGpxIndexes.has(p.gpxIndex); });
  var workingState = workingStateModule.createWorkingState(initialPoints);

  // Record objective drops
  for (var od = 0; od < objDrops.length; od++) {
    workingStateModule.addDrop(workingState, objDrops[od].dropGpxIndex, objDrops[od].reason, 'pre_segment');
  }

  // ── Phase 1: Per-segment multipass loop ────────────────────────────────────
  // Compute unique trkSegIndexes
  var segIndexes = [];
  var seenSegs = new Set();
  for (var pi = 0; pi < acceptedPoints.length; pi++) {
    var seg = acceptedPoints[pi].trkSegIndex;
    if (!seenSegs.has(seg)) { seenSegs.add(seg); segIndexes.push(seg); }
  }
  segIndexes.sort(function(a, b) { return a - b; });

  var allPassLogs = [];
  var allSpineIntervals = new Map();
  var allCoupledRegions = [];
  var allOverlapBlockResolution = [];

  for (var si = 0; si < segIndexes.length; si++) {
    var trkSegIndex = segIndexes[si];

    // Compute spine for this segment
    var spineMap = spineModule.computeSpineIntervals(workingState.workingOrderedPoints);
    allSpineIntervals = spineMap; // keep last computed (multi-seg: accumulate)

    // Get per-segment temporal audit
    var segTemporal = temporal;
    if (temporal.perSegment) {
      var segTemporalEntry = temporal.perSegment.find(function(s) { return s.trkSegIndex === trkSegIndex; });
      segTemporal = segTemporalEntry ? { tagIndex: segTemporalEntry.tagCounts, perSegment: temporal.perSegment } : temporal;
    }

    var loopResult = phase1Loop.runPhase1Loop(workingState, segTemporal, trkSegIndex, resolvedParams);
    allPassLogs.push({
      trkSegIndex: trkSegIndex,
      exitReason:  loopResult.exitReason,
      passes:      loopResult.passLog
    });
  }

  // Recompute final spine intervals after Phase 1
  allSpineIntervals = spineModule.computeSpineIntervals(workingState.workingOrderedPoints);

  // ── Phase 2: Edge reconciliation ──────────────────────────────────────────
  edgeRecon.runEdgeReconciliation(workingState, allSpineIntervals, segmentBoundaries);

  // ── Phase 3: Residual diagnostic sweep ────────────────────────────────────
  var residualAnnotations = residualSweep.runResidualDiagnosticSweep(workingState, allSpineIntervals);
  for (var ra = 0; ra < residualAnnotations.length; ra++) {
    workingStateModule.addAnnotation(workingState, residualAnnotations[ra]);
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  return correctionExport.buildCorrectionExport(
    workingState,
    allSpineIntervals,
    allCoupledRegions,
    allOverlapBlockResolution,
    allPassLogs
  );
}

module.exports = { runCorrection };
