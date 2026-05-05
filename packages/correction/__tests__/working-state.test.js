'use strict';

/**
 * packages/correction/__tests__/working-state.test.js
 *
 * Exhaustive tests for packages/correction/state/working-state.js
 * Adversarial: tests happy paths, edge cases, and things likely to be broken.
 */

const {
  createWorkingState,
  markAnomalyResolved,
  addDrop,
  addExcludedFromTrust,
  addAnnotation,
  addRearrangement,
  stageEdgeProposal,
  removeFromWorking,
  relocateRunAfter,
  relocatePointAfter
} = require('../state/working-state');

const { makePoint } = require('./_helpers/fixtures');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pts(n, segIndex) {
  segIndex = segIndex === undefined ? 0 : segIndex;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(makePoint({ gpxIndex: i, trkSegIndex: segIndex, timeMs: 1000000 + i * 1000 }));
  }
  return out;
}

function freshState(n) {
  return createWorkingState(pts(n));
}

// ─── createWorkingState ───────────────────────────────────────────────────────

describe('createWorkingState', () => {
  it('returns object with all required top-level fields', () => {
    const state = createWorkingState([]);
    expect(state).toHaveProperty('workingOrderedPoints');
    expect(state).toHaveProperty('drops');
    expect(state).toHaveProperty('excludedFromTrust');
    expect(state).toHaveProperty('annotations');
    expect(state).toHaveProperty('rearrangements');
    expect(state).toHaveProperty('stagedEdgeProposals');
    expect(state).toHaveProperty('proposals');
    expect(state).toHaveProperty('resolvedAnomalies');
    expect(state).toHaveProperty('passNumber');
  });

  it('workingOrderedPoints is a shallow copy — not the same reference', () => {
    const input = pts(3);
    const state = createWorkingState(input);
    expect(state.workingOrderedPoints).not.toBe(input);
    expect(state.workingOrderedPoints).toHaveLength(3);
  });

  it('workingOrderedPoints contains the same point objects (shallow copy)', () => {
    const input = pts(3);
    const state = createWorkingState(input);
    for (let i = 0; i < input.length; i++) {
      expect(state.workingOrderedPoints[i]).toBe(input[i]); // same object reference
    }
  });

  it('mutations to original array do not affect workingOrderedPoints', () => {
    const input = pts(3);
    const state = createWorkingState(input);
    input.push(makePoint({ gpxIndex: 99 }));
    expect(state.workingOrderedPoints).toHaveLength(3);
  });

  it('drops is an empty array', () => {
    const state = createWorkingState([]);
    expect(Array.isArray(state.drops)).toBe(true);
    expect(state.drops).toHaveLength(0);
  });

  it('excludedFromTrust is an empty array', () => {
    const state = createWorkingState([]);
    expect(Array.isArray(state.excludedFromTrust)).toBe(true);
    expect(state.excludedFromTrust).toHaveLength(0);
  });

  it('annotations is an empty array', () => {
    const state = createWorkingState([]);
    expect(Array.isArray(state.annotations)).toBe(true);
    expect(state.annotations).toHaveLength(0);
  });

  it('rearrangements is an empty array', () => {
    const state = createWorkingState([]);
    expect(Array.isArray(state.rearrangements)).toBe(true);
    expect(state.rearrangements).toHaveLength(0);
  });

  it('proposals is an empty array', () => {
    const state = createWorkingState([]);
    expect(Array.isArray(state.proposals)).toBe(true);
    expect(state.proposals).toHaveLength(0);
  });

  it('resolvedAnomalies is an empty Set', () => {
    const state = createWorkingState([]);
    expect(state.resolvedAnomalies).toBeInstanceOf(Set);
    expect(state.resolvedAnomalies.size).toBe(0);
  });

  it('passNumber starts at 0', () => {
    const state = createWorkingState([]);
    expect(state.passNumber).toBe(0);
  });

  it('stagedEdgeProposals is a Map', () => {
    const state = createWorkingState([]);
    expect(state.stagedEdgeProposals).toBeInstanceOf(Map);
    expect(state.stagedEdgeProposals.size).toBe(0);
  });

  it('works with an empty point array', () => {
    const state = createWorkingState([]);
    expect(state.workingOrderedPoints).toHaveLength(0);
  });

  it('two states created from the same input share no references to each other', () => {
    const input = pts(2);
    const s1 = createWorkingState(input);
    const s2 = createWorkingState(input);
    s1.drops.push({ gpxIndex: 0, reason: 'adjacent-exact-duplicate', stage: 'test' });
    expect(s2.drops).toHaveLength(0);
  });
});

