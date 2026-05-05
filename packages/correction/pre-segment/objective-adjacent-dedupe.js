'use strict';

/**
 * packages/correction/pre-segment/objective-adjacent-dedupe.js
 *
 * Initial deduplication pass — stream-adjacent only, pre-mutation
 * (ADR-correction-0014: before any mutation, stream-adjacent === traversal-adjacent).
 * Within ONE trkSegIndex only — raw stream-adjacent pairs across a <trkseg>
 * boundary are NOT recording duplicates.
 *
 * Equality table (plan §Adjacent dedupe equality table):
 *   Same timeMs (>0, finite) AND same lat AND same lon, plus the elevation table:
 *
 *   | ele situation                            | action                                  |
 *   |------------------------------------------|-----------------------------------------|
 *   | both exactly equal (incl. both absent)   | DROP curr; survivor keeps as-is.         |
 *   | both lack usable ele (null/absent OOB)   | DROP curr; survivor keeps null/absent.   |
 *   | exactly one has usable ele               | DROP the one without usable ele.         |
 *   | both finite but BOTH out-of-bounds       | DROP curr; survivor's ele set to null.   |
 *   | both have usable ele but values differ   | NO drop — emit annotation               |
 *   |                                          | 'adjacent_duplicate_ele_mismatch'        |
 *   |                                          | (proposal-scope, scopeRef.proposalId =  |
 *   |                                          | the keep gpxIndex synthetic ref).       |
 *
 * "Usable ele" = finite number AND validEleFloorM <= ele <= validEleCeilingM.
 *
 * This module:
 *   - Mutates workingState.workingOrderedPoints (drops the duplicate from the list).
 *   - Writes drops with reason 'adjacent-exact-duplicate'.
 *   - Writes proposal-scope annotations for ele-mismatch case.
 *   - Mutates a survivor's `ele` to null when both ele are OOB (per the table).
 */
var ws       = require('../state/working-state');
var defaults = require('../params/defaults');

