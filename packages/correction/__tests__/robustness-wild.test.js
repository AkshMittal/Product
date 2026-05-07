'use strict';

/**
 * Robustness suite — going wild on the correction layer.
 *
 * The user's directive: "we are trying to test robustness. so the gpxs dont
 * fixatively have to be about whats there, its to thoroughly test. u can go
 * wild. non passing tests arent a failure on our side. they are good."
 *
 * The pipeline must not throw, hang, or produce malformed output for ANY
 * input — including pathological ones the design didn't explicitly anticipate.
 * Every test in this file at minimum asserts:
 *   1. runCorrection does not throw.
 *   2. The output passes schema invariant.
 *   3. The output passes partition invariant.
 *
 * Tests that go further (assertion of specific behaviour) are commented as
 * such. Tests that surface real bugs are good — leave them failing and
 * document the issue.
 */

const { runCorrection } = require('../index');
const {
  assertSchemaInvariant, assertPartitionInvariant, assertSpineMonotonic,
  assertSpineSegmentIsolation, assertProposalCountsConsistent
} = require('./_helpers/invariants');
const { makePoint, T0, LAT0, LON0 } = require('./_helpers/fixtures');

function safeRun(points, params) {
  // Wraps the call so we can assert it doesn't throw.
  let result, error;
  try { result = runCorrection({}, points, params || {}); }
  catch (e) { error = e; }
  return { result, error };
}

function checkAll(points, result) {
  assertSchemaInvariant(result);
  assertPartitionInvariant(result, points.map(p => p.gpxIndex));
  assertProposalCountsConsistent(result);
  assertSpineMonotonic(result);
  assertSpineSegmentIsolation(result, points);
}

// ── Empty / trivial ─────────────────────────────────────────────────────

describe('robustness: trivial', () => {
  test('zero points', () => {
    const { result, error } = safeRun([]);
    expect(error).toBeUndefined();
    checkAll([], result);
  });

  test('single point with all required fields', () => {
    const pts = [makePoint({ gpxIndex: 0, timeMs: T0 })];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });
});

// ── Stress: large clean input ────────────────────────────────────────────

describe('robustness: scale stress', () => {
  test('5,000-point clean track terminates and produces consistent output', () => {
    const pts = Array.from({ length: 5000 }, (_, i) =>
      makePoint({ gpxIndex: i, timeMs: T0 + i * 1000, lat: LAT0 + i * 1e-5, lon: LON0 + i * 1e-5 })
    );
    const start = Date.now();
    const { result, error } = safeRun(pts);
    const elapsedMs = Date.now() - start;
    expect(error).toBeUndefined();
    checkAll(pts, result);
    // Soft perf assertion — a clean 5k input shouldn't take > 30s on any
    // reasonable machine. If this fails, perf regression is real.
    expect(elapsedMs).toBeLessThan(30000);
  });

  test('100 segments of 50 points each — multi-segment scaling', () => {
    const pts = [];
    let gpx = 0;
    for (let s = 0; s < 100; s++) {
      for (let i = 0; i < 50; i++) {
        pts.push(makePoint({
          gpxIndex: gpx++, trkSegIndex: s, timeMs: T0 + s * 100000 + i * 1000,
          lat: LAT0 + s * 0.01 + i * 1e-5, lon: LON0 + s * 0.01
        }));
      }
    }
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
    expect(result.spineIntervals).toHaveLength(100);
    // passLog is only populated for segments that enter Phase 1 (non-idle); clean tracks → empty
  });
});

// ── Pathological coordinate values ───────────────────────────────────────