// ─── markAnomalyResolved ──────────────────────────────────────────────────────

describe('markAnomalyResolved', () => {
  it('adds gpxIndex to resolvedAnomalies Set', () => {
    const state = freshState(3);
    markAnomalyResolved(state, 1);
    expect(state.resolvedAnomalies.has(1)).toBe(true);
  });

  it('is idempotent — adding same gpxIndex twice keeps size at 1', () => {
    const state = freshState(3);
    markAnomalyResolved(state, 1);
    markAnomalyResolved(state, 1);
    expect(state.resolvedAnomalies.size).toBe(1);
  });

  it('multiple different gpxIndexes each land in the set', () => {
    const state = freshState(5);
    markAnomalyResolved(state, 0);
    markAnomalyResolved(state, 3);
    markAnomalyResolved(state, 4);
    expect(state.resolvedAnomalies.size).toBe(3);
    expect(state.resolvedAnomalies.has(0)).toBe(true);
    expect(state.resolvedAnomalies.has(3)).toBe(true);
    expect(state.resolvedAnomalies.has(4)).toBe(true);
  });
});

// ─── addDrop ──────────────────────────────────────────────────────────────────

describe('addDrop', () => {
  it('adds a drop record with correct shape', () => {
    const state = freshState(3);
    addDrop(state, 1, 'adjacent-exact-duplicate', 'pre-segment-objective-dedupe');
    expect(state.drops).toHaveLength(1);
    expect(state.drops[0]).toEqual({
      gpxIndex: 1,
      reason: 'adjacent-exact-duplicate',
      stage: 'pre-segment-objective-dedupe'
    });
  });

  it('accepts reason adjacent-exact-duplicate', () => {
    const state = freshState(3);
    expect(() => addDrop(state, 0, 'adjacent-exact-duplicate', 'stage')).not.toThrow();
  });

  it('accepts reason duplicate_chunk_segment', () => {
    const state = freshState(3);
    expect(() => addDrop(state, 0, 'duplicate_chunk_segment', 'stage')).not.toThrow();
  });

  it('throws for an unknown drop reason string', () => {
    const state = freshState(3);
    expect(() => addDrop(state, 0, 'not-a-real-reason', 'stage')).toThrow();
  });

  it('throws for null reason', () => {
    const state = freshState(3);
    expect(() => addDrop(state, 0, null, 'stage')).toThrow();
  });

  it('throws for undefined reason', () => {
    const state = freshState(3);
    expect(() => addDrop(state, 0, undefined, 'stage')).toThrow();
  });

  it('throws for numeric reason', () => {
    const state = freshState(3);
    expect(() => addDrop(state, 0, 123, 'stage')).toThrow();
  });

  it('throws for empty string reason', () => {
    const state = freshState(3);
    expect(() => addDrop(state, 0, '', 'stage')).toThrow();
  });

  it('multiple drops accumulate in order', () => {
    const state = freshState(5);
    addDrop(state, 0, 'adjacent-exact-duplicate', 'stageA');
    addDrop(state, 2, 'duplicate_chunk_segment', 'stageB');
    addDrop(state, 4, 'adjacent-exact-duplicate', 'stageC');
    expect(state.drops).toHaveLength(3);
    expect(state.drops[0].gpxIndex).toBe(0);
    expect(state.drops[1].gpxIndex).toBe(2);
    expect(state.drops[2].gpxIndex).toBe(4);
  });

  it('same gpxIndex can be dropped twice — no dedup', () => {
    const state = freshState(3);
    addDrop(state, 1, 'adjacent-exact-duplicate', 'stageA');
    addDrop(state, 1, 'adjacent-exact-duplicate', 'stageB');
    expect(state.drops).toHaveLength(2);
    expect(state.drops[0].gpxIndex).toBe(1);
    expect(state.drops[1].gpxIndex).toBe(1);
  });

  it('does not mutate workingOrderedPoints when a drop is recorded', () => {
    const state = freshState(3);
    addDrop(state, 0, 'adjacent-exact-duplicate', 'stage');
    expect(state.workingOrderedPoints).toHaveLength(3);
  });
});

