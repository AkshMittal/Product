# ADR-correction-0015: Kinematic guard disposition — gating for single-subject proposals, advisory-with-fallback for multi-candidate competition

**Date**: 2026-04-23  
**Status**: accepted

## Context

The correction layer applies kinematic checks when placing a point or block at a new position. The check asks: does the implied speed between the placed subject and its bracket neighbours exceed a lenient ceiling?

Two distinct cases require different policy:

**Single-subject case.** Either exactly one candidate exists at a `timeMs` (a singleton-like insert) or a block is being reordered to a socket-ok position. There is **no forcing function** — if the kinematic check fails, the correct answer is often "leave this point where it is." Silently applying a kinematically-bad placement propagates bad geometry to all downstream layers (kinematic correction, smoothing, metrics). The downside risk (poisoning downstream) is asymmetric and large relative to the upside risk (missing a marginal geometry improvement).

**Multi-candidate competition case.** Multiple candidates share the same `timeMs` but have different coordinates. One of them has to be placed — the time slot is occupied by definition. The question is only which candidate to pick, not whether to place anyone. Some candidates may fail the kinematic check individually; applying a failed winner is still better than deferring when the alternative is leaving the `timeMs` slot with an equally-bad or worse occupant. The forcing function ("something must be here") changes the risk calculus.

**Exact-group case.** Multiple candidates share the same `timeMs` **and** the same geometry (lat/lon within epsilon). Kinematic check is uninformative — they are all geometrically identical. No check is run.

The kinematic score metric uses **sum of squares** of the two implied speeds (speedPrev² + speedNext²), not absolute maximum. This penalises both bracket speeds together, making it harder for a single large speed to hide behind a small one on the other side.

## Decision

### 1. Kinematic guard metric

For any candidate being placed at position P with bracket anchors `prev` and `next`:

```
speedPrevKph = haversineDistance(prev.lat, prev.lon, candidate.lat, candidate.lon)
               / (candidate.timeMs - prev.timeMs) * 3600000

speedNextKph = haversineDistance(candidate.lat, candidate.lon, next.lat, next.lon)
               / (next.timeMs - candidate.timeMs) * 3600000

score = speedPrevKph² + speedNextKph²
```

Guard threshold: both `speedPrevKph` and `speedNextKph` must be `≤ lenientMaxImpliedSpeedKph` (default **80 kph**). The score is used for winner selection in competition, not as a pass/fail threshold — the threshold is applied per-speed, not to the score.

A candidate **passes** if both bracket speeds are `≤ lenientMaxImpliedSpeedKph`. A candidate **fails** if either bracket speed exceeds the ceiling.

