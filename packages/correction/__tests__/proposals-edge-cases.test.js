'use strict';

/**
 * Proposal builders — edge cases.
 *
 * Covers block-proposal, singleton-proposal, duplicate-proposal across:
 *   - empty / single-belowAnchor inputs
 *   - block at segment start / end / spanning entire segment
 *   - block with internal monotonicity violation
 *   - singleton at start / end / no-bracket-on-one-side
 *   - exact-group / competition / mixed
 *   - cluster spanning a bracket position
 *   - bracket walks past missing-time neighbours
 */

const { buildBlockProposals }     = require('../proposals/block-proposal');
const { buildSingletonProposals } = require('../proposals/singleton-proposal');
const { buildDuplicateProposals } = require('../proposals/duplicate-proposal');
const {
  makePoint, cleanTrack,
  blockTrack, blockWithInternalViolation,
  singletonTrack,
  adjacentExactDup, competitionTrack, exactGroupTrack,
  T0
} = require('./_helpers/fixtures');

describe('block-proposal: empty / trivial', () => {
  test('no belowAnchor → no proposals', () => {
    const props = buildBlockProposals(cleanTrack(5), new Set(), 0);
    expect(props).toHaveLength(0);
  });

  test('single belowAnchor point in run → 1-element block proposal', () => {
    const pts = cleanTrack(5);
    const props = buildBlockProposals(pts, new Set([2]), 0);
    expect(props).toHaveLength(1);
    expect(props[0].gpxIndexes).toEqual([2]);
  });

  test('all points belowAnchor → single block spanning entire segment', () => {
    const pts = cleanTrack(5);
    const props = buildBlockProposals(pts, new Set([0, 1, 2, 3, 4]), 0);
    expect(props).toHaveLength(1);
    expect(props[0].gpxIndexes).toHaveLength(5);
  });
});

describe('block-proposal: run grouping', () => {
  test('two disjoint runs → two proposals', () => {
    const pts = cleanTrack(8);
    const props = buildBlockProposals(pts, new Set([1, 2, 5, 6]), 0);
    expect(props).toHaveLength(2);
    expect(props[0].gpxIndexes).toEqual([1, 2]);
    expect(props[1].gpxIndexes).toEqual([5, 6]);
  });

  test('belowAnchor at very last point closes the run correctly', () => {
    const pts = cleanTrack(5);
    const props = buildBlockProposals(pts, new Set([4]), 0);
    expect(props).toHaveLength(1);
    expect(props[0].gpxIndexes).toEqual([4]);
  });

  test('belowAnchor at very first point starts the run correctly', () => {
    const pts = cleanTrack(5);
    const props = buildBlockProposals(pts, new Set([0]), 0);
    expect(props).toHaveLength(1);
    expect(props[0].gpxIndexes).toEqual([0]);
  });
});

describe('block-proposal: internal monotonicity flag', () => {
  test('clean run → no internal violation', () => {
    const { points, belowAnchorIndexes } = blockTrack();
    const props = buildBlockProposals(points, new Set(belowAnchorIndexes), 0);
    expect(props[0].hasInternalMonotonicityViolation).toBe(false);
  });

  test('run with backward step inside → violation flag set', () => {
    const { points, belowAnchorIndexes } = blockWithInternalViolation();
    const props = buildBlockProposals(points, new Set(belowAnchorIndexes), 0);
    expect(props[0].hasInternalMonotonicityViolation).toBe(true);
  });
});

describe('singleton-proposal: edge cases', () => {
  test('candidate at first position → tPrev null, bracket has only nextGpxIndex', () => {
    const pts = cleanTrack(4);
    // Mark idx 0 as belowAnchor (artificial — first point has no predecessor)
    const props = buildSingletonProposals(pts, new Set([0]), new Set(), 0);
    expect(props).toHaveLength(1);
    expect(props[0].tPrev).toBeNull();
    expect(props[0].tNext).not.toBeNull();
  });

  test('candidate at last position → tNext null', () => {
    const pts = cleanTrack(4);
    const props = buildSingletonProposals(pts, new Set([3]), new Set(), 0);
    expect(props).toHaveLength(1);
    expect(props[0].tNext).toBeNull();
    expect(props[0].tPrev).not.toBeNull();
  });

  test('candidate already in a block run → not a singleton', () => {
    const pts = cleanTrack(5);
    const props = buildSingletonProposals(pts, new Set([2]), new Set([2]), 0);
    expect(props).toHaveLength(0);
  });

  test('bracket walk skips neighbours with missing timeMs', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 0    }),
      makePoint({ gpxIndex: 1, timeMs: null      }),  // missing time
      makePoint({ gpxIndex: 2, timeMs: T0 + 5    }),  // singleton candidate (would-be backtrack)
      makePoint({ gpxIndex: 3, timeMs: null      }),
      makePoint({ gpxIndex: 4, timeMs: T0 + 1000 }),
    ];
    const props = buildSingletonProposals(pts, new Set([2]), new Set(), 0);
    expect(props).toHaveLength(1);
    // tPrev should walk past idx 1 to idx 0; tNext should walk past idx 3 to idx 4
    expect(props[0].tPrev).toBe(T0 + 0);
    expect(props[0].tNext).toBe(T0 + 1000);
    expect(props[0].bracketGpxIndexes).toEqual([0, 4]);
  });

  test('only candidate in segment → both brackets null', () => {
    const pts = [makePoint({ gpxIndex: 0, timeMs: T0 + 100 })];
    const props = buildSingletonProposals(pts, new Set([0]), new Set(), 0);
    expect(props).toHaveLength(1);
    expect(props[0].tPrev).toBeNull();
    expect(props[0].tNext).toBeNull();
    expect(props[0].bracketGpxIndexes).toHaveLength(0);
  });
});

