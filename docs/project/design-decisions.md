# Design Decisions and Deferred Ideas

This document records explicit design choices, rejected approaches, and deferred ideas across the project — along with the reasoning behind each. The goal is to prevent the same debates from being relitigated, and to ensure that "why not" reasoning is as durable as "why yes" reasoning.

Each entry is tagged with its current status:
- **decided**: implemented or locked into the current architecture
- **deferred**: sound idea, not yet in scope, revisit at a named later layer
- **rejected**: considered and ruled out with a specific reason

---

## Audit layer scope

### Decision: Sampling rate clustering is an audit artifact
**Area**: audit / sampling  
**Status**: decided  
**Decision**: Clustering over consecutive positive time deltas (`Δt`) is audit-legitimate and is implemented in the sampling audit module.  
**Reasoning**: The clustering characterizes the recording mechanism's own behavior — how frequently the device wrote a point — which is self-contained within the stream. The input (set of `Δt` values) requires no external model. The threshold (2% relative insertion rule) is an explicit, fixed parameter. The output (cluster count, cluster statistics) carries no verdict about whether the sampling rate is "good" or "bad." Same input + same parameter = identical output always. All three audit legitimacy tests pass.  
**Cross-references**: `pipeline/sampling-audit.md`

---

### Decision: Timestamp audit uses per-point label-based architecture (not block / primary-category classification)
**Area**: audit / temporal (timestamp ordering and quality)  
**Status**: decided  

**Decision**: The timestamp audit emits **non-exclusive boolean tags** on anomalous points (`missing`, `unparsable`, `adjacentDuplicate`, `belowAnchor`, `belowPrevValid`, `nonAdjacentRepeat`), plus a hybrid payload: `tagCounts`, `tagIndex`, and sparse `pointAnnotations`. It does **not** classify each point into exactly one primary bucket (e.g. “duplicate vs backtracking”), and it does not maintain block/singleton summaries as the primary contract.

**Reasoning — why the model changed:**

1. **Downstream correction needs the full overlap, not a winner.** The correction layer must know *all* observables that apply simultaneously — for example a point that is both an adjacent duplicate *and* below the monotonic high-water mark. The old precedence model (adjacent-duplicate check before backtracking) could assign only one “primary” family, which hid structurally true facts from consumers that assumed “backtracking = everything below anchor.” Labels make every applicable fact explicit without inventing intersection types like “duplicate inside backtrack.”

2. **Fewer interpreted buckets, more facts.** Block-level summaries and mutually exclusive categories implicitly encouraged readers to treat the audit as having already decided “what kind of problem this is.” The label model stays closer to observation: each tag is a mechanical predicate on the stream at that index. Combining tags into repair strategies is explicitly deferred to later layers, which also hold geometry and continuity context.

3. **No “first occurrence is correct” leakage.** Non-adjacent repeat detection records *that* a value reappeared and *where* it first appeared (`firstOccurrenceGpxIndex`), as ordering facts only — not as a verdict on which copy is the true time. The monotonic anchor is likewise a running maximum, not a claim that any particular forward jump was valid.

4. **What was deliberately left untagged** (still non-interpretive): there is no “large forward jump” or similar timestamp-only anomaly class, because a big positive step is indistinguishable from a normal recording pause without non-audit context.

**Reasoning — computational efficiency:**

- **Stream-wide repeat detection**: `nonAdjacentRepeat` uses a `Map<timestampMs, firstGpxIndex>` for O(1) amortized lookup per point. A naive “scan all prior points for this value” approach is O(N²) in the worst case on tracks with few or no repeats.
- **Single pass**: All tags for a point are evaluated in one forward scan; no separate block-coalescing pass is required for the core contract. Block continuity remains derivable downstream if needed.

**What the new contract offers vs the old:**

- **Sparse annotations**: Only anomalous points appear in `pointAnnotations`; nominal points add no noise.
- **Dual access patterns**: `tagIndex` supports fast set queries (“all belowAnchor indices”); `pointAnnotations` supports ordered walks for correction pipelines.
- **Determinism preserved**: Same points, same order, same algorithm → same output; no randomness or policy thresholds in the temporal module.

