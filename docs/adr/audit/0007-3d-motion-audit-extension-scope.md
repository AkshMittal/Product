# ADR-0007: 3D motion observables live in motion audit extension

**Date**: 2026-04-02  
**Status**: accepted (amended 2026-04-03)  
**Deciders**: Product / pipeline owners  

*Elevation audit is now stable. Motion audit emits 3D **eligibility** flags (`eleUnresolvable`, etc.); **computed** 3D scalars are downstream.*

## Context

Vertical motion (`Δele / Δt`, 3D displacement and speed, inclination) ties elevation to horizontal kinematics. In mountain terrain, vertical change without horizontal context is misleading. The pipeline also rejects coordinate-less points, so valid `ele` implies valid `lat/lon`. **Audit scope:** the motion module records **which adjacent pairs are eligible** (pair flags); **computed** 3D scalars are produced downstream from raw coordinates and elevation using those masks.

## Decision

3D motion **eligibility and definitions** are owned by the **motion audit** slice of the pipeline (not a standalone vertical-only module). **Amendment (2026-04-03):** The motion module does **not** emit computed 3D scalars (`Δele`, `3D_distance`, `3D_speed`, `inclination_angle`, etc.); it emits **pair flags** including `eleUnresolvable` for exclusion masks. Downstream computes 3D observables from raw geometry and elevation using those flags. Coverage gap (invalid ele on one or both ends) remains a first-class **tagged** observable via `eleUnresolvable`.

## Alternatives Considered

### Alternative 1: Standalone “vertical audit” package
- **Pros**: Could house all **computed** `Δele` / vertical-rate outputs in one package.
- **Cons**: Duplicates adjacent-pair eligibility logic; splits ownership of the same kinematic pairs that motion already indexes; blurs elevation channel audit (pure ele quality) vs pair-level kinematic eligibility.
- **Why not**: 3D **eligibility** is defined on motion pairs; elevation audit stays channel-pure. **Computed** 3D scalars still belong in a downstream metrics/correction layer—not a second audit module that re-derives pair rules.

## Consequences

### Positive
- **Motion audit** remains the single authority for **pair-level 3D eligibility** (`eleUnresolvable` and related motion tags); consumers do not invent parallel exclusion rules.
- **Downstream** owns a clear place to compute `Δd`, `Δt`, `Δele`, 3D distance/speed, inclination, etc., only on pairs the audit marked eligible.
- Honest, tag-based reporting of “cannot treat this pair as 3D-eligible” when ele is missing or out of bounds—without embedding derived scalars in audit JSON.

### Negative
- Two-stage story for product readers: **audit = flags**, **downstream = numbers**. Docs and UI must not imply audit payloads include 3D speeds or totals.
- Motion module still owns a growing set of **predicates**; implementation must stay observation-only (no silent correction).

### Risks
- **Risk**: Consumers look only at audit JSON and expect precomputed vertical speed. **Mitigation**: ADR index, `motion-audit.md`, glossary, and ADR-0006/0008 cross-links state explicitly that computed kinematics are downstream.
- **Risk**: Downstream drifts from audit eligibility rules. **Mitigation**: ADR-0008 combination ownership; downstream must use motion exclusion sets, not re-derive eligibility.

**Cross-references**: [`../../project/pipeline/motion-audit.md`](../../project/pipeline/motion-audit.md), elevation audit module

---

## Amendment (2026-04-03)

**What changed:** The original decision placed 3D observable *emission* in the motion extension. The redesign (label-based architecture, 2026-04-03) revises the emission scope.

**Revised decision:** The motion module does **not** emit computed 3D values (`Δele`, `3D_distance`, `3D_speed`, `inclination_angle`, etc.). Instead, it emits the `eleUnresolvable` tag in `pairAnnotations` for every adjacent pair where one or both endpoints have invalid elevation (`ele === null` or outside `[validFloorM, validCeilingM]`). Absence of `eleUnresolvable` on a pair = that pair is 3D eligible.

Downstream correction/metrics layers compute all 3D derived quantities from raw `ele` values using `tagIndex.eleUnresolvable` as the exclusion mask.

**What is unchanged:** The original decision that 3D belongs in the motion module (not a standalone vertical-only module) still holds. Motion audit owns the 3D eligibility determination per ADR-0008. Only the emission of computed values moves downstream.

**`eleUnresolvable` predicate scope:** This tag fires on **every** adjacent pair where ele is invalid on one or both endpoints — independent of the time dimension. A pair that is simultaneously `timeUnresolvable` and `eleUnresolvable` gets both tags. Elevation observability is a separate dimension from temporal observability.

**Deferral note removed:** The original note deferring implementation until elevation audit stabilizes is superseded. Elevation audit is stable as of 2026-04-03.
