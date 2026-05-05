# Fixture Organization

Fixtures are organized by layer (audit vs correction) and by the specific modules they target.

## Audit Layer

### `audit/ingestion/` — GPX parsing, segment boundary detection
- adv-01-exact-2pct-boundary.gpx
- adv-02-near-boundary-float.gpx
- adv-09-mixed-point-types.gpx
- adv-31-single-trackpoint.gpx

### `audit/timestamp/` — Timestamp parsing and monotonicity detection
- adv-03-single-valid-timestamp.gpx
- adv-04-all-identical-timestamps.gpx
- adv-05-alternating-backtracking.gpx
- adv-10-timestamp-format-variants.gpx
- adv-11-backtracking-after-invalid-gap.gpx
- adv-33-empty-time-element-mid-track.gpx
- adv-34-missing-time-vs-empty-time.gpx
- adv-35-time-whitespace-only-body.gpx

### `audit/sampling/` — Δt density and spacing
- adv-06-large-forward-jump.gpx
- adv-07-dateline-crossing.gpx
- adv-37-reject-mid-track-sampling-motion-pair-counts.gpx

### `audit/motion/` — Speed stats and kinematic checks
- adv-26-motion-ele-boundary-inclusive.gpx
- adv-27-motion-ele-above-ceiling.gpx
- adv-28-motion-omit-ele-element.gpx
- adv-29-motion-stacked-backward-and-elebad.gpx
- adv-30-motion-mixed-time-backward-zero.gpx

### `audit/elevation/` — Elevation stats
- adv-08-polar-latitude.gpx
- adv-32-unparsable-ele-element.gpx

### `audit/e2e-audit/` — Full audit pipeline (all modules)
- adv-12-large-scale-20k.gpx

---

## Correction Layer

### Pre-Segment Modules

#### `correction/pre-segment/participation/` — Segment classification (full/sparse/geometry-only/fully-reversed)
- adv-15-static-geometry-long.gpx

#### `correction/pre-segment/boundary-classification/` — Inter-segment boundary types (chunk_ordering, duplicate_chunk, timestamp_discontinuity, segment_boundary_gap)
- adv-16-boundary-lat-lon-valid.gpx
- adv-36-gpx-gap-same-time-non-adjacent-dup.gpx

#### `correction/pre-segment/objective-dedupe/` — Stream-adjacent duplicate removal
- (No dedicated fixtures yet; covered by adjacent-dup proposal tests)

#### `correction/pre-segment/reversal-check/` — Time-decreasing segment detection and reversal
- adv-14-multi-trkseg-backtrack.gpx

#### `correction/pre-segment/deterministic-export/` — Chunk reordering by minTimeMs, duplicate chunk exclusion, timezone/gap annotations
- adv-17-time-parse-fuzz.gpx

---

### Proposals

#### `correction/proposals/block/` — Monotonicity-violating run detection
- adv-19-missing-singletons-and-block.gpx

#### `correction/proposals/singleton/` — Isolated out-of-order points with valid bracket neighbours
- adv-19-missing-singletons-and-block.gpx (shared)

#### `correction/proposals/duplicate/` — Adjacent-exact duplicates and competition inserts
- adv-18-duplicate-singletons.gpx
- adv-23-adjacent-dup-below-anchor.gpx
- adv-24-anchor-no-advance-on-dup.gpx

---

### Gates

#### `correction/gates/overlap/` — Corridor pierce-check and overlap veto
- (No dedicated fixtures yet; overlap logic verified in apply tests)

#### `correction/gates/coupling/` — Bilateral disturbance zones and symmetric coupling blocks
- (No dedicated fixtures yet; coupling logic verified in apply tests)

---

### Apply & Kinematic Guard

#### `correction/apply/kinematic-guard/` — Kinematic guard disposition (GATING vs ADVISORY)
- adv-27-motion-ele-above-ceiling.gpx (kinematic ceiling breach)

#### `correction/apply/resolution/` — Proposal application logic
- (Covered by proposal application tests)

---

### Phases

#### `correction/phases/phase-1-multipass/` — Per-segment multipass loop (≥3 iterations required)
- adv-22-locally-recovering-backtrack.gpx
- adv-25-multi-tag-convergence.gpx

#### `correction/phases/phase-2-edge/` — Cross-segment adjacent-exact-drop
- (Edge reconciliation covered in e2e tests)

#### `correction/phases/phase-3-diagnostic/` — Read-only residual diagnostic sweep
- (Phase 3 non-mutation verified in e2e tests)

---

### End-to-End

#### `correction/e2e/` — Rich, complex fixtures exercising all correction modules
- adv-13-mixed-all-anomalies.gpx (all anomaly types)
- adv-20-seeded-random-walk.gpx (stochastic coverage)
- adv-21-nonadjacent-repeat-streamwide.gpx (nonAdjacentRepeat tag)

---

## File Format

Each fixture has two files:
- `<name>.gpx` — Raw GPX input
- `<name>.audit.v2.json` — Expected audit output (schema validation baseline)

Optional:
- `<name>.correction.v2.json` — Expected correction output (not yet standardized; added per-test as needed)
