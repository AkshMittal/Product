# ADR-correction-0009: Overlap-detection scope — cross-proposal footprint mapping

**Date**: 2026-04-20  
**Status**: accepted

## Context

The `overlap-detection` module's scope was implicitly bounded to the block path: compute `B_min`/`B_max`, brackets, and closed socket for each `block-finding`, plus a generic "for all proposal kinds, determine temporal vetoes." The duty statement never specified *what footprint* is extracted per kind, *how* footprints are compared across kinds, or *what the veto rule is* when a cross-kind collision is found.

Each proposal kind makes a distinct **temporal claim** over a region:

- **`block-finding`**: envelope `[B_min, B_max]` + bracket corridor after socket computation
- **`singleton-insert`**: target slot time + bracket neighbour times as claimed corridor
- **`duplicate-reorder`** / spine-contention (MVP+): contended spine region
- **`exact-group-flag-only`**: exact group's `timeMs` — observational, no active apply claim

Without explicit cross-proposal footprint mapping, two collision classes go undetected:

1. A **singleton-insert** landing inside a block-contended zone — the block is flagged for overlap but the singleton is never cross-checked against that block's envelope.
2. A **block-finding** envelope colliding with a **`duplicate-reorder`** spine region (MVP+ scenario) — neither proposal sees the other's footprint.

This ADR establishes that cross-kind footprint mapping is part of **`overlap-detection`**'s duty, and that the approach is **detect-and-veto** for MVP (no cross-kind resolution logic, multipass provides iterative recovery). It also distinguishes this from **`coupling-detection`**: footprint collision is a **temporal** claim conflict; coupling is a **referential dependency** between proposals.

See also: **ADR-correction-0006** (bracket/socket/pierce-check for the block path), **`implementation_plan.md`** § **Cross-proposal footprint mapping**.

## Decision

1. **`overlap-detection` owns the cross-proposal footprint map.** Every pass, for every proposal in `correction.proposals[]`, derive a temporal footprint per kind (table in **`implementation_plan.md`** § **Cross-proposal footprint mapping**). Map all footprints together and flag cross-kind collisions before emitting `overlapVetoedProposalIds`.

2. **Block path runs first within each pass.** Bracket selection and socket computation (including corridor pierce-check — **ADR-correction-0006**, decision 5) for all `block-finding` proposals completes before cross-kind footprint comparison. Singleton and duplicate footprints are evaluated against finalized block envelopes.

3. **MVP collision rules (detect-and-veto):**
   - **Singleton inside any block envelope (any socket status):** `singleton-insert` `targetTimeMs ∈ [B_min, B_max]` of **any** `block-finding` — `socket-ok`, `overlap`, or `no-bracket` — → veto **both**: `overlap.singleton_block_conflict` on the singleton; block-finding added to `overlapVetoedProposalIds` even when `overlapBlockResolution.status === 'socket-ok'` (status preserved in `overlapBlockResolution` for diagnostic honesty; apply-level veto is via `overlapVetoedProposalIds`). Record colliding singleton ids in `overlapDiagnostics[].singletonConflictIds` for the block. **Rationale:** Applying block-reorder first and evaluating the singleton next pass implicitly assumes the singleton's insertion would not change the socket — it would, because the singleton's `timeMs` falls inside the block's claimed corridor. Furthermore, multiple singletons collectively inside the same envelope could constitute block-level time contention that would destroy the socket entirely. MVP: no ordering assumptions across kinds on the same pass; detect the conflict, veto both, flag both.
   - **Block footprint intersects `duplicate-reorder` region (MVP+):** detect and veto both via `overlap.*` flags; resolution deferred (flag + mask; no partial apply).
   - **Two `singleton-insert` corridors overlap:** `overlap.singleton_singleton_conflict`; veto both unless one clearly contains the other (versioned edge policy).

4. **MVP: detect-and-veto only.** No cross-kind resolution logic in `overlap-detection`. The multipass loop provides cross-kind recovery: a `singleton-insert` or `block-finding` vetoed due to cross-kind conflict on pass *k* may become viable on pass *k+1* if the contended geometry resolves. The key guarantee is that no cross-kind ordering assumption is baked in — all contending proposals are vetoed together and re-evaluated on the next pass from a clean snapshot.

5. **Footprints are pass-local.** Recomputed every multipass iteration alongside `correction.proposals[]`. No persistent cross-pass footprint store.

6. **Not coupling.** Footprint collision = temporal claim conflict (`overlap-detection`). Referential dependency between proposals = `coupling-detection`. Both gates apply independently via the AND rule in `resolution-apply`.

## Alternatives Considered

### Alternative 1: Leave cross-kind vetoes implicit

Keep "for all proposal kinds, determine temporal vetoes" as sufficient specification.

- **Pros**: Smaller spec surface area.
- **Cons**: Implementation will inevitably special-case this without guidance; singleton proposals can slip through block-contended zones silently. Correctness gap is invisible in the spec.
- **Why not**: Unacceptable for MVP correctness.

### Alternative 2: Cross-kind footprint comparison in `resolution-apply`

Move the cross-kind veto logic into `resolution-apply` rather than `overlap-detection`.

- **Pros**: Keeps `overlap-detection` purely diagnostic for block-path.
- **Cons**: Mixes veto logic with apply logic; `resolution-apply` would need to inspect footprints rather than consume a clean `overlapVetoedProposalIds` list. Breaks the established separation: vetoes are `overlap-detection` output, apply gate is `resolution-apply` input.
- **Why not**: Established pipeline boundary is correct; moving this out would erode it.

### Alternative 3: Dedicated cross-kind resolver module (post-MVP)

Build a separate module that resolves cross-kind conflicts by preferring, for example, the block fix and re-evaluating the singleton after the block clears.

- **Pros**: Could handle complex partial-resolution strategies.
- **Cons**: Unnecessary for MVP — multipass already gives iterative recovery; adds complexity.
- **Why not**: Post-MVP. Multipass is sufficient.

## Consequences

### Positive

- `overlap-detection`'s scope is fully specified: every proposal kind contributes a footprint, all cross-kind collisions are detectable, `overlapVetoedProposalIds` is unambiguous in origin.
- Singleton proposals cannot land inside block-contended zones without being caught and flagged.
- The block-runs-first ordering constraint is explicit, preventing footprint comparison against unfinished block envelopes.

### Negative

- `overlap-detection` must handle `singleton-insert` and `duplicate-reorder` footprints in addition to the block path — more implementation surface.
- MVP+ (block vs `duplicate-reorder`) collision may produce stalemates if multipass cannot recover in `multipassMaxIterations` iterations — outcome is honest (stalemate exit) but may leave data flagged rather than resolved.

### Risks

- Footprint definition for `duplicate-reorder` spine-contention region is "MVP+ versioned" — must be pinned before implementing that proposal kind; until then the block vs duplicate-reorder collision rule is detect-only when `duplicate-reorder` proposals appear.
- Cross-kind veto correctness requires block path (bracket selection + socket) to finalize before cross-kind comparison — ordering must be enforced in `overlap-detection` implementation.
