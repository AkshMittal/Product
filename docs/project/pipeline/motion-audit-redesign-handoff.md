# Motion audit module — redesign handoff (PLAN COMPLETE — ready for implementation)

**Status:** PLAN COMPLETE. All design decisions finalized. Cursor Composer should implement `packages/audit/pipeline/motion-audit.js` according to the specification in §10 and §11. Do not replicate the legacy implementation described in §3.

**Decisions finalized in:** design discussion session (2026-04-03). This document supersedes all earlier planning notes within it.

---

## 1. Pipeline context (product vs old "analysis only")

Originally the pipeline was a **deterministic GPX analysis** tool: audit everything observable from the file. It is now part of a **product** where **additional layers** will run after audit:

| Layer (conceptual order) | Role |
|--------------------------|------|
| **Audit** | Observation only: mechanical predicates on the raw stream. No silent repair. No "this is wrong" verdict — only "this matches predicate P." |
| **Correction / outlier handling** | Uses audit (and geometry) to build **masks**, drop or adjust points/edges, stitch order, etc. |
| **Smoothing** | Optional, explicit, versioned; operates on corrected or masked data. |
| **Interpretation / kinematic plausibility** | Richer models; **not** the first cleanup step. |
| **User-facing metrics** | Distance, moving time, summaries — intended to come **after** correction/smoothing. |

**Implication for motion audit:** Motion audit is a **pure flagging layer**. It does not compute kinematics. It does not produce user-facing metrics. It produces the exclusion masks that downstream correction and metrics layers use to decide which pairs are eligible for which computations.

---

## 2. Why keep a motion module in audit at all?

- **Temporal audit** is **point-centric** (missing time, unparsable, ordering/repeats).
- **Motion audit** is **pair-centric** (consecutive adjacent steps in ingestion order): it describes which adjacent edges are mechanically unusable or ambiguous for **specific dimensions of kinematic computation** on the **raw stream**.
- Downstream **exclusion logic** needs a **deterministic, reproducible list** of flagged pairs keyed by dimension (time, geometry, elevation) without baking correction policy into audit.

Motion audit in the redesign is:

1. **Inventory of pair-level pathologies** for the raw stream — one entry per anomalous pair.
2. **Input to exclusion masks** for correction/smoothing/metrics pipelines.
3. **Strict separation:** what is observable per adjacent pair vs what is computable by downstream.

---

## 3. Legacy implementation (reference only — do NOT replicate)

**File:** `packages/audit/pipeline/motion-audit.js`
**Entry:** `auditMotion(points)`

**What the legacy code does (do not replicate this logic):**

- Uses **anchored timestamp chaining**: `prevPoint` / `prevTimestampMs` advance only when the current point has a parseable timestamp. This means a "motion pair" in the legacy code can span multiple physical GPX points. **This is removed in the redesign.**
- Accumulates `totalForwardValidDistanceMeters`, `validMotionTimeSeconds`, speed samples, invalid-time ratios. **All aggregate stats are removed in the redesign.**
- Classifies pairs into **mutually exclusive primary buckets** (forward-valid, backward, zero, missing, unparsable, nonFiniteDistance). **Bucket model replaced by non-exclusive tags.**
- Returns `forwardValidPairCount` explicitly. **Removed — derivable by downstream.**

**Why it is being replaced:** The anchored chaining model produces motion pairs that bridge across timestamp gaps, requiring re-labeling of the same timestamp conditions already observed by temporal audit. Aggregate stats (distance, time, speed) invite misreading as product truth and belong downstream. The bucket model hides overlapping facts.

---

## 4. Timestamp module as the template

**Docs:** `docs/project/pipeline/timestamp-audit.md`
**Code:** `packages/audit/pipeline/timestamp-audit.js`
**ADR:** `docs/adr/audit/0002-timestamp-audit-label-based-architecture.md`

The motion redesign follows the same label-based architecture:

| Concept | Temporal (points) | Motion (pairs) — implemented |
|--------|-------------------|--------------------------------------|
| **Grain** | Per **point** (`gpxIndex`) | Per **adjacent pair** (`fromGpxIndex`, `toGpxIndex`) |
| **Non-exclusive tags** | Multiple booleans on one point | Multiple booleans on one anomalous pair |
| **Sparse output** | Only **anomalous** points in `pointAnnotations` | Only **anomalous** pairs in `pairAnnotations` |
| **Indexes** | `tagCounts` + `tagIndex` (arrays of gpxIndex) | `tagCounts` + `tagIndex` (arrays of pair identity objects) |
| **No "normal" label** | No tag for "point is fine" | No tag for "pair is forward-valid" — absence = not flagged |
| **Honesty** | No annotation ≠ certified correct | No annotation ≠ certified correct — only "no predicate fired" |