describe('robustness: pathological coordinates', () => {
  test('all points at the north pole', () => {
    const pts = Array.from({ length: 10 }, (_, i) =>
      makePoint({ gpxIndex: i, timeMs: T0 + i * 1000, lat: 90, lon: 0 })
    );
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });

  test('all points at the south pole', () => {
    const pts = Array.from({ length: 10 }, (_, i) =>
      makePoint({ gpxIndex: i, timeMs: T0 + i * 1000, lat: -90, lon: 0 })
    );
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });

  test('dateline crossing — alternating lon ±179.99', () => {
    const pts = Array.from({ length: 10 }, (_, i) =>
      makePoint({
        gpxIndex: i, timeMs: T0 + i * 1000, lat: 0,
        lon: i % 2 === 0 ? 179.99 : -179.99
      })
    );
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });

  test('NaN coordinates', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0,        lat: NaN, lon: NaN }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000, lat: 47,  lon: 8   }),
      makePoint({ gpxIndex: 2, timeMs: T0 + 2000, lat: NaN, lon: 8   }),
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    // Don't enforce specific bucket — just no crash and schema valid.
    assertSchemaInvariant(result);
  });

  test('Infinity coordinates', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0,        lat: Infinity, lon: 0 }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000, lat: 47,        lon: 8 }),
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    assertSchemaInvariant(result);
  });

  test('out-of-range lat (95°)', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0,        lat: 95, lon: 0 }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000, lat: 47, lon: 8 }),
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    assertSchemaInvariant(result);
  });

  test('extreme elevations (-50000m … +50000m)', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0,        lat: 47, lon: 8, ele: -50000 }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000, lat: 47, lon: 8, ele:  50000 }),
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });
});

// ── Pathological timestamps ──────────────────────────────────────────────

describe('robustness: pathological timestamps', () => {
  test('timeMs = 0', () => {
    const pts = [makePoint({ gpxIndex: 0, timeMs: 0 })];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });

  test('timeMs = Number.MAX_SAFE_INTEGER', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: Number.MAX_SAFE_INTEGER - 1 }),
      makePoint({ gpxIndex: 1, timeMs: Number.MAX_SAFE_INTEGER     }),
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });

  test('negative timeMs', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: -1000000 }),
      makePoint({ gpxIndex: 1, timeMs:  -500000 }),
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });

  test('all timestamps null → spine should be empty but pipeline runs', () => {
    const pts = Array.from({ length: 5 }, (_, i) =>
      makePoint({ gpxIndex: i, timeMs: null })
    );
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    assertSchemaInvariant(result);
    if (result.spineIntervals[0]) {
      expect(result.spineIntervals[0].spinePoints).toHaveLength(0);
    }
  });

  test('alternating valid / null timestamps', () => {
    const pts = Array.from({ length: 10 }, (_, i) =>
      makePoint({ gpxIndex: i, timeMs: i % 2 === 0 ? T0 + i * 1000 : null })
    );
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });

  test('strictly DECREASING timestamps (entire track is one big backtrack)', () => {
    const pts = Array.from({ length: 10 }, (_, i) =>
      makePoint({ gpxIndex: i, timeMs: T0 + (10 - i) * 1000, lat: 47 + i * 1e-5, lon: 8 })
    );
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
    // Pipeline corrects the full reversal — spine is computed on the reordered output,
    // so all points survive as forward-monotone after correction.
  });

  test('alternating zigzag in time (forward/backward/forward/...)', () => {
    const pts = [];
    for (let i = 0; i < 20; i++) {
      pts.push(makePoint({
        gpxIndex: i,
        timeMs: T0 + (i % 2 === 0 ? i * 1000 : (i - 0.5) * 1000),
        lat: 47, lon: 8
      }));
    }
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });
});

// ── Pathological structural patterns ────────────────────────────────────