**Cross-references**: `pipeline/timestamp-audit.md`, `pipeline/json-schema-v2-glossary.md` (`audit.temporal`)

---

### Decision: Time delta clustering uses non-adjacent pairs; elevation delta chain uses adjacent-only
**Area**: audit / sampling / elevation  
**Status**: decided  
**Decision**: The sampling audit computes `Δt` between the last and next parseable timestamp, skipping over points with missing or unparsable timestamps. The elevation audit computes `Δele` only between immediately adjacent valid-elevation points, and counts skipped pairs separately.

**Reasoning — why time deltas skip gaps:**
The clustering algorithm characterises the device's recording regime — how frequently the GPS unit wrote a point. If a device records at 1-second intervals but several consecutive points are missing timestamps, the device's physical recording interval did not change. Computing `Δt` across that gap (e.g., 5 seconds across 5 missing-timestamp points) still correctly recovers the 1-second regime. Skipping those points and pairing the last and next parseable timestamps gives the true inter-record time, which is the quantity the clustering is characterising. Non-adjacent `Δt` computation is by design: it is asking "how far apart in time were consecutive parseable recordings?" regardless of how many unparsable points lie between them.

**Reasoning — why elevation deltas do not skip gaps:**
`Δele` is not characterising a device regime. It is characterising the elevation channel's sequential behaviour — how the recorded values change step by step along the stream. Skipping over an invalid point and computing `Δele` across the gap would conflate two separate intervals into a single delta, misrepresenting the channel's local structure. A gap in the elevation chain is an observable in its own right (counted as `skippedPairsDueToMissingOrOob`), not noise to be bridged. The delta series is therefore strictly adjacent: each `Δele` is between the immediately preceding valid-elevation point and the current one, with no bridging.

**Why time-conditioned distance deltas also do not bridge gaps:**
The sampling module's `distanceDeltasMTimeConditioned` series uses `previousPoint` (updated on every array position) as the distance anchor, not the last-timestamped point. So time-conditioned distance deltas are always between physically adjacent points too. They are paired with time deltas only when the adjacent pair also happens to have a positive time delta. This keeps the distance observable honest: it represents the actual spatial step between adjacent recorded positions, not the accumulated displacement across a timestamp gap.

**Cross-references**: `pipeline/sampling-audit.md`, `pipeline/elevation-audit.md`

---

### Decision: `std(Δele)` is not an audit artifact
**Area**: audit / elevation  
**Status**: decided  
**Decision**: Standard deviation of consecutive elevation deltas is not emitted by the elevation audit module.  
**Reasoning**: Variance and deviation require a reference. For `Δele`, the natural reference would be zero (flat terrain) or the mean delta (average climb rate), but neither is meaningful in isolation. A track with a sustained 5m/step ascent has non-zero mean `Δele` by terrain, not noise. Standard deviation around that non-zero mean conflates terrain gradient with recording noise — you cannot separate them without detrending, and detrending is a processing step, not an audit step. Additionally, `std(Δele)` only becomes interpretable when cross-referenced with the sampling interval: the same spread value means something completely different at 1-second versus 30-second recording rates. A quantity that requires a second module's output to be interpretable is not self-contained and does not belong in the audit layer.  
**What audit emits instead**: min `Δele`, max `Δele`, max absolute `Δele`, zero-delta count and run statistics, raw elevation range. The characterization layer can compute spread metrics with full sampling context available.  
**Cross-references**: `pipeline/sampling-audit.md`, elevation audit module (to build)

---

