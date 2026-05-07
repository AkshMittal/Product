<!-- generated-by: gsd-doc-writer -->
> **Last updated**: 2026-05-06

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

#### Raw vs processed outputs (contract rule)
- Preserve **raw audit** output as immutable and exportable.
- Any cleaning / smoothing must be **explicit, versioned, and reversible**, producing separate processed views/exports with clear parameters and exclusion masks.
- The product surface may operate on a **versioned canonical geometry** derived from raw observations, while preserving raw audit as the immutable reference.
- Elevation should be treated as an **attached channel** (recorded vs terrain-model vs future fusion), never silently overwritten.

### 2) Advanced user control
- Keep sensible defaults for most users.
- Provide expert controls for users who need terrain-aware tuning.
- Example: steepest-section window must be configurable (e.g., 50m, 100m, 250m, 1km), not hard-bound.

### 3) Methodology visibility
- Users should know what was computed, how, and on what valid subset.
- Keep algorithm notes and assumptions linked in-product.

---

## Current State

Implemented — **Audit layer** (`packages/audit/pipeline/`):
- GPX ingestion and structural validation (`audit.ingestion`: counts, context, `rejections.events` for coordinate failures)
- Temporal audit (label-based: `tagCounts` / `tagIndex` / `pointAnnotations`; missing, unparsable, `belowAnchor`, stream-adjacent `adjacentDuplicate` / `belowPrevValid`, `nonAdjacentRepeat`); emits `perSegment` blocks
- Sampling audit (2% relative clustering for time and distance; GPX-stream-adjacent pairs per ADR-0013)
- Motion audit (label-based pair flags; stream-adjacent pairs; no anchored timestamp chaining)
- Elevation audit (per-point channel labels)
- Unified JSON export contract (schema v2); `audit-export-module.js` assembles final `audit.json`

Implemented — **Correction layer** (`packages/correction/`):
- Full 9-stage correction pipeline (see Architecture below); entry point `index.js` → `correction-runner.js`
- Emits `correction.json` with partition-invariant-verified output (every `gpxIndex` in exactly one of: drops, excludedFromTrust, trusted-surviving)
- Working state: `workingOrderedPoints`, `drops[]`, `excludedFromTrust[]`, `annotations[]`, `rearrangements[]`
- Kinematic guard: 80 kph ceiling (ADR-0015); GATING for length-1 proposals, ADVISORY for length ≥ 2
- Phase 1 multipass loop: up to 500 iterations per segment (configurable)
- Schema v1.0.0 for `correction.json`

Positioning:
- The system is now a **two-layer audit + correction pipeline**. The audit layer is observation-only and non-mutating; the correction layer is stateful and mutation-based.

---

## Refined Direction (Locked from Discussion)

### Audit layer policy (what must be emitted)
- Audit should emit all deterministic observables that can be derived from the GPX stream, even when some outputs may not be used immediately by correction.
- Time and distance sampling diagnostics should both be emitted; relevance decisions belong to later layers, not audit suppression logic.
- Audit output should remain descriptive and non-causal: report what happened in the stream, not why it happened.

#### v1 audit completion targets (explicit)
- **Temporal / "backtracking" observables** — shipped as **non-exclusive point labels** (`belowAnchor`, `belowPrevValid`, duplicates/repeat tags, etc.). That is why the audit moved off block-based summaries: downstream correction and interpretation derive **subtype** stories (stitched vs regression vs mixed) from labels + geometry + policy—not new audit taxonomies.
- **Distance-based sampling clustering** — shipped: same 2% insertion model as time, on GPX-stream-adjacent distance steps (ADR-0013).
- **Elevation audit module** — shipped: observational per-point labels + export; richer downstream elevation metrics remain product work.

#### Timestamp anomaly semantics (explicit)
- **Adjacent duplicate** = same instant as the **accepted GPX predecessor row** (`gpxIndex - 1`) when that predecessor has finite `timeMs` (not "previous valid in thinned array order" when a coordinate reject sits between rows). See ADR-0013.
- **Non-adjacent repeat** = timestamp value seen earlier in the stream but not that stream-adjacent equal-time case (`nonAdjacentRepeat` tag).
- **Below anchor** / monotonic anchor semantics remain as in temporal audit spec.

### Post-audit processing order
- Pipeline order should be:
  `audit -> objective data correction/flagging -> interpretation -> kinematic plausibility/advanced behavior checks`.
- Kinematic interpretation should not be treated as a first cleanup step; it should run only on explicitly valid subsets.
- Objective correction should focus first on definitional time/data usability boundaries (missing/unparsable/duplicate/non-positive/backtracking contexts).

### Correction philosophy (non-simplistic)
- Do not assume every below-anchor or backward-step context is auto-removable corruption.
- **Subtype-aware** handling (stitched-behind-anchor vs regression vs mixed patterns) belongs in **correction / interpretation** layers that consume audit labels—**not** in the audit module.
- Track discontinuities can be valid recording gaps; jumps are not automatically invalid if elapsed time plausibly explains displacement.

