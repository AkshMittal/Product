'use strict';

/**
 * packages/correction/phase2/edge-reconciliation.js
 *
 * Phase 2 of the correction pipeline. Runs ONCE after every segment finishes
 * Phase 1. Reads the post-Phase-1 working snapshot, the per-segment staged edge
 * proposals (workingState.stagedEdgeProposals), and the boundary classifications
 * produced by deterministic-export-fix / boundary-classifier.
 *
 * Two responsibilities:
 *
 * (1) Cross-segment adjacent-exact-drop (ADR-correction-0014 §Cross-segment
 *     adjacent dedupe exception):
 *     For each consecutive (S_i, S_{i+1}) pair in traversal order, if
 *     S_i.lastPoint and S_{i+1}.firstPoint are exact duplicates (same timeMs,
 *     lat, lon, ele) AND both points are spine-stable (members of their
 *     segment's spine), drop S_{i+1}.firstPoint with reason
 *     'adjacent-exact-duplicate', stage 'edge-reconciliation'.
 *     Either point unstable → no drop; emit segment-scope annotation
 *     'edge_coupling_unstable' on the boundary so Phase 3 can flag it.
 *
 * (2) Staged-edge reconciliation (plan §Edge proposals + ADR-correction-0010):
 *     Each segment may carry up to two staged edge proposals (firstEdge /
 *     lastEdge) parked in Phase 1. Resolve them against the **boundary
 *     stability matrix**:
 *       - segment_boundary_gap      → boundary is unstable, edges on the
 *                                     boundary side cannot be applied; members
 *                                     → excludedFromTrust 'edge_unresolved';
 *                                     segment-scope annotation
 *                                     'edge_coupling_unstable'.
 *       - timestamp_discontinuity   → unstable (timezone shift); same as gap.
 *       - chunk_ordering_resolved   → stable AFTER reorder; edges admissible.
 *       - duplicate_chunk_excluded  → boundary side gone (segment was excluded);
 *                                     edges on that side become orphaned and
 *                                     excludedFromTrust 'edge_unresolved'.
 *       - no boundary on a side (segment is at session start/end) →
 *                                     unstable by default; edges
 *                                     excludedFromTrust 'edge_unresolved'.
 *     "Stable" edges (admissible side) are NOT physically applied in MVP — Phase
 *     2's MVP is to convert unstable edges into excludedFromTrust + annotations.
 *     Future work: actually apply stable edges via resolution-apply once the
 *     "Phase 2 mutation" surface is finalised.
 *
 * @param {Object} workingState
 * @param {{ spinePointsBySegment: Map<number, Array<Object>>,
 *           envelopeBySegment:    Map<number, Object> }} spineResult
 * @param {Array<Object>} boundaryClassifications - from boundary-classifier
 * @returns {{
 *   crossSegmentDrops: Array,
 *   edgesResolvedStable: Array,
 *   edgesResolvedUnstable: Array
 * }}
 */

var ws = require('../state/working-state');

