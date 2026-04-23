'use strict';

/**
 * packages/correction/export/correction-export.js
 *
 * Assembles the final correction.json payload.
 *
 * Three collections (ADR-correction-0012):
 *   drops[]             — { gpxIndex, reason, stage }
 *   excludedFromTrust[] — { gpxIndex, reason, stage }
 *   annotations[]       — { kind, scope, gpxIndexes?, proposalId?, details? }
 *
 * Plus:
 *   spineIntervals[]       — per-segment spine-trusted point lists
 *   coupledRegions[]       — from coupling-detection
 *   overlapBlockResolution[] — from overlap-detection
 *   passLog[]              — per-pass exit reason and proposal counts
 *   survivingGpxIndexes[]  — gpxIndexes still in workingOrderedPoints (trusted)
 *
 * @param {Object} workingState
 * @param {Map<number, Array<Object>>} spineIntervals
 * @param {Array<Object>} coupledRegions
 * @param {Array<Object>} overlapBlockResolution
 * @param {Array<Object>} passLog  - array of { passNumber, exitReason, proposalCounts }
 * @returns {Object} correction payload
 */
function buildCorrectionExport(workingState, spineIntervals, coupledRegions, overlapBlockResolution, passLog) {
  // Convert spineIntervals map to array form
  var spineIntervalsArray = [];
  spineIntervals.forEach(function(points, trkSegIndex) {
    spineIntervalsArray.push({
      trkSegIndex: trkSegIndex,
      spinePoints: points.map(function(p) { return { gpxIndex: p.gpxIndex, timeMs: p.timeMs }; })
    });
  });
  spineIntervalsArray.sort(function(a, b) { return a.trkSegIndex - b.trkSegIndex; });

  var survivingGpxIndexes = workingState.workingOrderedPoints.map(function(p) { return p.gpxIndex; });

  return {
    metadata: {
      schemaVersion: '1.0.0',
      generatedAtUtc: new Date().toISOString()
    },
    drops:             workingState.drops,
    excludedFromTrust: workingState.excludedFromTrust,
    annotations:       workingState.annotations,
    spineIntervals:    spineIntervalsArray,
    coupledRegions:    coupledRegions || [],
    overlapBlockResolution: overlapBlockResolution || [],
    passLog:           passLog || [],
    survivingGpxIndexes: survivingGpxIndexes
  };
}

module.exports = { buildCorrectionExport };