**Key difference from temporal:** Temporal audit has no derived stats (no "total valid time"). Motion audit also has no derived stats in the redesign. All kinematics (speed, distance, Δele, 3D quantities) are computed by downstream layers.

---

## 5. Downstream consumption model (exclusion, not inclusion)

Downstream correction/metrics layers use **exclusion checks**:

- Start from the full set of adjacent pairs.
- **Remove** pairs that appear in the relevant audit `tagIndex` sets.
- Compute kinematics on the remaining eligible pairs from raw point data (lat, lon, ele, finite `timeMs` from ingestion).

**Examples:**

| Downstream computation | Exclude from motion tagIndex |
|---|---|
| Horizontal speed (Δd/Δt) | `timeUnresolvable` ∪ `backwardTime` ∪ `zeroTimeDelta` ∪ `nonFiniteDistance` |
| 3D speed (√(Δd²+Δele²)/Δt) | all of the above ∪ `eleUnresolvable` |
| Δele for terrain profile | `eleUnresolvable` only |
| Distance accumulation | `nonFiniteDistance` ∪ `timeUnresolvable` (if time-conditioned) |

**Do not** require every eligible pair to carry an explicit `forwardValid` tag — that is inclusion-based and conflicts with the label model.

**Gap regions (e.g. points 2–15 all have missing/unparsable timestamps):**
Motion audit emits `timeUnresolvable` for pairs (2,3), (3,4), …, (14,15), each with `ddMeters` where the geometry is available. Motion audit does NOT bridge the gap or compute a regional average speed. Downstream sees the contiguous run in `tagIndex.timeUnresolvable`, consults temporal audit's `tagIndex.missing` / `tagIndex.unparsable` to understand WHY those timestamps are broken, and computes whatever regional kinematic estimate it needs using the boundary timestamps and the geometry it has. This avoids redundant re-labeling of timestamp conditions already expressed by temporal audit.

---

## 6. Horizontal vs 3D — overlap of dimensions

**ADR:** `docs/adr/audit/0007-3d-motion-audit-extension-scope.md` (amended 2026-04-03 — see ADR for updated scope)

**Decision (amended):** 3D eligibility is flagged in the motion module via the `eleUnresolvable` tag. The motion module does NOT compute or emit 3D derived values (Δele, 3D distance, 3D speed, inclination). Downstream computes these from raw `ele` values using the exclusion sets. This is consistent with the pure-flagging architecture adopted for the redesign.

**`eleUnresolvable` predicate:**
Fires when one or both endpoints of the adjacent pair have `ele === null` OR `ele < validFloorM` OR `ele > validCeilingM`. This predicate is evaluated **independently on every adjacent pair regardless of time or distance tag status**. Elevation observability is independent of temporal observability — a pair can be both `timeUnresolvable` and `eleUnresolvable` simultaneously.

**Module independence for ele bounds check:**
Motion audit re-implements the ele validity bounds check (`[validFloorM, validCeilingM]`) independently. It does not import from the elevation audit module. Modules stay independent.

---

## 7. All design decisions — resolved

Previously this section listed open questions. All are now resolved:

| # | Question | Decision |
|---|---|---|
| 1 | Pair identity: `(fromGpxIndex, toGpxIndex)` vs sequential index | Use `(fromGpxIndex, toGpxIndex)` — always physically adjacent in ingestion order. |
| 2 | Aggregates: keep or drop | **All aggregate stats removed** from motion audit. No speed, no distance totals, no time totals, no `invalidTimeShare`. Downstream computes kinematics. |
| 3 | Shared ele validity definition | Motion re-implements the same bounds check independently. No shared helper. Module independence preferred. |
| 4 | Glossary + export schema | `audit.motion` section in `json-schema-v2-glossary.md` updated in this session. `audit-export-module.js` must be updated alongside implementation to reflect new shape. |
| 5 | Adversarial suite | Extend `metric()` / fixtures for new motion fields after implementation. |
| 6 | ADR amendments | ADR-0007 and ADR-0008 amended in this session. |
| 7 | `forwardValidPairCount` | **Removed.** Not emitted. Downstream derives it as `consecutivePairCount - pairAnnotations.length`. **Critical:** do NOT derive as `consecutivePairCount - sum(tagCounts)` — tags are non-exclusive and can stack on the same pair, causing double-counting. |
| 8 | Anchored chaining | **Removed entirely.** Motion audit evaluates every physically adjacent pair `(points[i-1], points[i])`. No `prevTimestampMs` anchor. No bridging across timestamp gaps. |
| 9 | 3D scope | Implemented in this redesign. Flagging via `eleUnresolvable` only — no emitted 3D computed values. |
| 10 | `eleUnresolvable` scope | Fires on **every** adjacent pair where ele is invalid on one or both endpoints — regardless of time or distance tag status. |