### Decision: Directional and vector variance are not audit artifacts
**Area**: audit / motion  
**Status**: decided  
**Decision**: Variance or clustering over bearing changes, directional deviation, or 3D speed variance is not part of the audit layer.  
**Reasoning**: Unlike sampling rate clustering — which characterizes the recording mechanism against no external model — directional and speed variance require a reference frame for "expected" motion. Any threshold or baseline there encodes a judgment about human motion or terrain plausibility. The audit layer has no terrain model and makes no claims about what constitutes normal motion. Furthermore, it is very hard to emit deviation clusters without the output implying "these are the anomalous segments," which is exactly the kind of verdict the audit must avoid. What audit does emit per-pair: bearing, inclination, 3D displacement, 3D speed — raw geometric observables with no verdict. The question of whether their variance is significant belongs in the kinematic plausibility layer.  
**Cross-references**: motion audit module, `objective-participation-and-quality.md`

---

### Decision: Elevation audit module scope
**Area**: audit / elevation  
**Status**: decided  
**Decision**: The elevation audit module covers the recorded elevation channel only: coverage, validity, duplicates, delta statistics, and co-presence counts with other fields.  
**In scope**:
- Missing elevation coverage (count, ratio, blocks, isolated events)
- Deterministically invalid values (below/above declared explicit bounds — e.g., `< -500m` or `> 9500m`)
- Adjacent duplicate elevation runs (count, ratio, blocks, isolated events)
- Consecutive `Δele` statistics (min, max, max absolute, zero-delta count)
- Raw elevation statistics (min, max, span, first valid, last valid, parseable point count)
- Co-presence counts with time (points with both valid ele and parseable time; consecutive pairs with both valid)

**Out of scope and why**:
- `std(Δele)` — see decision above
- Accumulated gain/loss — metric-layer concept, not a stream observable
- Smoothed grade or gradient — requires processing
- Vertical speed (`Δele / Δt`) — belongs in motion audit extension (requires time)
- DEM comparison — external dependency; see DEM decisions below  

**Cross-references**: `canonical-track-architecture.md`, motion audit module

---

### Decision: 3D motion audit extension scope
**Area**: audit / motion  
**Status**: deferred (to be built after elevation audit)  
**Decision**: 3D motion observables (vertical rate, 3D displacement, 3D speed, inclination) are emitted by an extension of the motion audit module, not as a standalone vertical module.  
**Reasoning**: `ele` without `lat/lon` cannot exist in this pipeline — ingestion rejects coordinate-less points, so every point with valid `ele` automatically has valid `lat/lon`. Vertical motion (`Δele / Δt`) is not meaningful without horizontal context in mountain terrain: a 50m elevation gain over 60 seconds means something completely different depending on whether horizontal displacement is 5m or 500m. The 3D layer is therefore always layered on top of existing horizontal pairs, not computed separately. For each forward-valid horizontal pair that also has both-valid `ele`, the motion audit extension additionally emits: `Δele`, `3D_distance = √(Δd² + Δele²)`, `3D_speed = 3D_distance / Δt`, `inclination_angle`. Coverage gap (forward-valid horizontal pairs missing elevation on one or both ends) is a first-class audit observable.  
**Cross-references**: `pipeline/motion-audit.md`, elevation audit module

---

## Field combination ownership

### Decision: Which module owns each field combination
**Area**: audit / all modules  
**Status**: decided  

| Field combination | Module | What it emits |
|---|---|---|
| `ele` alone | Elevation audit | Coverage, validity bounds, duplicate runs, delta statistics |
| `ele × ele` consecutive | Elevation audit | Raw `Δele` statistics, geometry-conditioned |
| `ele ∩ time` coverage | Elevation audit | Co-presence counts and ratios (no rates) |
| `Δt` (time deltas) | Sampling audit | Time sampling intervals, clustering |
| `Δd` geometry-conditioned | Sampling audit | Distance sampling intervals |
| `Δd` time-conditioned | Sampling audit | Time-gated distance deltas |
| `Δd / Δt` | Motion audit | Horizontal speed |
| `Δele / Δt` | Motion audit (extension) | Vertical rate |
| `√(Δd² + Δele²)` | Motion audit (extension) | 3D displacement |
| `√(Δd² + Δele²) / Δt` | Motion audit (extension) | 3D speed |
| Bearing, inclination per pair | Motion audit (extension) | Angular observables (low priority) |

