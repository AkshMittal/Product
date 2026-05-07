# GPX Correction Pipeline (v1)

The **correction layer** is a stateful, mutation-based pipeline that consumes audit output and raw GPX points, then produces a deterministic `correction.json` with applied fixes and diagnostic reports.

## Overview

**Two-layer architecture:**

1. **Layer 1 — Audit** (`packages/audit/`) — read-only, deterministic analysis of raw GPX points
   - Parses GPX; identifies timing anomalies, elevation gaps, speed violations
   - Emits per-segment observables: `belowAnchor`, `belowPrevValid`, `nonAdjacentRepeat` tags
   - Output: `audit.json`

2. **Layer 2 — Correction** (`packages/correction/`) — stateful mutation pipeline
   - Consumes audit output + raw points
   - Proposes, gates, and applies fixes in three phases
   - Output: `correction.json` (drops, excludedFromTrust, annotations, rearrangements)

## Quick Start

### Run the full pipeline

```bash
# On a single GPX file
node .misc/run-full-pipeline.js --input track.gpx --output ./output/

# On a CSV with embedded GPX (hikr.org format)
node scripts/parsing/parse-csv-gpx.js dataset.csv > /tmp/tracks.ndjson
node .misc/run-full-pipeline.js --input /tmp/tracks.ndjson --output ./output/
```

### Test suite

```bash
npm test                                          # All tests
npx jest packages/correction --no-coverage       # Correction suite only
npx jest --testNamePattern="partition invariant" # Specific test
```

## Architecture

### Phase 1 — Per-segment Terminal Solve (multipass loop)

For each segment with anomalies, run up to 500 iterations:

1. **Spine computation** — extract trusted-adjacent-only subset
2. **Proposal builders:**
   - `block-proposal.js` — contiguous belowAnchor runs (min length 2)
   - `singleton-proposal.js` — isolated out-of-order points
   - `duplicate-proposal.js` — adjacent-exact + same-timeMs groups
3. **Gates (AND logic):**
   - `overlap-detection.js` — spine footprint pierce-check
   - `coupling-detection.js` — bilateral disturbance zones (symmetric blocking)
4. **Apply** — mutations if all gates pass
5. **Verify** — rebuild proposals, exit if no new work found

**Exit reasons:** `no_proposals`, `stable`, `stalemate`, `all_applied`, `max_iterations`

### Phase 2 — Edge Reconciliation

Cross-segment work (adjacent-exact-drop) + staged edge proposal resolution:
- If both spine members of a cross-segment boundary pair are stable → drop the later one
- Staged edge proposals from Phase 1 → check boundary stability
- Stable edges deferred (MVP: not physically applied yet)
- Unstable edges → excludedFromTrust

### Phase 3 — Residual Diagnostic Sweep

Read-only scan of final workingOrderedPoints:
- Residual monotonicity violations (unresolved belowAnchor)
- Same-time groups (intra-segment, cross-segment)
- Coverage summary (trusted, dropped, excluded counts)

### Export

Assembles canonical correction payload; **verifies partition invariant:**
```
Every gpxIndex ∈ exactly one of {drops, excludedFromTrust, trusted-surviving}
```

Throws if violated.

## Key Concepts

### Proposals

Three kinds:

| Kind | What | Disposition |
|------|------|-------------|
| `block-finding` | Contiguous belowAnchor run | GATING (reorder) |
| `insert` | Isolated point (length=1) or competition group (length≥2) | GATING (len=1), ADVISORY (len≥2) |
| `adjacent-exact-drop` | Traversal-adjacent exact duplicate | Unconditional drop |

**Invariant:** every proposal has `applied: boolean`. If `applied === false`, `skipReason` is required (enum-locked).

### Gates

Both proposals in a region must pass AND logic:

1. **Overlap** — no spine footprint intersection; `bMin`/`bMax` computed at detection time
2. **Coupling** — both proposals blocked if in each other's disturbance zone (symmetric)

### Spine Envelope

Per-segment `{minTimeMs, maxTimeMs}` of trusted-adjacent-only points. Used for:
- Edge-proposal classification
- Bracket anchor validation
- Kinematic guard thresholds

### Partition Invariant

Three disjoint collections sum to all ingested points:

```js
drops[] + excludedFromTrust[] + (workingOrderedPoints \ excludedFromTrust[]) === all inputs
```

**Enforced at export time.** Dedup guards in `addDrop()` and `addExcludedFromTrust()` prevent double-counting.

### Kinematic Guard

80 kph (28 m/s) threshold per ADR-0015:
- **GATING** for length-1 proposals (block + insert singleton) — fail → excludedFromTrust
- **ADVISORY** for length≥2 inserts — all fail → lowest-score fallback

## Output Schema

### correction.json

```js
{
  metadata: { schemaVersion, generatedAtUtc, paramsSnapshot },
  participation: { mode, coverageRatio, reasons },  // per-segment modes
  segmentProfiles: [...],                            // post-correction participation
  boundaryClassifications: [...],                    // inter-segment
  spineIntervals: [...],                             // trusted-adjacent per segment
  proposals: [...],                                  // all proposals (applied + skipReason)
  drops: [...],                                      // { gpxIndex, reason, stage }
  excludedFromTrust: [...],                          // { gpxIndex, reason, stage, details? }
  annotations: [...],                                // { scope, kind, details }
  rearrangements: [...],                             // mutation log
  multipass: { perSegment: [...] },                  // Phase 1 pass logs per segment
  phase2: { ... },                                   // cross-segment result summary
  diagnostics: { residualBelowAnchor, ... },         // Phase 3 observables
  canonicalTrustedPoints: [...],                     // final trusted subset
  partitionInvariant: { ok, violations, ... }        // invariant report
}
```

