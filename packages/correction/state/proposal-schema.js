'use strict';

/**
 * packages/correction/state/proposal-schema.js
 *
 * Factory + validators for proposal objects (ADR-correction-0012).
 *
 * Three kinds:
 *   'block-finding'        — maximal contiguous belowAnchor run within one segment
 *   'insert'               — singleton / competition / exact-group replacement
 *   'adjacent-exact-drop'  — traversal-adjacent exact-duplicate drop
 *
 * Common fields on every proposal:
 *   id            string  — unique identifier
 *   kind          string  — one of the three above
 *   trkSegIndex   number  — owning segment
 *   isEdgeProposal boolean
 *   applied       boolean — initially false
 *   skipReason    string|null
 *
 * Insert payload fields:
 *   candidateGpxIndexes  number[]  — gpxIndexes of candidate points
 *   isExactGroup         boolean
 *   tPrev                number|null — prev bracket anchor timeMs
 *   tNext                number|null — next bracket anchor timeMs
 *   bracketGpxIndexes    number[]   — [prevGpxIndex?, nextGpxIndex?]
 *   targetTimeMs         number|null — optional; set by proposal builders when known
 *   winner               number|null — winning gpxIndex after apply
 *
 * Block-finding payload fields:
 *   gpxIndexes                    number[] — block members in traversal order
 *   hasInternalMonotonicityViolation boolean — true iff any intra-block backward step
 *   bMin, bMax                    number|null — populated by overlap-detection
 *   prevGpxIndex/nextGpxIndex     number|null — bracket anchors
 *   tPrev, tNext                  number|null — anchor times
 *   overlapStatus                 string|null — 'socket-ok' | 'overlap' | 'no-bracket' | null
 *
 * Adjacent-exact-drop payload fields:
 *   keepGpxIndex  number
 *   dropGpxIndex  number
 *   eleMismatch   boolean
 */

var nextId = 0;
function freshId(prefix) { return prefix + ':' + (++nextId); }

function makeInsertProposal(opts) {
  if (!opts) throw new Error('makeInsertProposal: opts required');
  if (typeof opts.trkSegIndex !== 'number') throw new Error('makeInsertProposal: trkSegIndex required');
  if (!Array.isArray(opts.candidateGpxIndexes) || opts.candidateGpxIndexes.length === 0) {
    throw new Error('makeInsertProposal: candidateGpxIndexes[] required (length≥1)');
  }
  return {
    id:                  freshId('insert'),
    kind:                'insert',
    trkSegIndex:         opts.trkSegIndex,
    isEdgeProposal:      !!opts.isEdgeProposal,
    candidateGpxIndexes: opts.candidateGpxIndexes.slice(),
    isExactGroup:        !!opts.isExactGroup,
    tPrev:               (opts.tPrev !== undefined && opts.tPrev !== null) ? opts.tPrev : null,
    tNext:               (opts.tNext !== undefined && opts.tNext !== null) ? opts.tNext : null,
    bracketGpxIndexes:   (opts.bracketGpxIndexes || []).slice(),
    targetTimeMs:        (typeof opts.targetTimeMs === 'number') ? opts.targetTimeMs : null,
    winner:              null,
    applied:             false,
    skipReason:          null
  };
}

function makeBlockFindingProposal(opts) {
  if (!opts) throw new Error('makeBlockFindingProposal: opts required');
  if (typeof opts.trkSegIndex !== 'number') throw new Error('makeBlockFindingProposal: trkSegIndex required');
  if (!Array.isArray(opts.gpxIndexes) || opts.gpxIndexes.length === 0) {
    throw new Error('makeBlockFindingProposal: gpxIndexes[] required (length≥1)');
  }
  return {
    id:                              freshId('block'),
    kind:                            'block-finding',
    trkSegIndex:                     opts.trkSegIndex,
    isEdgeProposal:                  !!opts.isEdgeProposal,
    gpxIndexes:                      opts.gpxIndexes.slice(),
    hasInternalMonotonicityViolation: !!opts.hasInternalMonotonicityViolation,
    bMin:           (typeof opts.bMin === 'number' && isFinite(opts.bMin)) ? opts.bMin : null,
    bMax:           (typeof opts.bMax === 'number' && isFinite(opts.bMax)) ? opts.bMax : null,
    prevGpxIndex:   null,
    nextGpxIndex:   null,
    tPrev:          null,
    tNext:          null,
    overlapStatus:  null,
    applied:        false,
    skipReason:     null
  };
}

function makeAdjacentExactDropProposal(opts) {
  if (!opts) throw new Error('makeAdjacentExactDropProposal: opts required');
  if (typeof opts.trkSegIndex !== 'number') throw new Error('trkSegIndex required');
  if (typeof opts.keepGpxIndex !== 'number') throw new Error('keepGpxIndex required');
  if (typeof opts.dropGpxIndex !== 'number') throw new Error('dropGpxIndex required');
  return {
    id:             freshId('adj-drop'),
    kind:           'adjacent-exact-drop',
    trkSegIndex:    opts.trkSegIndex,
    isEdgeProposal: false,
    keepGpxIndex:   opts.keepGpxIndex,
    dropGpxIndex:   opts.dropGpxIndex,
    eleMismatch:    !!opts.eleMismatch,
    applied:        false,
    skipReason:     null
  };
}

/**
 * Strict validator. Throws on missing/invalid fields. Used at export time.
 */
function assertValidProposal(proposal) {
  if (!proposal || typeof proposal !== 'object') throw new Error('proposal must be object');
  if (typeof proposal.id !== 'string') throw new Error('proposal.id required');
  if (typeof proposal.trkSegIndex !== 'number') throw new Error('proposal.trkSegIndex required');
  var validKinds = ['insert', 'block-finding', 'adjacent-exact-drop'];
  if (validKinds.indexOf(proposal.kind) === -1) {
    throw new Error('invalid proposal.kind: ' + proposal.kind);
  }
  if (typeof proposal.applied !== 'boolean') throw new Error('proposal.applied must be boolean');
  if (proposal.applied === true && proposal.skipReason !== null && proposal.skipReason !== undefined) {
    throw new Error('proposal.applied=true must NOT have skipReason');
  }
  if (proposal.applied === false && (proposal.skipReason === null || proposal.skipReason === undefined)) {
    throw new Error('proposal.applied=false must have skipReason');
  }
  if (proposal.kind === 'insert') {
    if (!Array.isArray(proposal.candidateGpxIndexes) || proposal.candidateGpxIndexes.length === 0) {
      throw new Error('insert.candidateGpxIndexes[] required');
    }
    if (typeof proposal.isExactGroup !== 'boolean') throw new Error('insert.isExactGroup required');
  } else if (proposal.kind === 'block-finding') {
    if (!Array.isArray(proposal.gpxIndexes) || proposal.gpxIndexes.length === 0) {
      throw new Error('block-finding.gpxIndexes[] required');
    }
  } else if (proposal.kind === 'adjacent-exact-drop') {
    if (typeof proposal.keepGpxIndex !== 'number') throw new Error('adj-drop.keepGpxIndex required');
    if (typeof proposal.dropGpxIndex !== 'number') throw new Error('adj-drop.dropGpxIndex required');
  }
}

module.exports = {
  makeInsertProposal,
  makeBlockFindingProposal,
  makeAdjacentExactDropProposal,
  assertValidProposal
};
