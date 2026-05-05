'use strict';

/**
 * packages/correction/proposals/duplicate-proposal.js
 *
 * Per plan §duplicate-proposal / ADR-correction-0004 / ADR-0014.
 *
 * Two halves:
 *
 * (A) Per-pass, per-segment proposals (`buildDuplicateProposals`):
 *   - Traversal-adjacent rescan within ONE segment for exact duplicates →
 *     `adjacent-exact-drop` proposals.
 *   - Same-`timeMs` groups of size ≥ 2 not all in adjacent-exact-drop →
 *     `insert` proposals with `candidates.length ≥ 2`:
 *       * isExactGroup=true   when every member shares lat+lon+ele
 *         (MVP: flag-only, not active for apply gating)
 *       * isExactGroup=false  competition: kinematic guard advisory + fallback
 *
 * (B) One-shot cross-segment detection (`detectCrossSegmentDuplicates`):
 *   - Same `timeMs` across DIFFERENT trkSegIndex →
 *     write to excludedFromTrust with reason 'cross_segment_duplicate'.
 *     No proposal emitted; phase 2 / phase 3 do not act on these.
 *
 * Each candidate in an insert payload carries:
 *   { gpxIndex, lat, lon, tPrev, tNext, bracketGpxIndexes, kinematics }
 * where `tPrev`/`tNext` are derived from the candidate's CURRENT traversal-adjacent
 * neighbours within the same segment (excluding other group members), and
 * `kinematics` is computed via the shared kinematic-guard primitive.
 */
var schema   = require('../state/proposal-schema');
var ws       = require('../state/working-state');

function getEle(p) {
  if (p.eleAbsent === true) return null;
  if (p.ele === null || p.ele === undefined) return null;
  return p.ele;
}
function isExactDuplicate(a, b) {
  if (typeof a.timeMs !== 'number' || !isFinite(a.timeMs) || a.timeMs <= 0) return false;
  if (typeof b.timeMs !== 'number' || !isFinite(b.timeMs) || b.timeMs <= 0) return false;
  if (a.timeMs !== b.timeMs) return false;
  if (a.lat !== b.lat || a.lon !== b.lon) return false;
  return getEle(a) === getEle(b);
}

/**
 * Per-segment duplicate proposals.
 *
 * @param {Array<Object>} workingOrderedPoints
 * @param {number}        trkSegIndex
 * @param {{minTimeMs:number|null, maxTimeMs:number|null}|null} spineEnvelope
 * @param {{lenientMaxImpliedSpeedKph?:number}} [params]
 */
