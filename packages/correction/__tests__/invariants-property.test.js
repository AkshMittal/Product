'use strict';

/**
 * Property-style invariant suite.
 *
 * Runs MANY synthetic inputs through the pipeline and asserts the suite of
 * always-hold invariants on each output. Designed to catch invariant
 * violations that arise from input combinations no targeted test covers.
 *
 * If a generated case fails, the failing input is logged to stderr so it
 * can be turned into a regression test.
 */

const { runCorrection } = require('../index');
const { assertAllInvariants } = require('./_helpers/invariants');
const { makePoint, T0 } = require('./_helpers/fixtures');

function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Generates a random track with controlled chaos:
 *   - segments: 1..3
 *   - per-segment points: 1..40
 *   - time pattern: forward / backward / dup-cluster / mixed
 *   - geometry: small steps mostly; rare teleport
 *   - some null timestamps
 */
function generateTrack(seed) {
  const r = mulberry32(seed);
  const numSegs = 1 + Math.floor(r() * 3);
  const pts = [];
  let gpx = 0;
  for (let s = 0; s < numSegs; s++) {
    const n = 1 + Math.floor(r() * 40);
    let t = T0 + s * 1000000;
    for (let i = 0; i < n; i++) {
      // Time pattern decisions
      const tDecision = r();
      let timeMs;
      if (tDecision < 0.05) timeMs = null;                               // missing time
      else if (tDecision < 0.15) timeMs = t;                             // duplicate cluster
      else if (tDecision < 0.25) timeMs = t - Math.floor(r() * 5000);    // backtrack
      else { timeMs = t + Math.floor(r() * 1000) + 1; t = timeMs; }       // forward

      // Geometry
      const teleport = r() < 0.02;
      const lat = teleport ? 30 + r() * 50 : 47 + (i + s) * 1e-5;
      const lon = teleport ? -180 + r() * 360 : 8 + (i + s) * 1e-5;

      pts.push(makePoint({
        gpxIndex: gpx++, trkSegIndex: s, timeMs,
        lat, lon,
        ele: r() < 0.3 ? undefined : 500 + Math.floor(r() * 1000)
      }));
    }
  }
  return pts;
}

describe('invariants: property-style fuzz over generated inputs', () => {
  const SEEDS_PER_RUN = 25;

  for (let s = 0; s < SEEDS_PER_RUN; s++) {
    test(`generated track seed=${s} satisfies all invariants`, () => {
      const pts = generateTrack(s);
      let result, error;
      try {
        result = runCorrection({}, pts, {});
      } catch (e) {
        error = e;
      }

      if (error) {
        // Surface the input for debugging when crashing
        // eslint-disable-next-line no-console
        console.error(`Crash on seed=${s}, n=${pts.length}:`, error.message);
        throw error;
      }

      try {
        assertAllInvariants(result, pts);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          `Invariant violation on seed=${s} (n=${pts.length}):\n` +
          e.message
        );
        throw e;
      }
    });
  }
});

describe('invariants: regression — known-good shapes', () => {
  test('pre-segment objective dedupe drops do not collide with phase 1 drops', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0,        lat: 47,    lon: 8 }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000, lat: 47.01, lon: 8 }),
      makePoint({ gpxIndex: 2, timeMs: T0 + 1000, lat: 47.01, lon: 8 }), // adjacent exact dup
      makePoint({ gpxIndex: 3, timeMs: T0 + 2000, lat: 47.02, lon: 8 }),
    ];
    const r = runCorrection({}, pts, {});
    const droppedIdx = r.drops.map(d => d.gpxIndex);
    // No double-drop of the same gpxIndex
    const unique = new Set(droppedIdx);
    expect(unique.size).toBe(droppedIdx.length);
  });

  test('annotations all have a `kind` string', () => {
    // Run a busy fixture to populate annotations
    const pts = generateTrack(7);
    const r = runCorrection({}, pts, {});
    for (const ann of r.annotations) {
      expect(typeof ann.kind).toBe('string');
      expect(ann.kind.length).toBeGreaterThan(0);
    }
  });

  test('every excluded entry has a non-empty reason', () => {
    const pts = generateTrack(13);
    const r = runCorrection({}, pts, {});
    for (const e of r.excludedFromTrust) {
      expect(typeof e.reason).toBe('string');
      expect(e.reason.length).toBeGreaterThan(0);
    }
  });

  test('schemaVersion is the locked 1.0.0 value', () => {
    const r = runCorrection({}, [makePoint({ gpxIndex: 0, timeMs: T0 })], {});
    expect(r.metadata.schemaVersion).toBe('1.0.0');
  });
});
