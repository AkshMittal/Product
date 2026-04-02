# ADR-0001: Sampling rate clustering is an audit artifact

**Date**: 2026-04-02  
**Status**: accepted  
**Deciders**: Product / pipeline owners

## Context

The sampling audit must characterize how often the device recorded points (inter-record time intervals) without smuggling in terrain or plausibility judgments. We needed a clear rule for whether clustering over positive time deltas belongs in the audit layer versus a downstream characterization layer.

## Decision

Clustering over consecutive positive time deltas (`Δt`) is **audit-legitimate** and is implemented in the sampling audit module. The algorithm uses the recording mechanism’s observable `Δt` population, an explicit fixed parameter (2% relative insertion threshold), and emits cluster structure without verdicts such as “good” or “bad” sampling.

## Alternatives Considered

### Alternative 1: Defer all clustering to a downstream “quality” layer
- **Pros**: Keeps audit output minimal.
- **Cons**: Loses a self-contained, reproducible summary of recording cadence that does not require external models.
- **Why not**: The input (set of `Δt` values) and parameter are sufficient for deterministic, observation-only clustering; the three audit legitimacy tests are satisfied.

### Alternative 2: Add policy thresholds (e.g. “acceptable cluster count”)
- **Pros**: Easier for casual consumers.
- **Cons**: Encodes interpretation in audit; same track could be “pass/fail” by hidden policy.
- **Why not**: Violates observation-only semantics; thresholds belong downstream.

## Consequences

### Positive
- Reproducible characterization of device write cadence from the stream alone.
- Clear separation: audit reports structure, not fitness of the athlete or device.

### Negative
- Consumers must not treat cluster count as a quality score without explicit downstream rules.

### Risks
- **Risk**: Mis-reading cluster statistics as verdicts. **Mitigation**: Document in module spec and glossary that outputs are non-normative.

**Cross-references**: [`../../project/pipeline/sampling-audit.md`](../../project/pipeline/sampling-audit.md)
