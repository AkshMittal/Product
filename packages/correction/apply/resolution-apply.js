'use strict';

/**
 * packages/correction/apply/resolution-apply.js
 *
 * Applies the AND-gated proposal set to workingState (mutations included).
 * Plan §resolution-apply, ADR-correction-0015.
 *
 * Gate: applyable = proposals \ overlapVetoed \ couplingBlocked.
 *
 * Per-kind disposition:
 *
 *   adjacent-exact-drop: unconditional drop.
 *
 *   block-finding (overlapStatus='socket-ok'):
 *     Kinematic check on block first↔prev and last↔next anchors (GATING).
 *     PASS → reorder; FAIL → excludedFromTrust + skipReason.
 *
 *   insert (length=1, isExactGroup=false): GATING.
 *     Kinematic check computed at apply time from workingState coords.
 *
 *   insert (length≥2, isExactGroup=false): ADVISORY with all-fail fallback.
 *     Winner = lowest-score passer; if all fail, lowest-score overall.
 *
 *   insert (isExactGroup=true): MVP flag-only.
 */

var guard    = require('./kinematic-guard');
var ws       = require('../state/working-state');
var defaults = require('../params/defaults');

function applyProposals(proposals, overlapVetoedProposalIds, couplingBlockedProposalIds,
                        overlapBlockResolution, workingState, params, passLabel, passIndex) {
  var thresholdKph = (params && typeof params.lenientMaxImpliedSpeedKph === 'number')
    ? params.lenientMaxImpliedSpeedKph
    : (typeof params === 'number' ? params : defaults.lenientMaxImpliedSpeedKph);

  var vetoedSet  = new Set(overlapVetoedProposalIds || []);
  var blockedSet = new Set(couplingBlockedProposalIds || []);

  var blockResMap = new Map();
  for (var bi = 0; bi < (overlapBlockResolution || []).length; bi++) {
    blockResMap.set(overlapBlockResolution[bi].proposalId, overlapBlockResolution[bi]);
  }

  function ptOf(gpxIndex) {
    var pts = workingState.workingOrderedPoints;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].gpxIndex === gpxIndex) return pts[i];
    }
    return null;
  }

  for (var i = 0; i < proposals.length; i++) {
    var proposal = proposals[i];

    if (vetoedSet.has(proposal.id)) {
      proposal.applied    = false;
      proposal.skipReason = 'overlap_vetoed';
      workingState.proposals.push(proposal);
      continue;
    }
    if (blockedSet.has(proposal.id)) {
      proposal.applied    = false;
      proposal.skipReason = 'coupling_blocked';
      workingState.proposals.push(proposal);
      continue;
    }

    if (proposal.kind === 'adjacent-exact-drop') {
      applyAdjacentExactDrop(proposal, workingState, passLabel, passIndex);
    } else if (proposal.kind === 'block-finding') {
      applyBlockFinding(proposal, blockResMap, ptOf, workingState, thresholdKph, passLabel, passIndex);
    } else if (proposal.kind === 'insert') {
      applyInsert(proposal, ptOf, workingState, thresholdKph, passLabel, passIndex);
    } else {
      proposal.applied    = false;
      proposal.skipReason = 'unknown_kind';
    }
    workingState.proposals.push(proposal);
  }
}

// ── adjacent-exact-drop ────────────────────────────────────────────────────
function applyAdjacentExactDrop(proposal, workingState, passLabel, passIndex) {
  ws.addDrop(workingState, proposal.dropGpxIndex, 'adjacent-exact-duplicate', passLabel);
  ws.removeFromWorking(workingState, proposal.dropGpxIndex);
  ws.addRearrangement(workingState, {
    kind:        'adjacent-exact-drop',
    passIndex:   (passIndex == null ? 0 : passIndex),
    trkSegIndex: proposal.trkSegIndex,
    stage:       passLabel,
    gpxIndexes:  [proposal.dropGpxIndex]
  });
  proposal.applied = true;
  proposal.skipReason = null;
}

