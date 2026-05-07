<!-- generated-by: gsd-doc-writer -->
# spine-intervals

**File:** `packages/correction/spine/spine-intervals.js`

## Overview

Computes per-segment spine points and spine envelopes. The spine is the forward-monotonic, duplicate-free subsequence of a segment's points used as a stable temporal reference by overlap-detection, coupling-detection, and edge-reconciliation.

Reference: ADR-correction-0010, ADR-correction-0014.

## API

```js
const {
  computeSpineIntervals,
  computeSpineResult,
  attachSpineEnvelopes
} = require('./spine/spine-intervals');
```

### computeSpineResult (primary)

```js
const result = computeSpineResult(workingOrderedPoints);
// returns {
//   spinePointsBySegment:          Map<trkSegIndex, spinePoints[]>,
//   envelopeBySegment:             Map<trkSegIndex, { minTimeMs, maxTimeMs }>,
//   duplicateTimeMembersBySegment: Map<trkSegIndex, Set<gpxIndex>>
// }
```

Full result object; used by `phase1-loop.js`, `edge-reconciliation.js`, and `phase3/residual-diagnostic-sweep.js`.

### computeSpineIntervals (lightweight)

```js
const map = computeSpineIntervals(workingOrderedPoints);
// returns Map<trkSegIndex, spinePoints[]>
```

Convenience wrapper for callers that only need spine points (e.g. `overlap-detection.js` in tests).

### attachSpineEnvelopes

```js
attachSpineEnvelopes(segmentProfiles, envelopeBySegment);
// mutates each profile to add { spineEnvelope: { minTimeMs, maxTimeMs } }
```

## Spine point definition

A point is a spine member for its segment when **all** of the following hold:

1. `timeMs` is a finite number strictly > 0
2. `timeMs` is strictly greater than the previous accepted spine point's `timeMs` (forward-monotonic greedy walk)
3. `timeMs` is NOT in a duplicate-time cluster (any `timeMs` that appears more than once within the segment is excluded entirely from the spine)

Computation does not cross `trkSegIndex` boundaries.

## Duplicate-time cluster detection

Before the monotonic walk, all `timeMs` values that appear more than once within a segment are identified. Every point with such a `timeMs` is added to `duplicateTimeMembersBySegment` and excluded from spine membership.

These clusters correspond to the same-`timeMs` groups that `duplicate-proposal.js` handles. Excluding them from the spine ensures overlap-detection and coupling-detection use only stable temporal references.

## Envelope

The spine envelope for a segment is `{ minTimeMs, maxTimeMs }` over the spine points. Used by:
- `block-proposal.js` and `singleton-proposal.js` — edge-proposal classification
- `overlap-detection.js` — bracket anchor search range
- Phase 2 boundary stability checks

If a segment has no spine points, envelope is `{ minTimeMs: null, maxTimeMs: null }`.

## Recomputation

`computeSpineResult` is called once per Phase 1 pass (on the current `workingOrderedPoints` snapshot) because prior-pass mutations may have changed which points form the spine.

## Related modules

- `gates/overlap-detection.js` — consumes `spinePointsBySegment`
- `gates/coupling-detection.js` — uses traversal neighbours (not spine directly, but spine stability underpins reference validity)
- `runner/phase1-loop.js` — calls `computeSpineResult` at the start of each pass
- `phase2/edge-reconciliation.js` — uses `spinePointsBySegment` for boundary stability tests
- `phase3/residual-diagnostic-sweep.js` — accepts `spineResult` for coverage reporting