// ─── addExcludedFromTrust ─────────────────────────────────────────────────────

describe('addExcludedFromTrust', () => {
  const VALID_REASON = 'same_time_non_winner';
  const VALID_REASON_2 = 'insert_competition_loser';

  it('creates entry with reasons[] array (not a reason string)', () => {
    const state = freshState(3);
    addExcludedFromTrust(state, 1, VALID_REASON);
    expect(state.excludedFromTrust).toHaveLength(1);
    const entry = state.excludedFromTrust[0];
    expect(Array.isArray(entry.reasons)).toBe(true);
    expect(entry.reasons).toContain(VALID_REASON);
    expect(entry).not.toHaveProperty('reason'); // must NOT have singular 'reason'
  });

  it('entry has gpxIndex field', () => {
    const state = freshState(3);
    addExcludedFromTrust(state, 2, VALID_REASON);
    expect(state.excludedFromTrust[0].gpxIndex).toBe(2);
  });

  it('idempotent: same (gpxIndex, reason) added twice → only one entry in reasons[]', () => {
    const state = freshState(3);
    addExcludedFromTrust(state, 1, VALID_REASON);
    addExcludedFromTrust(state, 1, VALID_REASON);
    expect(state.excludedFromTrust).toHaveLength(1);
    expect(state.excludedFromTrust[0].reasons).toHaveLength(1);
  });

  it('different reasons for same gpxIndex → both appear in one entry reasons[]', () => {
    const state = freshState(3);
    addExcludedFromTrust(state, 1, VALID_REASON);
    addExcludedFromTrust(state, 1, VALID_REASON_2);
    expect(state.excludedFromTrust).toHaveLength(1);
    expect(state.excludedFromTrust[0].reasons).toHaveLength(2);
    expect(state.excludedFromTrust[0].reasons).toContain(VALID_REASON);
    expect(state.excludedFromTrust[0].reasons).toContain(VALID_REASON_2);
  });

  it('different gpxIndexes → separate entries', () => {
    const state = freshState(5);
    addExcludedFromTrust(state, 1, VALID_REASON);
    addExcludedFromTrust(state, 3, VALID_REASON);
    expect(state.excludedFromTrust).toHaveLength(2);
    expect(state.excludedFromTrust[0].gpxIndex).toBe(1);
    expect(state.excludedFromTrust[1].gpxIndex).toBe(3);
  });

  it('throws on invalid reason string', () => {
    const state = freshState(3);
    expect(() => addExcludedFromTrust(state, 1, 'not-a-real-reason')).toThrow();
  });

  it('throws on null reason', () => {
    const state = freshState(3);
    expect(() => addExcludedFromTrust(state, 1, null)).toThrow();
  });

  it('throws on undefined reason', () => {
    const state = freshState(3);
    expect(() => addExcludedFromTrust(state, 1, undefined)).toThrow();
  });

  it('throws for empty string reason', () => {
    const state = freshState(3);
    expect(() => addExcludedFromTrust(state, 1, '')).toThrow();
  });

  it('details merged shallowly onto new entry', () => {
    const state = freshState(3);
    addExcludedFromTrust(state, 1, VALID_REASON, { foo: 'bar' });
    expect(state.excludedFromTrust[0].details).toEqual({ foo: 'bar' });
  });

  it('details merged shallowly onto existing entry — new keys added', () => {
    const state = freshState(3);
    addExcludedFromTrust(state, 1, VALID_REASON, { foo: 'bar' });
    addExcludedFromTrust(state, 1, VALID_REASON_2, { baz: 'qux' });
    expect(state.excludedFromTrust[0].details).toMatchObject({ foo: 'bar', baz: 'qux' });
  });

  it('details merge overwrites existing key on second call', () => {
    const state = freshState(3);
    addExcludedFromTrust(state, 1, VALID_REASON, { score: 1 });
    addExcludedFromTrust(state, 1, VALID_REASON_2, { score: 2 });
    expect(state.excludedFromTrust[0].details.score).toBe(2);
  });

  it('no details field when none provided', () => {
    const state = freshState(3);
    addExcludedFromTrust(state, 1, VALID_REASON);
    expect(state.excludedFromTrust[0].details).toBeUndefined();
  });

  it('accepts all 12 valid EXCLUDED_REASONS values', () => {
    const { EXCLUDED_REASONS } = require('../state/schema-enums');
    const state = freshState(3);
    const reasons = Object.values(EXCLUDED_REASONS);
    expect(reasons).toHaveLength(12);
    for (const r of reasons) {
      expect(() => addExcludedFromTrust(state, 99, r)).not.toThrow();
    }
  });
});

