# ADR-correction-0007: Audit modules vs correction participation (MVP)

**Date**: 2026-04-13  
**Status**: accepted  

## Context

Correction **consumes** audit outputs. Not every audit tag should drive **`correction.excludedFromTrust`** or duplicate participation logic; some pair-level motion tags **restate** point-level temporal/elevation facts.

## Decision

| Audit area | Correction participation (MVP) |
|------------|--------------------------------|
| **Ingestion** | Rejected rows **not** in `points`; cannot participate; canonical **`audit.ingestion.rejections`**. |
| **Temporal** | **Primary** for time-centric correction predicates and overlap/block/singleton/duplicate stories. |
| **Sampling** | Time deltas and **`coverageRatio`**; **invalid distance** pairs optional safety for spatial-step policy. |
| **Motion** | **Not required** for participation gating; **`timeUnresolvable`** / **`eleUnresolvable`** restate temporal/ele endpoint issues at **pair** granularity; **`nonFiniteDistance`** edge safety aligns with sampling. |
| **Elevation** | **Secondary** for time-centric correction; **`audit.elevation`** classifies usable vs OOB for **adjacent dedupe**; **OOB** does not null the point in ingestion — correction may set survivor **`ele = null`** per **ADR-correction-0004**. |

Downstream combines **`audit`**, **`correction.participation`**, and **`correction.excludedFromTrust`** (correction-only) per handoff contract.

## Alternatives Considered

### Alternative 1: Require `audit.motion` for every correction gate

- **Pros**: Single pair-level source.
- **Cons**: Redundant with temporal + sampling for time; extra coupling to motion parameters.
- **Why not**: **Rejected** for MVP participation.

### Alternative 2: Mirror all audit temporal missing/unparsable in `excludedFromTrust`

- **Pros**: One list for UI.
- **Cons**: Duplicates audit; two sources of truth.
- **Why not**: **Rejected** — see **ADR-correction-0002**.

## Consequences

### Positive

- Clear **separation**: audit **observes**; correction **acts** and emits correction-specific exclusions.

### Negative

- Implementers must read **multiple** handoff fields for full eligibility.

### Risks

- Drift if sampling vs motion **counts** diverge — align denominators with **ADR-0013**.
