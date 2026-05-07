'use strict';

/**
 * packages/correction/gates/overlap-detection.js
 *
 * Cross-proposal footprint mapping per ADR-correction-0009 / plan
 * §Cross-proposal footprint mapping. Reads snapshot + proposals only;
 * independent of coupling-detection.
 *
 * Block-finding path (per proposal):
 *   1. Compute B_min, B_max from member timeMs values.
 *   2. internalMonotonicity == false → status 'overlap'; emit annotation
 *      `block_internal_monotonicity_fail` (proposal-scope).
 *   3. Find bracket anchors (prevAnchor, nextAnchor) — segment spine points
 *      outside the block, immediately on each side of [B_min, B_max].
 *   4. If both anchors missing → status 'no-bracket'; annotation
 *      `overlap_bracket_missing`.
 *   5. Numeric socket: B_min >= tPrev AND B_max <= tNext.
 *   6. Corridor pierce-check: any spine point with timeMs in (tPrev,tNext)
 *      and gpxIndex not in block → status 'overlap'; annotation
 *      `overlap_spine_pierce_detected`.
 *   7. !socketOk → status 'overlap'; annotation `overlap_block`.
 *   8. socket-ok and not pierced → status 'socket-ok'.
 *
 * Cross-proposal collisions (segment-scoped):
 *   A. Insert inside block envelope:
 *      For each insert proposal P, if P.targetTimeMs ∈ [B_min, B_max] of any
 *      block-finding B in the same segment → veto BOTH P and B; annotation
 *      `overlap_singleton_block_conflict` on each.
 *   B. Two inserts with overlapping corridors:
 *      For each pair (P1, P2) of insert proposals in the same segment with
 *      overlapping bracket corridors (max(p1.tPrev, p2.tPrev) < min(p1.tNext, p2.tNext))
 *      → veto BOTH; annotation `overlap_singleton_singleton_conflict` on each.
 *      Exception: if one corridor strictly contains the other AND the contained
 *      corridor's targetTimeMs falls inside the container's, MVP still vetoes
 *      both (versioned edge policy — left simple in MVP).
 *
 * adjacent-exact-drop has no temporal footprint and never participates in collisions.
 *
 * @param {Array<Object>} proposals             - all proposals for this pass
 * @param {Array<Object>} workingOrderedPoints  - current snapshot
 * @param {Map<number, Array<Object>>} spinePointsBySegment - per-segment spine points
 * @returns {{
 *   overlapVetoedProposalIds: string[],
 *   overlapBlockResolution: Array,
 *   annotations: Array
 * }}
 */
