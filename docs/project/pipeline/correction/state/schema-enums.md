<!-- generated-by: gsd-doc-writer -->
# schema-enums

**File:** `packages/correction/state/schema-enums.js`

## Overview

Locked enum sets and validator functions for every string-valued field in the correction schema. All values are frozen at module load. Validators throw on unrecognised values and are called at every mutation point by `working-state.js` writers.

Reference: ADR-correction-0011, ADR-correction-0012.

## Drop reasons

Only two valid values (`DROP_REASONS`):

| Value | Set by |
|---|---|
| `'adjacent-exact-duplicate'` | `resolution-apply.js`, `phase2/edge-reconciliation.js` |
| `'duplicate_chunk_segment'` | `pre-segment/deterministic-export-fix.js` |

Validated by: `assertDropReason(reason)`

## ExcludedFromTrust reasons

`EXCLUDED_REASONS` — 12 values:

| Value | Set by |
|---|---|
| `'same_time_non_winner'` | (reserved) |
| `'insert_competition_loser'` | `resolution-apply.js` — competition losers |
| `'exact_group_unresolved'` | `resolution-apply.js` — exact-group flag-only |
| `'cross_segment_duplicate'` | `duplicate-proposal.detectCrossSegmentDuplicates` |
| `'out_of_segment_scope'` | phase1-loop |
| `'edge_unresolved'` | `phase2/edge-reconciliation.js` |
| `'overlap_block_member'` | (reserved) |
| `'coupling_blocked_subject'` | (reserved) |
| `'block_kinematic_guard_failed'` | `resolution-apply.js` — block kinematic guard fail |
| `'insert_kinematic_guard_failed'` | `resolution-apply.js` — singleton kinematic guard fail |
| `'sampling_below_neighbour_baseline'` | (reserved) |
| `'reversal_unconfirmed_member'` | `pre-segment/reversal-check.js` |

Validated by: `assertExcludedReason(reason)`

## Annotation kinds

Scoped by `scope` field. Validated by: `assertAnnotationKind(scope, kind)`

### session scope (3 kinds)

| Kind | Emitted by |
|---|---|
| `'geometry-only'` | participation-check |
| `'timestamp-sparse'` | participation-check |
| `'reversal_unconfirmed'` | reversal-check |

### segment scope (8 kinds)

| Kind | Emitted by |
|---|---|
| `'is_fully_reversed'` | reversal-check |
| `'segment_reversal_unconfirmed'` | reversal-check |
| `'chunk_ordering_resolved'` | deterministic-export-fix |
| `'duplicate_chunk_excluded'` | deterministic-export-fix |
| `'segment_boundary_gap'` | deterministic-export-fix |
| `'timestamp_discontinuity'` | deterministic-export-fix |
| `'edge_coupling_unstable'` | phase2/edge-reconciliation |
| `'multipass_cap_hit'` | phase1-loop |

### proposal scope (13 kinds)

| Kind | Emitted by |
|---|---|
| `'overlap_block'` | overlap-detection |
| `'overlap_singleton_block_conflict'` | overlap-detection |
| `'overlap_singleton_singleton_conflict'` | overlap-detection |
| `'overlap_spine_pierce_detected'` | overlap-detection |
| `'overlap_bracket_missing'` | overlap-detection |
| `'block_internal_monotonicity_fail'` | overlap-detection |
| `'coupled_same_time_deferred'` | (reserved) |
| `'coupled_reference_unstable'` | (reserved) |
| `'adjacent_duplicate_ele_mismatch'` | (reserved) |
| `'block_reorder_applied'` | resolution-apply |
| `'insert_applied'` | resolution-apply |
| `'block_reorder_kinematic_guard_failed'` | resolution-apply |
| `'insert_kinematic_guard_failed'` | resolution-apply |
| `'insert_competition_resolved'` | resolution-apply |
| `'insert_competition_kinematic_guard_failed'` | resolution-apply |

## Phase 1 exit reasons

`PHASE1_EXIT_REASONS` — 5 values:

| Value | Meaning |
|---|---|
| `'stable'` | `correction-idle` predicate returned true |
| `'all_applied'` | All proposals applied in this pass |
| `'stalemate'` | No proposals were applied (but anomalies remain) |
| `'no_proposals'` | Proposal builders returned empty |
| `'max_iterations'` | Hit `multipassMaxIterations` cap (default 500) |

Validated by: `assertPhase1ExitReason(reason)`

## Proposal skipReason values

`PROPOSAL_SKIP_REASONS` — 6 values:

| Value | Set when |
|---|---|
| `'kinematic_guard_failed'` | Kinematic check failed (GATING disposition) |
| `'overlap_vetoed'` | Proposal vetoed by overlap-detection |
| `'coupling_blocked'` | Proposal blocked by coupling-detection |
| `'edge_unresolved'` | Edge proposal could not be resolved in Phase 2 |
| `'out_of_segment_scope'` | Proposal generated for wrong segment |
| `'exact_group_flag_only'` | Insert with `isExactGroup=true` (MVP, no mutation) |

Validated by: `assertProposalSkipReason(reason)`

## Related modules

- `state/working-state.js` — calls all validators at every mutation
- `export/correction-export.js` — enforces schema at export time
- `state/proposal-schema.js` — proposal factories and `assertValidProposal`
