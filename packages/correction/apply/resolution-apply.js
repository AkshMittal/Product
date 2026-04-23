'use strict';

/**
 * packages/correction/apply/resolution-apply.js
 *
 * Applies AND-gated proposals to the working state.
 * Gate: !overlapVetoed && !couplingBlocked (ADR-correction-0010 §8).
 *
 * Per-kind disposition (ADR-correction-0015):
 *
 *   block-finding (socket-ok):
 *     → kinematic guard GATING.
 *     Pass → apply block reorder. Fail → excludedFromTrust + annotation, applied=false.
 *
 *   insert (length=1, isExactGroup=false):
 *     → kinematic guard GATING.
 *     Pass → move candidate to target position. Fail → excludedFromTrust + annotation, applied=false.
 *
 *   insert (length≥2, isExactGroup=false):
 *     → kinematic guard ADVISORY with all-fail fallback.
 *     Winner = passer with lowest score; if all fail, winner = lowest score overall.
 *     Non-winners → excludedFromTrust reason 'insert_competition_loser'.
 *
 *   insert (isExactGroup=true):
 *     → no kinematic check. Drop all but lowest gpxIndex. applied=true.
 *
 *   adjacent-exact-drop:
 *     → always apply. No gate (ADR-correction-0010).
 *
 * After applying: removes dropped/moved points from workingOrderedPoints as needed.
 * Sets applied + skipReason on every proposal.
 */

var guard   = require('./kinematic-guard');
var state   = require('../state/working-state');
var defaults = require('../params/defaults');

/**
 * @param {Array<Object>}  proposals
 * @param {string[]}       overlapVetoedProposalIds
 * @param {string[]}       couplingBlockedProposalIds
 * @param {Array<Object>}  overlapBlockResolution - socket-ok block details (from overlap-detection)
 * @param {Object}         workingState
 * @param {number}         thresholdKph
 * @param {string}         passLabel - e.g. 'phase1_pass_1'
 */
function applyProposals(
  proposals,
  overlapVetoedProposalIds,
  couplingBlockedProposalIds,
  overlapBlockResolution,
  workingState,
  thresholdKph,
  passLabel
) {
  if (thresholdKph === undefined) thresholdKph = defaults.lenientMaxImpliedSpeedKph;

  var vetoedSet  = new Set(overlapVetoedProposalIds);
  var blockedSet = new Set(couplingBlockedProposalIds);

  // Build block resolution lookup by proposalId
  var blockResMap = new Map();
  for (var bi = 0; bi < overlapBlockResolution.length; bi++) {
    blockResMap.set(overlapBlockResolution[bi].proposalId, overlapBlockResolution[bi]);
  }

  // Build point lookup for kinematic guard calls
  var ptMap = new Map();
  for (var pi = 0; pi < workingState.workingOrderedPoints.length; pi++) {
    var pt = workingState.workingOrderedPoints[pi];
    ptMap.set(pt.gpxIndex, pt);
  }

  for (var i = 0; i < proposals.length; i++) {
    var proposal = proposals[i];

    // ── Gate check ──────────────────────────────────────────────────────────
    if (vetoedSet.has(proposal.id)) {
      proposal.applied    = false;
      proposal.skipReason = 'overlap_vetoed';
      continue;
    }
    if (blockedSet.has(proposal.id)) {
      proposal.applied    = false;
      proposal.skipReason = 'coupling_blocked';
      continue;
    }

    // ── Per-kind apply logic ─────────────────────────────────────────────────
    if (proposal.kind === 'adjacent-exact-drop') {
      applyAdjacentExactDrop(proposal, workingState, passLabel);

    } else if (proposal.kind === 'block-finding') {
      applyBlockFinding(proposal, blockResMap, ptMap, workingState, thresholdKph, passLabel);

    } else if (proposal.kind === 'insert') {
      applyInsert(proposal, ptMap, workingState, thresholdKph, passLabel);

    } else {
      proposal.applied    = false;
      proposal.skipReason = 'unknown_kind';
    }
  }
}

// ── adjacent-exact-drop ────────────────────────────────────────────────────

