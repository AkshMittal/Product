'use strict';

/**
 * packages/correction/pre-segment/deterministic-export-fix.js
 *
 * Correction-owned classifier + applier for inter-segment boundary issues.
 * Replaces the legacy audit `export-fault-detection.js` per ADR-0013 / plan
 * §Deterministic export fix phase.
 *
 * Inputs (from audit output + boundary-classifier):
 *   - workingState         (mutable; this module mutates workingOrderedPoints
 *                          and writes drops/rearrangements/annotations)
 *   - boundaryClassifications (output of boundary-classifier.classifySegmentBoundaries)
 *   - segmentSummaries     (audit.ingestion.segmentSummaries[]) — for minTimeMs
 *                          ordering of chunks
 *   - segmentParticipationProfiles (mutated to mark excluded segments)
 *
 * Apply order (plan §Apply order):
 *   1. chunk_ordering          → reorder all affected segments by minTimeMs in a single
 *                                canonical pass; rearrangement kind 'segment-chunk-reorder';
 *                                annotation 'chunk_ordering_resolved' (segment-scope on each
 *                                moved segment).
 *   2. duplicate_chunk         → exclude later segment's points (drop reason
 *                                'duplicate_chunk_segment'); annotation
 *                                'duplicate_chunk_excluded' (segment-scope on the excluded
 *                                segment); profile.mode := 'geometry-only' with reason marker.
 *   3. timestamp_discontinuity → flag-only annotation 'timestamp_discontinuity'
 *                                (segment-scope on `to` segment) with details.suspectedTimezoneOffsetHours.
 *   4. segment_boundary_gap    → flag-only annotation 'segment_boundary_gap'
 *                                (segment-scope on `to` segment) with details.gapMs / impliedDistanceM /
 *                                impliedSpeedKph.
 *
 * @returns {{
 *   chunkReorders: Array, droppedSegments: number[],
 *   tzDiscontinuities: Array, gapAnnotations: Array
 * }} for runner introspection / tests
 */
var ws = require('../state/working-state');

function applyDeterministicExportFixes(workingState,
                                       boundaryClassifications,
                                       segmentSummaries,
                                       segmentParticipationProfiles) {
  var stage = 'deterministic-export-fix';
  var result = {
    chunkReorders: [],
    droppedSegments: [],
    tzDiscontinuities: [],
    gapAnnotations: []
  };

  if (!boundaryClassifications || boundaryClassifications.length === 0) {
    return result;
  }

  // Index segmentSummaries by trkSegIndex (or globalSegIndex) for minTimeMs lookup.
  var summaryBySeg = new Map();
  for (var s = 0; s < (segmentSummaries || []).length; s++) {
    var ss = segmentSummaries[s];
    var key = (ss.globalSegIndex !== undefined ? ss.globalSegIndex : ss.trkSegIndex);
    summaryBySeg.set(key, ss);
  }

  // Profile lookup (we mutate `mode` for excluded segments).
  var profileBySeg = new Map();
  for (var p = 0; p < (segmentParticipationProfiles || []).length; p++) {
    var pf = segmentParticipationProfiles[p];
    profileBySeg.set(pf.trkSegIndex, pf);
  }

  // ── 1) chunk_ordering: gather affected segments → canonical reorder by minTimeMs.
  var chunkOrderingSegs = new Set();
  for (var i = 0; i < boundaryClassifications.length; i++) {
    var b = boundaryClassifications[i];
    if (b.classification === 'chunk_ordering') {
      chunkOrderingSegs.add(b.fromTrkSegIndex);
      chunkOrderingSegs.add(b.toTrkSegIndex);
    }
  }
  if (chunkOrderingSegs.size > 0) {
    var affected = Array.from(chunkOrderingSegs).sort(function(a, b) { return a - b; });
    // Capture pre-reorder positions
    var preOrder = affected.slice();
    var sortedByMinTime = affected.slice().sort(function(a, b) {
      var aMin = (summaryBySeg.get(a) && summaryBySeg.get(a).minTimeMs);
      var bMin = (summaryBySeg.get(b) && summaryBySeg.get(b).minTimeMs);
      if (aMin === null || aMin === undefined) return 1;
      if (bMin === null || bMin === undefined) return -1;
      return aMin - bMin;
    });
    // Apply reorder iff order changed
    var changed = false;
    for (var k = 0; k < preOrder.length; k++) {
      if (preOrder[k] !== sortedByMinTime[k]) { changed = true; break; }
    }
    if (changed) {
      reorderSegmentsInPlace(workingState, sortedByMinTime);
      // Single rearrangement entry summarising the canonical pass.
      ws.addRearrangement(workingState, {
        kind: 'segment-chunk-reorder',
        passIndex: 0,
        stage: stage,
        affectedTrkSegIndexes: affected,
        newOrder: sortedByMinTime
      });
      // Annotation per moved segment (segment-scope).
      for (var m = 0; m < sortedByMinTime.length; m++) {
        if (preOrder[m] !== sortedByMinTime[m]) {
          ws.addAnnotation(workingState, {
            scope:    'segment',
            scopeRef: { trkSegIndex: sortedByMinTime[m] },
            kind:     'chunk_ordering_resolved',
            details:  { previousPosition: preOrder.indexOf(sortedByMinTime[m]),
                        newPosition: m,
                        affectedTrkSegIndexes: affected }
          });
        }
      }
      result.chunkReorders.push({ affected: affected, newOrder: sortedByMinTime });
    }
  }

  // ── 2) duplicate_chunk: exclude later segment's points.
  for (var d = 0; d < boundaryClassifications.length; d++) {
    var bd = boundaryClassifications[d];
    if (bd.classification !== 'duplicate_chunk') continue;
    var laterSeg = bd.toTrkSegIndex;
    var dropped = dropAllPointsInSegment(workingState, laterSeg, stage);
    result.droppedSegments.push(laterSeg);
    ws.addAnnotation(workingState, {
      scope:    'segment',
      scopeRef: { trkSegIndex: laterSeg },
      kind:     'duplicate_chunk_excluded',
      details:  {
        droppedGpxIndexes: dropped,
        adjacentToFromTrkSegIndex: bd.fromTrkSegIndex,
        impliedDistanceM: bd.impliedDistanceM,
        gapMs: bd.gapMs
      }
    });
    // Mark profile as geometry-only (no usable times) so downstream skips it.
    var prof = profileBySeg.get(laterSeg);
    if (prof) {
      prof.mode = 'geometry-only';
      prof.exitReason = 'duplicate-chunk-excluded';
      prof.correctionIdle = true;
    }
  }

  // ── 3) timestamp_discontinuity (flag-only, on `to` segment).
  for (var t = 0; t < boundaryClassifications.length; t++) {
    var bt = boundaryClassifications[t];
    if (bt.classification !== 'timestamp_discontinuity') continue;
    ws.addAnnotation(workingState, {
      scope:    'segment',
      scopeRef: { trkSegIndex: bt.toTrkSegIndex },
      kind:     'timestamp_discontinuity',
      details:  {
        fromTrkSegIndex: bt.fromTrkSegIndex,
        gapMs: bt.gapMs,
        suspectedTimezoneOffsetHours: bt.suspectedTimezoneOffsetHours
      }
    });
    result.tzDiscontinuities.push({
      fromTrkSegIndex: bt.fromTrkSegIndex,
      toTrkSegIndex:   bt.toTrkSegIndex,
      suspectedTimezoneOffsetHours: bt.suspectedTimezoneOffsetHours
    });
  }

  // ── 4) segment_boundary_gap (flag-only, every forward gap).
  for (var g = 0; g < boundaryClassifications.length; g++) {
    var bg = boundaryClassifications[g];
    if (!bg.isBoundaryGap) continue;
    ws.addAnnotation(workingState, {
      scope:    'segment',
      scopeRef: { trkSegIndex: bg.toTrkSegIndex },
      kind:     'segment_boundary_gap',
      details:  {
        fromTrkSegIndex:   bg.fromTrkSegIndex,
        gapMs:             bg.gapMs,
        impliedDistanceM:  bg.impliedDistanceM,
        impliedSpeedKph:   bg.impliedSpeedKph
      }
    });
    result.gapAnnotations.push({
      fromTrkSegIndex: bg.fromTrkSegIndex,
      toTrkSegIndex:   bg.toTrkSegIndex,
      gapMs: bg.gapMs
    });
  }

  return result;
}