---

## 8. ADR index — files the implementer should read

All under `docs/adr/audit/`:

| ADR | File | Relevance |
|-----|------|-----------|
| 0002 | `0002-timestamp-audit-label-based-architecture.md` | Label/hybrid output pattern; non-exclusive tags; sparse annotations. **Primary template.** |
| 0003 | `0003-time-deltas-bridge-gaps-elevation-deltas-adjacent-only.md` | Why gap-bridging was correct for sampling audit Δt but NOT for motion audit pairs. Motion audit now uses adjacent-only — aligned with the "adjacent" side of this ADR. |
| 0005 | `0005-directional-vector-variance-not-audit-artifact.md` | No bearing/speed variance clustering or normative "anomalous segment" in audit. |
| 0006 | `0006-elevation-audit-module-scope.md` | Ele channel scope; ele validity bounds (`validFloorM`, `validCeilingM`). Motion re-implements the same bounds check independently. |
| 0007 | `0007-3d-motion-audit-extension-scope.md` | **Amended.** 3D belongs on motion pairs; motion flags `eleUnresolvable`; computed 3D values emitted by downstream. |
| 0008 | `0008-audit-field-combination-ownership.md` | **Amended.** Motion audit owns the eligibility determination for `Δd/Δt` and 3D quantities; downstream computes them. |
| 0012 | `0012-ingestion-only-time-parse.md` | Motion (and sampling/temporal) use finite ingestion `timeMs` only; no `Date.parse` on `timeRaw` in audit modules. |

Hub: `docs/adr/README.md` → `docs/adr/audit/README.md`

---

## 9. Related module docs (update after implementation)

- `docs/project/pipeline/motion-audit.md` — module spec; **updated** for label-based adjacent-pair output (see file).
- `docs/project/pipeline/timestamp-audit.md` — full label semantics reference; the template for this redesign.
- `docs/project/pipeline/elevation-audit.md` — ele validity / channel behavior; ele audit is now stable.
- `docs/project/pipeline/json-schema-v2-glossary.md` — **updated in this session** with new `audit.motion` shape.
- `docs/project/product-roadmap.md` — may still reference pre-label motion wording; refresh separately.

---

## 10. One-paragraph brief for the implementer (Cursor Composer)

> Rewrite `packages/audit/pipeline/motion-audit.js` as a **pure adjacent-pair flagging layer** following the **timestamp audit label pattern** (`docs/project/pipeline/timestamp-audit.js`). Evaluate every physically adjacent pair `(points[i-1], points[i])` — no anchored timestamp chaining, no bridging across gaps. Apply **five independent, non-exclusive predicates** per pair: `backwardTime` (Δt < 0), `zeroTimeDelta` (Δt === 0), `timeUnresolvable` (one/both endpoints unparseable or missing timestamp), `nonFiniteDistance` (haversine non-finite), `eleUnresolvable` (one/both endpoints have null or out-of-bounds `ele`). Emit only anomalous pairs in sparse `pairAnnotations`. Emit `tagCounts` and `tagIndex`. Emit only `consecutivePairCount` as the session summary. Emit **no derived stats** — no speed, no distance totals, no time totals. Accept optional `params` with `validFloorM` (default -500) and `validCeilingM` (default 9500) for the ele bounds check, which motion re-implements independently. Read §11 for the exact output shape, predicate definitions, and implementation constraints.

---

## 11. Complete implementation specification

### 11.1 Function signature

```js
function auditMotion(points, params)
```

- `points` (Array): post-ingestion valid points in ingestion order. Each point: `{ lat, lon, timeMs, gpxIndex, ele }`.
  - `timeMs`: finite number (ms) from ingestion, or `null` when no instant; motion uses **only** finite `timeMs` (no `Date.parse` on `timeRaw`).
  - `ele`: number (meters) or `null`.
  - `gpxIndex`: original GPX stream index (integer; may not be contiguous if ingestion rejected some points).
- `params` (Object, optional):
  - `validFloorM` (number, default `-500`): lower ele bound (inclusive).
  - `validCeilingM` (number, default `9500`): upper ele bound (inclusive).

### 11.2 Algorithm — single forward pass

