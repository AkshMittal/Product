'use strict';

/**
 * packages/correction/proposals/duplicate-proposal.js
 *
 * Emits proposals for duplicate-time groups:
 *   - 'adjacent-exact-drop'  for traversal-adjacent exact duplicates (ADR-correction-0004)
 *   - 'insert' (competition) for non-adjacent groups sharing the same timeMs
 *
 * Per-pass rescan uses traversal-adjacency (ADR-correction-0014): after any mutation,
 * traversal neighbours change even if gpxIndex values don't.
 *
 * Exact duplicate predicate (ADR-correction-0004):
 *   Same timeMs (both finite) AND same lat AND same lon AND same ele (or both null/absent)
 *
 * Competition groups (two+ candidates with same timeMs, not exact geometry):
 *   Emitted as 'insert' proposals with isExactGroup: false and candidates.length >= 2.
 *   Kinematic guard selects winner at apply time (ADR-correction-0015).
 *
 * Exact-geometry groups (two+ candidates with same timeMs AND same geometry):
 *   Emitted as 'insert' proposals with isExactGroup: true.
 *   No kinematic check; winner = lowest gpxIndex (ADR-correction-0015 §5).
 *
 * @param {Array<Object>} workingOrderedPoints - current traversal snapshot (one segment)
 * @param {number}        trkSegIndex
 * @returns {Array<Object>} array of proposal objects
 */

var schema = require('../state/proposal-schema');

/**
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
function isExactDuplicate(a, b) {
  if (typeof a.timeMs !== 'number' || !isFinite(a.timeMs)) return false;
  if (typeof b.timeMs !== 'number' || !isFinite(b.timeMs)) return false;
  if (a.timeMs !== b.timeMs) return false;
  if (a.lat !== b.lat || a.lon !== b.lon) return false;
  var aEle = (a.eleAbsent === true || a.ele === null) ? null : a.ele;
  var bEle = (b.eleAbsent === true || b.ele === null) ? null : b.ele;
  return aEle === bEle;
}

function buildDuplicateProposals(workingOrderedPoints, trkSegIndex) {
  var proposals = [];
  var segPoints = workingOrderedPoints.filter(function(p) { return p.trkSegIndex === trkSegIndex; });

  // ── 1. Traversal-adjacent exact drops ──────────────────────────────────────
  for (var i = 1; i < segPoints.length; i++) {
    var prev = segPoints[i - 1];
    var curr = segPoints[i];
    if (isExactDuplicate(prev, curr)) {
      proposals.push(schema.makeAdjacentExactDropProposal({
        trkSegIndex: trkSegIndex,
        keepGpxIndex: prev.gpxIndex,
        dropGpxIndex: curr.gpxIndex
      }));
    }
  }

  // ── 2. Non-adjacent same-timeMs groups ────────────────────────────────────
  // Group all points by timeMs; skip groups of 1; skip if already covered by adjacent-exact-drop.
  var byTimeMs = new Map();
  for (var j = 0; j < segPoints.length; j++) {
    var pt = segPoints[j];
    if (typeof pt.timeMs !== 'number' || !isFinite(pt.timeMs)) continue;
    if (!byTimeMs.has(pt.timeMs)) byTimeMs.set(pt.timeMs, []);
    byTimeMs.get(pt.timeMs).push(pt);
  }

  byTimeMs.forEach(function(group) {
    if (group.length < 2) return;

    // Determine if this is an exact-geometry group
    var first = group[0];
    var allExact = group.every(function(g) { return isExactDuplicate(first, g); });

    // Sort by gpxIndex for determinism
    group.sort(function(a, b) { return a.gpxIndex - b.gpxIndex; });

    // Find bracket for the group (traversal neighbours of the lowest gpxIndex candidate)
    var lowestIdx = -1;
    for (var k = 0; k < segPoints.length; k++) {
      if (segPoints[k].gpxIndex === group[0].gpxIndex) { lowestIdx = k; break; }
    }
    var tPrev = null, prevGpxIndex = null;
    for (var l = lowestIdx - 1; l >= 0; l--) {
      var lpt = segPoints[l];
      if (typeof lpt.timeMs === 'number' && isFinite(lpt.timeMs) &&
          !group.some(function(g) { return g.gpxIndex === lpt.gpxIndex; })) {
        tPrev = lpt.timeMs; prevGpxIndex = lpt.gpxIndex; break;
      }
    }
    var tNext = null, nextGpxIndex = null;
    for (var r = lowestIdx + 1; r < segPoints.length; r++) {
      var rpt = segPoints[r];
      if (typeof rpt.timeMs === 'number' && isFinite(rpt.timeMs) &&
          !group.some(function(g) { return g.gpxIndex === rpt.gpxIndex; })) {
        tNext = rpt.timeMs; nextGpxIndex = rpt.gpxIndex; break;
      }
    }

    var bracketGpxIndexes = [];
    if (prevGpxIndex !== null) bracketGpxIndexes.push(prevGpxIndex);
    if (nextGpxIndex !== null) bracketGpxIndexes.push(nextGpxIndex);

    proposals.push(schema.makeInsertProposal({
      trkSegIndex: trkSegIndex,
      candidateGpxIndexes: group.map(function(g) { return g.gpxIndex; }),
      isExactGroup: allExact,
      tPrev: tPrev,
      tNext: tNext,
      bracketGpxIndexes: bracketGpxIndexes
    }));
  });

  return proposals;
}

module.exports = { buildDuplicateProposals };
