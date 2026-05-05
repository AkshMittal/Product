'use strict';

/**
 * packages/correction/state/working-state.js
 *
 * Mutable working state threaded through the correction pipeline.
 * Holds the four output collections (ADR-correction-0012) and the mutable point list:
 *
 *   workingOrderedPoints  Array<Point>  — current traversal order (mutated by pipeline)
 *   drops                 Array<Drop>   — { gpxIndex, reason, stage }; reason ∈ DROP_REASONS
 *   excludedFromTrust     Array<Excl>   — { gpxIndex, reasons:[], details? }; UPSERTED per gpxIndex
 *   annotations           Array<Annot>  — { scope, scopeRef, kind, details? }
 *   rearrangements        Array<Rearr>  — { kind, passIndex, trkSegIndex, gpxIndexes, stage, ... }
 *   stagedEdgeProposals   Map<segIdx, { lastEdge?, firstEdge? }> — edge proposals deferred to Phase 2
 *
 * Adjacency is computed from workingOrderedPoints on every read (ADR-correction-0014).
 *
 * All mutators validate inputs against ADR-0012 schema enums.
 */

var enums = require('./schema-enums');

/**
 * Creates a fresh working state for one correction run.
 * @param {Array<Object>} points - accepted GPX points (cloned, not mutated by reference).
 * @returns {Object} workingState
 */
function createWorkingState(points) {
  return {
    workingOrderedPoints: points.slice(),
    drops: [],
    excludedFromTrust: [],
    annotations: [],
    rearrangements: [],
    stagedEdgeProposals: new Map(),
    proposals: [],          // accumulator across passes (final list, with applied/skipReason)
    /**
     * gpxIndexes of points whose pre-correction anomaly tag (audit's belowAnchor
     * etc.) has been resolved by a successful apply. Proposal builders consult
     * this set to avoid re-emitting proposals for already-resolved anomalies on
     * subsequent multipass iterations. Survivors of a competition (the winner)
     * AND every member of a successfully-reordered block live here.
     */
    resolvedAnomalies: new Set(),
    passNumber: 0
  };
}

/**
 * Mark a gpxIndex as having had its anomaly tag resolved by a successful apply.
 * Used by resolution-apply on apply-success paths to break the multipass loop
 * for points whose audit tag (computed from the original ordering) persists
 * after correction.
 */
function markAnomalyResolved(state, gpxIndex) {
  state.resolvedAnomalies.add(gpxIndex);
}

// ── drops[] ─────────────────────────────────────────────────────────────────
/**
 * Add a drop record. Validates reason against ADR-0012 DropReason enum.
 * @param {Object} state
 * @param {number} gpxIndex
 * @param {string} reason   - one of enums.DROP_REASONS
 * @param {string} stage    - e.g. 'pre-segment-objective-dedupe', 'phase1_pass_3', 'edge-reconciliation'
 */
function addDrop(state, gpxIndex, reason, stage) {
  enums.assertDropReason(reason);
  state.drops.push({ gpxIndex: gpxIndex, reason: reason, stage: stage });
}

// ── excludedFromTrust[] ─────────────────────────────────────────────────────
/**
 * Upsert an excludedFromTrust entry. ADR-0012: one entry per gpxIndex with reasons[] array.
 * Idempotent on (gpxIndex, reason): adding the same reason twice is a no-op.
 * @param {Object} state
 * @param {number} gpxIndex
 * @param {string} reason   - one of enums.EXCLUDED_REASONS
 * @param {Object} [details] - optional structured details (merged shallow)
 */
function addExcludedFromTrust(state, gpxIndex, reason, details) {
  enums.assertExcludedReason(reason);
  var existing = null;
  for (var i = 0; i < state.excludedFromTrust.length; i++) {
    if (state.excludedFromTrust[i].gpxIndex === gpxIndex) {
      existing = state.excludedFromTrust[i];
      break;
    }
  }
  if (!existing) {
    existing = { gpxIndex: gpxIndex, reasons: [reason] };
    state.excludedFromTrust.push(existing);
  } else {
    if (existing.reasons.indexOf(reason) < 0) {
      existing.reasons.push(reason);
    }
  }
  if (details) {
    existing.details = Object.assign({}, existing.details || {}, details);
  }
}

// ── annotations[] ───────────────────────────────────────────────────────────
/**
 * Add an annotation. ADR-0012 shape: { scope, scopeRef:{trkSegIndex?, proposalId?}, kind, details? }.
 * @param {Object} state
 * @param {Object} annotation
 */
