'use strict';

/**
 * packages/correction/gates/coupling-detection.js
 *
 * Bilateral disturbance / kinematic coupling per ADR-correction-0010 (revised
 * 2026-04-23) / plan §Reference stability and coupling.
 *
 * **Strictly intra-segment** in Phase 1: disturbance zones, kinematic
 * traversal neighbours, and edges never cross trkSegIndex. Cross-segment
 * interactions are deferred to Phase 2 (edge reconciliation).
 *
 * For every proposal:
 *   - Disturbance zone (set of "disturbed" gpxIndexes), built from leaving +
 *     arriving sides:
 *       * insert: leaving = traversal-adjacent neighbours (same segment) of each
 *         candidate; arriving = each candidate's bracketGpxIndexes.
 *       * block-finding: leaving = traversal-adjacent neighbours (same segment)
 *         of the block's first/last members; arriving = [prevGpxIndex, nextGpxIndex].
 *       * adjacent-exact-drop: empty zone.
 *   - Kinematic reference set (whose stability the proposal depends on):
 *       * insert: union of every candidate's bracketGpxIndexes.
 *       * block-finding: [prevGpxIndex, nextGpxIndex].
 *       * adjacent-exact-drop: empty.
 *
 * Edge rule: P↔Q if any of P's kinematic references falls in Q's disturbance
 * zone AND both proposals share trkSegIndex. Block-finding now blocks
 * symmetrically (revised 2026-04-23).
 *
 * Side derivation:
 *   - 'arriving' if the disturbed gpxIndex is in P's kinematic reference set
 *     (it always will be, since that's the predicate); refine by checking
 *     whether the disturbance came from Q's arriving side (vs leaving).
 *   For diagnostic readability, we just record whether the gpxIndex belongs to
 *   P's "leaving" neighbour set (`leaving`) or arriving bracket set (`arriving`).
 *
 * @returns {{
 *   couplingBlockedProposalIds: string[],
 *   independentProposalIds:     string[],
 *   coupledRegions:             Array
 * }}
 */
