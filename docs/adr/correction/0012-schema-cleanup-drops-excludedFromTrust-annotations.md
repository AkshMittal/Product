# ADR-correction-0012: Schema cleanup — drops, excludedFromTrust, annotations

**Date**: 2026-04-23  
**Status**: accepted

## Context

Prior correction-layer schema proposals accumulated multiple overlapping collections:

- `correction.flags[]` — point-scope labels with mixed semantics (some were exclusion signals, some were diagnostic markers).
- `correction.masks[]` — bitfield or boolean array indicating which points to exclude from canonical processing; semantically redundant with `excludedFromTrust`.
- `correction.excludedFromTrust[]` — point-scope exclusion with reasons; the correct concept but incomplete reason enum.
- `correction.sessionFlags[]` — originally named "session flags" but scoped to session, segment, or proposal; the name implied session-only scope.

This created three problems:
1. Consumers had to check multiple collections to determine a point's trust status.
2. The flag/mask distinction was never enforced: any collection could be used to express exclusion.
3. `sessionFlags` was a misleading name for a multi-scope annotation collection.

Additionally, the kinematic guard decisions from ADR-correction-0015 required new reason and kind values in the enum.

## Decision

The correction output uses **exactly three point-or-proposal status collections**:

### 1. `correction.drops[]`

Points **physically removed** from all ordered traces. Absent from `fullOrderedPoints` and from `canonicalTrustedPoints`. Populated by:

- `objective-adjacent-dedupe` and per-pass `adjacent-exact-drop` (traversal-adjacent exact pairs).
- `deterministic-export-fix` (duplicate-chunk segment exclusion).

**Shape:**
```ts
interface Drop {
  gpxIndex: number;
  reason: DropReason;
  stage: string;  // 'objective-adjacent-dedupe' | 'edge-reconciliation' | 'deterministic-export-fix'
}

type DropReason =
  | 'adjacent-exact-duplicate'      // 100% identical adjacent twin
  | 'duplicate_chunk_segment';      // entire segment excluded by deterministic-export-fix
```

`drops` is append-only; once a `gpxIndex` is dropped it cannot appear in `excludedFromTrust`.

### 2. `correction.excludedFromTrust[]`

Points **kept in `fullOrderedPoints`** (visible in UI) but **omitted from `canonicalTrustedPoints`** (kinematic, smoothing, metrics do not see them). The exclusion list **is** the mask — no separate `masks[]` array exists.

**Shape:**
```ts
interface ExcludedFromTrust {
  gpxIndex: number;
  reasons: ExcludedReason[];   // one or more; a point may accumulate reasons across phases
  details?: object;            // kind-specific diagnostic payload (optional)
}

type ExcludedReason =
  // --- competition / duplicate ---
  | 'same_time_non_winner'           // lost kinematic competition among same-timeMs candidates
  | 'insert_competition_loser'       // non-winner in a multi-candidate Insert competition
  | 'exact_group_unresolved'         // non-adjacent identical group; MVP flag-only
  | 'cross_segment_duplicate'        // same timeMs in different trkSegIndex; structurally displaced

  // --- scope / envelope ---
  | 'out_of_segment_scope'           // proposal target outside segment envelope; not an edge proposal
  | 'edge_unresolved'                // Phase 2 double-unstable; staged proposal discarded

  // --- overlap ---
  | 'overlap_block_member'           // block hit overlap status (no reorder applied)

  // --- coupling ---
  | 'coupling_blocked_subject'       // kinematically sensitive proposal blocked by coupling; subject excluded

  // --- kinematic guard (single-subject gating) ---
  | 'block_kinematic_guard_failed'   // block-reorder socket-ok but kinematic guard failed; block not applied
  | 'insert_kinematic_guard_failed'  // insert length=1 kinematic guard failed; candidate not applied

  // --- reversal ---
  | 'reversal_unconfirmed_member'    // point inside a segment_reversal_unconfirmed segment

  // --- sampling ---
  | 'sampling_below_neighbour_baseline'; // sampling story too weak vs neighbour window
```

A point carries **all reasons** that accumulated across passes and phases. Multiple reasons are valid (e.g. a point may be `overlap_block_member` and `coupling_blocked_subject` simultaneously if it was involved in a blocked block that was also coupling-entangled).