function buildDuplicateProposals(workingOrderedPoints, trkSegIndex, spineEnvelope, params, excludedSet) {
  var excluded = (excludedSet instanceof Set) ? excludedSet : new Set(excludedSet || []);

  var proposals = [];
  var segPoints = workingOrderedPoints.filter(function(p) { return p.trkSegIndex === trkSegIndex; });
  if (segPoints.length === 0) return proposals;

  // (A1) Traversal-adjacent exact drops.
  var adjDropDropSet = new Set(); // gpxIndexes that have been queued for drop
  for (var i = 1; i < segPoints.length; i++) {
    var prev = segPoints[i - 1];
    var curr = segPoints[i];
    if (!isExactDuplicate(prev, curr)) continue;
    var eleMismatch = (getEle(prev) !== getEle(curr));
    proposals.push(schema.makeAdjacentExactDropProposal({
      trkSegIndex:  trkSegIndex,
      keepGpxIndex: prev.gpxIndex,
      dropGpxIndex: curr.gpxIndex,
      eleMismatch:  eleMismatch
    }));
    adjDropDropSet.add(curr.gpxIndex);
  }

  // (A2) Same-timeMs groups (size ≥ 2). Members already drop-queued by adj-exact, or
  // already in excludedFromTrust (e.g. competition losers from a prior pass), are
  // excluded — they no longer participate in NEW proposal formation.
  var byTime = new Map();
  for (var j = 0; j < segPoints.length; j++) {
    var pt = segPoints[j];
    if (typeof pt.timeMs !== 'number' || !isFinite(pt.timeMs) || pt.timeMs <= 0) continue;
    if (adjDropDropSet.has(pt.gpxIndex)) continue;
    if (excluded.has(pt.gpxIndex)) continue;
    if (!byTime.has(pt.timeMs)) byTime.set(pt.timeMs, []);
    byTime.get(pt.timeMs).push(pt);
  }

  byTime.forEach(function(group, timeKey) {
    if (group.length < 2) return;
    // Sort by gpxIndex for determinism.
    group.sort(function(a, b) { return a.gpxIndex - b.gpxIndex; });

    var allExact = true;
    var first = group[0];
    for (var g = 1; g < group.length; g++) {
      if (!isExactDuplicate(first, group[g])) { allExact = false; break; }
    }

    // Build per-candidate payloads with brackets + kinematics.
    var groupGiSet = new Set(group.map(function(p) { return p.gpxIndex; }));
    var candidateGpxIndexes = group.map(function(p) { return p.gpxIndex; });

    // Derive shared bracket from the first candidate (representative for the group).
    var firstPos = -1;
    for (var k = 0; k < segPoints.length; k++) {
      if (segPoints[k].gpxIndex === group[0].gpxIndex) { firstPos = k; break; }
    }
    var sharedPrevAnchor = null, sharedNextAnchor = null;
    for (var l = firstPos - 1; l >= 0; l--) {
      var lp2 = segPoints[l];
      if (groupGiSet.has(lp2.gpxIndex)) continue;
      if (typeof lp2.timeMs === 'number' && isFinite(lp2.timeMs) && lp2.timeMs > 0) {
        sharedPrevAnchor = lp2; break;
      }
    }
    for (var r2 = firstPos + 1; r2 < segPoints.length; r2++) {
      var rp2 = segPoints[r2];
      if (groupGiSet.has(rp2.gpxIndex)) continue;
      if (typeof rp2.timeMs === 'number' && isFinite(rp2.timeMs) && rp2.timeMs > 0) {
        sharedNextAnchor = rp2; break;
      }
    }
    var bracketGi = [];
    if (sharedPrevAnchor) bracketGi.push(sharedPrevAnchor.gpxIndex);
    if (sharedNextAnchor) bracketGi.push(sharedNextAnchor.gpxIndex);

    // Edge classification — group's targetTime against envelope.
    var isEdgeProposal;
    if (!spineEnvelope || spineEnvelope.minTimeMs === null || spineEnvelope.maxTimeMs === null) {
      isEdgeProposal = true;
    } else {
      isEdgeProposal = (timeKey <= spineEnvelope.minTimeMs) ||
                       (timeKey >= spineEnvelope.maxTimeMs);
    }

    proposals.push(schema.makeInsertProposal({
      trkSegIndex:         trkSegIndex,
      candidateGpxIndexes: candidateGpxIndexes,
      isExactGroup:        allExact,
      isEdgeProposal:      isEdgeProposal,
      tPrev:               sharedPrevAnchor ? sharedPrevAnchor.timeMs : null,
      tNext:               sharedNextAnchor ? sharedNextAnchor.timeMs : null,
      bracketGpxIndexes:   bracketGi,
      targetTimeMs:        timeKey
    }));
  });

  return proposals;
}

/**
 * Cross-segment same-timeMs detection. Writes excludedFromTrust entries
 * (reason 'cross_segment_duplicate') for each gpxIndex involved in a
 * cross-segment duplicate group. No proposal is emitted.
 *
 * Should be called ONCE before Phase 1 starts (after participation /
 * objective-dedupe / reversal / deterministic-export-fix).
 *
 * @param {Array<Object>} workingOrderedPoints
 * @param {Object}        workingState
 * @returns {Array<{timeMs:number, gpxIndexes:number[], trkSegIndexes:number[]}>}
 */
function detectCrossSegmentDuplicates(workingOrderedPoints, workingState) {
  var byTime = new Map();
  for (var i = 0; i < workingOrderedPoints.length; i++) {
    var p = workingOrderedPoints[i];
    if (typeof p.timeMs !== 'number' || !isFinite(p.timeMs) || p.timeMs <= 0) continue;
    if (!byTime.has(p.timeMs)) byTime.set(p.timeMs, []);
    byTime.get(p.timeMs).push(p);
  }
  var detections = [];
  byTime.forEach(function(group, t) {
    if (group.length < 2) return;
    // Cross-segment iff the group spans ≥2 distinct trkSegIndex values.
    var segs = new Set();
    for (var g = 0; g < group.length; g++) segs.add(group[g].trkSegIndex);
    if (segs.size < 2) return;
    var giArr = group.map(function(g) { return g.gpxIndex; });
    var segArr = Array.from(segs);
    detections.push({ timeMs: t, gpxIndexes: giArr, trkSegIndexes: segArr });
    for (var k = 0; k < group.length; k++) {
      ws.addExcludedFromTrust(workingState, group[k].gpxIndex, 'cross_segment_duplicate', {
        timeMs: t, peerSegments: segArr.filter(function(s) { return s !== group[k].trkSegIndex; })
      });
    }
  });
  return detections;
}

module.exports = {
  buildDuplicateProposals:        buildDuplicateProposals,
  detectCrossSegmentDuplicates:   detectCrossSegmentDuplicates
};
