'use strict';

/**
 * packages/correction/export/correction-export.js
 *
 * Assembles the canonical correction payload (ADR-correction-0012 §Output
 * schema). Verifies the partition invariant before returning:
 *
 *   The set of all gpxIndexes ingested into workingState splits into exactly
 *   THREE disjoint subsets:
 *     (a) drops[]                     — gpxIndex appears in workingState.drops
 *     (b) excludedFromTrust[]         — gpxIndex appears in workingState.excludedFromTrust
 *     (c) trusted-surviving           — still in workingState.workingOrderedPoints
 *                                       AND not in (b)
 *   Membership in (a) is mutually exclusive with (b) and (c). Membership in (c)
 *   is mutually exclusive with (b). Every ingested gpxIndex is in EXACTLY ONE
 *   of these three sets.
 *
 * Output keys (locked by ADR-0012):
 *   metadata               { schemaVersion, generatedAtUtc, paramsSnapshot }
 *   participation          { mode, coverageRatio, reasons }
 *   segmentProfiles        SegmentParticipationProfile[] (post-correction)
 *   boundaryClassifications inter-segment boundary records
 *   spineIntervals         per-segment spine-trusted point lists
 *   proposals              ALL proposals across all passes (with applied + skipReason)
 *   drops                  three-collection: drops
 *   excludedFromTrust      three-collection: excluded
 *   annotations            three-collection: annotations
 *   rearrangements         physical mutation log (insert-move, block-reorder, etc.)
 *   stagedEdgeProposals    Phase-2 input/output snapshot
 *   multipass.perSegment   per-segment Phase-1 pass log + exit reason
 *   phase2                 Phase-2 result summary
 *   diagnostics            Phase-3 residual sweep payload
 *   fullOrderedPoints      gpxIndex-only sequence in current traversal order
 *   canonicalTrustedPoints { gpxIndex, lat, lon, ele, timeMs, trkSegIndex }[]
 *                          for the trusted-surviving subset, in traversal order
 *   partitionInvariant     { ingested, drops, excluded, trustedSurviving, ok }
 *
 * @param {{
 *   workingState: Object,
 *   participation: Object,
 *   segmentProfiles: Array<Object>,
 *   boundaryClassifications: Array<Object>,
 *   spineResult: { spinePointsBySegment: Map, envelopeBySegment: Map },
 *   passLog: Array<Object>,
 *   coupledRegions: Array,
 *   overlapBlockResolution: Array,
 *   phase2Result: Object,
 *   diagnostics: Object,
 *   paramsSnapshot: Object,
 *   auditPerSegmentTags: Map<number, Object>
 * }} args
 * @returns {Object}
 */