function applyAdjacentExactDrop(proposal, workingState, passLabel) {
  state.addDrop(workingState, proposal.dropGpxIndex, 'adjacent_exact_duplicate', passLabel);
  removeFromWorking(workingState, proposal.dropGpxIndex);
  proposal.applied = true;
}

// ── block-finding (socket-ok) ──────────────────────────────────────────────

function applyBlockFinding(proposal, blockResMap, ptMap, workingState, thresholdKph, passLabel) {
  var res = blockResMap.get(proposal.id);
  if (!res) {
    // No socket-ok resolution — shouldn't reach here if gates work, but safe fallback
    proposal.applied    = false;
    proposal.skipReason = 'no_socket_ok_resolution';
    return;
  }

  // Kinematic guard: block first/last vs bracket anchors
  var firstPt = ptMap.get(proposal.gpxIndexes[0]);
  var lastPt  = ptMap.get(proposal.gpxIndexes[proposal.gpxIndexes.length - 1]);
  var prevAnc = res.prevAnchorPoint;
  var nextAnc = res.nextAnchorPoint;

  var checkPrev = firstPt ? guard.computeKinematicCheck(prevAnc, firstPt, null, thresholdKph) : null;
  var checkNext = lastPt  ? guard.computeKinematicCheck(null, lastPt, nextAnc, thresholdKph)  : null;

  var guardPassed = (
    (!checkPrev || checkPrev.passed) &&
    (!checkNext || checkNext.passed)
  );

  var kinematics = {
    speedPrevKph: checkPrev ? checkPrev.speedPrevKph : null,
    speedNextKph: checkNext ? checkNext.speedNextKph : null,
    score:        (checkPrev && checkNext) ? (
      (checkPrev.speedPrevKph || 0) * (checkPrev.speedPrevKph || 0) +
      (checkNext.speedNextKph || 0) * (checkNext.speedNextKph || 0)
    ) : null,
    thresholdKph: thresholdKph,
    passed:       guardPassed
  };

  if (!guardPassed) {
    // Gating: do not apply
    for (var gi = 0; gi < proposal.gpxIndexes.length; gi++) {
      state.addExcludedFromTrust(workingState, proposal.gpxIndexes[gi], 'block_kinematic_guard_failed', passLabel);
    }
    state.addAnnotation(workingState, {
      kind:       'block_reorder_kinematic_guard_failed',
      scope:      'proposal',
      proposalId: proposal.id,
      gpxIndexes: proposal.gpxIndexes,
      details:    { kinematics, parametersSnapshot: { lenientMaxImpliedSpeedKph: thresholdKph } }
    });
    proposal.applied    = false;
    proposal.skipReason = 'kinematic_guard_failed';
    return;
  }

  // Apply: reorder block members to the target socket position
  // TODO: implement actual reorder in workingOrderedPoints
  // Placeholder: mark as applied (full reorder logic in Phase H implementation)
  state.addAnnotation(workingState, {
    kind:       'block_reorder_applied',
    scope:      'proposal',
    proposalId: proposal.id,
    gpxIndexes: proposal.gpxIndexes,
    details:    { kinematics, parametersSnapshot: { lenientMaxImpliedSpeedKph: thresholdKph } }
  });
  proposal.applied = true;
}

// ── insert ─────────────────────────────────────────────────────────────────

