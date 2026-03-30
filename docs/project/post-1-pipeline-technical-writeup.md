# GPX Audit Pipeline: Module-Spec Technical Writeup

## Scope

This writeup documents the GPX audit pipeline specification and output contract.

Pipeline scope is intentionally limited to:

`GPX XML -> Ingestion -> Temporal Audit -> Sampling Audit -> Motion Audit -> Unified JSON Export`

No smoothing, correction, or trajectory rewriting is performed.

---

## Problem (Concise)

Raw GPX files can contain timestamp and structural irregularities that silently affect downstream analytics.  
This pipeline makes those irregularities explicit as structured audit outputs.

---

## Design Principles

- Modular stages with explicit boundaries
- Deterministic schema-first output
- No hidden mutation of source point stream
- Explainable diagnostics (`count`, `ratio`, `events`, `blocks`, `singlePointCount`)
- Explicit index semantics

---

## Architecture

1. Parse and validate GPX points (all supported point types)
2. Audit temporal anomalies
3. Audit time-based sampling behavior and normalization drift
4. Audit motion consistency from anchored timestamp pairs
5. Aggregate all module outputs into one canonical JSON payload

---

## Canonical Output Contract

Top-level payload:

- `metadata`
- `audit.ingestion`
- `audit.temporal`
- `audit.sampling`
- `audit.motion`

Versioning:

- `metadata.schemaVersion`

### Minimal Schema Snippet

```json
{
  "metadata": {
    "schemaVersion": "2.0.0",
    "generatedAtUtc": "2026-02-26T18:10:51.063Z",
    "source": { "fileName": "example.gpx" },
    "summary": { "totalPointCount": 119 }
  },
  "audit": {
    "temporal": {
      "totalPointsChecked": 119,
      "temporalOrder": {
        "missing": {
          "count": 0,
          "ratio": 0,
          "blocks": [],
          "singlePointCount": 0
        },
        "backtracking": {
          "count": 0,
          "maxDepthMs": null,
          "blocks": [],
          "singlePointCount": 0
        }
      }
    },
    "sampling": {
      "time": {
        "clustering": {
          "alphaUsed": 0.02,
          "clusterCountSorted": 63,
          "clusterCountSequential": 115
        },
        "normalization": {
          "globalFinalMeanRelativeDeviation": 0.0030,
          "globalFinalMaxRelativeDeviation": 0.0177
        }
      }
    },
    "motion": {
      "pairCounts": { "consecutivePairCount": 118, "forwardValidCount": 118 },
      "time": { "validMotionTimeSeconds": 14443, "invalidTimeRatio": 0 }
    }
  }
}
```

---

## Module Specifications

### 1) Ingestion Audit

Purpose:

- Parse `wpt`, `rtept`, `trkpt`
- Validate coordinates
- Preserve valid points and explicit rejection metadata

Why this boundary exists:

- Coordinate validity is a structural precondition for all downstream spatial math.
- Hard discarding is intentionally constrained to ingestion for invalid coordinates only.
- Downstream modules remain observational on the validated point stream instead of re-filtering data differently per module.
- This prevents denominator drift and keeps module outputs comparable.

Core outputs:

- `counts.totalPointCount`
- `counts.validPointCount`
- `counts.rejectedPointCount`
- `counts.pointTypeCounts`
- `rejections.count`, `rejections.events`
- Context flags (e.g., `hasMultiplePointTypes`, `hasAnyTimestampValues`)

### 2) Temporal Audit

Purpose:

- Detect timestamp anomalies:
  - missing
  - unparsable
  - duplicate
  - backtracking

Block rule:

- A block is recorded **only when contiguous anomaly length > 1**.
- Single-point anomalies are tracked separately and never upcast to blocks.

Why this structure:

- Block-level and single-point anomalies carry different operational meaning.
- Block metrics capture sustained corruption patterns (e.g., stitched segments, prolonged missing clocks).
- Singleton metrics preserve isolated faults that blocks would hide.
- Keeping both avoids false reassurance from block-only summaries while preserving pattern severity information.

Core outputs per anomaly:

- `count`, `ratio`
- `largestBlockLength`
- `blocks`
- `events`
- `singlePointCount`, `singlePointEvents`

### 3) Sampling Audit

Purpose:

- Characterize time-based sampling behavior from positive timestamp deltas.

Core method:

- Relative clustering threshold `alpha = 0.02` (2%).
- Two views:
  - sorted clustering
  - sequential clustering

Why this method:

- Relative tolerance is scale-aware; fixed absolute thresholds bias against long-interval tracks.
- Sorted clustering estimates global regime count independent of order.
- Sequential clustering captures order effects and local regime transitions.

Normalization diagnostics:

