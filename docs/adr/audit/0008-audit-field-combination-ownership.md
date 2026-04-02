# ADR-0008: Which module owns each field combination

**Date**: 2026-04-02  
**Status**: accepted  
**Deciders**: Product / pipeline owners

## Context

Multiple audit modules touch time, space, and elevation. Without explicit ownership, duplicate metrics or contradictory definitions appear across modules.

## Decision

Field-combination ownership is fixed as follows:

| Field combination | Module | What it emits |
|---|---|---|
| `ele` alone | Elevation audit | Coverage, validity bounds, duplicate runs, delta statistics |
| `ele × ele` consecutive | Elevation audit | Raw `Δele` statistics, geometry-conditioned |
| `ele ∩ time` coverage | Elevation audit | Co-presence counts and ratios (no rates) |
| `Δt` (time deltas) | Sampling audit | Time sampling intervals, clustering |
| `Δd` geometry-conditioned | Sampling audit | Distance sampling intervals |
| `Δd` time-conditioned | Sampling audit | Time-gated distance deltas |
| `Δd / Δt` | Motion audit | Horizontal speed |
| `Δele / Δt` | Motion audit (extension) | Vertical rate |
| `√(Δd² + Δele²)` | Motion audit (extension) | 3D displacement |
| `√(Δd² + Δele²) / Δt` | Motion audit (extension) | 3D speed |
| Bearing, inclination per pair | Motion audit (extension) | Angular observables (lower priority) |

## Alternatives Considered

### Alternative 1: Sampling audit owns all deltas including `Δele`
- **Pros**: One “delta hub.”
- **Cons**: Elevates sampling’s role into channel semantics; blurs ADR-0006.
- **Why not**: Elevation channel statistics stay in elevation audit; sampling stays cadence + spatial step regimes.

## Consequences

### Positive
- Clear lookup table for implementers and reviewers.

### Negative
- Cross-module features (3D) require reading two specs.

### Risks
- **Risk**: New combination lacks a row. **Mitigation**: Amend this ADR with a new number if ownership shifts.

**Cross-references**: all audit module docs under [`../../project/pipeline/`](../../project/pipeline/)