function buildCorrectionExport(args) {
  var workingState = args.workingState;
  var spineResult  = args.spineResult || { spinePointsBySegment: new Map(), envelopeBySegment: new Map() };

  // ── Spine intervals (array form) ──────────────────────────────────────────
  var spineIntervalsArray = [];
  spineResult.spinePointsBySegment.forEach(function(pts, segIdx) {
    var env = spineResult.envelopeBySegment.get(segIdx) || { minTimeMs: null, maxTimeMs: null };
    spineIntervalsArray.push({
      trkSegIndex:  segIdx,
      spinePoints:  pts.map(function(p) {
        return { gpxIndex: p.gpxIndex, timeMs: p.timeMs };
      }),
      spineEnvelope: { minTimeMs: env.minTimeMs, maxTimeMs: env.maxTimeMs }
    });
  });
  spineIntervalsArray.sort(function(a, b) { return a.trkSegIndex - b.trkSegIndex; });

  // ── passLog (flat per-segment array) ──────────────────────────────────────
  var passLog = (args.passLog || []).map(function(seg) {
    return {
      trkSegIndex:   seg.trkSegIndex,
      exitReason:    seg.exitReason,
      iterationsRun: seg.iterationsRun || 0,
      passes:        seg.passes || []
    };
  });

  // ── Staged edge proposals snapshot ────────────────────────────────────────
  var stagedEdge = [];
  (workingState.stagedEdgeProposals || new Map()).forEach(function(slots, segIdx) {
    if (!slots) return;
    stagedEdge.push({
      trkSegIndex: segIdx,
      firstEdge:   slots.firstEdge ? summariseProposal(slots.firstEdge) : null,
      lastEdge:    slots.lastEdge  ? summariseProposal(slots.lastEdge)  : null
    });
  });
  stagedEdge.sort(function(a, b) { return a.trkSegIndex - b.trkSegIndex; });

  // ── Trusted-surviving subset ──────────────────────────────────────────────
  var pts = workingState.workingOrderedPoints || [];
  var fullOrderedPoints = pts.map(function(p) { return p.gpxIndex; });
  var excludedSet = new Set((workingState.excludedFromTrust || []).map(function(e) { return e.gpxIndex; }));
  var canonicalTrustedPoints = [];
  var survivingGpxIndexes = [];
  for (var i = 0; i < pts.length; i++) {
    if (excludedSet.has(pts[i].gpxIndex)) continue;
    var p = pts[i];
    survivingGpxIndexes.push(p.gpxIndex);
    canonicalTrustedPoints.push({
      gpxIndex:    p.gpxIndex,
      lat:         p.lat,
      lon:         p.lon,
      ele:         (p.ele === undefined ? null : p.ele),
      timeMs:      (typeof p.timeMs === 'number' ? p.timeMs : null),
      trkSegIndex: p.trkSegIndex
    });
  }

  // ── Partition invariant ───────────────────────────────────────────────────
  // Ingested = (drops ∪ workingOrderedPoints).
  var dropSet = new Set((workingState.drops || []).map(function(d) { return d.gpxIndex; }));
  var workingSet = new Set(pts.map(function(p) { return p.gpxIndex; }));
  var ingestedSet = new Set();
  dropSet.forEach(function(gi) { ingestedSet.add(gi); });
  workingSet.forEach(function(gi) { ingestedSet.add(gi); });

  var partition = verifyPartition(ingestedSet, dropSet, excludedSet, workingSet);

  // ── Final shape ───────────────────────────────────────────────────────────
  return {
    metadata: {
      schemaVersion:  '1.0.0',
      generatedAtUtc: new Date().toISOString(),
      paramsSnapshot: args.paramsSnapshot || {}
    },
    participation:           args.participation || null,
    segmentProfiles:         args.segmentProfiles || [],
    boundaryClassifications: args.boundaryClassifications || [],
    spineIntervals:          spineIntervalsArray,
    proposals:               (workingState.proposals || []).map(serialiseProposal),
    drops:                   workingState.drops || [],
    excludedFromTrust:       workingState.excludedFromTrust || [],
    annotations:             workingState.annotations || [],
    rearrangements:          workingState.rearrangements || [],
    stagedEdgeProposals:     stagedEdge,
    coupledRegions:          args.coupledRegions || [],
    overlapBlockResolution:  args.overlapBlockResolution || [],
    passLog:                 passLog,
    survivingGpxIndexes:     survivingGpxIndexes,
    multipass: {
      perSegment: passLog
    },
    phase2:                  args.phase2Result || null,
    diagnostics:             args.diagnostics || null,
    fullOrderedPoints:       fullOrderedPoints,
    canonicalTrustedPoints:  canonicalTrustedPoints,
    partitionInvariant:      partition
  };
}

/**
 * Strict partition validator. Returns a structured report and throws if the
 * invariant fails.
 */