- Final comparison against stabilized cluster center metrics
- Global mean/max deviation summaries to surface drift

Why final comparison to stabilized `centerSec` is included:

- Local clustering can remain permissive under gradual drift.
- Final center-based deviation metrics expose global drift even when local membership still passes 2%.
- This prevents under-reporting regime instability in slowly varying tracks.

Core outputs:

- Timestamp context (`hasValidTimestamps`, progression, non-positive delta rejections)
- Delta statistics (`count`, `minMs`, `medianMs`, `maxMs`)
- Clustering metrics (`clusterCountSorted`, `clusterCountSequential`, stability ratios)
- Normalization metrics (`globalFinal*Deviation*`)
- Distance delta accounting (geometry-only and time-conditioned counts)

### 4) Motion Audit

Purpose:

- Evaluate motion consistency on anchored timestamp-valid consecutive pairs.

Why anchored pair evaluation:

- Motion metrics should only integrate over temporally valid forward intervals.
- Anchoring avoids contaminating valid motion totals with missing/unparsable/backward-time segments.
- Rejected pairs are still retained as explicit diagnostics rather than silently dropped.

Pair-valid caveat:

- Speed summaries (`mean`, `median`, `max`) are computed from individually valid forward pairs (`dt > 0`, finite distance).
- This is a pair-valid estimator in stream order, not a strict globally clean-continuity estimator.
- Therefore, values are observational outputs of valid local intervals and should not be over-interpreted as fully de-corrupted trajectory speed.

Core outputs:

- Pair counts (`consecutivePairCount`, `forwardValidCount`)
- Rejection taxonomy:
  - missing timestamp
  - unparsable timestamp
  - non-finite distance
  - backward time
  - zero time delta
- Time summary (`validMotionTimeSeconds`, `invalidTimeSeconds`, `invalidTimeRatio`)
- Distance and speed summaries

---

## Index Semantics

Index references are GPX-stream aligned:

- Temporal anomaly events/blocks use GPX-index semantics.
- Pairwise events use `fromIndex` and `toIndex`.

This avoids ambiguity between local array position and original GPX ordering.
It also keeps event references stable across module boundaries and post-processing.

---

## Cross-Module Consistency Expectations

Examples of expected alignment:

- `temporal.totalPointsChecked == ingestion.validPointCount`
- `sampling.timestampedPointsCount <= temporal.validParsedTimestampCount`
- `motion.forwardValidCount == sampling.positiveTimeDeltasCollected`
- `sampling.nonPositiveTimeDelta.count == motion.backwardCount + motion.zeroTimeDeltaCount`

These are consistency relations, not correction rules.

---

## Common Real-World Sources of Observed Anomalies

Observed anomalies can arise from common GPX production workflows, including:

- partial device exports or interrupted writes
- stitching/merging of multiple GPX segments with clock inconsistencies
- timezone conversion errors or clock drift
- paused/resumed logging behavior
- mixed-source aggregation (app export + edited segments)
- platform-specific timestamp formatting differences

This list is contextual and non-causal.

---

## Validation Position

Pipeline behavior is validated through synthetic/adversarial GPX suites to stress edge conditions and verify anomaly logic under controlled patterns.  
Reproducibility is anchored to the tracked fixture corpus and current `main` workbench flow; dataset-scale prevalence/intensity analysis remains a separate reporting layer.

---

## Observation-First Outlier Policy

This pipeline is an audit layer.  
It reports what exists in the GPX stream; it does not force interpretation.

Therefore:

- extreme values are retained as observations
- no automatic "bad data" attribution is made in this stage
- interpretation/thresholding belongs to downstream analysis layers

---

## Current Limitation

A major pipeline limitation is that sampling regime detection is currently implemented for **time-based sampling only**.  
Distance-based sampling regime detection is not yet implemented at equivalent depth.

Backtracking classification is currently chronology-anchor based only.  
The pipeline does not yet distinguish whether a backtracking run is a true linear timestamp regression versus a stitched segment block that is simply behind the active temporal anchor.

---

## Glossary

- **Backtracking timestamp**: current valid timestamp is below the monotonic temporal anchor.
- **Duplicate timestamp**: current valid timestamp equals previous valid timestamp.
- **Block anomaly**: contiguous anomaly run with `length > 1`.
- **Single-point anomaly**: anomaly event not belonging to any block.
- **Sequential clustering**: clustering in original delta order.
- **Sorted clustering**: clustering after sorting deltas.
- **Normalization drift**: final deviation from stabilized cluster-center reference metrics.
- **Pair-valid estimator**: metric computed from individually valid pairs without requiring global continuity cleanliness.

---

## Out of Scope

- trajectory correction
- denoising/smoothing
- causal attribution
- semantic activity interpretation

