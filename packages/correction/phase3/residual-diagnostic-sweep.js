'use strict';

/**
 * packages/correction/phase3/residual-diagnostic-sweep.js
 *
 * Phase 3: full canonical-traversal residual diagnostic sweep.
 * Observation-only — no mutations. Produces a structured `diagnostics` payload
 * that correction-export attaches to `correction.json` (plan §Phase 3,
 * ADR-correction-0011 / ADR-correction-0012).
 *
 * What it surfaces:
 *
 *   1. residualBelowAnchor[] — gpxIndexes where, in the FINAL workingOrderedPoints
 *      traversal, the previous same-segment neighbour with a usable timeMs has
 *      a strictly greater timeMs (i.e. backward step that survived Phase 1+2).
 *
 *   2. residualNonMonotonicSegments[] — { trkSegIndex, violations } counting
 *      same-segment consecutive pairs where Δt <= 0.
 *
 *   3. residualSameTimeGroups[] — surviving groups of ≥2 points with identical
 *      positive timeMs in the SAME segment, after Phase 1+2 mutations.
 *      Coupled groups are flagged with annotation 'coupled_same_time_deferred'
 *      (proposal-scope … emitted only if the group still has a parent
 *      proposal; otherwise we emit segment-scope as raw diagnostics).
 *
 *   4. residualCrossSegmentSameTime[] — surviving same-time groups spanning
 *      ≥2 trkSegIndex values (these should normally have been moved to
 *      excludedFromTrust 'cross_segment_duplicate' by Phase 1's
 *      detectCrossSegmentDuplicates; if any survive, we surface them).
 *      Note: post-CR-04, detectCrossSegmentDuplicates drops these points
 *      (drops[] + removeFromWorking) so survivors here indicate a gap in
 *      pre-segment detection coverage.
 *
 *   5. coverage: { segments: number, totalPoints: number,
 *                  trustedSurvivingCount: number, droppedCount: number,
 *                  excludedCount: number }
 *
 * No annotations are written via working-state writers (Phase 3 is
 * observation-only); diagnostics live as a separate payload returned to the
 * runner and assembled into correction.json by correction-export.
 *
 * @param {Object} workingState
 * @param {{ spinePointsBySegment: Map<number, Array<Object>>,
 *           envelopeBySegment:    Map<number, Object> }} spineResult
 * @param {Array<Object>} segmentProfiles
 * @returns {Object} diagnostics payload (plain JSON-serializable)
 */
function runResidualDiagnosticSweep(workingState, spineResult, segmentProfiles) {
  var pts = workingState.workingOrderedPoints || [];
  var diagnostics = {
    residualBelowAnchor:           [],
    residualNonMonotonicSegments:  [],
    residualSameTimeGroups:        [],
    residualCrossSegmentSameTime:  [],
    coverage: null
  };

  if (pts.length === 0) {
    diagnostics.coverage = {
      segments: 0, totalPoints: 0,
      trustedSurvivingCount: 0, droppedCount: 0, excludedCount: 0
    };
    return diagnostics;
  }

  // Group by segment in current traversal order.
  var bySeg = new Map();
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    if (!bySeg.has(p.trkSegIndex)) bySeg.set(p.trkSegIndex, []);
    bySeg.get(p.trkSegIndex).push(p);
  }

  // (1) + (2): per-segment monotonicity / belowAnchor in final traversal.
  bySeg.forEach(function(arr, seg) {
    var violations = 0;
    var lastUsable = null;
    for (var k = 0; k < arr.length; k++) {
      var pt = arr[k];
      if (typeof pt.timeMs !== 'number' || !isFinite(pt.timeMs) || pt.timeMs <= 0) continue;
      if (lastUsable !== null) {
        if (pt.timeMs <= lastUsable.timeMs) {
          violations++;
          diagnostics.residualBelowAnchor.push({
            gpxIndex:        pt.gpxIndex,
            trkSegIndex:     seg,
            prevGpxIndex:    lastUsable.gpxIndex,
            prevTimeMs:      lastUsable.timeMs,
            timeMs:          pt.timeMs,
            deltaMs:         pt.timeMs - lastUsable.timeMs
          });
        }
      }
      lastUsable = pt;
    }
    if (violations > 0) {
      diagnostics.residualNonMonotonicSegments.push({
        trkSegIndex: seg,
        violations:  violations
      });
    }
  });

  // (3) + (4): same-time groups by (timeMs, segment) and (timeMs, multi-segment).
  var byTimeIntra = new Map(); // key = seg + '|' + timeMs → [pts]
  var byTimeAny   = new Map(); // key = timeMs → [pts]
  for (var j = 0; j < pts.length; j++) {
    var p2 = pts[j];
    if (typeof p2.timeMs !== 'number' || !isFinite(p2.timeMs) || p2.timeMs <= 0) continue;
    var keyIntra = p2.trkSegIndex + '|' + p2.timeMs;
    if (!byTimeIntra.has(keyIntra)) byTimeIntra.set(keyIntra, []);
    byTimeIntra.get(keyIntra).push(p2);
    if (!byTimeAny.has(p2.timeMs)) byTimeAny.set(p2.timeMs, []);
    byTimeAny.get(p2.timeMs).push(p2);
  }
  byTimeIntra.forEach(function(group, key) {
    if (group.length < 2) return;
    var parts = key.split('|');
    diagnostics.residualSameTimeGroups.push({
      trkSegIndex: Number(parts[0]),
      timeMs:      Number(parts[1]),
      gpxIndexes:  group.map(function(g) { return g.gpxIndex; })
    });
  });
  byTimeAny.forEach(function(group, t) {
    if (group.length < 2) return;
    var segs = new Set();
    group.forEach(function(g) { segs.add(g.trkSegIndex); });
    if (segs.size < 2) return;
    diagnostics.residualCrossSegmentSameTime.push({
      timeMs:        t,
      gpxIndexes:    group.map(function(g) { return g.gpxIndex; }),
      trkSegIndexes: Array.from(segs)
    });
  });

  // (5) Coverage summary — relies on the partition invariant we'll re-verify
  // at export time. Here we just count.
  var droppedSet = new Set((workingState.drops || []).map(function(d) { return d.gpxIndex; }));
  var excludedSet = new Set((workingState.excludedFromTrust || []).map(function(e) { return e.gpxIndex; }));
  // Trusted surviving = points still in workingOrderedPoints AND not in
  // excludedFromTrust (drops are already removed from working).
  var trustedSurviving = 0;
  for (var c = 0; c < pts.length; c++) {
    if (!excludedSet.has(pts[c].gpxIndex)) trustedSurviving++;
  }
  diagnostics.coverage = {
    segments:               bySeg.size,
    totalPoints:            pts.length + droppedSet.size, // drops are no longer in working
    trustedSurvivingCount:  trustedSurviving,
    droppedCount:           droppedSet.size,
    excludedCount:          excludedSet.size
  };

  return diagnostics;
}

module.exports = { runResidualDiagnosticSweep };
