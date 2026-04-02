# ADR-0004: std(Δele) is not an audit artifact

**Date**: 2026-04-02  
**Status**: accepted  
**Deciders**: Product / pipeline owners

## Context

Spread metrics on consecutive elevation deltas tempt implementers to summarize “noise” in the elevation channel. Variance around a mean `Δele` conflates terrain trend with recording variability and requires sampling context to interpret — neither is inherent in the elevation stream alone.

## Decision

Standard deviation of consecutive elevation deltas (`std(Δele)`) is **not** emitted by the elevation audit module.

## Alternatives Considered

### Alternative 1: Emit std(Δele) with documented caveats
- **Pros**: Single number for simplistic dashboards.
- **Cons**: Strongly implies interpretability without detrending or sampling rate; confuses terrain gradient with noise.
- **Why not**: Not self-contained; needs another module’s `Δt` regime to mean anything.

### Alternative 2: Detrend elevation in audit before spread
- **Pros**: Cleaner separation of trend vs residual.
- **Cons**: Detrending is a processing choice, not an observation.
- **Why not**: Out of audit scope.

## Consequences

### Positive
- Audit stays free of reference-dependent spread metrics.
- Characterization layer can compute spread with full sampling and terrain context.

### Negative
- Consumers must compute spread downstream if needed.

### Risks
- **Risk**: Feature requests to “just add std.” **Mitigation**: Point to this ADR; emit min/max/max-abs/zero-run stats instead.

**What audit emits instead**: min `Δele`, max `Δele`, max absolute `Δele`, zero-delta count and run statistics, raw elevation range.

**Cross-references**: [`../../project/pipeline/sampling-audit.md`](../../project/pipeline/sampling-audit.md), elevation audit module
