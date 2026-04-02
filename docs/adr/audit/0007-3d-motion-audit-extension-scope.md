# ADR-0007: 3D motion observables live in motion audit extension

**Date**: 2026-04-02  
**Status**: accepted  
**Deciders**: Product / pipeline owners  

*Implementation of the extension is deferred until after elevation audit stabilizes.*

## Context

Vertical motion (`Δele / Δt`, 3D displacement and speed, inclination) ties elevation to horizontal kinematics. In mountain terrain, vertical change without horizontal context is misleading. The pipeline also rejects coordinate-less points, so valid `ele` implies valid `lat/lon`.

## Decision

3D motion observables (`Δele`, `3D_distance = √(Δd² + Δele²)`, `3D_speed`, `inclination_angle`, etc.) are emitted by an **extension** of the **motion audit** module — not a standalone vertical-only module.

For each forward-valid horizontal pair with both-valid elevation on both ends, the extension adds 3D and vertical observables. Coverage gap (missing ele on one or both ends) remains a first-class countable observable.

## Alternatives Considered

### Alternative 1: Standalone “vertical audit” package
- **Pros**: Organizes all `Δele` metrics in one place.
- **Cons**: Duplicates pair logic; splits speed from the same kinematic pairs motion already owns.
- **Why not**: 3D quantities are defined on motion pairs; elevation audit stays channel-pure.

## Consequences

### Positive
- Single place for `Δd`, `Δt`, and derived 3D scalars per pair.
- Honest reporting of “could not compute 3D” when ele missing.

### Negative
- Motion module complexity grows; must keep extension optional/clear in docs.

### Risks
- **Risk**: Extension delayed; consumers expect vertical speed early. **Mitigation**: Status noted in index; ADR-0006 defers vertical speed to here.

**Cross-references**: [`../../project/pipeline/motion-audit.md`](../../project/pipeline/motion-audit.md), elevation audit module
