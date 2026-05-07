# ADR-correction-0006: Overlap vs referential coupling; block reorder kinematic guard

**Date**: 2026-04-13 (revised 2026-04-20, revised 2026-04-23)  
**Status**: accepted **(revised)**  

## Context

**Temporal overlap** (two+ incompatible time stories for a stretch) and **referential coupling** (two **distinct** corrections whose neighbourhoods depend on each other) were easy to conflate under informal “secondary overlap” wording.

**Chunk reorder** must **not** evaluate **socket** using **only** the misplaced slab’s **immediate** `workingOrderedPoints` neighbours when those neighbours can still be **`belowAnchor`** or part of the **same** fault — that would reduce to **in-slab** sorting, not **true** chunk placement. **Brackets** (`t_prev`, `t_next`) must be chosen with **outside-the-run** and/or **`correction.spineIntervals`** policy (**`implementation_plan.md`** § **Bracket vs socket**, § **Block overlap**).

**Closed socket — structural guard:** The numeric predicate (**`B_min ≥ t_prev`**, **`B_max ≤ t_next`**) is necessary but **not sufficient**. The corridor between the bracket anchors must contain **no spine-trusted points** from **`correction.spineIntervals`** whose **`timeMs`** falls strictly inside **`(t_prev, t_next)`** and whose **`gpxIndex`** is not a member of the block. If any such point exists, the corridor is already occupied by the forward story — it is a forward-story interval, not a real inter-spine gap. The socket fails regardless of numeric fit. The user’s formulation: "the socket doesn’t refer to a gap found from 2 spine intervals, the max of one spine and min of next spine" — the numeric window is not the same as a real inter-spine gap (**`implementation_plan.md`** § **Block overlap**, step 4a).

**`block-proposal`** emits **`block-finding`** (run span + **internal monotonicity** only). **`overlap-detection`** computes **`B_min`/`B_max`**, **brackets**, **closed socket** (**`B_min ≥ t_prev`**, **`B_max ≤ t_next`**), overlap vs **`socket-ok`**, and **`blockReorderPayload`** in **`correction.overlapBlockResolution[]`**. **`resolution-apply`** performs **`block-reorder`** only when **`socket-ok`**, **not** vetoed, **not** coupled (**AND** gate). **Equality** at bracket may yield **seam** duplicate-time → **`duplicate-proposal`** later (**segment / tether** — **ADR-correction-0009** when present).

**Lenient kinematic** at bracket edges is **rejected** for the **block** path (MVP).

**Non-adjacent** same instant **100% exact** duplicates are **duplicate** semantics, not singleton backtrack inserts.

**Overlap vs duplicate clustering:** **`overlap-detection`** flags **conflicting time narratives**; it **does not** decide **which** indices share a **duplicate** kinematic competition pool (**`duplicate-proposal`** owns that).

## Decision

1. **Overlap (correction sense):** time overlap / conflicting narratives for a **`block-finding`** or other region → **`overlap.block`** + **`overlapDiagnostics`**; **flag + mask**; **no** **`block-reorder`** for that **`findingId`**. **Partial** overlap is **not** a separate “salvage” path in MVP. **Bracket touch** alone is **not** automatic overlap — policy distinguishes **harmless** touch + **duplicate-owned** seam vs **two incompatible stories** (versioned in **`overlap-detection`**).

2. **Coupling:** **referential / neighbour** instability between **distinct** proposals — **`coupling-detection`**; **not** interval overlap as the edge definition; **not** one index with two labels (multi-label flags instead).

3. **Block reorder kinematic guard (revised 2026-04-23):** A kinematic guard runs on every `socket-ok` block **before** `resolution-apply` applies it. The guard uses the bracket anchor points (`prevAnchorPoint`, `nextAnchorPoint`) and the block's first/last points to compute `speedPrevKph` and `speedNextKph`. If either exceeds `lenientMaxImpliedSpeedKph` (default 80 kph) → **do not apply**; block member points → `excludedFromTrust` reason `block_kinematic_guard_failed`; annotation `block_reorder_kinematic_guard_failed` (proposal-scope). See ADR-correction-0015 for full guard metric, payload, and disposition policy. The prior wording ("no lenient kinematic for block path") is **revoked** as of 2026-04-23.

4. **Internal monotonicity:** Classified on **`block-finding`**; **no intra-block time retreat** vs **previous row inside the block**; the **first** point **may** have **`belowPrevValid`** when the predecessor is **outside** the run. **`overlap-detection`** handles seam / **`belowPrevValid`** vs **`socket-ok`** (**versioned**).

5. **Structural socket guard (corridor pierce-check):** After the numeric closed-socket test passes, query **`correction.spineIntervals`** for any spine-trusted point with **`timeMs ∈ (t_prev, t_next)`** and **`gpxIndex ∉ block.gpxIndexes[]`**. If any such point exists → **`status: 'overlap'`**; **`spinePointPierceDetected: true`** in **`overlapDiagnostics`**; emit **`overlap.block`** + **`overlap.spine_pierce_detected`**. The corridor is already occupied by the forward story; no real inter-spine gap exists at that location. (**`implementation_plan.md`** § **Block overlap**, step 4a; § **Cross-proposal footprint mapping**.)

5. **`duplicate.exact_group_unresolved`:** **100% exact** groups that are **not** stream-adjacent on **this** snapshot → **flag + mask**, **no** kinematic competition in MVP; **`adjacent-exact-drop`** (**ADR-correction-0004**) handles **stream-adjacent** exact pairs **every** multipass iteration.

## Alternatives Considered

### Alternative 1: Kinematic guard on perfect-fit block reorder *(adopted in 2026-04-23 revision)*

- **Original status**: Rejected for MVP block path.
- **Revised status (2026-04-23)**: Adopted. The original rejection was based on concern about bracket-edge noise vetoing correct reorders. On further analysis, the asymmetric risk is the opposite: silently applying a kinematically-bad block-reorder poisons every downstream layer. The guard threshold is lenient (80 kph) and the score metric (sum of squares of both bracket speeds) avoids firing on single-direction edge noise. See ADR-correction-0015.

### Alternative 2: Resolve partial overlap by splitting blocks in MVP

- **Pros**: More fixes shipped.
- **Cons**: Policy-heavy; honesty risk.
- **Why not**: **Deferred** post-MVP.

### Alternative 3: **`block-reorder`** emitted directly from **`block-proposal`** with socket from array neighbours

- **Pros**: Simpler runner.
- **Cons**: **Misleading** socket for misplaced slabs; not real chunk reorder.
- **Why not**: **Rejected** — **bracket/socket** owned by **`overlap-detection`**; **`block-finding`** only (**`implementation_plan.md`**).

## Consequences

### Positive

- Clear **vocabulary** for overlap vs coupling; **honest** chunk **bracket** semantics.

### Negative

- Block reorder kinematic guard (lenient 80 kph, sum-of-squares metric) may fire on false positives where both bracket speeds are legitimately high (e.g. long spine gap with correct fast travel). These cases will show up in annotations as `block_reorder_kinematic_guard_failed` and are excluded from trust — visible to investigation but not poisoning canonical.
- **`resolution-apply`** must **merge** **`block-finding`** + **`overlapBlockResolution`** + kinematic guard check before apply.

### Risks

- **Bracket** policy must be **tested** (file ends, spine gaps, maximal `belowAnchor` runs).
- **Closed** socket increases **boundary duplicate-time** density — **`overlap-detection`** must **not** treat every seam as **`overlap.block`**; **`duplicate-proposal`** must respect **segment / tether** rules (**ADR-correction-0009** when present).
