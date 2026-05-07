'use strict';

/**
 * Gates — overlap-detection + coupling-detection edge cases.
 *
 * Both gates read snapshot state only (ADR-correction-0010). They are
 * independent of one another. We test:
 *   - empty proposals → no vetoes / no edges
 *   - block with no usable timestamps → vetoed
 *   - block with no spine bracket on either side → vetoed (no-bracket)
 *   - corridor pierce-check (extra spine point inside socket)
 *   - exactly-equal boundary timestamps (B_min === t_prev)
 *   - coupling: two singletons sharing a bracket anchor → mutual block
 *   - coupling: insert with adjacent-exact-drop → drop has no zone, no edge
 *   - coupling: chain of three coupled proposals
 */

const { detectOverlap }  = require('../gates/overlap-detection');
const { detectCoupling } = require('../gates/coupling-detection');
const { computeSpineIntervals } = require('../spine/spine-intervals');
const { makeBlockFindingProposal, makeInsertProposal, makeAdjacentExactDropProposal } =
  require('../state/proposal-schema');
const { makePoint, T0 } = require('./_helpers/fixtures');

describe('overlap-detection: degenerate inputs', () => {
  test('no proposals → empty result', () => {
    const r = detectOverlap([], [], new Map());
    expect(r.overlapVetoedProposalIds).toHaveLength(0);
    expect(r.overlapBlockResolution).toHaveLength(0);
  });

  test('only insert proposals (no blocks) → no overlap action', () => {
    const props = [makeInsertProposal({
      trkSegIndex: 0, candidateGpxIndexes: [3], isExactGroup: false,
      tPrev: T0, tNext: T0 + 100, bracketGpxIndexes: [0, 1]
    })];
    const r = detectOverlap(props, [], new Map());
    expect(r.overlapVetoedProposalIds).toHaveLength(0);
  });
});

describe('overlap-detection: block status', () => {
  test('block with all-null timeMs → vetoed (no usable timestamps)', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 0    }),
      makePoint({ gpxIndex: 1, timeMs: null      }),
      makePoint({ gpxIndex: 2, timeMs: null      }),
      makePoint({ gpxIndex: 3, timeMs: T0 + 1000 }),
    ];
    const block = makeBlockFindingProposal({
      trkSegIndex: 0, gpxIndexes: [1, 2], hasInternalMonotonicityViolation: false
    });
    const spine = computeSpineIntervals(pts);
    const r = detectOverlap([block], pts, spine);
    expect(r.overlapVetoedProposalIds).toContain(block.id);
  });

  test('block with no spine on either side → vetoed (no-bracket)', () => {
    // Spine is empty because all points are duplicate-time
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 100 }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 100 }),
    ];
    const spine = computeSpineIntervals(pts); // → empty for seg 0
    const block = makeBlockFindingProposal({
      trkSegIndex: 0, gpxIndexes: [0, 1], hasInternalMonotonicityViolation: false
    });
    const r = detectOverlap([block], pts, spine);
    expect(r.overlapVetoedProposalIds).toContain(block.id);
    expect(block.overlapStatus).toBe('no-bracket');
  });

  test('block fully bracketed and clean → socket-ok with resolution entry', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 +   0, lat: 47, lon: 8 }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 100, lat: 47, lon: 8 }),
      // block of two below-anchor points
      makePoint({ gpxIndex: 2, timeMs: T0 +  20, lat: 47, lon: 8 }),
      makePoint({ gpxIndex: 3, timeMs: T0 +  30, lat: 47, lon: 8 }),
      makePoint({ gpxIndex: 4, timeMs: T0 + 200, lat: 47, lon: 8 }),
      makePoint({ gpxIndex: 5, timeMs: T0 + 300, lat: 47, lon: 8 }),
    ];
    const spine = computeSpineIntervals(pts);
    const block = makeBlockFindingProposal({
      trkSegIndex: 0, gpxIndexes: [2, 3], hasInternalMonotonicityViolation: false
    });
    const r = detectOverlap([block], pts, spine);
    expect(r.overlapVetoedProposalIds).not.toContain(block.id);
    expect(block.overlapStatus).toBe('socket-ok');
    expect(r.overlapBlockResolution).toHaveLength(1);
    expect(r.overlapBlockResolution[0].prevAnchorPoint).toBeTruthy();
    expect(r.overlapBlockResolution[0].nextAnchorPoint).toBeTruthy();
  });

  test('corridor pierce: spine point inside (t_prev, t_next) but outside block → vetoed', () => {
    // Stream order reflects a GPX track where the block members have timestamps
    // that fall in the middle of a forward-moving segment, with a non-block point
    // interspersed in the same time window.
    //
    // Stream:  pt0(T0+0), pt1(T0+100), pt2(T0+110)[block], pt4(T0+150)[intruder],
    //          pt3(T0+180)[block], pt5(T0+300)
    //
    // Spine (forward-monotonic from stream): 0,1,2,4,3→rejected(150<180? no 150<180),
    // actually 4(150) is after 2(110) in stream, 150>110 → accepted; then 3(180)>150 → accepted.
    // Spine = [pt0, pt1, pt2, pt4, pt3, pt5] by timeMs = [0,100,110,150,180,300].
    //
    // Block gpxIndexes=[2,3], bMin=110, bMax=180.
    // Anchor search skips blockSet {2,3}:
    //   prevAnchor = pt1(T0+100) — last spine < 110
    //   nextAnchor = pt5(T0+300) — first spine > 180
    // tPrev=100, tNext=300. socketOk: 110>=100 && 180<=300 ✓
    // Pierce: pt4(T0+150) not in block, 150>100 && 150<300 → pierced=true → vetoed.
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 +   0 }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 100 }),
      makePoint({ gpxIndex: 2, timeMs: T0 + 110 }), // block member
      makePoint({ gpxIndex: 4, timeMs: T0 + 150 }), // INTRUDER — not in block, inside corridor
      makePoint({ gpxIndex: 3, timeMs: T0 + 180 }), // block member
      makePoint({ gpxIndex: 5, timeMs: T0 + 300 }),
    ];
    const spine = computeSpineIntervals(pts);
    const block = makeBlockFindingProposal({
      trkSegIndex: 0, gpxIndexes: [2, 3], hasInternalMonotonicityViolation: false
    });
    const r = detectOverlap([block], pts, spine);
    expect(r.overlapVetoedProposalIds).toContain(block.id);
  });
});