// Reorder segments in workingOrderedPoints so the segments listed in `affected` appear
// in `newOrder`. Non-affected segments keep their absolute positions (we only permute
// the slots originally occupied by the affected segments).
function reorderSegmentsInPlace(state, newOrder) {
  var pts = state.workingOrderedPoints;

  // Group all points by segment, preserving stream order within each segment.
  var bySeg = new Map();
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    if (!bySeg.has(p.trkSegIndex)) bySeg.set(p.trkSegIndex, []);
    bySeg.get(p.trkSegIndex).push(p);
  }

  // Determine the segments in their original placement order (set of unique
  // trkSegIndexes in the order they first appear in pts).
  var originalSegOrder = [];
  var seenSegs = new Set();
  for (var j = 0; j < pts.length; j++) {
    var sg = pts[j].trkSegIndex;
    if (!seenSegs.has(sg)) { seenSegs.add(sg); originalSegOrder.push(sg); }
  }

  // Affected slot positions (positions in originalSegOrder occupied by `newOrder`'s set).
  var newOrderSet = new Set(newOrder);
  var affectedSlots = [];
  for (var k = 0; k < originalSegOrder.length; k++) {
    if (newOrderSet.has(originalSegOrder[k])) affectedSlots.push(k);
  }
  // Build a final segment order: replace each affected slot with newOrder[*] in turn.
  var finalSegOrder = originalSegOrder.slice();
  for (var s = 0; s < affectedSlots.length; s++) {
    finalSegOrder[affectedSlots[s]] = newOrder[s];
  }

  // Rebuild workingOrderedPoints
  var rebuilt = [];
  for (var f = 0; f < finalSegOrder.length; f++) {
    var segPts = bySeg.get(finalSegOrder[f]) || [];
    for (var pi = 0; pi < segPts.length; pi++) rebuilt.push(segPts[pi]);
  }
  state.workingOrderedPoints = rebuilt;
}

function dropAllPointsInSegment(state, trkSegIndex, stage) {
  var droppedGi = [];
  var keep = [];
  for (var i = 0; i < state.workingOrderedPoints.length; i++) {
    var p = state.workingOrderedPoints[i];
    if (p.trkSegIndex === trkSegIndex) {
      droppedGi.push(p.gpxIndex);
      ws.addDrop(state, p.gpxIndex, 'duplicate_chunk_segment', stage);
    } else {
      keep.push(p);
    }
  }
  state.workingOrderedPoints = keep;
  return droppedGi;
}

module.exports = { applyDeterministicExportFixes };
