# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important: Before Making Changes

**Do not make any changes until you are 95% sure about what needs to be built.** Ask follow-up questions until you reach that confidence level. Clarify requirements, edge cases, scope, and expected outcomes before writing or modifying code.

## Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run a single test file
npx jest packages/correction/__tests__/e2e-smoke.test.js

# Run tests matching a pattern
npx jest --testNamePattern="partition invariant"
```

Tests live in `__tests__/` subdirectories alongside modules (e.g., `packages/correction/__tests__/`, `packages/shared/__tests__/`). Jest matches `**/__tests__/**/*.test.js`.

## Architecture

This is a **GPX audit + correction monorepo** (Mountain GPX Intelligence). The pipeline has two independent layers:

### Layer 1 — Audit (`packages/audit/pipeline/`)

Deterministic, non-mutating analysis of raw GPX points. Each module emits both global and per-segment observables:

- `gpx-ingestion-module.js` — parses GPX; emits `segmentBoundaries[]` and `segmentSummaries[]` with timing windows per segment.
- `timestamp-audit.js` — per-segment monotonicity violations, `belowAnchor`/`belowPrevValid`/`nonAdjacentRepeat` tag arrays, Δt stats.
- `sampling-audit.js` — per-segment Δt density and spacing.
- `motion-audit.js` — per-segment speed stats; contains the haversine implementation (now also extracted to `packages/shared/`).
- `elevation-audit.js` — per-segment elevation stats.
- `export-fault-detection.js` — **deprecated** (superseded by correction's `deterministic-export-fix.js`; kept for backwards compat).
- `audit-export-module.js` — assembles the final `audit.json` with nested `perSegment` blocks.

### Layer 2 — Correction (`packages/correction/`)

Stateful, mutation-based pipeline that consumes audit output and raw points, then produces a `correction.json`. Entry point: `packages/correction/index.js` → `runCorrection(auditJson, acceptedPoints, params?)`.

**Pipeline stages in `correction-runner.js`:**

1. **Participation check** (`pre-segment/participation-check.js`) — classifies each segment as `full`, `timestamp-sparse`, `geometry-only`, or `fully-reversed` based on coverage ratio (default threshold: 0.8).
2. **Boundary classification** (`pre-segment/boundary-classifier.js`) — classifies inter-segment boundaries from audit's `segmentBoundaries[]` into `chunk_ordering`, `duplicate_chunk`, `timestamp_discontinuity`, `segment_boundary_gap`.
3. **Cross-segment duplicate detection** (`proposals/duplicate-proposal.js`).
4. **Objective adjacent dedupe** (`pre-segment/objective-adjacent-dedupe.js`) — stream-adjacent only, pre-mutation.
5. **Reversal check** (`pre-segment/reversal-check.js`) — global full-array hypothesis first, then per-segment.
6. **Deterministic export fixes** (`pre-segment/deterministic-export-fix.js`) — chunk reordering by `minTimeMs`, duplicate chunk exclusion, timezone/gap flag annotations.
7. **Phase 1 — Per-segment multipass loop** (`runner/phase1-loop.js`) — for each non-idle segment: proposals → gates → apply → recheck idle (up to `multipassMaxIterations=500`).
8. **Phase 2 — Edge reconciliation** (`phase2/edge-reconciliation.js`) — cross-segment adjacent-exact-drop.
9. **Phase 3 — Residual diagnostic sweep** (`phase3/residual-diagnostic-sweep.js`) — read-only diagnostics, no mutations.
10. **Export** (`export/correction-export.js`) — assembles final payload.

**Short-circuit:** After steps 4, 5, and 6, if all segments are `correctionIdle` (no anomalies remain), the pipeline skips to export (`buildEarlyExport`).

**Working state** (`state/working-state.js`) — mutable throughout the pipeline. Tracks:
- `workingOrderedPoints` — live point array (mutated by drops and reorders)
- `drops[]` — `{gpxIndex, reason, stage}`
- `excludedFromTrust[]` — points present but flagged unreliable
- `annotations[]` — segment-scoped and session-scoped observations
- `rearrangements[]` — reorder events

**Correction-idle predicate** (`state/correction-idle.js`) — a segment is idle when: no `belowAnchor`/`belowPrevValid`/`nonAdjacentRepeat` anomalies, every Δt > 0, no same-time-different-coords groups.

### Phase 1 internals

For each active segment the loop runs:
1. `block-proposal.js` — finds monotonicity-violating runs (block-findings).
2. `singleton-proposal.js` — finds isolated out-of-order points with bracket neighbours.
3. `duplicate-proposal.js` — finds adjacent-exact duplicates and competition inserts.
4. `overlap-detection.js` (gate) — computes `B_min`/`B_max` footprints; corridor pierce-check; vetoes overlapping proposals.
5. `coupling-detection.js` (gate) — bilateral disturbance zones; symmetric coupling blocks.
6. `resolution-apply.js` — applies AND-gated proposals with `kinematic-guard.js` (80 kph ceiling, ADR-0015). Disposition: block/singleton use GATING (hard fail); multi-point inserts use ADVISORY (lowest-score fallback).

### Shared utilities (`packages/shared/`)

- `geo/haversine.js` — `haversineMeters(lat1, lon1, lat2, lon2)`, `haversineKph(p1, p2)`.
- `time/parse-timestamp.js` — `parseTimestampMs(str)`, `isValidTimeMs(t)`.

### Key invariants (enforced by tests)

- **Partition invariant**: every `gpxIndex` appears in exactly one of `drops`, `excludedFromTrust`, or trusted-surviving points.
- **Proposal invariant**: every proposal has `applied` boolean; if `applied === false`, `skipReason` must be present.
- **Schema invariant**: every annotation `kind` is in the locked enum (ADR-correction-0012).

### Architectural decisions

All design decisions are in `docs/adr/correction/0001–0015`. Key ones:
- ADR-0011: three-phase pipeline, per-segment multipass terminal-solve model.
- ADR-0012: schema — `drops`, `excludedFromTrust`, `annotations` as the three collections.
- ADR-0013: boundary classification ownership lives in correction, not audit.
- ADR-0014: traversal-adjacent canonical dedupe primitive (stream-adjacent, segment-bounded).
- ADR-0015: kinematic guard — GATING for length-1 insert/block, ADVISORY for length≥2.

### Module system

All modules use CommonJS (`require`/`module.exports`). No ESM.

### Fixtures

Adversarial GPX fixtures live in `fixtures/adversarial-custom-test/gpx/`. The e2e smoke test (`packages/correction/__tests__/e2e-smoke.test.js`) loads these to run the full audit → correction pipeline.
