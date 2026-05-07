<!-- generated-by: gsd-doc-writer -->
# kinematic-guard

**File:** `packages/correction/apply/kinematic-guard.js`

## Overview

Shared kinematic feasibility primitive. Computes the implied speeds between a candidate point and its bracket anchors, then passes or fails the candidate against a speed ceiling.

Used by `resolution-apply.js` for both GATING (hard fail) and ADVISORY (soft fail with fallback) dispositions. Also used by `singleton-proposal.js` and `duplicate-proposal.js` to pre-compute per-candidate kinematic payloads at proposal-build time.

Reference: ADR-correction-0015.

## API

```js
const { computeKinematicCheck } = require('./apply/kinematic-guard');

const check = computeKinematicCheck(
  prevAnchor,    // { lat, lon, timeMs }|null
  candidate,     // { lat, lon, timeMs }
  nextAnchor,    // { lat, lon, timeMs }|null
  thresholdKph   // number — default 80
);
```

### KinematicCheck shape

```js
{
  speedPrevKph: number | null,   // null if prevAnchor absent
  speedNextKph: number | null,   // null if nextAnchor absent
  score:        number | null,   // speedPrev² + speedNext² (partial if one side null)
  thresholdKph: number,
  passed:       boolean,
  failReason?:  'speed_prev_exceeded' | 'speed_next_exceeded' | 'both_exceeded' | 'no_bracket'
}
```

## Pass/fail rules

| Condition | Result |
|---|---|
| Both anchors null | `passed = false`, `failReason = 'no_bracket'` |
| Both speeds ≤ threshold | `passed = true` |
| `speedPrevKph > threshold` only | `passed = false`, `failReason = 'speed_prev_exceeded'` |
| `speedNextKph > threshold` only | `passed = false`, `failReason = 'speed_next_exceeded'` |
| Both speeds > threshold | `passed = false`, `failReason = 'both_exceeded'` |

Missing bracket on one side vacuously passes that side. A missing bracket on BOTH sides always fails with `no_bracket`.

## Degenerate time deltas

- `dtPrev === 0` → `speedPrevKph = Infinity` (instant distance, fails threshold)
- `dtPrev < 0` → `speedPrevKph = NaN` (same; NaN > threshold = false, so effectively vacuous pass — caller should not present negative-delta brackets)

## Score

`score = speedPrevKph² + speedNextKph²` (sum of squares). Used by `resolution-apply.js` to rank competition candidates when multiple candidates exist for the same insert slot. Lower score = kinematically closer fit.

If only one side is available, score uses that side only.

## Default threshold

`80 kph` (ADR-0015). Overridden via `params.lenientMaxImpliedSpeedKph` passed down from the correction runner.

## Speed calculation

Uses `haversineMeters` from `packages/shared/geo/haversine.js`:

```
speed (kph) = distanceMeters / deltaTimeMs * 3,600,000 / 1,000
```

## Related modules

- `apply/resolution-apply.js` — primary consumer; applies GATING and ADVISORY dispositions
- `packages/shared/geo/haversine.js` — `haversineMeters` for distance
- `params/defaults.js` — `lenientMaxImpliedSpeedKph` default value