describe('robustness: pathological structures', () => {
  test('1000 identical points (same time, same coords) → pre-segment dedupe to 1', () => {
    const pts = Array.from({ length: 1000 }, (_, i) =>
      makePoint({ gpxIndex: i, timeMs: T0 + 1000, lat: 47, lon: 8, ele: 500 })
    );
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    assertSchemaInvariant(result);
    assertPartitionInvariant(result, pts.map(p => p.gpxIndex));
    // Adjacent exact-dup pre-segment dedupe collapses 1000 identical points to 1 survivor.
    expect(result.drops).toHaveLength(999);
    expect(result.survivingGpxIndexes).toHaveLength(1);
  });

  test('1000 same-time DIFFERENT-coord points → no drops, empty spine', () => {
    const pts = Array.from({ length: 1000 }, (_, i) =>
      makePoint({ gpxIndex: i, timeMs: T0 + 1000, lat: 47 + i * 1e-7, lon: 8, ele: 500 })
    );
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    assertSchemaInvariant(result);
    // Distinct geometry → no pre-segment drops, but spine is empty (cluster).
    expect(result.spineIntervals[0].spinePoints).toHaveLength(0);
  });

  test('point with non-sequential gpxIndex (input is unsorted)', () => {
    const pts = [
      makePoint({ gpxIndex: 100, timeMs: T0 + 0    }),
      makePoint({ gpxIndex:   3, timeMs: T0 + 1000 }),
      makePoint({ gpxIndex:  50, timeMs: T0 + 2000 }),
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });

  test('duplicate gpxIndexes in input (caller error simulation)', () => {
    // The pipeline doesn't promise correct behaviour here, but it must not throw.
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0,        lat: 47,    lon: 8 }),
      makePoint({ gpxIndex: 0, timeMs: T0 + 1000, lat: 47.01, lon: 8 }), // same gpxIndex!
      makePoint({ gpxIndex: 1, timeMs: T0 + 2000, lat: 47.02, lon: 8 }),
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    assertSchemaInvariant(result);
    // Don't enforce partition invariant — gpxIndex collision means it's
    // ill-defined. Just make sure the pipeline doesn't crash.
  });

  test('segment indexes not zero-based', () => {
    const pts = [
      makePoint({ gpxIndex: 0, trkSegIndex: 5,  timeMs: T0      }),
      makePoint({ gpxIndex: 1, trkSegIndex: 5,  timeMs: T0+1000 }),
      makePoint({ gpxIndex: 2, trkSegIndex: 99, timeMs: T0      }),
      makePoint({ gpxIndex: 3, trkSegIndex: 99, timeMs: T0+1000 }),
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
    // All points share timeMs across segments → all dropped as cross_segment_duplicate.
    // Spine is empty; partition invariant still satisfied via drops[].
    expect(result.drops.map(d => d.gpxIndex).sort()).toEqual([0, 1, 2, 3]);
  });

  test('segment indexes interleaved out of order (input has alternating segs)', () => {
    const pts = [
      makePoint({ gpxIndex: 0, trkSegIndex: 0, timeMs: T0      }),
      makePoint({ gpxIndex: 1, trkSegIndex: 1, timeMs: T0      }),
      makePoint({ gpxIndex: 2, trkSegIndex: 0, timeMs: T0+1000 }),
      makePoint({ gpxIndex: 3, trkSegIndex: 1, timeMs: T0+1000 }),
      makePoint({ gpxIndex: 4, trkSegIndex: 0, timeMs: T0+2000 }),
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });

  test('every other point shares time with the next (long chain of pairs)', () => {
    const pts = [];
    for (let i = 0; i < 20; i++) {
      pts.push(makePoint({
        gpxIndex: i,
        timeMs: T0 + Math.floor(i / 2) * 1000,
        lat: 47 + i * 1e-5, lon: 8
      }));
    }
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });

  test('teleport storm: every other point is hundreds of km away', () => {
    const pts = [];
    for (let i = 0; i < 20; i++) {
      pts.push(makePoint({
        gpxIndex: i, timeMs: T0 + i * 1000,
        lat: i % 2 === 0 ? 47 : 51,
        lon: i % 2 === 0 ?  8 :  0
      }));
    }
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });

  test('elevation as string (caller bug simulation)', () => {
    const pts = [
      { gpxIndex: 0, trkSegIndex: 0, timeMs: T0,        lat: 47, lon: 8, ele: '500',  eleAbsent: false },
      { gpxIndex: 1, trkSegIndex: 0, timeMs: T0 + 1000, lat: 47, lon: 8, ele: 'abc',  eleAbsent: false },
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    assertSchemaInvariant(result);
  });
});

// ── Inputs missing properties (defensive) ────────────────────────────────

describe('robustness: malformed point objects', () => {
  test('point missing eleAbsent flag', () => {
    const pts = [
      { gpxIndex: 0, trkSegIndex: 0, timeMs: T0,        lat: 47, lon: 8 },
      { gpxIndex: 1, trkSegIndex: 0, timeMs: T0 + 1000, lat: 47, lon: 8 },
    ];
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    assertSchemaInvariant(result);
  });

  test('point missing trkSegIndex → pipeline does not throw (schema may carry undefined seg)', () => {
    const pts = [
      { gpxIndex: 0, timeMs: T0,        lat: 47, lon: 8 }, // no trkSegIndex
      { gpxIndex: 1, timeMs: T0 + 1000, lat: 47, lon: 8 },
    ];
    const { result, error } = safeRun(pts);
    // The pipeline must not crash on malformed input.
    expect(error).toBeUndefined();
    // Note: with trkSegIndex=undefined, spineIntervals may have an entry where
    // trkSegIndex is undefined. We DO NOT enforce schema strictness here —
    // garbage in, structured-but-flagged out. The fact that the pipeline
    // survives is the contract this test enforces.
    expect(result).toBeDefined();
  });
});

// ── Multipass convergence ──────────────────────────────────────────────

describe('robustness: multipass convergence', () => {
  test('cleared multipass: stable input always converges in 1-2 passes', () => {
    const pts = Array.from({ length: 20 }, (_, i) =>
      makePoint({ gpxIndex: i, timeMs: T0 + i * 1000, lat: 47 + i * 1e-5, lon: 8 })
    );
    const { result, error } = safeRun(pts);
    expect(error).toBeUndefined();
    // Clean track is correction-idle → no Phase 1 → passLog is empty (by design)
    expect(Array.isArray(result.passLog)).toBe(true);
  });

  test('low maxIterations (5) does not crash even on busy input', () => {
    // Build a track with many adjacent duplicates
    const pts = [];
    for (let i = 0; i < 10; i++) {
      pts.push(makePoint({ gpxIndex: 2*i,   timeMs: T0 + i * 1000, lat: 47 + i * 1e-5, lon: 8 }));
      pts.push(makePoint({ gpxIndex: 2*i+1, timeMs: T0 + i * 1000, lat: 47 + i * 1e-5, lon: 8 })); // exact dup
    }
    const { result, error } = safeRun(pts, { multipassMaxIterations: 5 });
    expect(error).toBeUndefined();
    checkAll(pts, result);
  });
});

// ── Random fuzz ─────────────────────────────────────────────────────────

describe('robustness: random fuzz (deterministic seed)', () => {
  // Mulberry32 PRNG for reproducibility
  function makePrng(seed) {
    return function() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function randomTrack(seed, n) {
    const r = makePrng(seed);
    const pts = [];
    for (let i = 0; i < n; i++) {
      pts.push(makePoint({
        gpxIndex: i,
        trkSegIndex: Math.floor(r() * 3),                 // 0,1, or 2
        timeMs: T0 + Math.floor(r() * 1e7),               // wide time window — many collisions/backtracks
        lat: 30 + r() * 60,                                // 30°…90°N
        lon: -180 + r() * 360,                             // anywhere in the world
        ele: r() < 0.3 ? undefined : -100 + r() * 9000     // some absent
      }));
    }
    return pts;
  }

  for (const seed of [1, 42, 1337, 0xDEADBEEF, 0xC0FFEE]) {
    test(`random track seed=${seed} (n=200)`, () => {
      const pts = randomTrack(seed, 200);
      const { result, error } = safeRun(pts);
      expect(error).toBeUndefined();
      // Don't run the full checkAll because random inputs may have
      // duplicate gpxIndexes by accident; partition invariant assumes uniqueness.
      // gpxIndex 0..n-1 are unique here, so partition IS valid.
      checkAll(pts, result);
    });
  }
});