### 3. `correction.annotations[]`

Formerly `correction.sessionFlags[]`. Renamed because the collection is not session-scoped — it covers session, segment, and proposal scope. **Annotations are diagnostic or UX context; they do not change trust status by themselves.** Trust is always `drops` or `excludedFromTrust`.

**Shape:**
```ts
interface Annotation {
  scope: 'session' | 'segment' | 'proposal';
  scopeRef: {
    trkSegIndex?: number;
    proposalId?: string;
  };
  kind: AnnotationKind;
  details?: object;  // kind-specific payload; kinematic annotations include KinematicCheck
}

type AnnotationKind =
  // --- session-scope ---
  | 'geometry-only'
  | 'timestamp-sparse'

  // --- segment-scope ---
  | 'is_fully_reversed'
  | 'segment_reversal_unconfirmed'
  | 'chunk_ordering_resolved'
  | 'duplicate_chunk_excluded'
  | 'segment_boundary_gap'
  | 'timestamp_discontinuity'
  | 'edge_coupling_unstable'
  | 'multipass_cap_hit'                        // segment exited with max-iterations

  // --- proposal-scope: overlap / coupling ---
  | 'overlap_block'
  | 'overlap_singleton_block_conflict'
  | 'overlap_singleton_singleton_conflict'
  | 'overlap_spine_pierce_detected'
  | 'overlap_bracket_missing'
  | 'block_internal_monotonicity_fail'
  | 'coupled_same_time_deferred'
  | 'coupled_reference_unstable'
  | 'adjacent_duplicate_ele_mismatch'

  // --- proposal-scope: kinematic guard outcomes ---
  | 'block_reorder_kinematic_guard_failed'      // block socket-ok; kinematic guard failed; not applied
  | 'insert_kinematic_guard_failed'             // insert length=1; kinematic guard failed; not applied
  | 'insert_competition_resolved'               // insert length≥2; winner selected by kinematic score
  | 'insert_competition_kinematic_guard_failed'; // insert length≥2; all candidates failed guard; fallback applied
```

Kinematic-outcome annotations carry a `details.kinematics` payload conforming to `KinematicCheck`:

```ts
interface KinematicCheck {
  speedPrevKph: number | null;
  speedNextKph: number | null;
  score: number | null;          // speedPrev² + speedNext² (sum of squares)
  thresholdKph: number;          // lenientMaxImpliedSpeedKph at time of check
  passed: boolean;
  failReason?: string;           // 'speed_prev_exceeded' | 'speed_next_exceeded' | 'both_exceeded' | 'no_bracket'
}
```

### Proposal additions — `applied` and `skipReason`

Every proposal in `correction.proposals[]` gains:

```ts
interface ProposalBase {
  id: string;
  kind: ProposalKind;
  trkSegIndex: number;
  isEdgeProposal?: boolean;
  applied: boolean;        // true if resolution-apply applied this proposal
  skipReason?: SkipReason; // set when applied=false and the skip was definitive (not just gated this pass)
}

type SkipReason =
  | 'kinematic_guard_failed'   // single-subject guard failure (block-reorder / insert length=1)
  | 'overlap_vetoed'           // overlap-detection vetoed
  | 'coupling_blocked'         // coupling-detection blocked (all passes)
  | 'edge_unresolved';         // Phase 2 double-unstable
```

`skipReason` is set on the **final** proposal record at export time (after all passes complete). A proposal that was coupling-blocked on pass 3 but applied on pass 5 has `applied: true` and no `skipReason`.

### Unified `Insert` proposal kind

`singleton-insert`, `duplicate-reorder`, and `exact-group-flag-only` are unified into a single `insert` kind at the output schema level. The source modules (`singleton-proposal.js`, `duplicate-proposal.js`) may remain separate internally but both emit `insert` proposals:

```ts
interface InsertProposal extends ProposalBase {
  kind: 'insert';
  targetTimeMs: number;
  isExactGroup: boolean;              // geometry-identical group → no kinematic check; MVP = flag-only
  candidates: InsertCandidate[];      // length=1: single-subject; length≥2: competition
  winner?: InsertCandidate;           // set if applied=true (competition winner or single applied candidate)
}

interface InsertCandidate {
  gpxIndex: number;
  lat: number;
  lon: number;
  tPrev?: number;
  tNext?: number;
  bracketGpxIndexes?: number[];
  kinematics?: KinematicCheck;        // populated for non-exact-group candidates only
}
```