// ─── addAnnotation ────────────────────────────────────────────────────────────

describe('addAnnotation', () => {
  it('adds annotation with correct shape', () => {
    const state = freshState(3);
    addAnnotation(state, { scope: 'session', kind: 'geometry-only', scopeRef: {}, details: { note: 'x' } });
    expect(state.annotations).toHaveLength(1);
    const ann = state.annotations[0];
    expect(ann.scope).toBe('session');
    expect(ann.kind).toBe('geometry-only');
    expect(ann.scopeRef).toEqual({});
    expect(ann.details).toEqual({ note: 'x' });
  });

  it('scopeRef defaults to {} when omitted', () => {
    const state = freshState(3);
    addAnnotation(state, { scope: 'session', kind: 'geometry-only' });
    expect(state.annotations[0].scopeRef).toEqual({});
  });

  it('throws when scope is missing', () => {
    const state = freshState(3);
    expect(() => addAnnotation(state, { kind: 'geometry-only' })).toThrow(/scope/i);
  });

  it('throws when kind is missing', () => {
    const state = freshState(3);
    expect(() => addAnnotation(state, { scope: 'session' })).toThrow(/kind/i);
  });

  it('throws on invalid kind for session scope', () => {
    const state = freshState(3);
    expect(() => addAnnotation(state, { scope: 'session', kind: 'is_fully_reversed' })).toThrow();
  });

  it('throws on invalid kind for segment scope', () => {
    const state = freshState(3);
    expect(() => addAnnotation(state, { scope: 'segment', kind: 'geometry-only' })).toThrow();
  });

  it('throws on invalid kind for proposal scope', () => {
    const state = freshState(3);
    expect(() => addAnnotation(state, { scope: 'proposal', kind: 'geometry-only' })).toThrow();
  });

  it('throws for an unknown scope', () => {
    const state = freshState(3);
    expect(() => addAnnotation(state, { scope: 'bogus', kind: 'geometry-only' })).toThrow(/scope/i);
  });

  it('throws when annotation is not an object', () => {
    const state = freshState(3);
    expect(() => addAnnotation(state, null)).toThrow();
    expect(() => addAnnotation(state, 'string')).toThrow();
    expect(() => addAnnotation(state, 42)).toThrow();
  });

  it('valid session annotation kinds all work', () => {
    const { SESSION_KINDS } = require('../state/schema-enums');
    const state = freshState(3);
    for (const kind of SESSION_KINDS) {
      expect(() => addAnnotation(state, { scope: 'session', kind })).not.toThrow();
    }
  });

  it('valid segment annotation kinds all work', () => {
    const { SEGMENT_KINDS } = require('../state/schema-enums');
    const state = freshState(3);
    for (const kind of SEGMENT_KINDS) {
      expect(() => addAnnotation(state, { scope: 'segment', kind })).not.toThrow();
    }
  });

  it('valid proposal annotation kinds all work', () => {
    const { PROPOSAL_KINDS } = require('../state/schema-enums');
    const state = freshState(3);
    for (const kind of PROPOSAL_KINDS) {
      expect(() => addAnnotation(state, { scope: 'proposal', kind })).not.toThrow();
    }
  });

  it('multiple annotations accumulate in order', () => {
    const state = freshState(3);
    addAnnotation(state, { scope: 'session', kind: 'geometry-only' });
    addAnnotation(state, { scope: 'session', kind: 'timestamp-sparse' });
    expect(state.annotations).toHaveLength(2);
    expect(state.annotations[0].kind).toBe('geometry-only');
    expect(state.annotations[1].kind).toBe('timestamp-sparse');
  });

  it('session-scope kind used on segment scope throws', () => {
    const state = freshState(3);
    expect(() => addAnnotation(state, { scope: 'segment', kind: 'reversal_unconfirmed' })).toThrow();
  });
});

