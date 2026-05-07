<!-- generated-by: gsd-doc-writer -->
> **Last updated**: 2026-05-06

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

`audit -> correction (participation + mutation) -> objective participation masks -> quality gates / reporting policy -> (later) kinematic plausibility and interpretation`

### Audit (descriptive, non-causal)

Audit emits deterministic observables and structures:

- point-level tags such as missing/unparsable timestamps (`audit.temporal` label-based output)
- pair-level motion flags and stream-adjacent sampling deltas (`audit.motion`, `audit.sampling`; adjacency by `gpxIndex`, ADR-0013)
- sparse `pointAnnotations` plus `tagIndex` / `tagCounts` (not legacy block buckets in the export)
- sampling clustering diagnostics for time and distance
- `perSegment` blocks in `audit.temporal` with per-segment counts and tag indices

Audit does not decide whether a metric should be computed. It only describes what is present and what happened in the stream.

### Correction participation classification (`pre-segment/participation-check.js`)

The correction layer's first stage classifies each segment and the global track into participation modes. This is a **read-only derive** over audit + points — it never mutates points or drops them.

**Mode classification logic (global and per-segment, same priority order):**

1. If `parseableTimestampPointCount === 0` → `geometry-only` (reason: `no-parseable-timestamps`)
2. Else if `hasAnyPositiveTimeDelta === false` → `geometry-only` (reason: `all-timestamps-uniform`)
3. Else if `coverageRatio < minTimestampPairCoverageRatio` (default **0.8**) → `timestamp-sparse` (reason: `insufficient-pair-coverage`)
4. Else → `full`

**Coverage ratio formula:**
```
coverageRatio = positiveTimeDeltaCount / consecutiveTimestampPairsCount
              (or 0 when consecutiveTimestampPairsCount === 0)
```

**`fully-reversed` mode (per-segment only):** A segment is `fully-reversed` when it has ≥ 2 parseable timestamps and every consecutive parseable time-pair is strictly decreasing (all Δt < 0). The reversal-check phase (`pre-segment/reversal-check.js`) decides whether to apply correction. A `fully-reversed` segment does not fall through to `timestamp-sparse` even if coverage < 0.8.

**`hasAnomalies` flag (per-segment):** True if any of `belowAnchor`, `belowPrevValid`, `nonAdjacentRepeat`, or `adjacentDuplicate` tag arrays are non-empty.

**`hasUsableTimes` flag (per-segment):** True if `parseableTimestampPointCount >= 2`.

**Default threshold:** `minTimestampPairCoverageRatio = 0.8` (overridable via `params` passed to `runCorrection()`). See `packages/correction/params/defaults.js`.

**Output fields per segment profile:**
```
{ trkSegIndex, mode, hasAnomalies, hasUsableTimes, coverageRatio,
  isFullyReversed, spineEnvelope, iterationsRun, exitReason, correctionIdle }
```

### Objective participation masks (eligibility labeling)

Participation masks translate audit observables and correction outputs into eligibility rules for metric families.

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

**Point-level** "duplicate" in `audit.temporal` is separate: `adjacentDuplicate` compares to the accepted predecessor at `gpxIndex - 1` with finite `timeMs`; repeats across gaps are `nonAdjacentRepeat` (ADR-0013).

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

## Correction layer participation vs audit modules (MVP)

Cross-reference: **`implementation_plan.md`** — **§ Audit pipeline: module-wise flags** and **§ Audit modules vs correction participation (MVP)**.

Summary for **time-centric correction** (reorder / overlap / duplicate-time):

- **Ingestion rejections** — not in **`points`**; cannot participate.
- **`audit.temporal`** — primary driver for correction; `perSegment` blocks consumed by participation-check.
- **`audit.sampling`** — time deltas and **coverageRatio**; **invalid distance** pairs optional safety for spatial-step policy.
- **`audit.motion`** — not required for correction participation gating; pair tags restate temporal + elevation endpoint issues.
- **`audit.elevation`** — secondary for correction MVP; **`outOfBounds`** is audit-labeled only (**`ele`** may remain numeric on the point); elevation **`adjacentDuplicate`** is observational.

Downstream combines **`audit`**, **`correction.participation`**, and **`correction.excludedFromTrust`** (correction-only) per handoff contract.

### Correction idle predicate (`state/correction-idle.js`)

A segment is **correctionIdle** (and skipped by Phase 1) when:
- no `belowAnchor`, `belowPrevValid`, or `nonAdjacentRepeat` anomalies remain
- every Δt > 0 for consecutive pairs
- no same-time-different-coords groups

If all segments are correctionIdle after pre-segment steps, the pipeline short-circuits to export (`buildEarlyExport`), skipping Phase 1 entirely.

---

## Backtracking and "cleaning" (MVP discipline)

Backtracking and related anomalies should be treated as:

- audit outputs (`belowAnchor`, `belowPrevValid`, and related tags; sparse annotations + indices)
- participation exclusions for metric families that cannot be trusted under those contexts
- correction targets for the correction layer (reorder/drop proposals, not audit-layer decisions)

MVP rule of thumb:

- prefer exclusion with reasons over structural correction
- defer stitched/reorder fixes to explicit processing profiles
- correction layer applies only high-confidence, kinematic-guard-gated mutations

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
