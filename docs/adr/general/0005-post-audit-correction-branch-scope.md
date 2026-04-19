# ADR-0005: Post-audit correction branch — scope and audit boundary

**Date**: 2026-04-13  
**Status**: accepted  
**Deciders**: Product / engineering  

## Context

Work on the **correction** branch targets **post-audit** processing: objective correction / flagging, optional smoothing and geometry profiles, kinematic checks, and metric-ready outputs — **not** re-architecting audit unless new **observables** are deliberately required.

Without an explicit boundary, “cleanup” logic risks **causal interpretation** inside audit-shaped code or **silent repair** presented as raw truth.

## Decision

1. **Audit** (`packages/audit/pipeline/`) remains the **observation + export substrate** for the current ingest pass. Treat it as **stable** unless downstream needs **new fields** — then extend audit **deliberately** (schema/version, tests, short rationale).

2. **Correction** lives in **explicit, versioned** layers: parameters, masks, flags, proposals, coupling, rearrangements, provenance — **no silent repair** as immutable raw.

3. **Separation:** audit describes **what the stream shows**; correction and later layers encode **policy and assumptions**. Do not merge **causal interpretation** into audit modules; keep audit aligned with observation-only ADRs.

4. **Processing ADRs** for correction-specific choices live under **`docs/adr/correction/`**; cross-cutting product order remains **`docs/adr/general/0002`**.

## Alternatives Considered

### Alternative 1: Evolve audit in the same pass as correction

- **Pros**: One unified export pass.
- **Cons**: Blurs observation vs policy; harder adversarial regression.
- **Why not**: **Rejected**.

### Alternative 2: No versioned correction profile

- **Pros**: Faster prototyping.
- **Cons**: Non-reproducible outputs; poor provenance.
- **Why not**: **Rejected** — correction outputs must be **versioned** and **logged**.

## Consequences

### Positive

- Clear **review lens**: audit-philosophy vs numeric pipeline review for correction code.

### Negative

- Two **layers** to maintain and document.

### Risks

- **Second read-only audit pass** on `workingOrderedPoints` for gating must not mutate the **original** ingest audit payload.
