'use strict';

/**
 * packages/correction/gates/coupling-detection.js
 *
 * Computes kinematic reference instability (coupling) between proposals.
 * Independent of overlap-detection (ADR-correction-0010): both read snapshot state only.
 *
 * Symmetric blocking (ADR-correction-0010 revised 2026-04-23):
 *   - 'insert' proposals (singleton + competition): kinematic references = bracketGpxIndexes
 *   - 'block-finding' (socket-ok): kinematic references = [prevGpxIndex, nextGpxIndex]
 *   Both are coupling-blocked if their reference points fall in another proposal's disturbance zone.
 *
 * Bilateral disturbance zones (ADR-correction-0010 §3):
 *   - insert: leaving = traversal neighbours of candidate's current position;
 *             arriving = bracketGpxIndexes
 *   - block-finding: leaving = traversal neighbours of block first/last;
 *                    arriving = [prevGpxIndex, nextGpxIndex]
 *   - adjacent-exact-drop: NO disturbance zone (geometry unchanged)
 *
 * Emits:
 *   couplingBlockedProposalIds[]  — ids of proposals with ≥1 coupling edge
 *   independentProposalIds[]      — ids with no coupling edges
 *   coupledRegions[]              — connected components with full edge diagnostics
 *
 * @param {Array<Object>} proposals - all proposals (post-overlap-detection)
 * @param {Array<Object>} workingOrderedPoints - current traversal snapshot
 * @returns {{ couplingBlockedProposalIds: string[], independentProposalIds: string[], coupledRegions: Array }}
 */
