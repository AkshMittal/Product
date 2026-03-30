# Product Roadmap: Mountain GPX Intelligence

## Working Vision

Build a SaaS for trekkers and climbers that turns uploaded GPX tracks into transparent, mountain-specific analytics.

Core thesis:
- mainstream tools are optimized for general fitness use cases
- mountain terrain needs different assumptions, methods, and controls
- analytics are only useful if data quality and computation trust are explicit

---

## Product Principles (Non-Negotiable)

### 1) Honesty-first computation
- If a section is unreliable for a metric, mark it and exclude it.
- Never silently smooth/repair and present output as raw truth.
- Every metric should expose quality context (coverage, exclusions, reason tags).

### 2) Advanced user control
- Keep sensible defaults for most users.
- Provide expert controls for users who need terrain-aware tuning.
- Example: steepest-section window must be configurable (e.g., 50m, 100m, 250m, 1km), not hard-bound.

### 3) Methodology visibility
- Users should know what was computed, how, and on what valid subset.
- Keep algorithm notes and assumptions linked in-product.

---

## Current State

Implemented:
- GPX ingestion and structural validation
- Temporal audit (missing/unparsable/duplicate/backtracking)
- Sampling audit (2% relative clustering + drift diagnostics)
- Motion audit (anchored pair-valid metrics)
- Unified JSON export contract
- Single-GPX inspection workbench on `main` branch; methodology links
- 12k-scale case study execution pipeline and reporting scripts

Positioning:
- Current system is an observation and audit layer, not a correction engine.

---

## Refined Direction (Locked from Discussion)

### Audit layer policy (what must be emitted)
- Audit should emit all deterministic observables that can be derived from the GPX stream, even when some outputs may not be used immediately by correction.
- Time and distance sampling diagnostics should both be emitted; relevance decisions belong to later layers, not audit suppression logic.
- Audit output should remain descriptive and non-causal: report what happened in the stream, not why it happened.

### Post-audit processing order
- Pipeline order should be:
  `audit -> objective data correction/flagging -> interpretation -> kinematic plausibility/advanced behavior checks`.
- Kinematic interpretation should not be treated as a first cleanup step; it should run only on explicitly valid subsets.
- Objective correction should focus first on definitional time/data usability boundaries (missing/unparsable/duplicate/non-positive/backtracking contexts).

### Correction philosophy (non-simplistic)
- Do not assume every backtracking event is auto-removable corruption.
- Backtracking handling should evolve toward subtype-aware + spatially aware checks (e.g., stitched-behind-anchor vs linear regression vs mixed patterns), rather than one blanket policy.
- Track discontinuities can be valid recording gaps; jumps are not automatically invalid if elapsed time plausibly explains displacement.

### v1 scope discipline
- First version should prioritize objective, high-confidence exclusions/flags over aggressive interpretation.
- For time-based metrics, confidently state where values are undefined or unreliable instead of forcing inference.
- Keep interpretation claims conservative until a versioned, explicit policy layer is in place.

### Product scope focus (not generic activity platform)
- Product should stay mountain-focused rather than broad multi-sport parity.
- User input should prioritize selecting mountain-engaged sections of a track (domain scoping), not a large generic activity taxonomy.
- Optional segment declarations should act as explicit context for later policy/interpretation, while raw audit remains unchanged.

---

## Roadmap Phases

## Phase 0 (Now): Freeze and Evidence
- Stabilize audit contract and indexing semantics.
- Keep adversarial validation suite passing.
- Regenerate 12k outputs with finalized schema.
- Publish concise pipeline communication assets.

Exit criteria:
- consistent schema
- deterministic reruns
- no ambiguity between block and single-point anomaly views

## Phase 1: Queryable Case Study Platform
- Load case-study outputs into a queryable database.
- Build controlled query API + frontend explorer.
- Surface dataset-level anomaly prevalence/intensity in interactive form.

Minimum deliverables:
- filterable track list
- per-track audit detail view
- block/single-point anomaly inspection
- export of filtered query results

## Phase 2: Processing Layer (Explicit, Not Silent)
- Add optional processing profiles after audit.
- Processing must be user-visible, versioned, and reversible.
- Keep raw vs processed comparison available.

Examples:
- smoothing profile with explicit parameters
- outlier handling policy
- section-level exclusion policy by metric

## Phase 3: Mountain-specific Metric Engine
- Introduce terrain-aware and windowed metrics.
- Use rolling windows, not coarse fixed buckets.
- Return metric + quality metadata together.

Examples:
- steepest section for configurable window length
- sustained grade effort windows
- ascent/descent segmentation quality-aware stats

## Phase 4: Community + Comparative Analysis
- Shareable route analytics views
- peer comparison on normalized mountain metrics
- route/segment discovery using quality-filtered data

---

## Metric Contract Direction (Draft)

Every metric should return:
- `value`
- `qualityLevel` (`high` / `caution` / `invalid`)
- `coverageRatio`
- `excludedSegmentsCount`
- `exclusionReasons[]`
- `parametersUsed`

This keeps outputs trustworthy and interpretable.

---

## Immediate Next Actions

1) Complete fresh 12k rerun on finalized schema.
2) Set up DB-backed case-study explorer (Phase 1 MVP).
3) Define first metric spec in full detail (suggested: `steepestWindow`).
4) Write short product vision note from this roadmap for internship use.

---

## Open Notes / Backlog Seeds

- Elevation should be integrated in relevant downstream metrics.
- Investigate patterns inside backtracking blocks (e.g., linear regression vs stitched anomaly signatures).
- Add distance-based sampling clustering at parity with current time-based clustering.
- Add explicit correction-layer masks (versioned and reversible) before advanced interpretation.
- Add mountain-engaged user segment scoping in product UX to reduce interpretation ambiguity.
