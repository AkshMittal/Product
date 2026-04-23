'use strict';

/**
 * End-to-end smoke test for the correction pipeline.
 *
 * Runs the correction layer on small adversarial GPX fixtures by constructing
 * minimal point arrays from known fixture characteristics.
 *
 * Since the correction runner's vm-loader integration is Phase I wiring (not yet
 * complete), this test constructs synthetic point arrays that match known fixture
 * properties and verifies the pipeline output schema and invariants.
 *
 * Full GPX-to-correction integration (loading actual .gpx files through the
 * vm-based audit pipeline into correction) is Phase J.
 */

const { runCorrection } = require('../index');

// ── Helpers ────────────────────────────────────────────────────────────────

function makePoint(gpxIndex, trkSegIndex, timeMs, lat, lon, ele) {
  return {
    gpxIndex,
    trkSegIndex,
    timeMs,
    lat,
    lon,
    ele: (ele !== undefined) ? ele : null,
    eleAbsent: (ele === undefined),
    timeAbsent: (timeMs === null)
  };
}

function assertInvariant(result, allGpxIndexes) {
  // Partition invariant: every gpxIndex appears in exactly one of:
  //   drops, excludedFromTrust, survivingGpxIndexes
  const droppedSet     = new Set(result.drops.map(d => d.gpxIndex));
  const excludedSet    = new Set(result.excludedFromTrust.map(e => e.gpxIndex));
  const survivingSet   = new Set(result.survivingGpxIndexes);

  for (const gi of allGpxIndexes) {
    const inDrop     = droppedSet.has(gi);
    const inExcluded = excludedSet.has(gi);
    const inSurvive  = survivingSet.has(gi);
    const count = (inDrop ? 1 : 0) + (inExcluded ? 1 : 0) + (inSurvive ? 1 : 0);
    expect(count).toBeGreaterThanOrEqual(1); // must appear somewhere
    // Note: a point can be in excludedFromTrust AND surviving (trusted=false but not dropped)
    // but must NOT be in drops AND surviving simultaneously
    if (inDrop) {
      expect(inSurvive).toBe(false);
    }
  }
}