// ─── addRearrangement ─────────────────────────────────────────────────────────

describe('addRearrangement', () => {
  it('appends a rearrangement record', () => {
    const state = freshState(3);
    const rearr = { kind: 'block-reorder', stage: 'phase1_pass_1', gpxIndexes: [0, 1], trkSegIndex: 0 };
    addRearrangement(state, rearr);
    expect(state.rearrangements).toHaveLength(1);
    expect(state.rearrangements[0]).toBe(rearr); // same object reference
  });

  it('throws when rearrangement is not an object', () => {
    const state = freshState(3);
    expect(() => addRearrangement(state, null)).toThrow();
    expect(() => addRearrangement(state, 'string')).toThrow();
  });

  it('throws when kind is missing', () => {
    const state = freshState(3);
    expect(() => addRearrangement(state, { stage: 'phase1_pass_1' })).toThrow(/kind/i);
  });

  it('throws when stage is missing', () => {
    const state = freshState(3);
    expect(() => addRearrangement(state, { kind: 'block-reorder' })).toThrow(/stage/i);
  });

  it('multiple rearrangements accumulate', () => {
    const state = freshState(3);
    addRearrangement(state, { kind: 'block-reorder', stage: 'phase1_pass_1' });
    addRearrangement(state, { kind: 'block-reorder', stage: 'phase1_pass_2' });
    expect(state.rearrangements).toHaveLength(2);
  });

  it('extra fields beyond kind/stage are preserved', () => {
    const state = freshState(3);
    addRearrangement(state, { kind: 'block-reorder', stage: 'phase1', gpxIndexes: [2, 3], trkSegIndex: 0 });
    expect(state.rearrangements[0].gpxIndexes).toEqual([2, 3]);
    expect(state.rearrangements[0].trkSegIndex).toBe(0);
  });
});

// ─── stageEdgeProposal ────────────────────────────────────────────────────────