**Cross-references**: all audit module docs

---

## DEM (terrain model) usage

### Decision: DEM is not used during audit
**Area**: audit / elevation  
**Status**: decided  
**Decision**: The elevation audit module does not perform any DEM lookup or DEM-based comparison. The audit operates purely on the GPX stream and explicit parameters.  
**Reasoning**:
1. **External dependency breaks self-contained reproducibility.** Every other audit module is reproducible from the GPX file plus declared parameters alone. Introducing a DEM lookup means the audit output depends on the specific DEM product, resolution, and interpolation method used. That is a processing profile, not a baseline audit.
2. **Position spike entanglement.** A GPS position spike is typically a signal acquisition artifact where the receiver briefly loses lock. In that moment, `lat`, `lon`, and `ele` are all derived from the same corrupted satellite geometry simultaneously. The DEM residual at a spike point (`eleRaw - eleDEM(spike_lat, spike_lon)`) does not measure vertical GPS error — it measures noise from a corrupt fix that corrupts all three axes together. The residual is not a clean observable.
3. **Two-error entanglement on clean points.** Even on non-spike points, `eleRaw - eleDEM(lat, lon)` is a function of two independent unknowns: horizontal position error (which causes the DEM lookup to use a slightly wrong location) and vertical recording error. The audit has no way to separate them.

**Cross-references**: `canonical-track-architecture.md`, elevation audit module

---

### Decision: DEM residual analysis is valid as a post-audit quality gate step
**Area**: quality gate / elevation  
**Status**: deferred  
**Decision**: Computing `eleRaw - eleDEM(lat, lon)` per point as a quality gate step — after audit has run — is a sound approach to characterizing vertical GPS recording error.  
**Reasoning**: GPS receivers measure elevation using the same satellite geometry as horizontal position, but the measurement is independent of the horizontal coordinates at the device's actual physical location. For the typical (non-spike) population: if a device is physically at location A but records lat/lon of location B due to gradual horizontal drift, `eleRaw` is still the device's estimate of the altitude of location A, not location B. This is sensor independence (also called sensor decoupling): the vertical channel measures the device's actual altitude regardless of horizontal coordinate error. Therefore `eleRaw - eleDEM(lat, lon)` on a non-spike point gives a meaningful signal about vertical GPS error, with the DEM serving as a terrain-anchored reference. The residual distribution across the clean population characterizes the device's vertical accuracy.  
**The spike caveat**: Position spike points are excluded from the residual computation (or flagged separately) because at spike points, `ele` and `lat/lon` are all from the same corrupt satellite solution. The audit's horizontal anomaly flags identify these points, so the quality gate layer has the information needed to condition the DEM comparison correctly.  
**DEM accuracy caveat**: DEM products (SRTM, Copernicus, NASADEM) have their own vertical uncertainty (10–30m in steep mountain terrain at 30m resolution). Residual analysis should declare the DEM product and version explicitly, and report the residual distribution rather than a single threshold verdict.  
**Cross-references**: `canonical-track-architecture.md`, elevation audit module, `objective-participation-and-quality.md`

---

### Decision: Full DEM substitution for recorded elevation
**Area**: processing / elevation channels  
**Status**: deferred  
**Decision**: Using a DEM to replace recorded elevation entirely is valid only when the recorded elevation channel is systematically unusable (large-scale missing or invalid data), and only as an explicitly declared attached channel — never as a silent replacement.  
**Reasoning**: The canonical track architecture treats elevation as an attached channel with declared provenance. Replacing `eleRaw` with `eleDEM` silently would violate the honesty-first principle: the product would present model-derived altitude as if it were recorded data. Full DEM substitution must declare: DEM product and version, resolution, interpolation method, coverage, and the reason for substitution. It produces a separate channel, not a modification of the raw channel.  
**Cross-references**: `canonical-track-architecture.md`, `product-roadmap.md`