function applyObjectiveAdjacentDedupe(workingState, params) {
  var stage = 'pre-segment-objective-dedupe';
  var floor = (params && typeof params.validEleFloorM === 'number')   ? params.validEleFloorM   : defaults.validEleFloorM;
  var ceil  = (params && typeof params.validEleCeilingM === 'number') ? params.validEleCeilingM : defaults.validEleCeilingM;

  var dropPairs = [];      // [{keep, drop}]
  var eleMismatches = [];  // [{aGpxIndex, bGpxIndex, trkSegIndex}]
  var oobBothSurvivors = []; // [gpxIndex] whose ele will be set to null

  var pts = workingState.workingOrderedPoints;
  for (var i = 1; i < pts.length; i++) {
    var prev = pts[i - 1];
    var curr = pts[i];

    // Stream-adjacent: gpxIndex+1
    if (curr.gpxIndex !== prev.gpxIndex + 1) continue;
    // Same segment hard wall.
    if (curr.trkSegIndex !== prev.trkSegIndex) continue;

    var bothTimes = (typeof prev.timeMs === 'number' && isFinite(prev.timeMs) && prev.timeMs > 0 &&
                     typeof curr.timeMs === 'number' && isFinite(curr.timeMs) && curr.timeMs > 0);
    if (!bothTimes) continue;
    if (prev.timeMs !== curr.timeMs) continue;

    if (prev.lat !== curr.lat || prev.lon !== curr.lon) continue;

    // Elevation table.
    var pe = classifyEle(prev, floor, ceil);
    var ce = classifyEle(curr, floor, ceil);

    if (pe.kind === 'usable' && ce.kind === 'usable') {
      if (pe.value === ce.value) {
        dropPairs.push({ keep: prev.gpxIndex, drop: curr.gpxIndex, trkSegIndex: prev.trkSegIndex });
      } else {
        // Mismatch — keep both, annotate.
        eleMismatches.push({
          aGpxIndex: prev.gpxIndex,
          bGpxIndex: curr.gpxIndex,
          trkSegIndex: prev.trkSegIndex,
          aEle: pe.value, bEle: ce.value
        });
      }
      continue;
    }

    if (pe.kind === 'absent' && ce.kind === 'absent') {
      // Both lack usable ele → drop curr; survivor keeps as-is.
      dropPairs.push({ keep: prev.gpxIndex, drop: curr.gpxIndex, trkSegIndex: prev.trkSegIndex });
      continue;
    }

    if (pe.kind === 'usable' && ce.kind === 'absent') {
      // Drop the one without usable ele (curr).
      dropPairs.push({ keep: prev.gpxIndex, drop: curr.gpxIndex, trkSegIndex: prev.trkSegIndex });
      continue;
    }
    if (pe.kind === 'absent' && ce.kind === 'usable') {
      // Drop the one without usable ele (prev).
      dropPairs.push({ keep: curr.gpxIndex, drop: prev.gpxIndex, trkSegIndex: prev.trkSegIndex });
      continue;
    }

    if (pe.kind === 'oob' && ce.kind === 'oob') {
      // Both finite but OOB → drop curr; survivor's ele := null.
      dropPairs.push({ keep: prev.gpxIndex, drop: curr.gpxIndex, trkSegIndex: prev.trkSegIndex });
      oobBothSurvivors.push(prev.gpxIndex);
      continue;
    }

    // Mixed usable/oob — treat OOB side as "absent" → drop the OOB side.
    if (pe.kind === 'usable' && ce.kind === 'oob') {
      dropPairs.push({ keep: prev.gpxIndex, drop: curr.gpxIndex, trkSegIndex: prev.trkSegIndex });
      continue;
    }
    if (pe.kind === 'oob' && ce.kind === 'usable') {
      dropPairs.push({ keep: curr.gpxIndex, drop: prev.gpxIndex, trkSegIndex: prev.trkSegIndex });
      continue;
    }
  }

  // Apply: mutate working state.
  // 1. Set survivor ele to null for OOB-both pairs (mutate point object).
  if (oobBothSurvivors.length > 0) {
    var survivorSet = new Set(oobBothSurvivors);
    for (var w = 0; w < workingState.workingOrderedPoints.length; w++) {
      if (survivorSet.has(workingState.workingOrderedPoints[w].gpxIndex)) {
        workingState.workingOrderedPoints[w].ele = null;
      }
    }
  }
  // 2. Record drops + remove from working order.
  var dropSet = new Set();
  for (var d = 0; d < dropPairs.length; d++) {
    var dr = dropPairs[d];
    ws.addDrop(workingState, dr.drop, 'adjacent-exact-duplicate', stage);
    dropSet.add(dr.drop);
  }
  if (dropSet.size > 0) {
    workingState.workingOrderedPoints = workingState.workingOrderedPoints.filter(function(p) {
      return !dropSet.has(p.gpxIndex);
    });
  }
  // 3. Annotate ele-mismatch pairs.
  for (var m = 0; m < eleMismatches.length; m++) {
    var em = eleMismatches[m];
    ws.addAnnotation(workingState, {
      scope:    'proposal',
      scopeRef: { proposalId: 'adjacent-pair:' + em.aGpxIndex + ':' + em.bGpxIndex,
                  trkSegIndex: em.trkSegIndex },
      kind:     'adjacent_duplicate_ele_mismatch',
      details:  { aGpxIndex: em.aGpxIndex, bGpxIndex: em.bGpxIndex,
                  aEle: em.aEle, bEle: em.bEle }
    });
  }

  return {
    droppedPairs: dropPairs,
    eleMismatches: eleMismatches,
    oobBothSurvivors: oobBothSurvivors
  };
}

function classifyEle(point, floor, ceil) {
  // Returns {kind:'usable'|'absent'|'oob', value:number|null}
  if (point.eleAbsent === true) return { kind: 'absent', value: null };
  var v = point.ele;
  if (v === null || v === undefined) return { kind: 'absent', value: null };
  if (typeof v !== 'number' || !isFinite(v)) return { kind: 'absent', value: null };
  if (v < floor || v > ceil) return { kind: 'oob', value: v };
  return { kind: 'usable', value: v };
}

module.exports = { applyObjectiveAdjacentDedupe };
