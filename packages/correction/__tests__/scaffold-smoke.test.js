'use strict';

/**
 * Scaffold smoke test — verifies proposal-schema factories and working-state
 * mutation contracts. Module-level API contracts that fixture tests don't cover.
 */

const { makeInsertProposal, makeBlockFindingProposal, makeAdjacentExactDropProposal, assertValidProposal } = require('../state/proposal-schema');
const { createWorkingState, addDrop } = require('../state/working-state');

const POINTS = [
  { gpxIndex: 0, trkSegIndex: 0, timeMs: 1000000, lat: 47.0,   lon: 8.0,   ele: 500, eleAbsent: false },
  { gpxIndex: 1, trkSegIndex: 0, timeMs: 1001000, lat: 47.001, lon: 8.001, ele: 501, eleAbsent: false },
  { gpxIndex: 2, trkSegIndex: 0, timeMs: 1002000, lat: 47.002, lon: 8.002, ele: 502, eleAbsent: false },
  { gpxIndex: 3, trkSegIndex: 0, timeMs: 1003000, lat: 47.003, lon: 8.003, ele: 503, eleAbsent: false },
  { gpxIndex: 4, trkSegIndex: 0, timeMs: 1004000, lat: 47.004, lon: 8.004, ele: 504, eleAbsent: false },
];

describe('proposal-schema factories', () => {
  test('makeInsertProposal produces valid proposal', () => {
    const p = makeInsertProposal({ trkSegIndex: 0, candidateGpxIndexes: [2], isExactGroup: false, tPrev: 1000, tNext: 2000, bracketGpxIndexes: [1, 3] });
    expect(p.kind).toBe('insert');
    expect(p.candidateGpxIndexes).toEqual([2]);
    expect(p.applied).toBe(false);
    // assertValidProposal is export-time: requires skipReason on applied=false
    p.skipReason = 'overlap_vetoed';
    assertValidProposal(p);
  });
  test('makeBlockFindingProposal produces valid proposal', () => {
    const p = makeBlockFindingProposal({ trkSegIndex: 0, gpxIndexes: [1, 2], hasInternalMonotonicityViolation: false });
    expect(p.kind).toBe('block-finding');
    expect(p.applied).toBe(false);
    p.skipReason = 'overlap_vetoed';
    assertValidProposal(p);
  });
  test('makeAdjacentExactDropProposal produces valid proposal', () => {
    const p = makeAdjacentExactDropProposal({ trkSegIndex: 0, keepGpxIndex: 0, dropGpxIndex: 1 });
    expect(p.kind).toBe('adjacent-exact-drop');
    expect(p.applied).toBe(false);
    p.skipReason = 'overlap_vetoed';
    assertValidProposal(p);
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
    addDrop(ws, 3, 'adjacent-exact-duplicate', 'pre_segment');
    expect(ws.drops).toHaveLength(1);
    expect(ws.drops[0].gpxIndex).toBe(3);
  });
});