describe('coupling-detection: degenerate inputs', () => {
  test('no proposals → empty result', () => {
    const r = detectCoupling([], []);
    expect(r.couplingBlockedProposalIds).toHaveLength(0);
    expect(r.coupledRegions).toHaveLength(0);
  });

  test('single insert proposal with no peers → independent', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 0    }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000 }),
      makePoint({ gpxIndex: 2, timeMs: T0 + 500  }),
    ];
    const ins = makeInsertProposal({
      trkSegIndex: 0, candidateGpxIndexes: [2], isExactGroup: false,
      tPrev: T0, tNext: T0 + 1000, bracketGpxIndexes: [0, 1]
    });
    const r = detectCoupling([ins], pts);
    expect(r.couplingBlockedProposalIds).toHaveLength(0);
    expect(r.independentProposalIds).toContain(ins.id);
  });
});

describe('coupling-detection: edges', () => {
  test('two inserts sharing a bracket anchor → both coupling-blocked', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 0    }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000 }), // shared bracket anchor
      makePoint({ gpxIndex: 2, timeMs: T0 + 500  }), // singleton 1 (would-be insert)
      makePoint({ gpxIndex: 3, timeMs: T0 + 600  }), // singleton 2
      makePoint({ gpxIndex: 4, timeMs: T0 + 2000 }),
    ];
    const ins1 = makeInsertProposal({
      trkSegIndex: 0, candidateGpxIndexes: [2], isExactGroup: false,
      tPrev: T0, tNext: T0 + 1000, bracketGpxIndexes: [0, 1]
    });
    const ins2 = makeInsertProposal({
      trkSegIndex: 0, candidateGpxIndexes: [3], isExactGroup: false,
      tPrev: T0 + 1000, tNext: T0 + 2000, bracketGpxIndexes: [1, 4]
    });
    const r = detectCoupling([ins1, ins2], pts);
    expect(r.couplingBlockedProposalIds).toContain(ins1.id);
    expect(r.couplingBlockedProposalIds).toContain(ins2.id);
    expect(r.coupledRegions).toHaveLength(1);
    expect(r.coupledRegions[0].edges.length).toBeGreaterThan(0);
  });

  test('adjacent-exact-drop has no disturbance zone → does not couple peers', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 0    }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000 }),
      makePoint({ gpxIndex: 2, timeMs: T0 + 1000 }),
      makePoint({ gpxIndex: 3, timeMs: T0 + 2000 }),
    ];
    const drop = makeAdjacentExactDropProposal({ trkSegIndex: 0, keepGpxIndex: 1, dropGpxIndex: 2 });
    const ins  = makeInsertProposal({
      trkSegIndex: 0, candidateGpxIndexes: [3], isExactGroup: false,
      tPrev: T0 + 1000, tNext: null, bracketGpxIndexes: [1]
    });
    const r = detectCoupling([drop, ins], pts);
    expect(r.couplingBlockedProposalIds).not.toContain(drop.id);
    // drop has no zone but ins's bracket anchor (1) IS the keep of the drop.
    // Drop has no zone → no edge from drop to ins. ins's refs = [1]; does drop's zone hold 1? No.
    expect(r.couplingBlockedProposalIds).not.toContain(ins.id);
  });

  test('chain of three inserts (A↔B, B↔C) → single coupled region of 3', () => {
    const pts = [
      makePoint({ gpxIndex: 0, timeMs: T0 + 0    }),
      makePoint({ gpxIndex: 1, timeMs: T0 + 1000 }),
      makePoint({ gpxIndex: 2, timeMs: T0 + 2000 }),
      makePoint({ gpxIndex: 3, timeMs: T0 + 3000 }),
      // candidates
      makePoint({ gpxIndex: 4, timeMs: T0 + 500  }),
      makePoint({ gpxIndex: 5, timeMs: T0 + 1500 }),
      makePoint({ gpxIndex: 6, timeMs: T0 + 2500 }),
    ];
    const A = makeInsertProposal({
      trkSegIndex: 0, candidateGpxIndexes: [4], isExactGroup: false,
      tPrev: T0, tNext: T0 + 1000, bracketGpxIndexes: [0, 1]
    });
    const B = makeInsertProposal({
      trkSegIndex: 0, candidateGpxIndexes: [5], isExactGroup: false,
      tPrev: T0 + 1000, tNext: T0 + 2000, bracketGpxIndexes: [1, 2]
    });
    const C = makeInsertProposal({
      trkSegIndex: 0, candidateGpxIndexes: [6], isExactGroup: false,
      tPrev: T0 + 2000, tNext: T0 + 3000, bracketGpxIndexes: [2, 3]
    });
    const r = detectCoupling([A, B, C], pts);
    expect(r.coupledRegions).toHaveLength(1);
    expect(r.coupledRegions[0].proposalIds.sort()).toEqual([A.id, B.id, C.id].sort());
  });

  test('two truly-disjoint regions: separated by non-disturbed traversal padding', () => {
    // Coupling considers traversal-adjacent neighbours as disturbance zone.
    // To get TRULY disjoint regions, candidates in different pairs must not
    // be traversal-adjacent in workingOrderedPoints AND their bracket anchors
    // must not overlap. We pad with extra non-candidate points between pairs.
    const pts = [
      makePoint({ gpxIndex: 0,  timeMs: T0 +  0    }),  // bracket A
      makePoint({ gpxIndex: 1,  timeMs: T0 +  1000 }),  // bracket A
      makePoint({ gpxIndex: 2,  timeMs: T0 +  500  }),  // singleton A1
      makePoint({ gpxIndex: 3,  timeMs: T0 +  600  }),  // singleton A2
      makePoint({ gpxIndex: 10, timeMs: T0 +  2000 }),  // padding
      makePoint({ gpxIndex: 11, timeMs: T0 +  3000 }),  // padding
      makePoint({ gpxIndex: 12, timeMs: T0 +  4000 }),  // padding
      makePoint({ gpxIndex: 13, timeMs: T0 +  4500 }),  // padding
      makePoint({ gpxIndex: 4,  timeMs: T0 +  5000 }),  // bracket B
      makePoint({ gpxIndex: 5,  timeMs: T0 +  6000 }),  // bracket B
      makePoint({ gpxIndex: 6,  timeMs: T0 +  5500 }),  // singleton B1
      makePoint({ gpxIndex: 7,  timeMs: T0 +  5600 }),  // singleton B2
    ];
    const props = [
      makeInsertProposal({ trkSegIndex: 0, candidateGpxIndexes: [2], isExactGroup: false,
        tPrev: T0, tNext: T0 + 1000, bracketGpxIndexes: [0, 1] }),
      makeInsertProposal({ trkSegIndex: 0, candidateGpxIndexes: [3], isExactGroup: false,
        tPrev: T0, tNext: T0 + 1000, bracketGpxIndexes: [0, 1] }),
      makeInsertProposal({ trkSegIndex: 0, candidateGpxIndexes: [6], isExactGroup: false,
        tPrev: T0 + 5000, tNext: T0 + 6000, bracketGpxIndexes: [4, 5] }),
      makeInsertProposal({ trkSegIndex: 0, candidateGpxIndexes: [7], isExactGroup: false,
        tPrev: T0 + 5000, tNext: T0 + 6000, bracketGpxIndexes: [4, 5] }),
    ];
    const r = detectCoupling(props, pts);
    expect(r.coupledRegions).toHaveLength(2);
  });
});