// ── block-finding ──────────────────────────────────────────────────────────
function applyBlockFinding(proposal, blockResMap, ptOf, workingState, thresholdKph, passLabel, passIndex) {
  if (proposal.overlapStatus !== 'socket-ok') {
    proposal.applied    = false;
    proposal.skipReason = 'overlap_vetoed';
    return;
  }
  var res = blockResMap.get(proposal.id);
  if (!res) {
    proposal.applied    = false;
    proposal.skipReason = 'overlap_vetoed';
    return;
  }
  var firstPt = ptOf(proposal.gpxIndexes[0]);
  var lastPt  = ptOf(proposal.gpxIndexes[proposal.gpxIndexes.length - 1]);
  if (!firstPt || !lastPt) {
    proposal.applied    = false;
    proposal.skipReason = 'overlap_vetoed';
    return;
  }

  var prevCheck = res.prevAnchorPoint
    ? guard.computeKinematicCheck(res.prevAnchorPoint, firstPt, null, thresholdKph)
    : null;
  var nextCheck = res.nextAnchorPoint
    ? guard.computeKinematicCheck(null, lastPt, res.nextAnchorPoint, thresholdKph)
    : null;

  var sp = prevCheck ? prevCheck.speedPrevKph : null;
  var sn = nextCheck ? nextCheck.speedNextKph : null;
  var prevExceed = (sp !== null && sp > thresholdKph);
  var nextExceed = (sn !== null && sn > thresholdKph);
  var passed = !prevExceed && !nextExceed && (sp !== null || sn !== null);
  var failReason = null;
  if (!passed) {
    if (sp === null && sn === null) failReason = 'no_bracket';
    else if (prevExceed && nextExceed) failReason = 'both_exceeded';
    else if (prevExceed)               failReason = 'speed_prev_exceeded';
    else if (nextExceed)               failReason = 'speed_next_exceeded';
  }
  var score = null;
  if (sp !== null && sn !== null) score = sp*sp + sn*sn;
  else if (sp !== null) score = sp*sp;
  else if (sn !== null) score = sn*sn;
  var kinematics = {
    speedPrevKph: sp, speedNextKph: sn, score: score,
    thresholdKph: thresholdKph, passed: passed
  };
  if (failReason) kinematics.failReason = failReason;

  if (!passed) {
    for (var gi = 0; gi < proposal.gpxIndexes.length; gi++) {
      ws.addExcludedFromTrust(workingState, proposal.gpxIndexes[gi],
        'block_kinematic_guard_failed', passLabel, { proposalId: proposal.id, kinematics: kinematics });
    }
    ws.addAnnotation(workingState, {
      scope:    'proposal',
      scopeRef: { proposalId: proposal.id, trkSegIndex: proposal.trkSegIndex },
      kind:     'block_reorder_kinematic_guard_failed',
      details:  { kinematics: kinematics,
                  parametersSnapshot: { lenientMaxImpliedSpeedKph: thresholdKph } }
    });
    proposal.applied    = false;
    proposal.skipReason = 'kinematic_guard_failed';
    return;
  }

  var afterGi = (res.prevGpxIndex !== null && res.prevGpxIndex !== undefined) ? res.prevGpxIndex : null;
  ws.relocateRunAfter(workingState, proposal.gpxIndexes, afterGi);

  // Mark all block members as resolved so subsequent passes don't re-propose them.
  for (var ri = 0; ri < proposal.gpxIndexes.length; ri++) {
    ws.markAnomalyResolved(workingState, proposal.gpxIndexes[ri]);
  }

  ws.addAnnotation(workingState, {
    scope:    'proposal',
    scopeRef: { proposalId: proposal.id, trkSegIndex: proposal.trkSegIndex },
    kind:     'block_reorder_applied',
    details:  { gpxIndexes: proposal.gpxIndexes, afterGpxIndex: afterGi, kinematics: kinematics }
  });
  ws.addRearrangement(workingState, {
    kind:         'block-reorder',
    passIndex:    (passIndex == null ? 0 : passIndex),
    trkSegIndex:  proposal.trkSegIndex,
    stage:        passLabel,
    gpxIndexes:   proposal.gpxIndexes,
    afterGpxIndex: afterGi,
    prevGpxIndex:  res.prevGpxIndex,
    nextGpxIndex:  res.nextGpxIndex,
    kinematics:    kinematics
  });
  proposal.applied = true;
  proposal.skipReason = null;
  proposal.kinematics = kinematics;
}