function runEdgeReconciliation(workingState, spineResult, boundaryClassifications) {
  var spineMap = (spineResult && spineResult.spinePointsBySegment) || new Map();
  var classifications = boundaryClassifications || [];

  // Build a per-segment spine-membership lookup for stability tests.
  var spineMemberByGpx = new Set();
  spineMap.forEach(function(arr) { arr.forEach(function(p) { spineMemberByGpx.add(p.gpxIndex); }); });

  // Build a segIdx → segment-points map (post-Phase-1 working order).
  var segPoints = new Map();
  for (var i = 0; i < workingState.workingOrderedPoints.length; i++) {
    var p = workingState.workingOrderedPoints[i];
    if (!segPoints.has(p.trkSegIndex)) segPoints.set(p.trkSegIndex, []);
    segPoints.get(p.trkSegIndex).push(p);
  }

  // Sort segment indexes by traversal order (use first occurrence in workingOrderedPoints).
  var segOrder = [];
  var seen = new Set();
  for (var k = 0; k < workingState.workingOrderedPoints.length; k++) {
    var seg = workingState.workingOrderedPoints[k].trkSegIndex;
    if (!seen.has(seg)) { seen.add(seg); segOrder.push(seg); }
  }

  // Index boundaries by toTrkSegIndex for quick lookup.
  var boundaryByToSeg = new Map();
  var boundaryByFromSeg = new Map();
  classifications.forEach(function(b) {
    boundaryByToSeg.set(b.toTrkSegIndex, b);
    boundaryByFromSeg.set(b.fromTrkSegIndex, b);
  });

  // ── (1) Cross-segment adjacent-exact-drop ────────────────────────────────
  var excludedSet = new Set((workingState.excludedFromTrust || []).map(function(e) { return e.gpxIndex; }));
  var crossSegmentDrops = [];
  for (var s = 0; s < segOrder.length - 1; s++) {
    var prevSeg = segOrder[s];
    var nextSeg = segOrder[s + 1];
    var prevArr = segPoints.get(prevSeg) || [];
    var nextArr = segPoints.get(nextSeg) || [];
    if (prevArr.length === 0 || nextArr.length === 0) continue;
    var lastPt  = prevArr[prevArr.length - 1];
    var firstPt = nextArr[0];

    if (!isExactDuplicate(lastPt, firstPt)) continue;

    var bothStable = spineMemberByGpx.has(lastPt.gpxIndex) &&
                     spineMemberByGpx.has(firstPt.gpxIndex);
    if (!bothStable) {
      // Unstable boundary — emit annotation so Phase 3 can surface it.
      try {
        ws.addAnnotation(workingState, {
          scope:    'segment',
          scopeRef: { trkSegIndex: nextSeg },
          kind:     'edge_coupling_unstable',
          details: {
            reason:        'cross_segment_dup_unstable',
            fromGpxIndex:  lastPt.gpxIndex,
            toGpxIndex:    firstPt.gpxIndex,
            fromSpineStable: spineMemberByGpx.has(lastPt.gpxIndex),
            toSpineStable:   spineMemberByGpx.has(firstPt.gpxIndex)
          }
        });
      } catch (_e) { /* enum-safe */ }
      continue;
    }

    // Both stable — drop the next-segment first point, unless it was already
    // excluded pre-Phase-1 (detectCrossSegmentDuplicates excludes boundary pairs
    // before the multipass loop runs; dropping an already-excluded point violates
    // the partition invariant).
    if (excludedSet.has(firstPt.gpxIndex)) continue;
    ws.addDrop(workingState, firstPt.gpxIndex, 'adjacent-exact-duplicate', 'edge-reconciliation');
    ws.removeFromWorking(workingState, firstPt.gpxIndex);
    ws.addRearrangement(workingState, {
      kind:         'cross-segment-adjacent-drop',
      passIndex:    0,
      trkSegIndex:  nextSeg,
      stage:        'edge-reconciliation',
      gpxIndexes:   [firstPt.gpxIndex],
      keepGpxIndex: lastPt.gpxIndex
    });
    crossSegmentDrops.push({
      keepGpxIndex: lastPt.gpxIndex,
      dropGpxIndex: firstPt.gpxIndex,
      fromTrkSegIndex: prevSeg,
      toTrkSegIndex:   nextSeg
    });
  }

  // ── (2) Staged-edge reconciliation ───────────────────────────────────────
  var edgesResolvedStable   = [];
  var edgesResolvedUnstable = [];

  workingState.stagedEdgeProposals.forEach(function(slots, segIdx) {
    if (!slots) return;
    // firstEdge: stability depends on the boundary INCOMING to this segment
    if (slots.firstEdge) {
      var inB = boundaryByToSeg.get(segIdx) || null;
      var stable = isBoundaryStable(inB, /*isIncoming=*/true);
      if (stable) {
        edgesResolvedStable.push({ trkSegIndex: segIdx, side: 'firstEdge',
                                   proposalId: slots.firstEdge.id, boundary: inB });
        // MVP: leave applied=false but mark as deferred-stable; we don't mutate.
        slots.firstEdge.applied    = false;
        slots.firstEdge.skipReason = 'edge_unresolved';
        excludeEdgeMembers(slots.firstEdge, workingState, 'edge_unresolved',
          { reason: 'phase2_mvp_no_apply', boundary: inB || null });
      } else {
        unstableEdge(workingState, segIdx, 'firstEdge', slots.firstEdge, inB,
                     edgesResolvedUnstable);
      }
      workingState.proposals.push(slots.firstEdge);
    }
    // lastEdge: stability depends on the boundary OUTGOING from this segment
    if (slots.lastEdge) {
      var outB = boundaryByFromSeg.get(segIdx) || null;
      var stableOut = isBoundaryStable(outB, /*isIncoming=*/false);
      if (stableOut) {
        edgesResolvedStable.push({ trkSegIndex: segIdx, side: 'lastEdge',
                                   proposalId: slots.lastEdge.id, boundary: outB });
        slots.lastEdge.applied    = false;
        slots.lastEdge.skipReason = 'edge_unresolved';
        excludeEdgeMembers(slots.lastEdge, workingState, 'edge_unresolved',
          { reason: 'phase2_mvp_no_apply', boundary: outB || null });
      } else {
        unstableEdge(workingState, segIdx, 'lastEdge', slots.lastEdge, outB,
                     edgesResolvedUnstable);
      }
      workingState.proposals.push(slots.lastEdge);
    }
  });

  return {
    crossSegmentDrops:     crossSegmentDrops,
    edgesResolvedStable:   edgesResolvedStable,
    edgesResolvedUnstable: edgesResolvedUnstable
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function getEle(p) {
  if (p.eleAbsent === true) return null;
  if (p.ele === null || p.ele === undefined) return null;
  return p.ele;
}
function isExactDuplicate(a, b) {
  if (typeof a.timeMs !== 'number' || !isFinite(a.timeMs) || a.timeMs <= 0) return false;
  if (typeof b.timeMs !== 'number' || !isFinite(b.timeMs) || b.timeMs <= 0) return false;
  if (a.timeMs !== b.timeMs) return false;
  if (a.lat !== b.lat || a.lon !== b.lon) return false;
  return getEle(a) === getEle(b);
}

/**
 * Stability matrix:
 *   null boundary           → unstable (segment is at session edge)
 *   chunk_ordering          → stable  (resolved by deterministic-export-fix reorder)
 *   duplicate_chunk         → unstable (segment side gone)
 *   timestamp_discontinuity → unstable
 *   segment_boundary_gap    → unstable
 *   anything else           → unstable (defensive default)
 */
function isBoundaryStable(boundary /*, isIncoming */) {
  if (!boundary) return false;
  var c = boundary.classification;
  if (c === 'chunk_ordering') return true;
  return false;
}

function unstableEdge(workingState, segIdx, side, proposal, boundary, sink) {
  excludeEdgeMembers(proposal, workingState, 'edge_unresolved',
    { reason: 'phase2_unstable_boundary', side: side,
      boundaryClassification: boundary ? boundary.classification : null });
  proposal.applied    = false;
  proposal.skipReason = 'edge_unresolved';
  try {
    ws.addAnnotation(workingState, {
      scope:    'segment',
      scopeRef: { trkSegIndex: segIdx },
      kind:     'edge_coupling_unstable',
      details:  {
        side:                  side,
        proposalId:            proposal.id,
        boundaryClassification: boundary ? boundary.classification : null
      }
    });
  } catch (_e) { /* enum-safe */ }
  sink.push({ trkSegIndex: segIdx, side: side,
              proposalId: proposal.id, boundary: boundary });
}

function excludeEdgeMembers(proposal, workingState, reason, details) {
  var workingSet = new Set(workingState.workingOrderedPoints.map(function(p) { return p.gpxIndex; }));
  function mark(gi) {
    if (!workingSet.has(gi)) return;
    ws.addExcludedFromTrust(workingState, gi, reason,
      Object.assign({ proposalId: proposal.id }, details || {}));
  }
  if (proposal.kind === 'insert') {
    (proposal.candidateGpxIndexes || []).forEach(mark);
  } else if (proposal.kind === 'block-finding') {
    (proposal.gpxIndexes || []).forEach(mark);
  }
}

module.exports = { runEdgeReconciliation };
