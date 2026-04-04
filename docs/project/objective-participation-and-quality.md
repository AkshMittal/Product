# Objective Participation Masks and Quality Gates

## Purpose

This document clarifies layer responsibilities after the audit stage:

- how objective participation (what data is eligible for which metric family) is derived
- how quality gates (when to downgrade/refuse outputs) are applied without becoming kinematic smoothing
- how timestamp labeling/flagging is represented consistently

The goal is to keep the pipeline understandable and honesty-first while enabling conservative MVP outputs.

---

## Layer responsibilities (post-audit)

Pipeline intent:

`audit -> objective participation masks -> quality gates / reporting policy -> (later) kinematic plausibility and interpretation`

### Audit (descriptive, non-causal)

Audit emits deterministic observables and structures:

- point-level tags such as missing/unparsable timestamps (`audit.temporal` label-based output)
- pair-level motion flags and stream-adjacent sampling deltas (`audit.motion`, `audit.sampling`; adjacency by `gpxIndex`, ADR-0013)
- sparse `pointAnnotations` plus `tagIndex` / `tagCounts` (not legacy block buckets in the export)
- sampling clustering diagnostics for time and distance

Audit does not decide whether a metric should be computed. It only describes what is present and what happened in the stream.

### Objective participation masks (eligibility labeling)

Participation masks translate audit observables into eligibility rules for metric families.

Key idea:

- no point is "removed" from raw truth
- a point/pair/segment becomes ineligible for some computations, with explicit reason tags

This layer is allowed to label data as:

- eligible for geometry-conditioned metrics
- eligible for time-conditioned metrics
- eligible for elevation-conditioned metrics
- eligible for an MVP-safe profile

But it should avoid causal claims about why the device behaved that way, and it should avoid smoothing/repair.

### Quality gates (regional / window-based reporting policy)

Quality gates decide whether to:

- produce a metric value
- downgrade quality level
- refuse output for a segment/window due to insufficient coverage or concentrated anomalies

This layer can use aggregate summaries such as rates, concentration, and coverage computed from masks and audit outputs.

This is where density/spread discussions belong; it is not an audit primitive.

### Later layers (interpretation and kinematics)

Interpretation and kinematic plausibility checks are versioned policy layers applied after objective eligibility.

Examples:

- stitched/reordering hypotheses built from audit labels (e.g., `belowAnchor`) in **interpretation**—not additional audit subtypes
- speed/acceleration outlier rejection
- map-matching / route snapping

---

## Timestamp labeling and usage (objective v1)

This section defines a conservative, objective scheme for timestamp-related eligibility.

### Timestamp point states

Per point:

- missing: no timestamp value
- unparsable: timestamp exists but cannot be parsed
- parseable: timestamp can be parsed into milliseconds

### Pair states (time-conditioned)

Use **GPX-stream-adjacent** pairs only: both endpoints accepted, `curr.gpxIndex === prev.gpxIndex + 1`, and both have finite `timeMs` (same gate as `audit.sampling` time deltas and `audit.motion` time predicates). Then:

- forward-valid: `dt > 0`
- duplicate / zero delta: `dt === 0` on that stream-adjacent edge
- backward: `dt < 0`

**Point-level** “duplicate” in `audit.temporal` is separate: `adjacentDuplicate` compares to the accepted predecessor at `gpxIndex - 1` with finite `timeMs`; repeats across gaps are `nonAdjacentRepeat` (ADR-0013).

### Objective eligibility rules (examples)

- time-conditioned metrics:
  - only use forward-valid pairs
  - exclude duplicate/backward/missing/unparsable contexts
  - report coverage and reasons

- geometry-conditioned metrics:
  - do not require timestamps by definition
  - may still use time flags for quality reporting in stricter profiles

- MVP conservative mode:
  - if backward-time/backtracking contexts exist, restrict or refuse time-conditioned metrics unless coverage is high and anomalies are sparse
  - never silently repair timestamps; only mask

---

## Backtracking and "cleaning" (MVP discipline)

Backtracking and related anomalies should be treated as:

- audit outputs (`belowAnchor`, `belowPrevValid`, and related tags; sparse annotations + indices)
- participation exclusions for metric families that cannot be trusted under those contexts

MVP rule of thumb:

- prefer exclusion with reasons over structural correction
- defer stitched/reorder fixes to explicit processing profiles

---

## Reporting contract

Any metric or exported processed view should carry:

- the mask profile id and version
- coverage ratio
- excluded share and reason tags
- parameters used
- quality level (`high`, `caution`, `invalid`)

This enables:

- conservative MVP outputs without silent repair
- later policy evolution without breaking interpretability
