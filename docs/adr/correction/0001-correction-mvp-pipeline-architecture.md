# ADR-correction-0001: MVP correction pipeline — spine, multipass, proposals, overlap, coupling, apply

**Date**: 2026-04-13  
**Status**: accepted  

## Context

**Singleton**, **duplicate**, and **block** corrections need a **clear** split: **what** each anomaly class **wants** (proposals) vs **whether** it is **safe** to apply (**temporal overlap** vs **referential coupling**). **Single-pass** apply is **insufficient** when **`block-reorder`** changes geometry so **overlap** / **singleton** stories **change**; **overlap** and **coupling** must be **recomputed** on the **new** `workingOrderedPoints`. **Spine intervals** give a **shared** forward-run partition **after reversal** and **after each mutating apply**.

**Proposal list growth:** Rebuilding **`correction.proposals[]`** each iteration may yield **new** proposal **instances** (same **kinds**) when an apply **unlocks** eligibility — e.g. **`duplicate-reorder`** at a **block–spine seam** after **`block-reorder`** (**`resolution-apply`**, **`overlapBlockResolution`** **`socket-ok`** — **ADR-correction-0006**, **`implementation_plan.md`**). That is **expected**, not a pipeline bug.

## Decision

**MVP runner shape:**

1. **Early mutations:** `participation-check`, `objective-adjacent-dedupe`, `reversal-check`.
2. **`spine-intervals`:** First build **after** `reversal-check`; **recompute** after each **mutating** `resolution-apply`.
3. **Multipass loop** (bounded by **`multipassMaxIterations`**): each iteration — **replace** `correction.proposals[]` via `block-proposal` → `singleton-proposal` → `duplicate-proposal`; **`overlap-detection`** (including **`overlapBlockResolution[]`** for **`block-finding`** rows — **ADR-correction-0006**) → **`coupling-detection`** → **`resolution-apply`** (**AND** gate). **Exit** on **idle** (`noCorrectionTemporalAnomalies`), **stalemate** (non-empty proposals but **empty** `applyable`), **empty proposals**, or **max iterations**.
4. **`correction-export`**.

Proposal modules **only** emit findings; **`overlap-detection`** and **`coupling-detection`** **do not** live inside them. **`overlap-detection`** does **not** own **duplicate** kinematic competition grouping (**`duplicate-proposal`**, **ADR-correction-0009** when present).

## Alternatives Considered

### Alternative 1: Single-pass proposal → overlap → coupling → apply

- **Pros**: One loop iteration; simpler runner.
- **Cons**: **Block** apply **unlocks** or **reclassifies** **singleton** / **overlap**; geometry after apply **invalidates** one-shot vetoes.
- **Why not**: **Rejected** — **multipass** with **recomputed** overlap, coupling, **proposals**, and **spine**.

### Alternative 2: Embed coupling or overlap inside proposal modules

- **Pros**: Fewer modules.
- **Cons**: Violates separation; hard to test; coupling and overlap **cross-cut** proposal kinds.
- **Why not**: **Rejected**.

## Consequences

### Positive

- **One** proposal list per pass; **two** permission layers; **one** apply stage per pass (**AND** gate); **spine** shared across consumers.

### Negative

- **More** CPU than single-pass; **multipassMaxIterations** and **deterministic** rebuild rules must be **tested**.

### Risks

- Under-detection in **either** layer → unsafe apply; **stalemate** with **unresolved** proposals — mitigate with conservative flags, **max-iterations** honesty, and fixtures.
- **Multipass diagnostics** (per-pass **`appliedProposalIds`**, optional **`passLog`**) recommended to catch **zombies**, **non-determinism**, and **proposal explosions** — see **`implementation_plan.md`** § Multipass diagnostics.