function detectCoupling(proposals, workingOrderedPoints) {
  // Build gpxIndex → traversal position lookup
  var traversalPos = new Map();
  for (var i = 0; i < workingOrderedPoints.length; i++) {
    traversalPos.set(workingOrderedPoints[i].gpxIndex, i);
  }

  /**
   * Get traversal neighbours of a gpxIndex in the current snapshot.
   * Returns { prev: gpxIndex|null, next: gpxIndex|null }
   */
  function traversalNeighbours(gpxIndex) {
    var pos = traversalPos.get(gpxIndex);
    if (pos === undefined) return { prev: null, next: null };
    var prev = pos > 0 ? workingOrderedPoints[pos - 1].gpxIndex : null;
    var next = pos < workingOrderedPoints.length - 1 ? workingOrderedPoints[pos + 1].gpxIndex : null;
    return { prev, next };
  }

  // Build disturbance zones per proposal
  // Each zone is a Set<number> of gpxIndexes that are "disturbed" by this proposal
  var disturbanceZones = new Map(); // proposalId → Set<number>

  for (var p = 0; p < proposals.length; p++) {
    var prop = proposals[p];
    var zone = new Set();

    if (prop.kind === 'adjacent-exact-drop') {
      // No disturbance zone (ADR-correction-0010 §3)
    } else if (prop.kind === 'insert') {
      // Leaving side: traversal neighbours of each candidate's current position
      for (var ci = 0; ci < prop.candidateGpxIndexes.length; ci++) {
        var nb = traversalNeighbours(prop.candidateGpxIndexes[ci]);
        if (nb.prev !== null) zone.add(nb.prev);
        if (nb.next !== null) zone.add(nb.next);
      }
      // Arriving side: bracketGpxIndexes
      for (var bi = 0; bi < prop.bracketGpxIndexes.length; bi++) {
        zone.add(prop.bracketGpxIndexes[bi]);
      }
    } else if (prop.kind === 'block-finding') {
      // Leaving side: traversal neighbours of block first/last
      if (prop.gpxIndexes.length > 0) {
        var firstNb = traversalNeighbours(prop.gpxIndexes[0]);
        var lastNb  = traversalNeighbours(prop.gpxIndexes[prop.gpxIndexes.length - 1]);
        if (firstNb.prev !== null) zone.add(firstNb.prev);
        if (firstNb.next !== null) zone.add(firstNb.next);
        if (lastNb.prev !== null) zone.add(lastNb.prev);
        if (lastNb.next !== null) zone.add(lastNb.next);
      }
      // Arriving side: bracket anchors (prevGpxIndex, nextGpxIndex)
      if (prop.prevGpxIndex !== null) zone.add(prop.prevGpxIndex);
      if (prop.nextGpxIndex !== null) zone.add(prop.nextGpxIndex);
    }

    disturbanceZones.set(prop.id, zone);
  }

  // Build kinematic reference points per proposal (what each proposal's check depends on)
  function kineRefIndexes(prop) {
    if (prop.kind === 'insert') return prop.bracketGpxIndexes;
    if (prop.kind === 'block-finding') {
      var refs = [];
      if (prop.prevGpxIndex !== null) refs.push(prop.prevGpxIndex);
      if (prop.nextGpxIndex !== null) refs.push(prop.nextGpxIndex);
      return refs;
    }
    return []; // adjacent-exact-drop: no kinematic references
  }

  // Kinematically sensitive proposal kinds
  function isKineSensitive(prop) {
    return prop.kind === 'insert' || prop.kind === 'block-finding';
  }

  // Build coupling edges: for each sensitive proposal P, for each other proposal Q,
  // if any of P's kinematic ref indexes fall in Q's disturbance zone → edge P↔Q
  var edges = []; // { blockedProposalId, disturbanceSourceId, disturbedGpxIndex, side }
  var adjacency = new Map(); // proposalId → Set<proposalId> (neighbours in coupling graph)

  proposals.forEach(function(prop) {
    adjacency.set(prop.id, new Set());
  });

  for (var pi = 0; pi < proposals.length; pi++) {
    var P = proposals[pi];
    if (!isKineSensitive(P)) continue;
    var Prefs = kineRefIndexes(P);

    for (var qi = 0; qi < proposals.length; qi++) {
      var Q = proposals[qi];
      if (P.id === Q.id) continue;
      var Qzone = disturbanceZones.get(Q.id);
      if (!Qzone) continue;

      for (var ri = 0; ri < Prefs.length; ri++) {
        if (Qzone.has(Prefs[ri])) {
          edges.push({
            blockedProposalId:    P.id,
            disturbanceSourceId:  Q.id,
            disturbedGpxIndex:    Prefs[ri],
            side: P.bracketGpxIndexes && P.bracketGpxIndexes.includes(Prefs[ri]) ? 'arriving' : 'leaving'
          });
          adjacency.get(P.id).add(Q.id);
          adjacency.get(Q.id).add(P.id);
          break; // one edge per (P, Q) pair is enough
        }
      }
    }
  }

  // Connected components (union-find)
  var parent = new Map();
  proposals.forEach(function(p) { parent.set(p.id, p.id); });
  function find(id) {
    while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); }
    return id;
  }
  function union(a, b) {
    var ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  edges.forEach(function(e) { union(e.blockedProposalId, e.disturbanceSourceId); });

  // Group proposals into regions
  var regionMap = new Map();
  proposals.forEach(function(p) {
    var root = find(p.id);
    if (!regionMap.has(root)) regionMap.set(root, []);
    regionMap.get(root).push(p.id);
  });

  var coupledRegions = [];
  regionMap.forEach(function(ids, root) {
    // Only non-trivial regions (size > 1 or has edges)
    var regionEdges = edges.filter(function(e) { return ids.includes(e.blockedProposalId); });
    if (ids.length > 1 || regionEdges.length > 0) {
      var zoneUnion = new Set();
      ids.forEach(function(id) {
        disturbanceZones.get(id).forEach(function(gi) { zoneUnion.add(gi); });
      });
      coupledRegions.push({
        proposalIds: ids,
        disturbanceZoneGpxIndexes: Array.from(zoneUnion),
        edges: regionEdges
      });
    }
  });

  // Coupling-blocked = kinematically sensitive proposals with ≥1 coupling edge
  var blockedSet = new Set();
  edges.forEach(function(e) { blockedSet.add(e.blockedProposalId); });
  var couplingBlockedProposalIds = proposals
    .filter(function(p) { return isKineSensitive(p) && blockedSet.has(p.id); })
    .map(function(p) { return p.id; });

  var independentProposalIds = proposals
    .filter(function(p) { return !blockedSet.has(p.id); })
    .map(function(p) { return p.id; });

  return { couplingBlockedProposalIds, independentProposalIds, coupledRegions };
}

module.exports = { detectCoupling };