// ── insert ─────────────────────────────────────────────────────────────────
function applyInsert(proposal, ptOf, workingState, thresholdKph, passLabel, passIndex) {
  var candidateGpxIndexes = proposal.candidateGpxIndexes || [];

  // isExactGroup: MVP flag-only — no kinematic check, drop all but lowest gpxIndex.
  if (proposal.isExactGroup) {
    var sorted = candidateGpxIndexes.slice().sort(function(a, b) { return a - b; });
    var keeper = sorted[0];
    for (var ei = 0; ei < candidateGpxIndexes.length; ei++) {
      var idx = candidateGpxIndexes[ei];
      if (idx !== keeper) {
        ws.addDrop(workingState, idx, 'adjacent-exact-duplicate', passLabel);
        ws.removeFromWorking(workingState, idx);
      }
    }
    proposal.applied    = true;
    proposal.skipReason = null;
    proposal.winner     = keeper;
    return;
  }

  // Resolve bracket anchor points from workingState.
  var prevAnchorPt = null, nextAnchorPt = null;
  var bracketGis   = proposal.bracketGpxIndexes || [];
  if (bracketGis.length >= 1) {
    if (proposal.tPrev !== null && proposal.tPrev !== undefined) {
      prevAnchorPt = ptOf(bracketGis[0]);
    } else if (bracketGis.length === 1) {
      // lone bracket is next anchor
      nextAnchorPt = ptOf(bracketGis[0]);
    }
  }
  if (bracketGis.length >= 2) {
    nextAnchorPt = ptOf(bracketGis[bracketGis.length - 1]);
  }

  // length=1 — gating
  if (candidateGpxIndexes.length === 1) {
    var candPt = ptOf(candidateGpxIndexes[0]);
    if (!candPt) {
      proposal.applied    = false;
      proposal.skipReason = 'kinematic_guard_failed';
      proposal.winner     = null;
      return;
    }
    var k = guard.computeKinematicCheck(prevAnchorPt, candPt, nextAnchorPt, thresholdKph);
    if (!k || !k.passed) {
      ws.addExcludedFromTrust(workingState, candidateGpxIndexes[0],
        'insert_kinematic_guard_failed', passLabel,
        { proposalId: proposal.id, kinematics: k });
      ws.addAnnotation(workingState, {
        scope:    'proposal',
        scopeRef: { proposalId: proposal.id, trkSegIndex: proposal.trkSegIndex },
        kind:     'insert_kinematic_guard_failed',
        details:  { kinematics: k,
                    parametersSnapshot: { lenientMaxImpliedSpeedKph: thresholdKph } }
      });
      proposal.applied    = false;
      proposal.skipReason = 'kinematic_guard_failed';
      proposal.winner     = null;
      return;
    }
    moveCandidateToTarget(workingState, candidateGpxIndexes[0], proposal, passLabel, passIndex);
    ws.markAnomalyResolved(workingState, candidateGpxIndexes[0]);
    ws.addAnnotation(workingState, {
      scope:    'proposal',
      scopeRef: { proposalId: proposal.id, trkSegIndex: proposal.trkSegIndex },
      kind:     'insert_applied',
      details:  { gpxIndex: candidateGpxIndexes[0] }
    });
    proposal.winner  = candidateGpxIndexes[0];
    proposal.applied = true;
    proposal.skipReason = null;
    return;
  }

  // length ≥ 2 — competition with all-fail fallback.
  var enriched = candidateGpxIndexes.map(function(gi) {
    var pt = ptOf(gi);
    var kc = pt ? guard.computeKinematicCheck(prevAnchorPt, pt, nextAnchorPt, thresholdKph) : null;
    return { gi: gi, kinematics: kc };
  });
  var passers = enriched.filter(function(e) { return e.kinematics && e.kinematics.passed; });
  var pool    = passers.length > 0 ? passers : enriched;
  pool.sort(function(a, b) {
    var sa = (a.kinematics && a.kinematics.score !== null) ? a.kinematics.score : Infinity;
    var sb = (b.kinematics && b.kinematics.score !== null) ? b.kinematics.score : Infinity;
    if (sa !== sb) return sa - sb;
    return a.gi - b.gi;
  });
  var winnerEntry = pool[0];
  var allFailed = (passers.length === 0);
  var annKind = allFailed ? 'insert_competition_kinematic_guard_failed' : 'insert_competition_resolved';

  ws.addAnnotation(workingState, {
    scope:    'proposal',
    scopeRef: { proposalId: proposal.id, trkSegIndex: proposal.trkSegIndex },
    kind:     annKind,
    details:  {
      winnerGpxIndex: winnerEntry.gi,
      allFailed:      allFailed,
      candidates:     enriched.map(function(e) {
        return { gpxIndex: e.gi, kinematics: e.kinematics };
      }),
      parametersSnapshot: { lenientMaxImpliedSpeedKph: thresholdKph }
    }
  });

  for (var li = 0; li < enriched.length; li++) {
    var e = enriched[li];
    if (e.gi === winnerEntry.gi) continue;
    ws.addExcludedFromTrust(workingState, e.gi, 'insert_competition_loser', passLabel,
      { proposalId: proposal.id, kinematics: e.kinematics });
  }
  moveCandidateToTarget(workingState, winnerEntry.gi, proposal, passLabel, passIndex);
  ws.markAnomalyResolved(workingState, winnerEntry.gi);

  proposal.winner  = winnerEntry.gi;
  proposal.applied = true;
  proposal.skipReason = null;
}

/**
 * Move a point so it sits after bracketGis[0] (prev anchor) within its segment.
 */
function moveCandidateToTarget(workingState, gpxIndex, proposal, passLabel, passIndex) {
  var afterGi     = null;
  var bracketGis  = proposal.bracketGpxIndexes || [];
  if (bracketGis.length >= 1) {
    if (proposal.tPrev !== null && proposal.tPrev !== undefined) {
      afterGi = bracketGis[0];
    }
    // lone bracket is next anchor → place at start
    if (bracketGis.length === 1 && (proposal.tPrev === null || proposal.tPrev === undefined)) {
      afterGi = null;
    }
  }
  try {
    ws.relocatePointAfter(workingState, gpxIndex, afterGi);
  } catch (e) {
    // fallback: skip mutation
  }
  ws.addRearrangement(workingState, {
    kind:          'insert-move',
    passIndex:     (passIndex == null ? 0 : passIndex),
    trkSegIndex:   proposal.trkSegIndex,
    stage:         passLabel,
    gpxIndexes:    [gpxIndex],
    afterGpxIndex: afterGi,
    targetTimeMs:  proposal.targetTimeMs,
    proposalId:    proposal.id
  });
}

module.exports = { applyProposals };
