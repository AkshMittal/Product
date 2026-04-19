# ADR-correction-0006: Overlap vs referential coupling; block reorder without kinematic (MVP)

**Date**: 2026-04-13  
**Status**: accepted **(revised)**  

## Context

**Temporal overlap** (two+ incompatible time stories for a stretch) and **referential coupling** (two **distinct** corrections whose neighbourhoods depend on each other) were easy to conflate under informal “secondary overlap” wording.

**Chunk reorder** must **not** evaluate **socket** using **only** the misplaced slab’s **immediate** `workingOrderedPoints` neighbours when those neighbours can still be **`belowAnchor`** or part of the **same** fault — that would reduce to **in-slab** sorting, not **true** chunk placement. **Brackets** (`t_prev`, `t_next`) must be chosen with **outside-the-run** and/or **`correction.spineIntervals`** policy (**`implementation_plan.md`** § **Bracket vs socket**, § **Block overlap**).

**`block-proposal`** emits **`block-finding`** (run span + **internal monotonicity** only). **`overlap-detection`** computes **`B_min`/`B_max`**, **brackets**, **closed socket** (**`B_min ≥ t_prev`**, **`B_max ≤ t_next`**), overlap vs **`socket-ok`**, and **`blockReorderPayload`** in **`correction.overlapBlockResolution[]`**. **`resolution-apply`** performs **`block-reorder`** only when **`socket-ok`**, **not** vetoed, **not** coupled (**AND** gate). **Equality** at bracket may yield **seam** duplicate-time → **`duplicate-proposal`** later (**segment / tether** — **ADR-correction-0009** when present).

**Lenient kinematic** at bracket edges is **rejected** for the **block** path (MVP).

**Non-adjacent** same instant **100% exact** duplicates are **duplicate** semantics, not singleton backtrack inserts.

**Overlap vs duplicate clustering:** **`overlap-detection`** flags **conflicting time narratives**; it **does not** decide **which** indices share a **duplicate** kinematic competition pool (**`duplicate-proposal`** owns that).

## Decision

1. **Overlap (correction sense):** time overlap / conflicting narratives for a **`block-finding`** or other region → **`overlap.block`** + **`overlapDiagnostics`**; **flag + mask**; **no** **`block-reorder`** for that **`findingId`**. **Partial** overlap is **not** a separate “salvage” path in MVP. **Bracket touch** alone is **not** automatic overlap — policy distinguishes **harmless** touch + **duplicate-owned** seam vs **two incompatible stories** (versioned in **`overlap-detection`**).

2. **Coupling:** **referential / neighbour** instability between **distinct** proposals — **`coupling-detection`**; **not** interval overlap as the edge definition; **not** one index with two labels (multi-label flags instead).

3. **Block reorder (MVP):** **No** lenient kinematic. **`block-proposal`** → **`block-finding`** only. **`overlap-detection`** → **`overlapBlockResolution`** (**brackets**, **socket**, **`blockReorderPayload`** when **`socket-ok`**). **`resolution-apply`** applies **`block-reorder`** from **overlap output** + **AND** gate (**ADR-correction-0001**, **0008**). **`Kinematic`** remains on **singleton-proposal** and **duplicate-proposal** where specified.

4. **Internal monotonicity:** Classified on **`block-finding`**; **no intra-block time retreat** vs **previous row inside the block**; the **first** point **may** have **`belowPrevValid`** when the predecessor is **outside** the run. **`overlap-detection`** handles seam / **`belowPrevValid`** vs **`socket-ok`** (**versioned**).

5. **`duplicate.exact_group_unresolved`:** **100% exact** groups that are **not** stream-adjacent on **this** snapshot → **flag + mask**, **no** kinematic competition in MVP; **`adjacent-exact-drop`** (**ADR-correction-0004**) handles **stream-adjacent** exact pairs **every** multipass iteration.

## Alternatives Considered

### Alternative 1: Kinematic guard on perfect-fit block reorder

- **Pros**: Catches implausible motion after move.
- **Cons**: Bracket-edge noise **vetoes** time-correct reorder.
- **Why not**: **Rejected** for MVP block path.

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

- Block reorder **without** kinematic may accept rare geometric outliers — accepted trade for MVP.
- **`resolution-apply`** must **merge** **`block-finding`** + **`overlapBlockResolution`**.

### Risks

- **Bracket** policy must be **tested** (file ends, spine gaps, maximal `belowAnchor` runs).
- **Closed** socket increases **boundary duplicate-time** density — **`overlap-detection`** must **not** treat every seam as **`overlap.block`**; **`duplicate-proposal`** must respect **segment / tether** rules (**ADR-correction-0009** when present).