If the bracket anchor is missing on one side (the candidate would be the segment's first or last spine point), only the available bracket speed is checked; the missing-side check is skipped (vacuously passes).

### 2. Block-reorder (socket-ok): kinematic guard is GATING

After `overlap-detection` confirms a block is `socket-ok`:

1. Compute `speedPrevKph` using `prevAnchorPoint` (bracket `t_prev` spine point) and the block's first point.
2. Compute `speedNextKph` using the block's last point and `nextAnchorPoint` (bracket `t_next` spine point).
3. Score = speedPrevKph² + speedNextKph².

| Guard outcome | Action |
|---|---|
| Pass (both speeds ≤ threshold) | Apply block-reorder. |
| Fail (either speed > threshold) | **Do not apply.** Annotation `block_reorder_kinematic_guard_failed` (proposal-scope) with `details.kinematics` payload. All block member `gpxIndexes` → `excludedFromTrust` with reason `block_kinematic_guard_failed`. Proposal `applied: false`, `skipReason: 'kinematic_guard_failed'`. |

Block-reorder kinematic check runs **after** the socket and coupling checks. A block that is overlap-vetoed or coupling-blocked never reaches the kinematic check.

### 3. Insert length=1 (single-subject): kinematic guard is GATING

An `insert` proposal with `candidates.length === 1` and `isExactGroup: false`:

1. Compute bracket speeds using the candidate's `tPrev`/`tNext` bracket.
2. Score = speedPrevKph² + speedNextKph².

| Guard outcome | Action |
|---|---|
| Pass | Apply — move the candidate to its target position. |
| Fail | **Do not apply.** Annotation `insert_kinematic_guard_failed` (proposal-scope) with `details.kinematics` payload. The candidate `gpxIndex` → `excludedFromTrust` with reason `insert_kinematic_guard_failed`. Proposal `applied: false`, `skipReason: 'kinematic_guard_failed'`. |

### 4. Insert length≥2 (multi-candidate competition): advisory-with-fallback

An `insert` proposal with `candidates.length ≥ 2` and `isExactGroup: false`:

1. Compute kinematic score for each candidate.
2. Partition into passers (both bracket speeds ≤ threshold) and failers.
3. **Tiebreaker for equal scores:** lowest `gpxIndex`.

| Passer count | Action |
|---|---|
| ≥1 | Apply the passer with the **lowest score** (sum of squares). Annotation `insert_competition_resolved` (proposal-scope) with winner `gpxIndex` and per-candidate `kinematics` in details. Non-winners → `excludedFromTrust` reason `insert_competition_loser`. |
| 0 (all fail) | Apply the candidate with the **lowest score** (sum of squares) as fallback winner. Annotation `insert_competition_kinematic_guard_failed` (proposal-scope) with full per-candidate kinematics. Non-winners → `excludedFromTrust` reason `insert_competition_loser`. Proposal `applied: true` (the winner is placed; the competition is resolved). |

**Rationale for all-fail fallback:** the `timeMs` slot is occupied by competing candidates regardless of the check outcome. Not applying anything means the worst-scoring candidate remains in place by default — which is at least as bad as applying the best available. The score comparison ensures the least-bad candidate is selected. The annotation `insert_competition_kinematic_guard_failed` makes the forced pick auditable.

### 5. Insert isExactGroup=true: no kinematic check

Geometry-identical candidates. The check is uninformative. Drop all but one (lowest `gpxIndex`) or flag per MVP policy (ADR-correction-0006 / ADR-correction-0012).

### 6. Score payload in annotations

Every kinematic-outcome annotation carries `details.kinematics` conforming to `KinematicCheck` (defined in ADR-correction-0012):

```ts
{
  speedPrevKph: number | null,
  speedNextKph: number | null,
  score: number | null,
  thresholdKph: number,
  passed: boolean,
  failReason?: 'speed_prev_exceeded' | 'speed_next_exceeded' | 'both_exceeded' | 'no_bracket'
}
```

For competition annotations, `details.candidates` is an array of per-candidate `KinematicCheck` objects, keyed by `gpxIndex`, so the full competition picture is inspectable.

### 7. Parameter snapshot

Every kinematic annotation also carries `details.parametersSnapshot.lenientMaxImpliedSpeedKph` (the value used at time of check). This ensures the check is reproducible and auditable even if the default is later changed.

## Alternatives Considered

### Alternative 1: Apply-with-annotation for all guard failures (original plan)

Apply every proposal, including single-subject guard failures, and annotate.

- **Pros:** Maximizes the number of corrections applied.
- **Cons:** Silently applies kinematically-bad geometry for single-subject cases. If the block doesn't belong at that location (temporally garbage), every downstream layer receives poisoned geometry. The two failure sub-cases — (a) neighbours are actually correct large jumps with no flags and (b) the block genuinely doesn't belong — both get the same silent treatment. Case (b) is actively detrimental.
- **Why not:** The downside risk (bad geometry in canonical) is asymmetric for single-subject cases. Not applying is safe — the point stays in place and is excluded from trust if the guard fails. This is the user's explicit decision.

### Alternative 2: Kinematic guard as purely advisory for all cases (no gating)

Compute scores, emit annotations, never gate apply.

- **Pros:** Maximum correction throughput.
- **Cons:** Same as Alternative 1 — bad geometry silently enters canonical for single-subject cases.
- **Why not:** The gating/advisory distinction is intentional and asymmetric: single-subject has no forcing function, competition does.

### Alternative 3: No fallback for all-fail competition — defer the slot

If all competition candidates fail, mark as `exact_group_unresolved` and exclude all from trust.

- **Pros:** Never applies a kinematically-bad winner.
- **Cons:** The `timeMs` slot had a valid occupant before the competition was detected. Excluding all candidates means the slot is empty, which is worse than placing the least-bad candidate. The forcing function argument applies here: something must be at this `timeMs`.
- **Why not:** The all-fail fallback is the correct conservative choice for competition. The annotation makes the forced pick transparent and auditable.

### Alternative 4: Use max(speedPrev, speedNext) instead of sum of squares for score

- **Pros:** Simpler; directly penalises the worst single bracket speed.
- **Cons:** A candidate with both bracket speeds at 79 kph (just under threshold) scores the same as one with speeds 0 kph and 79 kph under max(), but is kinematically much worse in aggregate.
- **Why not:** Sum of squares penalises both bracket speeds simultaneously, which better reflects overall kinematic plausibility at the placement site.

### Alternative 5: Apply lowest `gpxIndex` as tiebreaker, not lowest score

Use `gpxIndex` as primary tiebreaker in all competition cases.

- **Pros:** Deterministic without computing scores.
- **Cons:** Document order (`gpxIndex`) is not a reliable proxy for kinematic quality. Two candidates with identical geometry but different indices would be decided by arbitrary document position.
- **Why not:** Score (sum of squares) is the primary sort; lowest `gpxIndex` is tiebreaker only when scores are equal. This preserves determinism while preferring the kinematically better candidate.

## Consequences

### Positive

- Single-subject guard failures are safe: the point stays where it is, excluded from trust if needed. No downstream poisoning.
- Competition always resolves — the `timeMs` slot is always filled by the least-bad available candidate.
- Per-candidate kinematic payloads in annotations make competition decisions fully auditable without re-deriving the geometry.
- `parametersSnapshot` in each annotation ensures reproducibility after threshold parameter changes.

### Negative

- Single-subject failures that are false positives (the block or singleton actually belongs there but the bracket speed check fires) are excluded from trust and never applied. These require manual investigation via annotations.
- The 80 kph default is conservative for mountaineering contexts where short steep descents can produce high GPS-derived speeds; this may cause legitimate singletons/blocks to fail the guard. The parameter is versioned and can be tuned post-MVP with real data.

### Risks

- Block-reorder bracket speeds depend on bracket anchor point quality. If the anchor is itself an anomalous point (not on the spine but used as anchor due to MVP bracket selection policy), the check may fire spuriously. Spine-based bracket selection (ADR-correction-0006) mitigates this but does not eliminate it.
- The `no_bracket` fail reason (missing anchor on one side) must be handled gracefully — check only the available side; log `no_bracket` in `details.kinematics.failReason`.
