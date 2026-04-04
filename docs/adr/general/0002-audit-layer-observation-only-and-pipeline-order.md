# ADR-0002: Audit layer remains observation-only; post-audit pipeline order

**Date**: 2026-04-02
**Status**: accepted
**Deciders**: Product / engineering (documented in `docs/project/product-roadmap.md`)

## Context

The system already ships rich, deterministic audits (time, sampling, motion, etc.) and a unified export contract. The product positioning is an **observation and audit layer**, not a correction engine that infers user intent or rewrites the stream in the same pass. Without explicit separation, “cleanup” logic tends to mix causality and interpretation into diagnostics, hides relevancy choices inside audit, and makes downstream metrics untrustworthy.

Constraints: emit objective, high-signal observables even when downstream layers are not built yet; keep audit outputs stable for adversarial validation and reproducibility; preserve strict separation between **what the data shows** and **what policy says to do about it**.

## Decision

**Audit** emits deterministic **observational** diagnostics derived from the GPX stream: descriptive, non-causal (report what happened, not why). Audit does not suppress outputs because a later layer might not use them; time- and distance-based sampling diagnostics both belong in audit; relevance filtering is a downstream concern.

**Post-audit pipeline order** is locked as:

`audit → objective data correction/flagging → interpretation → kinematic plausibility / advanced behavior checks`

Kinematic interpretation runs only on **explicitly valid** subsets, not as a first-pass cleanup. Correction focuses on definitional usability boundaries first; backtracking and discontinuities are handled with subtype-aware, conservative policies rather than one blanket “remove bad points” rule.

## Alternatives Considered

### Alternative 1: Audit emits only fields immediately consumed by the current UI

- **Pros**: Smaller payloads; less noise for implementers.
- **Cons**: Loses the contract as a complete observational record; relevancy drifts into audit logic; harder to iterate processing without rerunning ingestion semantics.
- **Why not**: Locked direction—audit should emit all deterministic observables that can be derived; downstream decides relevance.

### Alternative 2: Run kinematic / plausibility checks inside audit as primary cleaning

- **Pros**: Single pass; fewer pipeline stages.
- **Cons**: Collapses “observation” with “policy”; risks causal language and silent exclusion at the wrong layer; contradicts roadmap ordering.
- **Why not**: Explicitly rejected—kinematic checks belong after explicit valid subsets exist.

### Alternative 3: Treat all backtracking and jumps as corruption to auto-remove

- **Pros**: Simpler implementation; cleaner-looking tracks.
- **Cons**: Ignores valid recording gaps and spatial context; dishonest for mountain use cases; fights honesty-first principles.
- **Why not**: Rejected in favor of subtype-aware, conservative handling and explicit masks.

## Consequences

### Positive

- Clear mental model for contributors and future agents: audit = facts on the wire; later stages = masks, interpretation, policy.
- Stable, testable audit contract suitable for research and 12k-scale validation.
- Metrics can attach to declared valid regions without audit having pre-judged intent.

### Negative

- Larger audit surface area to maintain, document, and render in tooling.
- Product must invest in separate correction/interpretation layers rather than overloading audit.

### Risks

- **Risk**: New features sneak causal or “fixup” behavior into audit modules. **Mitigation**: Code review against audit philosophy skill/docs; keep glossary and ADRs visible to agents.