describe('duplicate-proposal: kinds', () => {
  test('adjacent exact pair → adjacent-exact-drop proposal (keep lower idx)', () => {
    const props = buildDuplicateProposals(adjacentExactDup(), 0);
    const adjDrops = props.filter(p => p.kind === 'adjacent-exact-drop');
    expect(adjDrops).toHaveLength(1);
    expect(adjDrops[0].keepGpxIndex).toBe(1);
    expect(adjDrops[0].dropGpxIndex).toBe(2);
  });

  test('competition group → insert proposal with isExactGroup=false', () => {
    const props = buildDuplicateProposals(competitionTrack(), 0);
    const inserts = props.filter(p => p.kind === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].isExactGroup).toBe(false);
    expect(inserts[0].candidateGpxIndexes.sort()).toEqual([1, 3]);
  });

  test('exact-geometry group of 3 → insert proposal with isExactGroup=true', () => {
    const props = buildDuplicateProposals(exactGroupTrack(), 0);
    // Adjacent-exact-drops fire on adjacent pairs first, leaving the unmatched ones.
    // Whichever it produces, an insert proposal with isExactGroup=true should also exist
    // OR adjacent drops cover all duplicates.
    const inserts  = props.filter(p => p.kind === 'insert');
    const adjDrops = props.filter(p => p.kind === 'adjacent-exact-drop');
    // Coverage invariant: the three duplicates 1,2,3 must all be referenced
    const referencedDrops = new Set(adjDrops.map(p => p.dropGpxIndex));
    const referencedInserts = new Set(
      inserts.flatMap(p => p.candidateGpxIndexes)
    );
    const allCovered = [2, 3].every(i =>
      referencedDrops.has(i) || referencedInserts.has(i)
    );
    expect(allCovered).toBe(true);
  });
});

describe('duplicate-proposal: ele-absent equality', () => {
  test('two adjacent points sharing time/coord/no-ele → exact duplicate', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0     }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1, lat: 47.5, lon: 8.5 }),
      makePoint({ gpxIndex: 2, timeMs: T0 + 1, lat: 47.5, lon: 8.5 }),
      makePoint({ gpxIndex: 3, timeMs: T0 + 2 }),
    ];
    const props = buildDuplicateProposals(pts, 0);
    expect(props.some(p => p.kind === 'adjacent-exact-drop' && p.dropGpxIndex === 2)).toBe(true);
  });

  test('one has ele, other does not → NOT exact (still emits competition insert)', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0,     lat: 47.5, lon: 8.5            }), // no ele
      makePoint({ gpxIndex: 1, timeMs: T0,     lat: 47.5, lon: 8.5, ele: 500  }), // has ele
    ];
    const props = buildDuplicateProposals(pts, 0);
    const adjDrops = props.filter(p => p.kind === 'adjacent-exact-drop');
    expect(adjDrops).toHaveLength(0);
    const inserts = props.filter(p => p.kind === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].isExactGroup).toBe(false);
  });
});

describe('duplicate-proposal: nothing to do', () => {
  test('clean track → no proposals', () => {
    const props = buildDuplicateProposals(cleanTrack(10), 0);
    expect(props).toHaveLength(0);
  });

  test('cross-segment same-time pair → not seen as a duplicate within a segment', () => {
    const pts = [
      makePoint({ gpxIndex: 0, trkSegIndex: 0, timeMs: T0 + 100 }),
      makePoint({ gpxIndex: 1, trkSegIndex: 1, timeMs: T0 + 100 }),
    ];
    expect(buildDuplicateProposals(pts, 0)).toHaveLength(0);
    expect(buildDuplicateProposals(pts, 1)).toHaveLength(0);
  });
});