**Remaining proposal kinds (unchanged):**
- `block-finding` — emitted by `block-proposal.js`.
- `adjacent-exact-drop` — emitted by `duplicate-proposal.js`.

### What is removed

| Removed | Replaced by |
|---|---|
| `correction.flags[]` | `correction.annotations[]` (proposal/segment/session scope) + `correction.excludedFromTrust[]` (point scope) |
| `correction.masks[]` | `correction.excludedFromTrust[]` is the mask |
| `correction.sessionFlags[]` | `correction.annotations[]` |
| `overlapVetoedProposalIds[]` (exported) | `correction.proposals[].skipReason = 'overlap_vetoed'` |
| `couplingBlockedProposalIds[]` (exported) | `correction.proposals[].skipReason = 'coupling_blocked'` |
| `singleton-insert` proposal kind | `insert` with `candidates.length === 1`, `isExactGroup: false` |
| `duplicate-reorder` proposal kind | `insert` with `candidates.length >= 2`, `isExactGroup: false` |
| `exact-group-flag-only` proposal kind | `insert` with `isExactGroup: true`, `applied: false` |

`overlapVetoedProposalIds` and `couplingBlockedProposalIds` are still computed internally by `overlap-detection` and `coupling-detection` as runner state. They are **not exported** as top-level arrays; their information is encoded in each proposal's `applied` and `skipReason` fields plus proposal-scope annotations.

### Partition invariant

For every `gpxIndex` in `points` at correction input, exactly one of:
1. `gpxIndex ∈ correction.drops` — removed from all ordered traces.
2. `gpxIndex ∈ correction.excludedFromTrust` — in `fullOrderedPoints`; absent from `canonicalTrustedPoints`.
3. `gpxIndex ∈ canonicalTrustedPoints` — in `fullOrderedPoints`; trusted.

This invariant is checked at `correction-export` time. A violation is a defect.

## Alternatives Considered

### Alternative 1: Keep `sessionFlags` name

- **Why not:** Misleading. `sessionFlags` implies session-only scope; the collection covers session, segment, and proposal scope. `annotations` is accurate.

### Alternative 2: Keep separate `singleton-insert`, `duplicate-reorder`, `exact-group-flag-only` kinds

- **Why not:** They differ only by `candidates.length` and `isExactGroup`. The kinematic disposition is already defined in terms of these two dimensions (ADR-correction-0015). A unified `insert` kind with these two fields is strictly cleaner and eliminates the need to dispatch on three kind strings for the same logical operation.

### Alternative 3: Keep `flags[]` and `masks[]` as separate collections

- **Why not:** Semantically redundant. `excludedFromTrust` is the point-scope exclusion record. `annotations` is the diagnostic/context record. There is no third concept.

### Alternative 4: Multi-reason string vs separate entries per reason

- **Why not:** A single `ExcludedFromTrust` entry with a `reasons: string[]` array is correct — it is one record per point, not one record per reason. This avoids multiple `excludedFromTrust` entries for the same `gpxIndex` that must be joined by the consumer.

## Consequences

### Positive

- Consumers have one place to check for point trust status (`drops` or `excludedFromTrust`).
- Annotations are purely contextual — no implicit trust effect — making the semantics unambiguous.
- Unified `insert` kind simplifies kinematic guard dispatch (one kind, two booleans).
- `applied` and `skipReason` on proposals make the final state of every proposal inspectable without re-running logic.

### Negative

- Renaming `sessionFlags` → `annotations` is a breaking schema change for any consumer already reading `correction.sessionFlags`. (MVP scope: no external consumers yet; rename is low-cost.)
- Merging `singleton-insert`/`duplicate-reorder`/`exact-group-flag-only` into `insert` requires updating both emitting modules and all tests referencing the old kind strings.

### Risks

- `insert` with `candidates.length === 0` should be invalid but may appear if a proposal module emits an empty competition pool. `correction-export` must validate and log a defect if encountered.
