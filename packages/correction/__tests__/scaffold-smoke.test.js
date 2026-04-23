'use strict';

/**
 * Scaffold smoke test — verifies all modules load without error and
 * basic correction pipeline executes on a trivial input.
 */

const { runCorrection } = require('../index');
const { computeSpineIntervals } = require('../spine/spine-intervals');
const { buildBlockProposals } = require('../proposals/block-proposal');
const { buildSingletonProposals } = require('../proposals/singleton-proposal');
const { buildDuplicateProposals } = require('../proposals/duplicate-proposal');
const { detectOverlap } = require('../gates/overlap-detection');
const { detectCoupling } = require('../gates/coupling-detection');
const { computeKinematicCheck } = require('../apply/kinematic-guard');
const { makeInsertProposal, makeBlockFindingProposal, makeAdjacentExactDropProposal, assertValidProposal } = require('../state/proposal-schema');
const { createWorkingState, addDrop, addExcludedFromTrust, addAnnotation } = require('../state/working-state');
const { classifySegmentBoundaries } = require('../pre-segment/boundary-classifier');
const { checkParticipation } = require('../pre-segment/participation-check');
const { findObjectiveAdjacentDuplicates } = require('../pre-segment/objective-adjacent-dedupe');

// Simple test fixture: 5 points, one segment, forward monotone
function makePoint(gpxIndex, timeMs, lat, lon, ele) {
  return { gpxIndex, trkSegIndex: 0, timeMs, lat, lon, ele: ele || null, eleAbsent: ele === undefined };
}

const POINTS = [
  makePoint(0, 1000000, 47.0, 8.0, 500),
  makePoint(1, 1001000, 47.001, 8.001, 501),
  makePoint(2, 1002000, 47.002, 8.002, 502),
  makePoint(3, 1003000, 47.003, 8.003, 503),
  makePoint(4, 1004000, 47.004, 8.004, 504),
];

describe('scaffold: all modules load', () => {
  test('runCorrection is a function', () => {
    expect(typeof runCorrection).toBe('function');
  });
  test('computeSpineIntervals is a function', () => {
    expect(typeof computeSpineIntervals).toBe('function');
  });
  test('computeKinematicCheck is a function', () => {
    expect(typeof computeKinematicCheck).toBe('function');
  });
});

describe('proposal-schema factories', () => {
  test('makeInsertProposal produces valid proposal', () => {
    const p = makeInsertProposal({ trkSegIndex: 0, candidateGpxIndexes: [2], isExactGroup: false, tPrev: 1000, tNext: 2000, bracketGpxIndexes: [1, 3] });
    assertValidProposal(p);
    expect(p.kind).toBe('insert');
    expect(p.candidateGpxIndexes).toEqual([2]);
  });
  test('makeBlockFindingProposal produces valid proposal', () => {
    const p = makeBlockFindingProposal({ trkSegIndex: 0, gpxIndexes: [1, 2], hasInternalMonotonicityViolation: false });
    assertValidProposal(p);
    expect(p.kind).toBe('block-finding');
  });
  test('makeAdjacentExactDropProposal produces valid proposal', () => {
    const p = makeAdjacentExactDropProposal({ trkSegIndex: 0, keepGpxIndex: 0, dropGpxIndex: 1 });
    assertValidProposal(p);
    expect(p.kind).toBe('adjacent-exact-drop');
  });
});

describe('working-state', () => {
  test('createWorkingState initialises all collections', () => {
    const ws = createWorkingState(POINTS);
    expect(ws.drops).toEqual([]);
    expect(ws.excludedFromTrust).toEqual([]);
    expect(ws.annotations).toEqual([]);
    expect(ws.workingOrderedPoints.length).toBe(5);
  });
  test('addDrop records drop', () => {
    const ws = createWorkingState(POINTS);
    addDrop(ws, 3, 'test_reason', 'pre_segment');
    expect(ws.drops).toHaveLength(1);
    expect(ws.drops[0].gpxIndex).toBe(3);
  });
});