function assertProposalInvariant(result) {
  // Every proposal with applied===false must have a skipReason
  const passLogs = result.passLog || [];
  // (Proposals are not currently exposed in the export; this is a schema invariant check)
  // Verify passLog structure
  for (const segLog of passLogs) {
    expect(segLog).toHaveProperty('trkSegIndex');
    expect(segLog).toHaveProperty('exitReason');
    expect(segLog).toHaveProperty('passes');
    expect(Array.isArray(segLog.passes)).toBe(true);
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────

// Scenario 1: Clean forward-monotone track (adv-01 analog)
// 10 points, single segment, uniform Δt, no anomalies
const CLEAN_TRACK = Array.from({ length: 10 }, (_, i) =>
  makePoint(i, 0, 1714000000000 + i * 10000, 47.0 + i * 0.001, 8.0 + i * 0.001, 500 + i)
);

// Scenario 2: Track with one adjacent exact duplicate (adv-04 analog partial)
const DUP_TRACK = [
  makePoint(0, 0, 1714000000000, 47.0, 8.0, 500),
  makePoint(1, 0, 1714000001000, 47.001, 8.001, 501),
  makePoint(2, 0, 1714000001000, 47.001, 8.001, 501), // exact dup of 1
  makePoint(3, 0, 1714000002000, 47.002, 8.002, 502),
  makePoint(4, 0, 1714000003000, 47.003, 8.003, 503),
];

// Scenario 3: Multi-segment track
const MULTI_SEG_TRACK = [
  makePoint(0, 0, 1714000000000, 47.0, 8.0, 500),
  makePoint(1, 0, 1714000001000, 47.001, 8.001, 501),
  makePoint(2, 0, 1714000002000, 47.002, 8.002, 502),
  makePoint(3, 1, 1714000010000, 47.5, 8.5, 600),
  makePoint(4, 1, 1714000011000, 47.501, 8.501, 601),
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('e2e: output schema', () => {
  test('correction output has all required top-level keys', () => {
    const result = runCorrection({}, CLEAN_TRACK, {});
    expect(result).toHaveProperty('metadata');
    expect(result).toHaveProperty('drops');
    expect(result).toHaveProperty('excludedFromTrust');
    expect(result).toHaveProperty('annotations');
    expect(result).toHaveProperty('spineIntervals');
    expect(result).toHaveProperty('coupledRegions');
    expect(result).toHaveProperty('overlapBlockResolution');
    expect(result).toHaveProperty('passLog');
    expect(result).toHaveProperty('survivingGpxIndexes');
  });

  test('all collections are arrays', () => {
    const result = runCorrection({}, CLEAN_TRACK, {});
    expect(Array.isArray(result.drops)).toBe(true);
    expect(Array.isArray(result.excludedFromTrust)).toBe(true);
    expect(Array.isArray(result.annotations)).toBe(true);
    expect(Array.isArray(result.spineIntervals)).toBe(true);
    expect(Array.isArray(result.survivingGpxIndexes)).toBe(true);
  });

  test('metadata has schemaVersion and generatedAtUtc', () => {
    const result = runCorrection({}, CLEAN_TRACK, {});
    expect(result.metadata.schemaVersion).toBe('1.0.0');
    expect(typeof result.metadata.generatedAtUtc).toBe('string');
  });
});

describe('e2e: partition invariant', () => {
  test('clean track: all points survive, none dropped', () => {
    const result = runCorrection({}, CLEAN_TRACK, {});
    assertInvariant(result, CLEAN_TRACK.map(p => p.gpxIndex));
    expect(result.drops).toHaveLength(0);
    expect(result.survivingGpxIndexes).toHaveLength(CLEAN_TRACK.length);
  });

  test('dup track: one point dropped (adjacent exact duplicate)', () => {
    const result = runCorrection({}, DUP_TRACK, {});
    assertInvariant(result, DUP_TRACK.map(p => p.gpxIndex));
    // gpxIndex 2 is an exact dup of 1 — should be pre-segment dropped
    const droppedIndexes = result.drops.map(d => d.gpxIndex);
    expect(droppedIndexes).toContain(2);
  });

  test('multi-segment track: all points accounted for', () => {
    const result = runCorrection({}, MULTI_SEG_TRACK, {});
    assertInvariant(result, MULTI_SEG_TRACK.map(p => p.gpxIndex));
  });
});

describe('e2e: passLog invariant', () => {
  test('clean track: passLog has one entry per segment', () => {
    const result = runCorrection({}, CLEAN_TRACK, {});
    assertProposalInvariant(result);
    expect(result.passLog).toHaveLength(1); // one segment
    expect(result.passLog[0].trkSegIndex).toBe(0);
  });

  test('multi-segment track: passLog has two entries', () => {
    const result = runCorrection({}, MULTI_SEG_TRACK, {});
    assertProposalInvariant(result);
    expect(result.passLog).toHaveLength(2);
  });

  test('passLog exitReason is a known value', () => {
    const VALID_EXIT_REASONS = ['stable', 'all_applied', 'stalemate', 'max_iterations', 'no_proposals'];
    const result = runCorrection({}, CLEAN_TRACK, {});
    for (const log of result.passLog) {
      expect(VALID_EXIT_REASONS).toContain(log.exitReason);
    }
  });
});

describe('e2e: spineIntervals', () => {
  test('clean track produces non-empty spine', () => {
    const result = runCorrection({}, CLEAN_TRACK, {});
    expect(result.spineIntervals).toHaveLength(1);
    expect(result.spineIntervals[0].trkSegIndex).toBe(0);
    expect(result.spineIntervals[0].spinePoints.length).toBeGreaterThan(0);
  });

  test('each spine point has gpxIndex and timeMs', () => {
    const result = runCorrection({}, CLEAN_TRACK, {});
    for (const seg of result.spineIntervals) {
      for (const sp of seg.spinePoints) {
        expect(typeof sp.gpxIndex).toBe('number');
        expect(typeof sp.timeMs).toBe('number');
      }
    }
  });
});