describe('stageEdgeProposal', () => {
  const proposalA = { id: 'insert:1', kind: 'insert' };
  const proposalB = { id: 'insert:2', kind: 'insert' };

  it('stages a lastEdge proposal correctly', () => {
    const state = freshState(3);
    stageEdgeProposal(state, 0, 'lastEdge', proposalA);
    const entry = state.stagedEdgeProposals.get(0);
    expect(entry).toBeDefined();
    expect(entry.lastEdge).toBe(proposalA);
    expect(entry.firstEdge).toBeNull();
  });

  it('stages a firstEdge proposal correctly', () => {
    const state = freshState(3);
    stageEdgeProposal(state, 0, 'firstEdge', proposalA);
    const entry = state.stagedEdgeProposals.get(0);
    expect(entry).toBeDefined();
    expect(entry.firstEdge).toBe(proposalA);
    expect(entry.lastEdge).toBeNull();
  });

  it('throws on invalid side string', () => {
    const state = freshState(3);
    expect(() => stageEdgeProposal(state, 0, 'bogus', proposalA)).toThrow(/side/i);
    expect(() => stageEdgeProposal(state, 0, '', proposalA)).toThrow();
    expect(() => stageEdgeProposal(state, 0, null, proposalA)).toThrow();
  });

  it('two proposals for same segment in different sides both stored', () => {
    const state = freshState(3);
    stageEdgeProposal(state, 1, 'lastEdge', proposalA);
    stageEdgeProposal(state, 1, 'firstEdge', proposalB);
    const entry = state.stagedEdgeProposals.get(1);
    expect(entry.lastEdge).toBe(proposalA);
    expect(entry.firstEdge).toBe(proposalB);
  });

  it('second call to same side overwrites', () => {
    const state = freshState(3);
    stageEdgeProposal(state, 0, 'lastEdge', proposalA);
    stageEdgeProposal(state, 0, 'lastEdge', proposalB);
    expect(state.stagedEdgeProposals.get(0).lastEdge).toBe(proposalB);
  });

  it('different trkSegIndexes produce separate entries in the Map', () => {
    const state = freshState(3);
    stageEdgeProposal(state, 0, 'lastEdge', proposalA);
    stageEdgeProposal(state, 1, 'lastEdge', proposalB);
    expect(state.stagedEdgeProposals.size).toBe(2);
    expect(state.stagedEdgeProposals.get(0).lastEdge).toBe(proposalA);
    expect(state.stagedEdgeProposals.get(1).lastEdge).toBe(proposalB);
  });
});

// ─── removeFromWorking ────────────────────────────────────────────────────────

describe('removeFromWorking', () => {
  it('removes the point with matching gpxIndex', () => {
    const state = freshState(5);
    const before = state.workingOrderedPoints.length;
    removeFromWorking(state, 2);
    expect(state.workingOrderedPoints).toHaveLength(before - 1);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    expect(indexes).not.toContain(2);
  });

  it('returns true when the point was found and removed', () => {
    const state = freshState(5);
    const result = removeFromWorking(state, 3);
    expect(result).toBe(true);
  });

  it('returns false when the gpxIndex is not in the working list', () => {
    const state = freshState(5);
    const result = removeFromWorking(state, 99);
    expect(result).toBe(false);
  });

  it('does not remove other points when one is removed', () => {
    const state = freshState(5);
    removeFromWorking(state, 2);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    expect(indexes).toEqual([0, 1, 3, 4]);
  });

  it('removing from an empty list returns false', () => {
    const state = freshState(0);
    expect(removeFromWorking(state, 0)).toBe(false);
  });

  it('removes a single-element list, leaving it empty', () => {
    const state = freshState(1);
    const result = removeFromWorking(state, 0);
    expect(result).toBe(true);
    expect(state.workingOrderedPoints).toHaveLength(0);
  });
});

// ─── relocateRunAfter ─────────────────────────────────────────────────────────