function addAnnotation(state, annotation) {
  if (!annotation || typeof annotation !== 'object') {
    throw new Error('annotation must be an object');
  }
  if (!annotation.scope) throw new Error('annotation.scope required');
  if (!annotation.kind)  throw new Error('annotation.kind required');
  enums.assertAnnotationKind(annotation.scope, annotation.kind);
  // Normalize scopeRef
  var scopeRef = annotation.scopeRef || {};
  state.annotations.push({
    scope:    annotation.scope,
    scopeRef: scopeRef,
    kind:     annotation.kind,
    details:  annotation.details
  });
}

// ── rearrangements[] ────────────────────────────────────────────────────────
/**
 * Append a rearrangement (mutation log) entry.
 * @param {Object} state
 * @param {Object} rearrangement   - { kind, passIndex?, trkSegIndex, gpxIndexes, stage, ...extra }
 */
function addRearrangement(state, rearrangement) {
  if (!rearrangement || typeof rearrangement !== 'object') {
    throw new Error('rearrangement must be an object');
  }
  if (!rearrangement.kind)  throw new Error('rearrangement.kind required');
  if (!rearrangement.stage) throw new Error('rearrangement.stage required');
  state.rearrangements.push(rearrangement);
}

// ── stagedEdgeProposals (per-segment, lastEdge / firstEdge) ─────────────────
/**
 * Stage an edge proposal for Phase 2 reconciliation.
 * @param {Object} state
 * @param {number} trkSegIndex
 * @param {'lastEdge'|'firstEdge'} side
 * @param {Object} proposal
 */
function stageEdgeProposal(state, trkSegIndex, side, proposal) {
  if (side !== 'lastEdge' && side !== 'firstEdge') {
    throw new Error('stageEdgeProposal: side must be lastEdge or firstEdge');
  }
  var entry = state.stagedEdgeProposals.get(trkSegIndex);
  if (!entry) {
    entry = { lastEdge: null, firstEdge: null };
    state.stagedEdgeProposals.set(trkSegIndex, entry);
  }
  entry[side] = proposal;
}

/**
 * Remove a gpxIndex from workingOrderedPoints (used by drop application only).
 * Returns true if removed; false if not present.
 */
function removeFromWorking(state, gpxIndex) {
  var before = state.workingOrderedPoints.length;
  state.workingOrderedPoints = state.workingOrderedPoints.filter(function(p) {
    return p.gpxIndex !== gpxIndex;
  });
  return state.workingOrderedPoints.length < before;
}

/**
 * Move a contiguous run of points (by their gpxIndexes, in current traversal order)
 * out of its current position and re-insert them just AFTER `afterGpxIndex` in the
 * traversal order. Used for block-reorder.
 * If `afterGpxIndex` is null, re-inserts at the very beginning of the list.
 * Throws if any of `gpxIndexes` is not currently in workingOrderedPoints.
 */
function relocateRunAfter(state, gpxIndexes, afterGpxIndex) {
  var pts = state.workingOrderedPoints;
  var setGi = new Set(gpxIndexes);
  var moved = [];
  var rest  = [];
  for (var i = 0; i < pts.length; i++) {
    if (setGi.has(pts[i].gpxIndex)) {
      moved.push(pts[i]);
    } else {
      rest.push(pts[i]);
    }
  }
  if (moved.length !== gpxIndexes.length) {
    throw new Error('relocateRunAfter: not all gpxIndexes present in working list');
  }
  // Sort `moved` to follow input order (the caller provides the desired ordering).
  var orderMap = new Map();
  for (var k = 0; k < gpxIndexes.length; k++) orderMap.set(gpxIndexes[k], k);
  moved.sort(function(a, b) { return orderMap.get(a.gpxIndex) - orderMap.get(b.gpxIndex); });

  // Find insertion index in `rest`
  var insertAt;
  if (afterGpxIndex === null || afterGpxIndex === undefined) {
    insertAt = 0;
  } else {
    insertAt = -1;
    for (var j = 0; j < rest.length; j++) {
      if (rest[j].gpxIndex === afterGpxIndex) { insertAt = j + 1; break; }
    }
    if (insertAt < 0) {
      throw new Error('relocateRunAfter: afterGpxIndex not found in remaining points');
    }
  }
  state.workingOrderedPoints = rest.slice(0, insertAt).concat(moved).concat(rest.slice(insertAt));
}

/**
 * Move a single point (`movedGpxIndex`) so it appears immediately AFTER `afterGpxIndex`
 * in workingOrderedPoints. If `afterGpxIndex` is null, place at the start.
 */
function relocatePointAfter(state, movedGpxIndex, afterGpxIndex) {
  relocateRunAfter(state, [movedGpxIndex], afterGpxIndex);
}

module.exports = {
  createWorkingState,
  markAnomalyResolved,
  addDrop, addExcludedFromTrust, addAnnotation, addRearrangement,
  stageEdgeProposal,
  removeFromWorking, relocateRunAfter, relocatePointAfter
};
