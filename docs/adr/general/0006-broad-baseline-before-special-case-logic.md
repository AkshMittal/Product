# ADR-0006: Broad baseline passes before GPX special-case logic

**Date**: 2026-04-13  
**Status**: accepted  
**Deciders**: Product / engineering  

## Context

GPX ingestion and downstream processing are dominated by **heterogeneity**: vendor quirks, partial or missing timestamps, duplicate instants, geometry-only tracks, sampling gaps, and overlapping failure modes. Without an explicit discipline, implementation pressure tends toward **front-loading special cases**—many conditional branches in one pass, implicit “fixes” mixed with observation, and behavior that is hard to test, review, or evolve.

That pattern increases the risk of silent policy in observational layers, regressions on ordinary files, and opaque coupling between unrelated edge behaviors.

## Decision

1. **Prefer broad, cheap, deterministic baseline work first**—passes that handle the **majority** of files with clear inputs/outputs and minimal branching.

2. **Defer special-case policy** to **explicit, scoped** stages or modules: documented (spec/ADR), covered by **targeted fixtures**, and **not** entangled with the baseline path as a growing nest of inline conditions.

3. **Escalation rule:** Add a special case only when a **stated** need exists (contract, metric correctness, product surface, or reproducible adversarial gap)—not preemptively for every anecdotal quirk.

4. **Layering:** Keep **observation** (audit) honest and general; push interpretive or corrective special cases to **post-audit** layers already separated by ADR-0002 and ADR-0005.

## Alternatives Considered

### Alternative 1: Encode most known GPX quirks in the first ingest/audit pass

- **Pros**: Fewer pipeline stages; some paths feel “complete” earlier.
- **Cons**: Baseline becomes unmaintainable; hard to tell observation from policy; tests explode; changes risk ordinary-track regressions.
- **Why not**: Rejected—violates separation of concerns and scales poorly with real-world variety.

### Alternative 2: A single “smart” unified resolver for anomalies

- **Pros**: One place to read for behavior.
- **Cons**: Hidden cross-talk between unrelated cases; difficult to prove determinism and to disable one policy without side effects.
- **Why not**: Rejected in favor of staged, dumb building blocks plus explicit coupling (see correction ADRs).

## Consequences

### Positive

- Baseline paths stay **reviewable** and **cheap to regression-test** at scale.
- Special cases remain **traceable** to rationale and fixtures.
- Aligns with observation-only audit and versioned correction.

### Negative

- Requires discipline in code review to resist “just one more `if`” in core passes.
- Some files need **multiple** stages to reach final state; orchestration must stay clear.

### Risks

- **Risk**: Urgent edge fixes bypass staging and erode the baseline. **Mitigation**: ADR/spec gate for new branches; adversarial fixtures; periodic refactors that push policy downward/outward from observation layers.
