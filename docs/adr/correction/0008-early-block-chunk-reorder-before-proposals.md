# ADR-correction-0008: Proposal-fed overlap + coupling — **supersedes** early-only chunk apply

**Date**: 2026-04-13  
**Status**: accepted **(revised)**  

## Context

An earlier revision routed **perfect-fit chunk** through **`block-chunk-reorder`** **before** **singleton/duplicate** proposals so **referential coupling** would not **veto** socket-only chunk fixes.

Product direction **evolved**: **proposal modules** should **only** emit findings; **`overlap-detection`** and **`coupling-detection`** both **consume the same** **`correction.proposals[]`**; **`resolution-apply`** applies only what passes **both** gates (**AND**). **Chunk** is **`block-finding`** in **`proposals`**; **`overlap-detection`** emits **`overlapBlockResolution`** (**brackets**, **socket**, **`blockReorderPayload`**); **`resolution-apply`** performs **`block-reorder`** from that merge (**`implementation_plan.md`**).

## Decision (current)

1. **No** separate **`block-chunk-reorder`** stage before proposals.

2. **`block-proposal`**, **`singleton-proposal`**, **`duplicate-proposal`** run **first** (after early mutations), **read-only** on order.

3. **`overlap-detection`** and **`coupling-detection`** both take **`proposals`** (+ context).

4. **`resolution-apply`** applies **`applyable`** = **overlap-safe ∩ coupling-safe** in deterministic order (e.g. **`block-reorder`** from **`block-finding`+overlap → singleton → duplicate kinds**).

5. **Multipass:** **Rebuild** **`proposals`** and **recompute** **overlap** + **coupling** each iteration until **idle**, **stalemate**, **no proposals**, or **`multipassMaxIterations`** (**implementation_plan**).

6. **`correction.spineIntervals`:** built **after** **`reversal-check`**, **recomputed** after **mutating** **`resolution-apply`**, **shared** by proposal and detector modules.

## Alternatives Considered

### Alternative 1: Early **`block-chunk-reorder`** only (prior ADR-0008)

- **Pros**: Chunk **never** blocked by **singleton/duplicate** coupling graph.
- **Cons**: **Two** mutation points; chunk **outside** unified **proposal / AND-apply** story.
- **Why not**: **Superseded** by unified **proposal-fed** overlap + coupling (**implementation_plan**).

## Consequences

### Positive

- **Uniform** orchestration; **one** apply locus.

### Negative

- Must **tune** **overlap** and **coupling** so **socket-only** chunk is **not** incorrectly vetoed — **policy** and **tests**, not a **special** early stage.

### Risks

- **Conservative** overlap or coupling can still **block** chunk; mitigate with **explicit** rules in those modules (details **versioned**, not in this ADR).