### v1 scope discipline
- First version should prioritize objective, high-confidence exclusions/flags over aggressive interpretation.
- For time-based metrics, confidently state where values are undefined or unreliable instead of forcing inference.
- Keep interpretation claims conservative until a versioned, explicit policy layer is in place.

#### Cleaning outputs (MVP intent)
- Cleaning must not be one-size-fits-all; "bad for one metric" is not "bad for all metrics."
- Cleaning should emit **versioned, reversible masks/exclusions** with **reason tags**, so metrics can report:
  - computed-on coverage ratio
  - excluded portion + reason breakdown
  - parameters used
- Prefer objective domain boundaries early; avoid deep kinematic correction/smoothing before real user data exists.

### Product scope focus (not generic activity platform)
- Product should stay mountain-focused rather than broad multi-sport parity.
- User input should prioritize selecting mountain-engaged sections of a track (domain scoping), not a large generic activity taxonomy.
- Optional segment declarations should act as explicit context for later policy/interpretation, while raw audit remains unchanged.

---

## MVP Definition (Product v1)

MVP goal:
- Ship a mountain-focused product that can attract an initial userbase and produce high-signal data for iterative algorithm refinement.

Core wedge:
- A **personal mountain log** built on top of the audit + correction engine.
- Users can attach **notes and photos** anchored to their route (index/time/nearest-point anchoring), enabling:
  - personal route memory ("what happened here?")
  - contextual labeling for later pattern study (rest, crux, weather, route-finding, navigation error)

MVP constraints:
- Audit layer must be "complete" for v1 (objective, deterministic observables + stable schema + adversarial coverage). **Status: complete.**
- Correction layer must produce a stable `correction.json` with partition-invariant guarantees. **Status: complete.**
- Cleaning/processing should be explicit and conservative:
  - focus on objective usability masks and confidence/coverage reporting
  - avoid deep kinematic correction and avoid silent smoothing
- Keep privacy and trust central (private-by-default behavior, clear retention/deletion, explicit opt-in for research use).

Adoption reality check:
- "Free" reduces price friction but not effort/trust/habit friction.
- Early adoption needs a repeated win + privacy trust + low-friction upload; tracks are sensitive location+time data.

---

## Roadmap Phases

## Phase 0 (Complete): Freeze and Evidence
- Stabilize audit contract and indexing semantics. ✓
- Keep adversarial validation suite passing. ✓
- Regenerate 12k outputs with finalized schema. ✓
- Publish concise pipeline communication assets. ✓

Exit criteria (met):
- consistent schema (v2 label-based temporal/motion/elevation; sparse `pointAnnotations` + `tagIndex`)
- deterministic reruns
- adversarial suite passing; ingestion rejections use `audit.ingestion.rejections.events` naming

## Phase 0b (Complete): Correction Layer
Exit criteria (met):
- 9-stage correction pipeline implemented and tested
- Partition invariant enforced in `correction-export.js`
- Phase 1 multipass per-segment loop operational (up to 500 iterations)
- Phase 2 edge reconciliation and Phase 3 residual diagnostics operational
- ADR-0001 through ADR-0015 documented in `docs/adr/correction/`

## Phase 1: User-Facing Logging Platform + Data Loop
- Load case-study outputs into a queryable database.
- Build controlled query API + frontend explorer (internal and/or user-facing).
- Ship the personal mountain log experience (notes/photos anchored to route).
- Establish an explicit data loop:
  - what anomalies are common in real uploads
  - what users label as rest/crux/slowdown
  - where audit gaps block desired metrics
  - which interpretation policies are worth building next

Minimum deliverables:
- private-by-default track library
- per-track audit detail view
- per-tag and per-point (sparse) anomaly inspection from audit JSON
- per-track correction detail view (drops, excludedFromTrust, canonicalTrustedPoints)
- anchored notes + optional photo attachments
- export of track + audit + correction + user annotations

## Phase 2: Processing Layer (Explicit, Not Silent)
- Add optional processing profiles after correction.
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

1) Stand up DB-backed track library + per-track audit + correction view (private-by-default).
2) Add anchored notes (and optionally photos) to create a labeled data loop.
3) Extend adversarial / product tests when **audit** adds new tags or export fields (not for interpretation-only subtypes).
4) Add mountain-engaged user segment scoping in product UX to reduce interpretation ambiguity.

---

## Open Notes / Backlog Seeds

- Elevation should be integrated in relevant downstream metrics.
- Investigate patterns for correction/interpretation using audit labels + geometry (e.g., linear regression vs stitched signatures)—**downstream**, not new audit emitters.
- Add explicit correction-layer masks (versioned and reversible) before advanced interpretation.
