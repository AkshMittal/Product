# ADR-0008: Which module owns each field combination

**Date**: 2026-04-02  
**Status**: accepted (amended 2026-04-03)  
**Deciders**: Product / pipeline owners

## Context

Multiple audit modules touch time, space, and elevation. Without explicit ownership, duplicate metrics or contradictory definitions appear across modules.

## Decision

Field-combination ownership is fixed as follows:

| Field combination | Module | What it emits |
|---|---|---|
| `ele` alone (point channel) | Elevation audit | Per-point tags: `missing`, `unparsable`, `outOfBounds`, `adjacentDuplicate`; `validElevationPointCount` |
| `ele × ele` consecutive | Downstream (optional) | Δele series / stats from raw `ele` + elevation labels — not audit payload |
| `ele ∩ time` coverage | Downstream (optional) | Intersect `audit.elevation.tagIndex` with `audit.temporal` by `gpxIndex` — not audit payload |
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
- **Why not**: Elevation audit stays **point labels** for the ele channel; sampling stays cadence + spatial step regimes; Δele aggregates belong downstream if needed.

## Consequences

### Positive
- Clear lookup table for implementers and reviewers.

### Negative
- Cross-module features (3D) require reading two specs.

### Risks
- **Risk**: New combination lacks a row. **Mitigation**: Amend this ADR with a new number if ownership shifts.

**Cross-references**: all audit module docs under [`../../project/pipeline/`](../../project/pipeline/)

---

## Amendment (2026-04-03)

**What changed:** The "what it emits" column for motion audit rows has been revised. The original table implied motion audit emits computed kinematic values. The redesign (label-based architecture, 2026-04-03) shifts emission of derived quantities downstream.

**Revised ownership model:**

| Field combination | Module | Audit emits | Downstream computes |
|---|---|---|---|
| `Δd / Δt` | Motion audit | `backwardTime`, `zeroTimeDelta`, `timeUnresolvable`, `nonFiniteDistance` tags | Horizontal speed, using eligible pairs from tagIndex |
| `Δele / Δt` | Motion audit (extension) | `eleUnresolvable` tag (+ time tags above) | Vertical rate, using eligible pairs |
| `√(Δd² + Δele²)` | Motion audit (extension) | `eleUnresolvable` tag | 3D displacement, using eligible pairs |
| `√(Δd² + Δele²) / Δt` | Motion audit (extension) | `eleUnresolvable` tag (+ time tags) | 3D speed, using eligible pairs |
| Bearing, inclination per pair | Motion audit (extension) | `eleUnresolvable` tag (for inclination) | Angular observables, using eligible pairs |

**What is unchanged:** Module ownership (which module is responsible for these computations and their eligibility rules) is unchanged. Motion audit remains the sole authority for determining whether a given adjacent pair is eligible for horizontal and 3D kinematic computation. Downstream must not invent its own eligibility rules for these field combinations — it uses the motion audit exclusion sets.