function detectOverlap(proposals, workingOrderedPoints, spinePointsBySegment) {
  var vetoed = new Set();
  var resolutions = [];
  var annotations = [];

  // Index points for O(1) lookup.
  var pointByGpx = new Map();
  for (var i = 0; i < workingOrderedPoints.length; i++) {
    pointByGpx.set(workingOrderedPoints[i].gpxIndex, workingOrderedPoints[i]);
  }

  // ── Block-finding pass ─────────────────────────────────────────────────────
  for (var b = 0; b < proposals.length; b++) {
    var bp = proposals[b];
    if (bp.kind !== 'block-finding') continue;

    if (bp.hasInternalMonotonicityViolation === true) {
      bp.overlapStatus = 'overlap';
      vetoed.add(bp.id);
      annotations.push({
        scope: 'proposal',
        scopeRef: { proposalId: bp.id, trkSegIndex: bp.trkSegIndex },
        kind:  'block_internal_monotonicity_fail',
        details: { gpxIndexes: bp.gpxIndexes }
      });
      continue;
    }

    var blockSet = new Set(bp.gpxIndexes);
    var bMin = Infinity, bMax = -Infinity;
    for (var m = 0; m < bp.gpxIndexes.length; m++) {
      var pt = pointByGpx.get(bp.gpxIndexes[m]);
      if (!pt) continue;
      if (typeof pt.timeMs === 'number' && isFinite(pt.timeMs) && pt.timeMs > 0) {
        if (pt.timeMs < bMin) bMin = pt.timeMs;
        if (pt.timeMs > bMax) bMax = pt.timeMs;
      }
    }
    if (!isFinite(bMin) || !isFinite(bMax)) {
      bp.overlapStatus = 'overlap';
      bp.bMin = null; bp.bMax = null;
      vetoed.add(bp.id);
      annotations.push({
        scope: 'proposal',
        scopeRef: { proposalId: bp.id, trkSegIndex: bp.trkSegIndex },
        kind:  'overlap_block',
        details: { reason: 'no-usable-block-times' }
      });
      continue;
    }
    bp.bMin = bMin;
    bp.bMax = bMax;

    var segSpine = spinePointsBySegment.get(bp.trkSegIndex) || [];
    var prevAnchor = null, nextAnchor = null;
    for (var sp = 0; sp < segSpine.length; sp++) {
      var spt = segSpine[sp];
      if (blockSet.has(spt.gpxIndex)) continue;
      if (spt.timeMs < bMin) prevAnchor = spt;     // last one wins (sorted)
      else if (spt.timeMs > bMax) { nextAnchor = spt; break; }
    }

    if (!prevAnchor && !nextAnchor) {
      bp.overlapStatus = 'no-bracket';
      vetoed.add(bp.id);
      annotations.push({
        scope: 'proposal',
        scopeRef: { proposalId: bp.id, trkSegIndex: bp.trkSegIndex },
        kind:  'overlap_bracket_missing',
        details: { bMin: bMin, bMax: bMax }
      });
      continue;
    }

    var tPrev = prevAnchor ? prevAnchor.timeMs : null;
    var tNext = nextAnchor ? nextAnchor.timeMs : null;
    bp.prevGpxIndex = prevAnchor ? prevAnchor.gpxIndex : null;
    bp.nextGpxIndex = nextAnchor ? nextAnchor.gpxIndex : null;
    bp.tPrev = tPrev;
    bp.tNext = tNext;

    var socketOk = (tPrev === null || bMin >= tPrev) &&
                   (tNext === null || bMax <= tNext);
    var pierced = false;
    if (socketOk && tPrev !== null && tNext !== null) {
      for (var pc = 0; pc < segSpine.length; pc++) {
        var sp2 = segSpine[pc];
        if (blockSet.has(sp2.gpxIndex)) continue;
        if (sp2.timeMs > tPrev && sp2.timeMs < tNext) { pierced = true; break; }
      }
    }

    if (!socketOk) {
      bp.overlapStatus = 'overlap';
      vetoed.add(bp.id);
      annotations.push({
        scope: 'proposal',
        scopeRef: { proposalId: bp.id, trkSegIndex: bp.trkSegIndex },
        kind:  'overlap_block',
        details: { bMin: bMin, bMax: bMax, tPrev: tPrev, tNext: tNext }
      });
    } else if (pierced) {
      bp.overlapStatus = 'overlap';
      vetoed.add(bp.id);
      annotations.push({
        scope: 'proposal',
        scopeRef: { proposalId: bp.id, trkSegIndex: bp.trkSegIndex },
        kind:  'overlap_spine_pierce_detected',
        details: { bMin: bMin, bMax: bMax, tPrev: tPrev, tNext: tNext }
      });
    } else {
      bp.overlapStatus = 'socket-ok';
      resolutions.push({
        proposalId:        bp.id,
        trkSegIndex:       bp.trkSegIndex,
        gpxIndexes:        bp.gpxIndexes,
        bMin:              bMin,
        bMax:              bMax,
        tPrev:             tPrev,
        tNext:             tNext,
        prevGpxIndex:      bp.prevGpxIndex,
        nextGpxIndex:      bp.nextGpxIndex,
        prevAnchorPoint:   prevAnchor,
        nextAnchorPoint:   nextAnchor,
        spinePointPierceDetected: false
      });
    }
  }

  // ── Cross-kind: insert vs block envelope ───────────────────────────────────
  for (var i2 = 0; i2 < proposals.length; i2++) {
    var ip = proposals[i2];
    if (ip.kind !== 'insert') continue;
    if (ip.isExactGroup) continue; // exact-group is flag-only, no apply-gating
    if (typeof ip.targetTimeMs !== 'number') continue;
    for (var j2 = 0; j2 < proposals.length; j2++) {
      var bp2 = proposals[j2];
      if (bp2.kind !== 'block-finding') continue;
      if (bp2.trkSegIndex !== ip.trkSegIndex) continue;
      if (bp2.bMin === null || bp2.bMax === null) continue;
      if (ip.targetTimeMs >= bp2.bMin && ip.targetTimeMs <= bp2.bMax) {
        vetoed.add(ip.id);
        vetoed.add(bp2.id);
        annotations.push({
          scope: 'proposal',
          scopeRef: { proposalId: ip.id, trkSegIndex: ip.trkSegIndex },
          kind: 'overlap_singleton_block_conflict',
          details: { otherProposalId: bp2.id, blockEnvelope: [bp2.bMin, bp2.bMax],
                     targetTimeMs: ip.targetTimeMs }
        });
        annotations.push({
          scope: 'proposal',
          scopeRef: { proposalId: bp2.id, trkSegIndex: bp2.trkSegIndex },
          kind: 'overlap_singleton_block_conflict',
          details: { otherProposalId: ip.id, blockEnvelope: [bp2.bMin, bp2.bMax],
                     targetTimeMs: ip.targetTimeMs }
        });
      }
    }
  }

  // ── Cross-kind: insert-insert corridor overlap ─────────────────────────────
  // Build the list of insert proposals with computable corridors.
  var inserts = [];
  for (var k2 = 0; k2 < proposals.length; k2++) {
    var p = proposals[k2];
    if (p.kind !== 'insert' || p.isExactGroup) continue;
    inserts.push({ proposal: p, tPrev: p.tPrev, tNext: p.tNext });
  }
  for (var a = 0; a < inserts.length; a++) {
    for (var b2 = a + 1; b2 < inserts.length; b2++) {
      var P1 = inserts[a], P2 = inserts[b2];
      if (P1.proposal.trkSegIndex !== P2.proposal.trkSegIndex) continue;
      // Need both corridor endpoints — fall back gracefully if open-ended.
      var lo1 = (P1.tPrev !== null) ? P1.tPrev : -Infinity;
      var hi1 = (P1.tNext !== null) ? P1.tNext : Infinity;
      var lo2 = (P2.tPrev !== null) ? P2.tPrev : -Infinity;
      var hi2 = (P2.tNext !== null) ? P2.tNext : Infinity;
      var overlapLo = Math.max(lo1, lo2);
      var overlapHi = Math.min(hi1, hi2);
      if (overlapLo < overlapHi) {
        // Check whether the two targetTimeMs values fall inside the overlap
        // (true conflict) — if both targets lie in the shared corridor, veto.
        var t1 = P1.proposal.targetTimeMs, t2 = P2.proposal.targetTimeMs;
        var conflict = (t1 > overlapLo && t1 < overlapHi) ||
                       (t2 > overlapLo && t2 < overlapHi);
        if (conflict) {
          vetoed.add(P1.proposal.id);
          vetoed.add(P2.proposal.id);
          annotations.push({
            scope: 'proposal',
            scopeRef: { proposalId: P1.proposal.id, trkSegIndex: P1.proposal.trkSegIndex },
            kind: 'overlap_singleton_singleton_conflict',
            details: { otherProposalId: P2.proposal.id,
                       overlapWindow: [overlapLo, overlapHi],
                       targets: [t1, t2] }
          });
          annotations.push({
            scope: 'proposal',
            scopeRef: { proposalId: P2.proposal.id, trkSegIndex: P2.proposal.trkSegIndex },
            kind: 'overlap_singleton_singleton_conflict',
            details: { otherProposalId: P1.proposal.id,
                       overlapWindow: [overlapLo, overlapHi],
                       targets: [t1, t2] }
          });
        }
      }
    }
  }

  return {
    overlapVetoedProposalIds: Array.from(vetoed),
    overlapBlockResolution:   resolutions,
    annotations:              annotations
  };
}

module.exports = { detectOverlap };
