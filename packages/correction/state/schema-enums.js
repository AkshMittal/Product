'use strict';

/**
 * packages/correction/state/schema-enums.js
 *
 * Locked enums + scope rules from ADR-correction-0011 and ADR-correction-0012.
 * Validators below are used by working-state writers and by correction-export
 * to enforce shape invariants at every mutation point.
 */

// ── Drop reasons (ADR-0012) ─────────────────────────────────────────────────
// Only two valid drop reasons.
var DROP_REASONS = Object.freeze({
  ADJACENT_EXACT_DUPLICATE:  'adjacent-exact-duplicate',
  DUPLICATE_CHUNK_SEGMENT:   'duplicate_chunk_segment',
  CROSS_SEGMENT_DUPLICATE:   'cross_segment_duplicate'
});
var DROP_REASON_SET = new Set(Object.values(DROP_REASONS));

// ── ExcludedFromTrust reasons (ADR-0012) ────────────────────────────────────
var EXCLUDED_REASONS = Object.freeze({
  SAME_TIME_NON_WINNER:         'same_time_non_winner',
  INSERT_COMPETITION_LOSER:     'insert_competition_loser',
  EXACT_GROUP_UNRESOLVED:       'exact_group_unresolved',
  OUT_OF_SEGMENT_SCOPE:         'out_of_segment_scope',
  EDGE_UNRESOLVED:              'edge_unresolved',
  EDGE_DEFERRED_STABLE:         'edge_deferred_stable',
  OVERLAP_BLOCK_MEMBER:         'overlap_block_member',
  COUPLING_BLOCKED_SUBJECT:     'coupling_blocked_subject',
  BLOCK_KINEMATIC_GUARD_FAILED: 'block_kinematic_guard_failed',
  INSERT_KINEMATIC_GUARD_FAILED:'insert_kinematic_guard_failed',
  SAMPLING_BELOW_NEIGHBOUR_BASELINE: 'sampling_below_neighbour_baseline',
  REVERSAL_UNCONFIRMED_MEMBER:  'reversal_unconfirmed_member'
});
var EXCLUDED_REASON_SET = new Set(Object.values(EXCLUDED_REASONS));

// ── Annotation kinds (ADR-0012) ─────────────────────────────────────────────
var SESSION_KINDS = Object.freeze([
  'geometry-only', 'timestamp-sparse', 'reversal_unconfirmed'
]);
var SEGMENT_KINDS = Object.freeze([
  'is_fully_reversed', 'segment_reversal_unconfirmed', 'chunk_ordering_resolved',
  'duplicate_chunk_excluded', 'segment_boundary_gap', 'timestamp_discontinuity',
  'edge_coupling_unstable', 'multipass_cap_hit'
]);
var PROPOSAL_KINDS = Object.freeze([
  // overlap / coupling
  'overlap_block', 'overlap_singleton_block_conflict', 'overlap_singleton_singleton_conflict',
  'overlap_spine_pierce_detected', 'overlap_bracket_missing',
  'block_internal_monotonicity_fail',
  'coupled_same_time_deferred', 'coupled_reference_unstable',
  'adjacent_duplicate_ele_mismatch',
  // apply success
  'block_reorder_applied', 'insert_applied',
  // kinematic
  'block_reorder_kinematic_guard_failed', 'insert_kinematic_guard_failed',
  'insert_competition_resolved', 'insert_competition_kinematic_guard_failed'
]);

var ANNOTATION_KIND_BY_SCOPE = Object.freeze({
  session:  new Set(SESSION_KINDS),
  segment:  new Set(SEGMENT_KINDS),
  proposal: new Set(PROPOSAL_KINDS)
});

// ── Phase 1 exit reasons (locked set) ───────────────────────────────────────
var PHASE1_EXIT_REASONS = Object.freeze({
  STABLE:         'stable',
  ALL_APPLIED:    'all_applied',
  STALEMATE:      'stalemate',
  NO_PROPOSALS:   'no_proposals',
  MAX_ITERATIONS: 'max_iterations'
});
var PHASE1_EXIT_SET = new Set(Object.values(PHASE1_EXIT_REASONS));

// ── Skip reasons on proposals (ADR-0012) ────────────────────────────────────
var PROPOSAL_SKIP_REASONS = Object.freeze({
  KINEMATIC_GUARD_FAILED: 'kinematic_guard_failed',
  OVERLAP_VETOED:         'overlap_vetoed',
  COUPLING_BLOCKED:       'coupling_blocked',
  EDGE_UNRESOLVED:        'edge_unresolved',
  OUT_OF_SEGMENT_SCOPE:   'out_of_segment_scope',
  EXACT_GROUP_FLAG_ONLY:  'exact_group_flag_only'
});
var PROPOSAL_SKIP_SET = new Set(Object.values(PROPOSAL_SKIP_REASONS));

// ── Validators ───────────────────────────────────────────────────────────────

function assertDropReason(reason) {
  if (!DROP_REASON_SET.has(reason)) {
    throw new Error('invalid drop reason: ' + reason);
  }
}

function assertExcludedReason(reason) {
  if (!EXCLUDED_REASON_SET.has(reason)) {
    throw new Error('invalid excludedFromTrust reason: ' + reason);
  }
}

function assertAnnotationKind(scope, kind) {
  var allowed = ANNOTATION_KIND_BY_SCOPE[scope];
  if (!allowed) throw new Error('invalid annotation scope: ' + scope);
  if (!allowed.has(kind)) {
    throw new Error('invalid annotation kind for scope=' + scope + ': ' + kind);
  }
}

function assertPhase1ExitReason(reason) {
  if (!PHASE1_EXIT_SET.has(reason)) {
    throw new Error('invalid phase 1 exit reason: ' + reason);
  }
}

function assertProposalSkipReason(reason) {
  if (!PROPOSAL_SKIP_SET.has(reason)) {
    throw new Error('invalid proposal skipReason: ' + reason);
  }
}

module.exports = {
  DROP_REASONS, DROP_REASON_SET,
  EXCLUDED_REASONS, EXCLUDED_REASON_SET,
  SESSION_KINDS, SEGMENT_KINDS, PROPOSAL_KINDS, ANNOTATION_KIND_BY_SCOPE,
  PHASE1_EXIT_REASONS, PHASE1_EXIT_SET,
  PROPOSAL_SKIP_REASONS, PROPOSAL_SKIP_SET,
  assertDropReason, assertExcludedReason, assertAnnotationKind,
  assertPhase1ExitReason, assertProposalSkipReason
};