## Testing

### Fixtures

Adversarial GPX test suite in `fixtures/adversarial-custom-test/gpx/`:
- Pathological timings (reversals, duplicates, gaps)
- Geometric anomalies (teleports, reversals)
- Multi-segment boundary cases

Run via `e2e-smoke.test.js` (full pipeline) or `proposals-edge-cases.test.js` (proposal-level).

### Invariant Assertions

- **Partition invariant** — every gpxIndex in exactly one collection
- **Proposal invariant** — `applied` boolean + `skipReason` presence checked
- **Schema invariant** — enum-locked kinds, reasons, annotation scopes
- **Spine monotonicity** — trusted points are strictly time-ordered per segment

## Development

### File Structure

```
packages/correction/
├── proposals/          # Block, singleton, duplicate builders
├── gates/              # Overlap, coupling detection
├── apply/              # Resolution and kinematic guard
├── phase2/             # Edge reconciliation
├── phase3/             # Diagnostic sweep
├── pre-segment/        # Participation check, reversal, boundary classification
├── export/             # Final payload assembly + partition validation
├── state/              # Working state, schema, enums
├── runner/             # Phase 1 loop orchestration
├── __tests__/          # 249 passing tests (e2e, proposals, gates, runners, edge cases)
└── docs/adr/           # ADR-0001 through ADR-0015 (design decisions)
```

### Key ADRs

- **ADR-0011** — three-phase pipeline, per-segment multipass terminal-solve
- **ADR-0012** — schema (drops, excludedFromTrust, annotations as three collections)
- **ADR-0013** — boundary classification in correction, not audit
- **ADR-0014** — traversal-adjacent canonical dedupe primitive
- **ADR-0015** — kinematic guard thresholds (GATING vs ADVISORY)

Read `docs/adr/correction/` for full rationales.

### Parameters

Default overrides in `packages/correction/params/defaults.js`:

```js
{
  multipassMaxIterations: 500,           // Phase 1 cap per segment
  lenientMaxImpliedSpeedKph: 80,         // Kinematic threshold
  minTimestampPairCoverageRatio: 0.8     // Participation classification
}
```

## Known Limitations (v1)

1. **Phase 2 stable edges not applied** — detected but not physically reordered (MVP intentional)
2. **Annotation flooding** — no dedup on overlap annotations per pass (output bloat, not correctness)
3. **No dynamic profile optimization** — block-proposal ignores participation mode hint (dead code path)
4. **jsdom missing** — `fixtures-validation.test.js` can't load (infrastructure, not code)

## Examples

### Single-file correction

```js
const { runCorrection } = require('./packages/correction');
const audit = require('./packages/audit');

const gpxPoints = [...];  // raw points from GPX parser
const auditJson = audit.runAudit(gpxPoints);
const correctionJson = runCorrection(auditJson, gpxPoints);

console.log(correctionJson.canonicalTrustedPoints);  // final safe subset
console.log(correctionJson.drops);                   // removed points
console.log(correctionJson.diagnostics);             // residual issues
```

### Batch processing

See `scripts/pipeline/run-full-pipeline.js` for:
- CSV parsing with embedded GPX
- Batch coordination with 25-track pagination
- Per-track correction + combined export

## Architecture Diagrams

### Data Flow

```
GPX Input
  ↓
Audit Layer (read-only)
  ├─ Ingestion (segment boundaries, timing windows)
  ├─ Temporal analysis (belowAnchor tags per segment)
  ├─ Sampling/Motion/Elevation audit
  └─ audit.json output
  ↓
Correction Layer (stateful mutations)
  ├─ Phase 1: Per-segment multipass (propose → gate → apply)
  ├─ Phase 2: Cross-segment + edge reconciliation
  ├─ Phase 3: Residual diagnostics (read-only)
  └─ correction.json output
  ↓
Export (partition verification + canonical subset)
```

### Phase 1 Loop (per segment)

```
Spine + Envelope
  ↓
Proposals (block, singleton, duplicate)
  ↓
Scope Gate (envelope bounds)
  ↓
Overlap Gate (spine footprint)
  ↓
Coupling Gate (bilateral disturbance)
  ↓
Apply (kinematic check → reorder/exclude)
  ↓
Verify (rebuild proposals, check for new work)
  ↓
Exit? (stable, stalemate, max_iterations) or loop
```

## Contributing

- Add new proposal types to `proposals/`
- Add gates via `gates/`
- Update ADRs in `docs/adr/correction/`
- All changes require partition invariant verification (test suite enforces this)
- 95% confidence rule: don't implement without understanding edge cases first

## References

- Main docs: [`docs/README.md`](../docs/README.md)
- JSON schema glossary: [`docs/project/pipeline/json-schema-v2-glossary.md`](../docs/project/pipeline/json-schema-v2-glossary.md)
- Audit layer: [`packages/audit/README.md`](packages/audit/README.md) (if exists)
- Security: [`SECURITY.md`](SECURITY.md)