describe('relocateRunAfter', () => {
  it('moves specified gpxIndexes to correct position after afterGpxIndex', () => {
    const state = freshState(6); // points 0..5
    // Move [2,3] to after point 5
    relocateRunAfter(state, [2, 3], 5);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    expect(indexes).toEqual([0, 1, 4, 5, 2, 3]);
  });

  it('afterGpxIndex=null moves the run to the very start', () => {
    const state = freshState(5); // 0..4
    relocateRunAfter(state, [3, 4], null);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    expect(indexes).toEqual([3, 4, 0, 1, 2]);
  });

  it('afterGpxIndex=undefined moves the run to the very start (treated as null)', () => {
    const state = freshState(5);
    relocateRunAfter(state, [4], undefined);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    expect(indexes[0]).toBe(4);
  });

  it('throws if any gpxIndex not in working list', () => {
    const state = freshState(5);
    expect(() => relocateRunAfter(state, [2, 99], 4)).toThrow(/not all gpxIndexes/i);
  });

  it('throws if afterGpxIndex not in remaining points (i.e. it was in the moved set)', () => {
    const state = freshState(5);
    // afterGpxIndex=2 is also in the moved set — once extracted it won't be in rest
    expect(() => relocateRunAfter(state, [2, 3], 2)).toThrow();
  });

  it('throws if afterGpxIndex does not exist at all', () => {
    const state = freshState(5);
    expect(() => relocateRunAfter(state, [1], 99)).toThrow();
  });

  it('preserves order of moved points per input order (not original order)', () => {
    const state = freshState(6);
    // Provide reversed order [4, 2, 3] — should appear in that order
    relocateRunAfter(state, [4, 2, 3], 5);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    const movedSection = indexes.slice(indexes.indexOf(4));
    expect(movedSection[0]).toBe(4);
    expect(movedSection[1]).toBe(2);
    expect(movedSection[2]).toBe(3);
  });

  it('non-moved points retain relative order', () => {
    const state = freshState(6); // 0..5
    relocateRunAfter(state, [2, 3], 5);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    // Non-moved are [0,1,4,5]; their relative order must be intact
    const nonMoved = indexes.filter(i => ![2, 3].includes(i));
    expect(nonMoved).toEqual([0, 1, 4, 5]);
  });

  it('moving a single point works', () => {
    const state = freshState(5); // 0..4
    relocateRunAfter(state, [0], 4);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    expect(indexes).toEqual([1, 2, 3, 4, 0]);
  });

  it('moving all points to start preserves input order', () => {
    const state = freshState(4); // 0..3
    relocateRunAfter(state, [3, 1, 2, 0], null);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    expect(indexes).toEqual([3, 1, 2, 0]);
  });

  it('relocating to just after the first non-moved point', () => {
    const state = freshState(5); // 0..4
    relocateRunAfter(state, [3, 4], 0);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    expect(indexes).toEqual([0, 3, 4, 1, 2]);
  });
});

// ─── relocatePointAfter ───────────────────────────────────────────────────────

describe('relocatePointAfter', () => {
  it('moves a single point after afterGpxIndex', () => {
    const state = freshState(5); // 0..4
    relocatePointAfter(state, 1, 4);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    expect(indexes).toEqual([0, 2, 3, 4, 1]);
  });

  it('moves a single point to the start when afterGpxIndex is null', () => {
    const state = freshState(5);
    relocatePointAfter(state, 4, null);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    expect(indexes[0]).toBe(4);
    expect(indexes).toHaveLength(5);
  });

  it('throws when movedGpxIndex is not in working list', () => {
    const state = freshState(5);
    expect(() => relocatePointAfter(state, 99, 0)).toThrow();
  });

  it('throws when afterGpxIndex is not in working list (and not null)', () => {
    const state = freshState(5);
    expect(() => relocatePointAfter(state, 0, 99)).toThrow();
  });

  it('moving point to immediately before itself (after previous) works', () => {
    const state = freshState(4); // 0..3
    // Move point 2 to after point 0 — should become [0,2,1,3]
    relocatePointAfter(state, 2, 0);
    const indexes = state.workingOrderedPoints.map(p => p.gpxIndex);
    expect(indexes).toEqual([0, 2, 1, 3]);
  });
});