```
for i = 1 to points.length - 1:
  prev = points[i-1]
  curr = points[i]

  // --- Timestamp resolution (finite ingestion timeMs only; see ADR-0012) ---
  prevTsMs = (typeof prev.timeMs === 'number' && isFinite(prev.timeMs)) ? prev.timeMs : NaN
  currTsMs = (typeof curr.timeMs === 'number' && isFinite(curr.timeMs)) ? curr.timeMs : NaN
  bothTimestampsFinite = isFinite(prevTsMs) && isFinite(currTsMs)

  // --- Horizontal distance ---
  ddMeters = haversine(prev.lat, prev.lon, curr.lat, curr.lon)

  // --- Ele validity (independent per endpoint) ---
  prevEleValid = (prev.ele !== null && prev.ele >= validFloorM && prev.ele <= validCeilingM)
  currEleValid = (curr.ele !== null && curr.ele >= validFloorM && curr.ele <= validCeilingM)

  // --- Predicate evaluation (all independent) ---
  tags = {}

  if not bothTimestampsFinite:
    tags.timeUnresolvable = true

  if bothTimestampsFinite:
    dtSec = (currTsMs - prevTsMs) / 1000
    if dtSec < 0:  tags.backwardTime = true
    if dtSec === 0: tags.zeroTimeDelta = true

  if !isFinite(ddMeters):
    tags.nonFiniteDistance = true

  if not (prevEleValid and currEleValid):
    tags.eleUnresolvable = true

  // --- Accumulate ---
  consecutivePairCount++

  if any tag fired:
    build pairAnnotation entry (see §11.3)
    update tagCounts and tagIndex for each fired tag
```

**Critical constraint — no anchored chaining:** Do NOT maintain a `prevTimestampMs` or `prevPoint` that advances only on valid timestamps. Every pair is `(points[i-1], points[i])` unconditionally.

**Critical constraint — no accumulated stats:** Do NOT accumulate distance totals, time totals, or speed samples. The accumulator variables `totalValidDistanceMeters`, `validMotionTimeSeconds`, `speedSamples`, `invalidTimeSeconds` from the legacy code do NOT exist in the new implementation.

### 11.3 `pairAnnotation` entry structure

One entry per anomalous pair (a pair with at least one fired tag). All applicable tags appear on the same entry — non-exclusive.

```js
{
  fromGpxIndex: <number>,   // prev.gpxIndex
  toGpxIndex:   <number>,   // curr.gpxIndex

  // Time-dimension tags (mutually exclusive with each other by math; not exclusive with others)
  timeUnresolvable: true,   // optional — omit if false
  backwardTime:     true,   // optional — omit if false
  zeroTimeDelta:    true,   // optional — omit if false

  // Raw observed values (present only when the relevant tag fires AND the value is meaningful)
  dtSec:    <number>,  // present when backwardTime OR zeroTimeDelta; value is Δt in seconds
  ddMeters: <number>,  // present when timeUnresolvable AND haversine is finite
                       // (if nonFiniteDistance also fires, ddMeters is non-finite → omit)

  // Geometry tag
  nonFiniteDistance: true,  // optional — omit if false

  // Elevation dimension tag (independent of time/distance tags)
  eleUnresolvable: true,    // optional — omit if false
}
```

**`ddMeters` emission rule for `timeUnresolvable` pairs:** Emit `ddMeters` if haversine is finite. If `nonFiniteDistance` also fires on the same pair, omit `ddMeters` (the `nonFiniteDistance` tag already communicates the geometry is broken). This is the only place per-pair horizontal geometry is surfaced for time-unresolvable pairs — there is no separate horizontal distance module that provides this.

**`dtSec` emission rule:** Emit when `backwardTime` or `zeroTimeDelta`. This is the raw Δt in seconds (negative for backward, zero for zero-delta). Do not emit `dtSec` on `timeUnresolvable` pairs (Δt is undefined when time is unresolvable).

### 11.4 `tagIndex` entry structure

Each tag's index is an array of pair identity objects:

```js
tagIndex: {
  backwardTime:      [ { fromGpxIndex: <n>, toGpxIndex: <n> }, ... ],
  zeroTimeDelta:     [ ... ],
  timeUnresolvable:  [ ... ],
  nonFiniteDistance: [ ... ],
  eleUnresolvable:   [ ... ]
}
```

A pair that fires multiple tags appears in **each** relevant tag's index array. This is intentional — downstream uses individual tag sets for different exclusion scenarios (see §5).

### 11.5 Complete return shape