function verifyPartition(ingestedSet, dropSet, excludedSet, workingSet) {
  // (a) drops ∩ excluded must be empty
  var dropsExclOverlap = [];
  dropSet.forEach(function(gi) { if (excludedSet.has(gi)) dropsExclOverlap.push(gi); });
  // (b) drops ∩ working must be empty
  var dropsWorkingOverlap = [];
  dropSet.forEach(function(gi) { if (workingSet.has(gi)) dropsWorkingOverlap.push(gi); });
  // (c) excluded must be a subset of working (excluded points stay in working order, just not in trusted)
  var excludedNotInWorking = [];
  excludedSet.forEach(function(gi) { if (!workingSet.has(gi)) excludedNotInWorking.push(gi); });
  // (d) every ingested must be in exactly one of {drops, working}
  var orphans = [];
  ingestedSet.forEach(function(gi) {
    var inDrop  = dropSet.has(gi);
    var inWork  = workingSet.has(gi);
    if (!(inDrop ^ inWork)) orphans.push(gi);  // XOR: must be in exactly one
  });

  var trustedSurvivingCount = 0;
  workingSet.forEach(function(gi) { if (!excludedSet.has(gi)) trustedSurvivingCount++; });

  var ok = (dropsExclOverlap.length === 0 &&
            dropsWorkingOverlap.length === 0 &&
            excludedNotInWorking.length === 0 &&
            orphans.length === 0);

  var report = {
    ingested:               ingestedSet.size,
    drops:                  dropSet.size,
    excluded:               excludedSet.size,
    trustedSurviving:       trustedSurvivingCount,
    workingOrderedPoints:   workingSet.size,
    ok:                     ok,
    violations: {
      dropsExclOverlap:    dropsExclOverlap,
      dropsWorkingOverlap: dropsWorkingOverlap,
      excludedNotInWorking: excludedNotInWorking,
      orphans:             orphans
    }
  };

  if (!ok) {
    throw new Error('correction-export: partition invariant violated: ' +
      JSON.stringify({
        dropsExclOverlap:    dropsExclOverlap.length,
        dropsWorkingOverlap: dropsWorkingOverlap.length,
        excludedNotInWorking: excludedNotInWorking.length,
        orphans:             orphans.length
      }));
  }
  return report;
}

function serialiseProposal(p) {
  var out = {
    id:             p.id,
    kind:           p.kind,
    trkSegIndex:    p.trkSegIndex,
    isEdgeProposal: p.isEdgeProposal,
    applied:        p.applied,
    skipReason:     p.skipReason
  };
  if (p.kind === 'insert') {
    out.candidateGpxIndexes = p.candidateGpxIndexes;
    out.isExactGroup        = p.isExactGroup;
    out.tPrev               = p.tPrev;
    out.tNext               = p.tNext;
    out.bracketGpxIndexes   = p.bracketGpxIndexes;
    out.targetTimeMs        = p.targetTimeMs;
    out.winner              = p.winner;
  } else if (p.kind === 'block-finding') {
    out.gpxIndexes                      = p.gpxIndexes;
    out.hasInternalMonotonicityViolation = p.hasInternalMonotonicityViolation;
    out.bMin          = p.bMin; out.bMax = p.bMax;
    out.prevGpxIndex  = p.prevGpxIndex; out.nextGpxIndex = p.nextGpxIndex;
    out.tPrev         = p.tPrev; out.tNext = p.tNext;
    out.overlapStatus = p.overlapStatus;
    out.kinematics    = p.kinematics || null;
  } else if (p.kind === 'adjacent-exact-drop') {
    out.keepGpxIndex = p.keepGpxIndex;
    out.dropGpxIndex = p.dropGpxIndex;
    out.eleMismatch  = p.eleMismatch;
  }
  return out;
}

function summariseProposal(p) {
  return {
    id:             p.id,
    kind:           p.kind,
    trkSegIndex:    p.trkSegIndex,
    isEdgeProposal: p.isEdgeProposal,
    targetTimeMs:   p.targetTimeMs,
    gpxIndexes:     p.gpxIndexes,
    candidatesCount: (p.candidateGpxIndexes ? p.candidateGpxIndexes.length : null),
    applied:        p.applied,
    skipReason:     p.skipReason
  };
}

module.exports = { buildCorrectionExport };
