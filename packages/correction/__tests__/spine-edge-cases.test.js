'use strict';

/**
 * Spine intervals — edge cases and pathological inputs.
 *
 * Goal: stress the spine algorithm beyond its happy path.
 *   - empty / single-point inputs
 *   - all-points-share-time clusters
 *   - inter-segment isolation (hard wall per ADR-correction-0014)
 *   - non-finite timestamps (NaN / Infinity / null / missing)
 *   - duplicate-time clusters of size 2, 3, N
 *   - non-monotone trailing tail
 *   - spine across input ordering perturbations
 */

const { computeSpineIntervals } = require('../spine/spine-intervals');
const { makePoint, cleanTrack, multiSegmentTrack, T0 } = require('./_helpers/fixtures');

describe('spine: degenerate inputs', () => {
  test('empty input → empty map', () => {
    const m = computeSpineIntervals([]);
    expect(m.size).toBe(0);
  });

  test('single point with valid time → one-element spine', () => {
    const m = computeSpineIntervals([makePoint({ gpxIndex: 0, timeMs: T0 })]);
    expect(m.get(0)).toHaveLength(1);
  });

  test('single point with null time → empty spine', () => {
    const m = computeSpineIntervals([makePoint({ gpxIndex: 0, timeMs: null })]);
    expect(m.get(0) || []).toHaveLength(0);
  });

  test('single point with NaN time → excluded', () => {
    const m = computeSpineIntervals([makePoint({ gpxIndex: 0, timeMs: NaN })]);
    expect(m.get(0) || []).toHaveLength(0);
  });

  test('single point with Infinity time → excluded', () => {
    const m = computeSpineIntervals([makePoint({ gpxIndex: 0, timeMs: Infinity })]);
    expect(m.get(0) || []).toHaveLength(0);
  });
});

describe('spine: duplicate-time cluster handling', () => {
  test('cluster of 3 → all three excluded', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 0    }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000 }),
      makePoint({ gpxIndex: 2, timeMs: T0 + 1000 }),
      makePoint({ gpxIndex: 3, timeMs: T0 + 1000 }),
      makePoint({ gpxIndex: 4, timeMs: T0 + 2000 }),
    ];
    const ids = computeSpineIntervals(pts).get(0).map(p => p.gpxIndex);
    expect(ids).toEqual([0, 4]);
  });

  test('non-adjacent same-time pair both excluded', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 1000 }), // dup
      makePoint({ gpxIndex: 1, timeMs: T0 + 2000 }),
      makePoint({ gpxIndex: 2, timeMs: T0 + 1000 }), // dup
      makePoint({ gpxIndex: 3, timeMs: T0 + 3000 }),
    ];
    const ids = computeSpineIntervals(pts).get(0).map(p => p.gpxIndex);
    expect(ids).not.toContain(0);
    expect(ids).not.toContain(2);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
  });

  test('all points share one timestamp → empty spine', () => {
    const pts = Array.from({ length: 5 }, (_, i) =>
      makePoint({ gpxIndex: i, timeMs: T0 + 1000 })
    );
    expect(computeSpineIntervals(pts).get(0)).toHaveLength(0);
  });
});

describe('spine: monotonicity boundary', () => {
  test('exactly equal times back-to-back → both excluded as duplicate-cluster', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 100 }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 100 }),
    ];
    expect(computeSpineIntervals(pts).get(0)).toHaveLength(0);
  });

  test('backward step → backward point silently excluded', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 0    }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000 }),
      makePoint({ gpxIndex: 2, timeMs: T0 +  500 }), // backward
      makePoint({ gpxIndex: 3, timeMs: T0 + 2000 }),
    ];
    const ids = computeSpineIntervals(pts).get(0).map(p => p.gpxIndex);
    expect(ids).toEqual([0, 1, 3]);
  });

  test('long backward run after a forward prefix', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 0    }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000 }),
      makePoint({ gpxIndex: 2, timeMs: T0 + 2000 }),
      // backward run of 5
      makePoint({ gpxIndex: 3, timeMs: T0 + 1500 }),
      makePoint({ gpxIndex: 4, timeMs: T0 + 1400 }),
      makePoint({ gpxIndex: 5, timeMs: T0 + 1300 }),
      makePoint({ gpxIndex: 6, timeMs: T0 + 1200 }),
      makePoint({ gpxIndex: 7, timeMs: T0 + 1100 }),
      makePoint({ gpxIndex: 8, timeMs: T0 + 3000 }),
    ];
    const ids = computeSpineIntervals(pts).get(0).map(p => p.gpxIndex);
    expect(ids).toEqual([0, 1, 2, 8]);
  });
});

describe('spine: segment isolation hard wall', () => {
  test('two segments, each computed independently', () => {
    const pts = multiSegmentTrack(2, 4);
    const m = computeSpineIntervals(pts);
    expect(m.size).toBe(2);
    expect(m.get(0)).toHaveLength(4);
    expect(m.get(1)).toHaveLength(4);
  });

  test('time overlap across segments does NOT poison the other segment', () => {
    // Seg 0: t ∈ [0, 100], Seg 1: t ∈ [50, 60] — same-time across segments OK
    const pts = [
      makePoint({ gpxIndex: 0, trkSegIndex: 0, timeMs: T0 + 0   }),
      makePoint({ gpxIndex: 1, trkSegIndex: 0, timeMs: T0 + 50  }),
      makePoint({ gpxIndex: 2, trkSegIndex: 0, timeMs: T0 + 100 }),
      makePoint({ gpxIndex: 3, trkSegIndex: 1, timeMs: T0 + 50  }), // shares time with seg-0 idx 1
      makePoint({ gpxIndex: 4, trkSegIndex: 1, timeMs: T0 + 60  }),
    ];
    const m = computeSpineIntervals(pts);
    expect(m.get(0).map(p => p.gpxIndex)).toEqual([0, 1, 2]);
    expect(m.get(1).map(p => p.gpxIndex)).toEqual([3, 4]);
  });

  test('one segment empty (all duplicates) does not affect siblings', () => {
    const pts = [
      makePoint({ gpxIndex: 0, trkSegIndex: 0, timeMs: T0 + 100 }),
      makePoint({ gpxIndex: 1, trkSegIndex: 0, timeMs: T0 + 100 }),
      makePoint({ gpxIndex: 2, trkSegIndex: 1, timeMs: T0 + 200 }),
      makePoint({ gpxIndex: 3, trkSegIndex: 1, timeMs: T0 + 300 }),
    ];
    const m = computeSpineIntervals(pts);
    expect(m.get(0)).toHaveLength(0);
    expect(m.get(1)).toHaveLength(2);
  });
});

describe('spine: large input', () => {
  test('1000-point clean track → 1000 spine points', () => {
    const m = computeSpineIntervals(cleanTrack(1000));
    expect(m.get(0)).toHaveLength(1000);
  });

  test('1000-point track with every other point a duplicate-time cluster', () => {
    const pts = [];
    for (let i = 0; i < 1000; i++) {
      pts.push(makePoint({
        gpxIndex: i,
        timeMs: T0 + (i % 2 === 0 ? i * 1000 : (i - 1) * 1000) // 0 and 1 share, 2 and 3 share, ...
      }));
    }
    const ids = computeSpineIntervals(pts).get(0).map(p => p.gpxIndex);
    // every point is in a duplicate pair → empty
    expect(ids).toHaveLength(0);
  });
});
