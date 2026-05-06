<!-- generated-by: gsd-doc-writer -->
> **Last updated**: 2026-05-06

# Canonical Track Architecture (Single Source of Truth)

## Purpose

This document defines how the product represents a GPX upload end-to-end while preserving the project's core principles:

- honesty-first computation: no silent repair presented as raw truth
- raw vs processed: raw inputs and raw audit output remain immutable and exportable
- single source of truth (product surface): the UI and metrics operate on one canonical track representation at a time

This is not an algorithm spec. It is a contract for how layers relate and what must be explicit.

---

## Core model

**Raw observations -> Audit -> Correction -> Canonical geometry -> Attached elevation sources -> Metric families**

Key intent:

- the GPX `lat/lon` stream is the primary structural variable
- elevation is often missing or highly noisy; treat it as an attached channel, not the backbone
- "single source of truth" means: for any rendered or interactive view and metric set, there is a chosen canonical track representation with declared provenance

---

## Raw observations (immutable)

Raw observations are the original GPX-derived points in original order, plus the audit results derived from them.

- raw points:
  - `lat`, `lon` (primary)
  - `timeAbsent`, `timeMs`, `timeRaw` (optional; ingestion sets all three for the time channel — `timeRaw` is observational text, `timeMs` is the sole parsed instant used by audits)
  - elevation channel fields from ingestion (`ele`, `eleAbsent`, etc.)
  - parsed extensions (optional)
- raw audit output (`audit.json`):
  - schema v2 **`audit.*`**: ingestion counts and `rejections.events`; temporal / motion / elevation **label-based** fields (`tagCounts`, `tagIndex`, sparse `pointAnnotations`); sampling time and distance diagnostics on **GPX-stream-adjacent** steps (ADR-0013)
  - `perSegment` blocks in `audit.temporal` — per-segment counts and tag indices
  - "blocks" or segment groupings, if needed, are **derived downstream** from tags and stream order—not primary buckets in the export

Rules:

- raw observations are never overwritten
- any downstream processing must reference raw observations by index and must be reversible

---

## Audit layer (`packages/audit/pipeline/`)

The audit layer is deterministic and non-mutating. It produces `audit.json`. Modules in pipeline order:

1. `gpx-ingestion-module.js` — parses GPX; emits `segmentBoundaries[]` and `segmentSummaries[]` with timing windows per segment
2. `timestamp-audit.js` — per-segment monotonicity violations, tag arrays, Δt stats
3. `sampling-audit.js` — per-segment Δt density and spacing
4. `motion-audit.js` — per-segment speed stats; haversine (also extracted to `packages/shared/`)
5. `elevation-audit.js` — per-segment elevation stats
6. `export-fault-detection.js` — **deprecated** (superseded by correction's `deterministic-export-fix.js`; kept for backwards compat)
7. `audit-export-module.js` — assembles final `audit.json` with nested `perSegment` blocks

Audit does not decide whether a metric should be computed. It only describes what is present and what happened in the stream.

---

## Correction layer (`packages/correction/`)

The correction layer is stateful and mutation-based. It consumes `audit.json` and raw accepted points, then produces `correction.json`. Entry point: `index.js` → `correction-runner.js`.

### Pipeline stages

1. **Participation check** (`pre-segment/participation-check.js`) — classifies each segment as `full`, `timestamp-sparse`, `geometry-only`, or `fully-reversed`. Coverage ratio = `positiveTimeDeltaCount / consecutiveTimestampPairsCount`; threshold default 0.8 (`minTimestampPairCoverageRatio`).
2. **Boundary classification** (`pre-segment/boundary-classifier.js`) — classifies inter-segment boundaries into `chunk_ordering`, `duplicate_chunk`, `timestamp_discontinuity`, `segment_boundary_gap`.
3. **Cross-segment duplicate detection** (`proposals/duplicate-proposal.js`).
4. **Objective adjacent dedupe** (`pre-segment/objective-adjacent-dedupe.js`) — stream-adjacent only, pre-mutation.
5. **Reversal check** (`pre-segment/reversal-check.js`) — global full-array hypothesis first, then per-segment.
6. **Deterministic export fixes** (`pre-segment/deterministic-export-fix.js`) — chunk reordering by `minTimeMs`, duplicate chunk exclusion, timezone/gap flag annotations.
7. **Phase 1 — Per-segment multipass loop** (`runner/phase1-loop.js`) — for each non-idle segment: proposals → gates → apply → recheck idle (up to `multipassMaxIterations = 500`).
8. **Phase 2 — Edge reconciliation** (`phase2/edge-reconciliation.js`) — cross-segment adjacent-exact-drop.
9. **Phase 3 — Residual diagnostic sweep** (`phase3/residual-diagnostic-sweep.js`) — read-only diagnostics, no mutations.
10. **Export** (`export/correction-export.js`) — assembles final payload; enforces partition invariant.

**Short-circuit:** After steps 4, 5, and 6, if all segments are `correctionIdle` (no anomalies remain), the pipeline skips to export (`buildEarlyExport`).

### Working state (`state/working-state.js`)

Mutable throughout the pipeline. Tracks:
- `workingOrderedPoints` — live point array (mutated by drops and reorders)
- `drops[]` — `{gpxIndex, reason, stage}`
- `excludedFromTrust[]` — points present but flagged unreliable
- `annotations[]` — segment-scoped and session-scoped observations
- `rearrangements[]` — reorder events

### Partition invariant

Every `gpxIndex` ingested into the correction pipeline appears in **exactly one** of:
- `drops[]`
- `excludedFromTrust[]` (subset of `workingOrderedPoints` — present but not trusted)
- trusted-surviving points (`workingOrderedPoints` minus `excludedFromTrust`)

Enforced at export time in `correction-export.js`; throws on violation.

### Correction output schema (`correction.json`, schema v1.0.0)

Key output fields:
- `metadata` — `schemaVersion`, `generatedAtUtc`, `paramsSnapshot`
- `participation` — global mode, coverageRatio, reasons
- `segmentProfiles` — per-segment participation profiles (post-correction)
- `boundaryClassifications` — inter-segment boundary records
- `spineIntervals` — per-segment spine-trusted point lists
- `proposals` — all proposals across all passes (`applied` + `skipReason`)
- `drops`, `excludedFromTrust`, `annotations` — the three-collection output
- `rearrangements` — physical mutation log
- `canonicalTrustedPoints` — `{gpxIndex, lat, lon, ele, timeMs, trkSegIndex}[]` for trusted-surviving subset
- `partitionInvariant` — `{ingested, drops, excluded, trustedSurviving, ok}`
- `multipass.perSegment` — Phase 1 pass log and exit reason per segment
- `phase2` — Phase 2 result summary
- `diagnostics` — Phase 3 residual sweep payload

---

## Canonical geometry (processed, explicit, versioned)

Canonical geometry is the product's chosen "best estimate" horizontal path representation for a given profile. The correction layer's `canonicalTrustedPoints` is the primary upstream input to this layer.

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

- canonical geometry is derived from correction layer's `canonicalTrustedPoints` (partition-invariant verified)
- elevation can remain primarily observational, while optional model-based elevation is explicit
- "single source of truth" is satisfied per chosen profile, and profile changes remain explicit rather than silent