function applyInsert(proposal, ptMap, workingState, thresholdKph, passLabel) {
  // isExactGroup: no kinematic check — drop all but lowest gpxIndex
  if (proposal.isExactGroup) {
    var sorted = proposal.candidateGpxIndexes.slice().sort(function(a, b) { return a - b; });
    for (var ei = 1; ei < sorted.length; ei++) {
      state.addDrop(workingState, sorted[ei], 'exact_group_non_winner', passLabel);
      removeFromWorking(workingState, sorted[ei]);
    }
    proposal.applied = true;
    return;
  }

  var prevAnchor = null, nextAnchor = null;
  if (proposal.bracketGpxIndexes && proposal.bracketGpxIndexes.length > 0) {
    prevAnchor = ptMap.get(proposal.bracketGpxIndexes[0]) || null;
    nextAnchor = ptMap.get(proposal.bracketGpxIndexes[1]) || null;
  }
  // Use tPrev/tNext as tiebreaker if anchor lookup fails
  if (!prevAnchor && proposal.tPrev !== null) {
    prevAnchor = { lat: 0, lon: 0, timeMs: proposal.tPrev }; // position unknown — skip speed check
  }
  if (!nextAnchor && proposal.tNext !== null) {
    nextAnchor = { lat: 0, lon: 0, timeMs: proposal.tNext };
  }

  // length=1: gating
  if (proposal.candidateGpxIndexes.length === 1) {
    var candidate = ptMap.get(proposal.candidateGpxIndexes[0]);
    if (!candidate) { proposal.applied = false; proposal.skipReason = 'candidate_not_found'; return; }

    var check = guard.computeKinematicCheck(prevAnchor, candidate, nextAnchor, thresholdKph);
    if (!check.passed) {
      state.addExcludedFromTrust(workingState, candidate.gpxIndex, 'insert_kinematic_guard_failed', passLabel);
      state.addAnnotation(workingState, {
        kind:       'insert_kinematic_guard_failed',
        scope:      'proposal',
        proposalId: proposal.id,
        gpxIndexes: [candidate.gpxIndex],
        details:    { kinematics: check, parametersSnapshot: { lenientMaxImpliedSpeedKph: thresholdKph } }
      });
      proposal.applied    = false;
      proposal.skipReason = 'kinematic_guard_failed';
    } else {
      // TODO: apply the actual insertion reorder in workingOrderedPoints
      state.addAnnotation(workingState, {
        kind: 'insert_applied', scope: 'proposal', proposalId: proposal.id,
        gpxIndexes: [candidate.gpxIndex],
        details: { kinematics: check, parametersSnapshot: { lenientMaxImpliedSpeedKph: thresholdKph } }
      });
      proposal.applied = true;
    }
    return;
  }

  // length≥2: advisory with all-fail fallback
  var checks = proposal.candidateGpxIndexes.map(function(gpxIdx) {
    var cand = ptMap.get(gpxIdx);
    if (!cand) return { gpxIndex: gpxIdx, check: null };
    return { gpxIndex: gpxIdx, check: guard.computeKinematicCheck(prevAnchor, cand, nextAnchor, thresholdKph) };
  });

  var passers = checks.filter(function(c) { return c.check && c.check.passed; });
  var pool    = passers.length > 0 ? passers : checks;

  // Select winner: lowest score, tiebreak by lowest gpxIndex
  pool.sort(function(a, b) {
    var sa = a.check ? (a.check.score || Infinity) : Infinity;
    var sb = b.check ? (b.check.score || Infinity) : Infinity;
    if (sa !== sb) return sa - sb;
    return a.gpxIndex - b.gpxIndex;
  });

  var winner = pool[0];
  var allFailed = passers.length === 0;
  var annKind = allFailed ? 'insert_competition_kinematic_guard_failed' : 'insert_competition_resolved';

  state.addAnnotation(workingState, {
    kind: annKind, scope: 'proposal', proposalId: proposal.id,
    gpxIndexes: proposal.candidateGpxIndexes,
    details: {
      winnerGpxIndex: winner.gpxIndex,
      allFailed: allFailed,
      candidates: checks.map(function(c) { return { gpxIndex: c.gpxIndex, kinematics: c.check }; }),
      parametersSnapshot: { lenientMaxImpliedSpeedKph: thresholdKph }
    }
  });

  for (var li = 0; li < checks.length; li++) {
    if (checks[li].gpxIndex !== winner.gpxIndex) {
      state.addExcludedFromTrust(workingState, checks[li].gpxIndex, 'insert_competition_loser', passLabel);
      removeFromWorking(workingState, checks[li].gpxIndex);
    }
  }

  // TODO: apply the actual reorder for winner into correct traversal position
  proposal.applied = true;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function removeFromWorking(workingState, gpxIndex) {
  workingState.workingOrderedPoints = workingState.workingOrderedPoints.filter(function(p) {
    return p.gpxIndex !== gpxIndex;
  });
}

module.exports = { applyProposals };