```js
return {
  audit: {
    motion: {
      summary: {
        consecutivePairCount: <number>,   // always points.length - 1
        parameters: {
          validFloorM:   <number>,        // ele lower bound used (from params or default)
          validCeilingM: <number>         // ele upper bound used (from params or default)
        }
      },
      tagCounts: {
        backwardTime:      <number>,
        zeroTimeDelta:     <number>,
        timeUnresolvable:  <number>,
        nonFiniteDistance: <number>,
        eleUnresolvable:   <number>
      },
      tagIndex: {
        backwardTime:      [ { fromGpxIndex, toGpxIndex }, ... ],
        zeroTimeDelta:     [ ... ],
        timeUnresolvable:  [ ... ],
        nonFiniteDistance: [ ... ],
        eleUnresolvable:   [ ... ]
      },
      pairAnnotations: [
        // sparse — only anomalous pairs; one entry per pair regardless of how many tags fire
        {
          fromGpxIndex:      <number>,
          toGpxIndex:        <number>,
          timeUnresolvable?: true,
          backwardTime?:     true,
          zeroTimeDelta?:    true,
          dtSec?:            <number>,
          ddMeters?:         <number>,
          nonFiniteDistance?: true,
          eleUnresolvable?:  true
        }
      ]
    }
  }
}
```

### 11.6 What NOT to implement

The following exist in the legacy code and must NOT appear in the new implementation:

| Legacy item | Reason removed |
|---|---|
| `prevTimestampMs` / anchored chaining `prevPoint` | Replaced by adjacent-pair-only evaluation |
| `forwardValidPairCount` | Derivable as `consecutivePairCount - pairAnnotations.length`; not emitted |
| `validMotionTimeSeconds` | Derived stat — downstream computes |
| `invalidTimeSeconds` | Derived stat — downstream computes |
| `invalidTimeShareOfEvaluatedTime` | Derived ratio — downstream computes |
| `totalForwardValidDistanceMeters` | Derived stat — downstream computes |
| `speedSamples`, `meanSpeedMps`, `medianSpeedMps`, `maxSpeedMps` | Derived stats — downstream computes |
| `missingTimestampPairCount` / `unparsableTimestampPairCount` as separate counters | Collapsed into single `timeUnresolvable` tag — no re-labeling of why timestamps are broken (temporal audit owns that) |
| `backwardTimePairCount` / `zeroTimeDeltaPairCount` as top-level counters | Now in `tagCounts.backwardTime` / `tagCounts.zeroTimeDelta` |
| `rejections.events.*` arrays (legacy event shape) | Replaced by `pairAnnotations` |

### 11.7 Edge cases

- **`points.length <= 1`:** No pairs to evaluate. Return `consecutivePairCount: 0`, all `tagCounts` as `0`, all `tagIndex` arrays as `[]`, `pairAnnotations: []`.
- **Pair with `timeUnresolvable` AND `nonFiniteDistance`:** Both tags fire. `ddMeters` is NOT emitted (see §11.3 emission rule). Both appear in respective `tagIndex` arrays and in `pairAnnotations`.
- **Pair with `backwardTime` AND `eleUnresolvable`:** Both tags fire independently. `dtSec` emitted (time is parseable — backward is a valid Δt). `eleUnresolvable` emitted. One `pairAnnotations` entry with both tags.
- **All five tags on one pair:** Theoretically possible (e.g. timestamps unresolvable, haversine non-finite, and ele invalid on both ends). One `pairAnnotations` entry. That pair appears in all five `tagIndex` arrays.
- **`ele` not provided on point objects:** If `ele` is `undefined` (not `null`), treat as `null` (missing). `eleUnresolvable` fires.
- **`gpxIndex` gaps:** Points passed to `auditMotion` are post-ingestion valid points. Their `gpxIndex` values may not be contiguous (ingestion may have rejected intermediate points). This is correct and expected — do not assume `toGpxIndex === fromGpxIndex + 1` in terms of gpxIndex values. Array adjacency (i-1, i) is what defines a "pair," not gpxIndex contiguity.

### 11.8 Files to update alongside implementation

1. **`packages/audit/pipeline/motion-audit.js`** — the implementation target.
2. **`audit-export-module.js`** (wherever it lives in the packages tree) — update to reflect new `audit.motion` shape so exported JSON matches.
3. **`docs/project/pipeline/motion-audit.md`** — short module doc; expand after implementation to describe the new label-based architecture.
4. **`scripts/generate-gpx-adversarial-suite.js`** — extend `metric()` / fixtures for new motion fields (`eleUnresolvable`, `timeUnresolvable`, tag stacking cases).

---

*Document updated 2026-04-03 — plan complete. All design decisions finalized. Edit this file if decisions change during implementation.*