describe('spine-intervals', () => {
  test('forward-monotone 5 points → 5 spine points', () => {
    const spineMap = computeSpineIntervals(POINTS);
    expect(spineMap.has(0)).toBe(true);
    expect(spineMap.get(0)).toHaveLength(5);
  });

  test('duplicate-time cluster excluded', () => {
    const pts = [
      makePoint(0, 1000, 47.0, 8.0, 500),
      makePoint(1, 1000, 47.001, 8.001, 501), // same timeMs as 0 → both excluded
      makePoint(2, 2000, 47.002, 8.002, 502),
    ];
    const spineMap = computeSpineIntervals(pts);
    const spine = spineMap.get(0);
    expect(spine.map(p => p.gpxIndex)).not.toContain(0);
    expect(spine.map(p => p.gpxIndex)).not.toContain(1);
    expect(spine.map(p => p.gpxIndex)).toContain(2);
  });
});

describe('kinematic-guard', () => {
  test('near-stationary speed → passes threshold', () => {
    const prev = { lat: 47.0, lon: 8.0, timeMs: 0 };
    const cand = { lat: 47.001, lon: 8.0, timeMs: 100000 }; // ~111m in 100s ≈ 4 kph
    const next = { lat: 47.002, lon: 8.0, timeMs: 200000 };
    const result = computeKinematicCheck(prev, cand, next, 80);
    expect(result.passed).toBe(true);
    expect(result.speedPrevKph).toBeLessThan(10);
  });
  test('teleport → fails threshold', () => {
    const prev = { lat: 47.0, lon: 8.0, timeMs: 0 };
    const cand = { lat: 51.5, lon: 0.0, timeMs: 1000 }; // ~500km in 1s
    const result = computeKinematicCheck(prev, cand, null, 80);
    expect(result.passed).toBe(false);
    expect(result.speedPrevKph).toBeGreaterThan(80);
  });
  test('null prev → vacuously passes prev side', () => {
    const cand = { lat: 47.0, lon: 8.0, timeMs: 1000 };
    const next = { lat: 47.001, lon: 8.0, timeMs: 200000 };
    const result = computeKinematicCheck(null, cand, next, 80);
    expect(result.speedPrevKph).toBeNull();
    expect(result.passed).toBe(true);
  });
});

describe('participation-check', () => {
  test('all valid coords → all participating', () => {
    const { participatingGpxIndexes, nonParticipatingGpxIndexes } = checkParticipation(POINTS);
    expect(participatingGpxIndexes.size).toBe(5);
    expect(nonParticipatingGpxIndexes.size).toBe(0);
  });
});

describe('objective-adjacent-dedupe', () => {
  test('no duplicates → empty drops', () => {
    expect(findObjectiveAdjacentDuplicates(POINTS)).toHaveLength(0);
  });
  test('adjacent exact duplicate → one drop', () => {
    const pts = [
      makePoint(0, 1000, 47.0, 8.0, 500),
      makePoint(1, 1000, 47.0, 8.0, 500), // exact dup
      makePoint(2, 2000, 47.1, 8.1, 510),
    ];
    const drops = findObjectiveAdjacentDuplicates(pts);
    expect(drops).toHaveLength(1);
    expect(drops[0].keepGpxIndex).toBe(0);
    expect(drops[0].dropGpxIndex).toBe(1);
  });
});

describe('boundary-classifier', () => {
  test('same-day boundaries classified correctly', () => {
    const boundaries = [
      { trkSegIndex: 0, firstGpxIndex: 0, lastGpxIndex: 4, firstTimeMs: Date.UTC(2024, 3, 25, 10, 0, 0), lastTimeMs: Date.UTC(2024, 3, 25, 11, 0, 0) },
      { trkSegIndex: 1, firstGpxIndex: 5, lastGpxIndex: 9, firstTimeMs: Date.UTC(2024, 3, 25, 11, 30, 0), lastTimeMs: Date.UTC(2024, 3, 25, 12, 0, 0) }
    ];
    const result = classifySegmentBoundaries(boundaries);
    expect(result).toHaveLength(1);
    expect(result[0].classification).toBe('same_day');
    expect(result[0].gapMs).toBe(30 * 60 * 1000);
  });
});

describe('runCorrection end-to-end (trivial)', () => {
  test('clean forward-monotone points → no drops, no excludedFromTrust', () => {
    const result = runCorrection({}, POINTS, {});
    expect(result).toHaveProperty('drops');
    expect(result).toHaveProperty('excludedFromTrust');
    expect(result).toHaveProperty('annotations');
    expect(result).toHaveProperty('survivingGpxIndexes');
    expect(result.drops).toHaveLength(0);
    expect(result.excludedFromTrust).toHaveLength(0);
    expect(result.survivingGpxIndexes).toHaveLength(5);
  });
});
