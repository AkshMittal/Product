# ADR-0005: Directional and vector variance are not audit artifacts

**Date**: 2026-04-02  
**Status**: accepted  
**Deciders**: Product / pipeline owners

## Context

Bearing changes, directional deviation, and variance in 3D speed sound like compact summaries of motion quality. They inherently need a reference for “expected” motion and easily imply **anomalous** segments — a verdict the audit layer avoids.

## Decision

Variance or clustering over bearing changes, directional deviation, or 3D speed variance is **not** part of the audit layer.

**Amendment (2026-04-03):** The motion audit does **not** emit computed per-pair kinematic scalars (bearing, inclination, 3D displacement, 3D speed, horizontal speed). It emits **label-based pair flags** only (`backwardTime`, `zeroTimeDelta`, `timeUnresolvable`, `nonFiniteDistance`, `eleUnresolvable`) for downstream exclusion. Distributional or variance summaries over those quantities remain out of audit; downstream computes kinematics on eligible pairs.

## Alternatives Considered

### Alternative 1: Plausibility thresholds in audit (max turn rate, etc.)
- **Pros**: Single-pass “flag bad segments.”
- **Cons**: Encodes terrain and activity assumptions; implies normative judgment.
- **Why not**: No terrain model in audit; belongs in kinematic plausibility layer.

### Alternative 2: Variance clusters with neutral naming
- **Pros**: Might feel observation-only.
- **Cons**: Cluster labels still read as “these segments differ” — downstream treats as verdict.
- **Why not**: Hard to emit without implied ranking of segments.

## Consequences

### Positive
- Clean separation: audit = mechanical pair flags, later layer = computed kinematics and plausibility vs reference motion.

### Negative
- Rich motion “quality” summaries require an additional pipeline stage.

### Risks
- **Risk**: Pressure to move thresholds into audit for convenience. **Mitigation**: This ADR; motion audit stays flag-only; no distributional clustering in audit.

**Cross-references**: motion audit module, [`../../project/objective-participation-and-quality.md`](../../project/objective-participation-and-quality.md)