function detectCoupling(proposals, workingOrderedPoints) {
  // Build position lookup + segment-aware traversal-neighbour helper.
  var posByGpx = new Map();
  for (var i = 0; i < workingOrderedPoints.length; i++) {
    posByGpx.set(workingOrderedPoints[i].gpxIndex, i);
  }
  function neighboursSameSeg(gpxIndex, trkSegIndex) {
    var pos = posByGpx.get(gpxIndex);
    if (pos === undefined) return { prev: null, next: null };
    var prev = null, next = null;
    if (pos > 0) {
      var pp = workingOrderedPoints[pos - 1];
      if (pp.trkSegIndex === trkSegIndex) prev = pp.gpxIndex;
    }
    if (pos < workingOrderedPoints.length - 1) {
      var np = workingOrderedPoints[pos + 1];
      if (np.trkSegIndex === trkSegIndex) next = np.gpxIndex;
    }
    return { prev: prev, next: next };
  }

  // Per-proposal disturbance zones, kinematic refs, leaving/arriving sets.
  var zones      = new Map(); // id → Set<gpxIndex>
  var leavingSet = new Map(); // id → Set<gpxIndex>
  var arrivingSet= new Map(); // id → Set<gpxIndex>
  var kineRefs   = new Map(); // id → Set<gpxIndex>

  for (var p = 0; p < proposals.length; p++) {
    var prop = proposals[p];
    var leave = new Set();
    var arrive = new Set();
    var refs   = new Set();

    if (prop.kind === 'adjacent-exact-drop') {
      // empty
    } else if (prop.kind === 'insert') {
      var candGis = prop.candidateGpxIndexes || [];
      for (var c = 0; c < candGis.length; c++) {
        // leaving — current traversal neighbours within same segment
        var nb = neighboursSameSeg(candGis[c], prop.trkSegIndex);
        if (nb.prev !== null) leave.add(nb.prev);
        if (nb.next !== null) leave.add(nb.next);
      }
      // arriving — shared bracketGpxIndexes
      var br = prop.bracketGpxIndexes || [];
      for (var bi = 0; bi < br.length; bi++) {
        arrive.add(br[bi]);
        refs.add(br[bi]);
      }
    } else if (prop.kind === 'block-finding') {
      var gi = prop.gpxIndexes || [];
      if (gi.length > 0) {
        var firstNb = neighboursSameSeg(gi[0], prop.trkSegIndex);
        var lastNb  = neighboursSameSeg(gi[gi.length - 1], prop.trkSegIndex);
        if (firstNb.prev !== null && !setHasGi(gi, firstNb.prev)) leave.add(firstNb.prev);
        if (lastNb.next  !== null && !setHasGi(gi, lastNb.next))  leave.add(lastNb.next);
      }
      if (prop.prevGpxIndex !== null && prop.prevGpxIndex !== undefined) {
        arrive.add(prop.prevGpxIndex);
        refs.add(prop.prevGpxIndex);
      }
      if (prop.nextGpxIndex !== null && prop.nextGpxIndex !== undefined) {
        arrive.add(prop.nextGpxIndex);
        refs.add(prop.nextGpxIndex);
      }
    }

    var distZone = new Set();
    leave.forEach(function(g)  { distZone.add(g); });
    arrive.forEach(function(g) { distZone.add(g); });
    zones.set(prop.id, distZone);
    leavingSet.set(prop.id, leave);
    arrivingSet.set(prop.id, arrive);
    kineRefs.set(prop.id, refs);
  }

  function setHasGi(arr, gi) { for (var i=0;i<arr.length;i++) if (arr[i]===gi) return true; return false; }

  // Build edges + adjacency. Strictly intra-segment.
  var edges = [];
  var adjacency = new Map();
  proposals.forEach(function(p) { adjacency.set(p.id, new Set()); });

  for (var pi = 0; pi < proposals.length; pi++) {
    var P = proposals[pi];
    var Prefs = kineRefs.get(P.id);
    if (!Prefs || Prefs.size === 0) continue;
    var Pleave = leavingSet.get(P.id);
    var Parrive = arrivingSet.get(P.id);

    for (var qi = 0; qi < proposals.length; qi++) {
      if (pi === qi) continue;
      var Q = proposals[qi];
      if (Q.trkSegIndex !== P.trkSegIndex) continue;
      var Qzone = zones.get(Q.id);
      if (!Qzone || Qzone.size === 0) continue;

      var hit = null;
      Prefs.forEach(function(gi) {
        if (hit === null && Qzone.has(gi)) hit = gi;
      });
      if (hit !== null) {
        var side = Parrive.has(hit) ? 'arriving' : (Pleave.has(hit) ? 'leaving' : 'arriving');
        edges.push({
          blockedProposalId:    P.id,
          disturbanceSourceId:  Q.id,
          disturbedGpxIndex:    hit,
          side:                 side,
          trkSegIndex:          P.trkSegIndex
        });
        adjacency.get(P.id).add(Q.id);
        adjacency.get(Q.id).add(P.id);
      }
    }
  }

  // Connected components (union-find).
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

  var regionMap = new Map();
  proposals.forEach(function(p) {
    var root = find(p.id);
    if (!regionMap.has(root)) regionMap.set(root, []);
    regionMap.get(root).push(p.id);
  });

  var coupledRegions = [];
  regionMap.forEach(function(ids) {
    var regionEdges = edges.filter(function(e) { return ids.indexOf(e.blockedProposalId) >= 0; });
    if (ids.length > 1 || regionEdges.length > 0) {
      var zoneUnion = new Set();
      ids.forEach(function(id) { (zones.get(id) || new Set()).forEach(function(gi) { zoneUnion.add(gi); }); });
      // Trk seg index is the same across the region by construction (intra-segment).
      var trkSeg = null;
      for (var i = 0; i < proposals.length; i++) {
        if (ids.indexOf(proposals[i].id) >= 0) { trkSeg = proposals[i].trkSegIndex; break; }
      }
      coupledRegions.push({
        trkSegIndex: trkSeg,
        proposalIds: ids,
        disturbanceZoneGpxIndexes: Array.from(zoneUnion),
        edges: regionEdges
      });
    }
  });

  var blockedSet = new Set();
  edges.forEach(function(e) { blockedSet.add(e.blockedProposalId); });
  var couplingBlockedProposalIds = proposals
    .filter(function(p) { return blockedSet.has(p.id); })
    .map(function(p) { return p.id; });

  var independentProposalIds = proposals
    .filter(function(p) { return !blockedSet.has(p.id); })
    .map(function(p) { return p.id; });

  return {
    couplingBlockedProposalIds: couplingBlockedProposalIds,
    independentProposalIds:     independentProposalIds,
    coupledRegions:             coupledRegions
  };
}

module.exports = { detectCoupling };
