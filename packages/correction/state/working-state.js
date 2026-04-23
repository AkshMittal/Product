'use strict';

/**
 * packages/correction/state/working-state.js
 *
 * Factory for the mutable working state threaded through the correction pipeline.
 * Holds the three output collections (ADR-correction-0012) and the mutable point list.
 *
 * Three collections (schema locked):
 *   drops[]             — { gpxIndex, reason, stage }
 *   excludedFromTrust[] — { gpxIndex, reason, stage }
 *   annotations[]       — { kind, scope, gpxIndexes?, proposalId?, details? }
 *
 * workingOrderedPoints — mutable copy of accepted points, ordered by the solver.
 *   Traversal adjacency is computed from this array on each pass (ADR-correction-0014).
 *   Must be invalidated (re-walked) after every mutation in resolution-apply.
 */

/**
 * Creates a fresh working state for one correction run.
 * @param {Array<Object>} points - Accepted GPX points from ingestion (not mutated; copied)
 * @returns {WorkingState}
 */
function createWorkingState(points) {
  return {
    /** Mutable ordered point list. Clone of input; mutated by resolution-apply each pass. */
    workingOrderedPoints: points.slice(),

    /** Points dropped from canonical (exact duplicates, etc.). ADR-correction-0012. */
    drops: [],

    /** Points excluded from trust but kept in stream. ADR-correction-0012. */
    excludedFromTrust: [],

    /** All annotations (renamed from sessionFlags). ADR-correction-0012. */
    annotations: [],

    /** Proposals accumulated across the current pass. Reset each pass. */
    proposals: [],

    /** Pass counter (1-based within segment). */
    passNumber: 0,
  };
}

/**
 * Adds a drop record.
 * @param {WorkingState} state
 * @param {number} gpxIndex
 * @param {string} reason  - e.g. 'adjacent_exact_duplicate'
 * @param {string} stage   - e.g. 'pre_segment' | 'phase1_pass_N'
 */
function addDrop(state, gpxIndex, reason, stage) {
  state.drops.push({ gpxIndex, reason, stage });
}

/**
 * Adds an excludedFromTrust record.
 * @param {WorkingState} state
 * @param {number} gpxIndex
 * @param {string} reason  - e.g. 'insert_kinematic_guard_failed'
 * @param {string} stage
 */
function addExcludedFromTrust(state, gpxIndex, reason, stage) {
  state.excludedFromTrust.push({ gpxIndex, reason, stage });
}

/**
 * Adds an annotation.
 * @param {WorkingState} state
 * @param {Object} annotation - Must include `kind` from the locked enum (ADR-correction-0012)
 */
function addAnnotation(state, annotation) {
  state.annotations.push(annotation);
}

module.exports = { createWorkingState, addDrop, addExcludedFromTrust, addAnnotation };
