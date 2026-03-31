# Canonical Track Architecture (Single Source of Truth)

## Purpose

This document defines how the product represents a GPX upload end-to-end while preserving the project's core principles:

- honesty-first computation: no silent repair presented as raw truth
- raw vs processed: raw inputs and raw audit output remain immutable and exportable
- single source of truth (product surface): the UI and metrics operate on one canonical track representation at a time

This is not an algorithm spec. It is a contract for how layers relate and what must be explicit.

---

## Core model

**Raw observations -> Canonical geometry -> Attached elevation sources -> Metric families**

Key intent:

- the GPX `lat/lon` stream is the primary structural variable
- elevation is often missing or highly noisy; treat it as an attached channel, not the backbone
- "single source of truth" means: for any rendered or interactive view and metric set, there is a chosen canonical track representation with declared provenance

---

## Raw observations (immutable)

Raw observations are the original GPX-derived points in original order, plus the audit results derived from them.

- raw points:
  - `lat`, `lon` (primary)
  - `timeRaw` (optional)
  - `eleRaw` (optional)
  - parsed extensions (optional)
- raw audit output:
  - observational diagnostics such as missing/unparsable/duplicate/backtracking timestamps, sampling diagnostics, motion pair classes, and later elevation observables
  - event and block structures

Rules:

- raw observations are never overwritten
- any downstream processing must reference raw observations by index and must be reversible

---

## Canonical geometry (processed, explicit, versioned)

Canonical geometry is the product's chosen "best estimate" horizontal path representation for a given profile.

It is the single source used for:

- map rendering and hit-testing
- index-based anchoring for notes/photos and UX primitives
- distance and geometry-conditioned computations
- alignment axis for attached channels such as elevation and derived grades

Rules:

- canonical geometry is processed output, not "the raw GPX"
- it must be explicit, versioned, and reversible:
  - profile id such as `geometryProfileId`
  - algorithm name/version
  - parameters used
  - masks/exclusions and reason tags when applicable
- canonical geometry should carry quality metadata so later layers can downgrade or refuse outputs rather than silently guessing

This architecture allows a single, consistent coordinate stream for UI interaction while still preserving raw truth.

---

## Attached elevation sources (channels on canonical geometry)

Elevation is represented as one or more explicit channels attached to canonical geometry points.

Why: once geometry is processed, the original `eleRaw` values no longer map one-to-one to the new coordinates.

Therefore any "canonical elevation" must be defined by an explicit method, for example:

- recorded elevation channel: `eleRaw` resampled/aligned onto canonical geometry by a declared rule
- terrain-model elevation channel: `eleDem(lat, lon)` sampled from a declared DEM product at canonical geometry coordinates
- future fusion channel: explicit combination of recorded and model elevation under a declared policy

Rules:

- never silently replace recorded elevation with model elevation
- any elevation channel must declare:
  - source type (`recorded`, `dem`, `fused`)
  - parameters and version
  - coverage/quality

---

## Metric families (declare their dependencies)

Every metric must declare which track representation it uses:

- geometry profile
- elevation channel, if required
- timestamp eligibility rules, if time-conditioned
- exclusion masks and reason breakdowns
- coverage ratio / quality level

This enforces:

- transparency about what was computed, how, and on what valid subset
- comparability across processing profiles
- future extensibility without breaking old exports

---

## MVP scope notes

For MVP, this architecture supports a conservative approach:

- canonical geometry can exist as an explicit processed profile without claiming ground truth
- elevation can remain primarily observational, while optional model-based elevation is explicit
- "single source of truth" is satisfied per chosen profile, and profile changes remain explicit rather than silent
