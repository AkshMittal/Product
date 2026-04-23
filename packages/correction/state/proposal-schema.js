'use strict';

/**
 * packages/correction/state/proposal-schema.js
 *
 * Factory functions and validators for correction proposal objects.
 *
 * Proposal kinds (unified per ADR-correction-0012):
 *   'insert'             — singleton insert or duplicate competition
 *   'block-finding'      — chunk reorder candidate
 *   'adjacent-exact-drop' — stream-adjacent exact duplicate drop
 *
 * Every proposal has:
 *   id          {string}  — unique within a pass (e.g. 'insert:42', 'block:7-12')
 *   kind        {string}  — one of the three kinds above
 *   trkSegIndex {number}  — owning segment
 *   applied     {boolean|undefined} — set by resolution-apply; undefined before apply
 *   skipReason  {string|undefined}  — set when applied === false
 *
 * Kind-specific payload fields are appended by each factory.
 */

var nextId = 0;
function freshId(prefix) {
  return prefix + ':' + (++nextId);
}

/**
 * Creates an 'insert' proposal.
 * @param {Object} opts
 * @param {number}   opts.trkSegIndex
 * @param {number[]} opts.candidateGpxIndexes  — 1 item = singleton, 2+ = competition
 * @param {boolean}  opts.isExactGroup          — geometry-identical candidates
 * @param {number|null} opts.tPrev              — timeMs of traversal-prev bracket anchor
 * @param {number|null} opts.tNext              — timeMs of traversal-next bracket anchor
 * @param {number[]}    opts.bracketGpxIndexes  — [prevGpxIndex, nextGpxIndex] (coupling reference)
 */
function makeInsertProposal(opts) {
  return {
    id: freshId('insert'),
    kind: 'insert',
    trkSegIndex: opts.trkSegIndex,
    candidateGpxIndexes: opts.candidateGpxIndexes,
    isExactGroup: opts.isExactGroup,
    tPrev: opts.tPrev !== undefined ? opts.tPrev : null,
    tNext: opts.tNext !== undefined ? opts.tNext : null,
    bracketGpxIndexes: opts.bracketGpxIndexes || [],
  };
}

/**
 * Creates a 'block-finding' proposal.
 * @param {Object} opts
 * @param {number}   opts.trkSegIndex
 * @param {number[]} opts.gpxIndexes       — block member gpxIndexes (ordered)
 * @param {boolean}  opts.hasInternalMonotonicityViolation
 */
function makeBlockFindingProposal(opts) {
  return {
    id: freshId('block'),
    kind: 'block-finding',
    trkSegIndex: opts.trkSegIndex,
    gpxIndexes: opts.gpxIndexes,
    hasInternalMonotonicityViolation: opts.hasInternalMonotonicityViolation,
    // Filled in by overlap-detection when socket-ok:
    overlapStatus: null,        // 'socket-ok' | 'overlap' | null
    prevGpxIndex: null,         // bracket anchor (for coupling guard)
    nextGpxIndex: null,         // bracket anchor (for coupling guard)
    tPrev: null,
    tNext: null,
  };
}

/**
 * Creates an 'adjacent-exact-drop' proposal.
 * @param {Object} opts
 * @param {number} opts.trkSegIndex
 * @param {number} opts.keepGpxIndex   — the surviving duplicate
 * @param {number} opts.dropGpxIndex   — the one to be dropped
 */
function makeAdjacentExactDropProposal(opts) {
  return {
    id: freshId('adj-drop'),
    kind: 'adjacent-exact-drop',
    trkSegIndex: opts.trkSegIndex,
    keepGpxIndex: opts.keepGpxIndex,
    dropGpxIndex: opts.dropGpxIndex,
  };
}

/**
 * Validates that a proposal has the required base fields.
 * Throws if invalid. Used in tests.
 * @param {Object} proposal
 */
function assertValidProposal(proposal) {
  if (!proposal || typeof proposal !== 'object') throw new Error('proposal must be an object');
  if (typeof proposal.id !== 'string') throw new Error('proposal.id must be a string');
  const validKinds = ['insert', 'block-finding', 'adjacent-exact-drop'];
  if (!validKinds.includes(proposal.kind)) throw new Error('invalid proposal kind: ' + proposal.kind);
  if (typeof proposal.trkSegIndex !== 'number') throw new Error('proposal.trkSegIndex must be a number');
}

module.exports = { makeInsertProposal, makeBlockFindingProposal, makeAdjacentExactDropProposal, assertValidProposal };
