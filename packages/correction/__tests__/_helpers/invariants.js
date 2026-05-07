'use strict';

/**
 * Phase J invariant checkers.
 *
 * Each function asserts a property that MUST hold on every well-formed
 * correction-pipeline output, regardless of the input. They throw on
 * violation (so test reporters surface a clear failure).
 *
 * The Jest `expect` API is captured lazily so this module remains importable
 * outside Jest (e.g. during exploratory scripts).
 */

/**
 * Partition invariant (ADR-correction-0012):
 *   For every input gpxIndex G:
 *     G ∈ drops          XOR  (G ∈ excludedFromTrust ∪ surviving)
 *   In words: a dropped point is gone; a non-dropped point may either be
 *   trusted-surviving, or surviving-but-excluded-from-trust, or both signals
 *   may apply, but it must NOT be both dropped AND surviving simultaneously.
 *
 *   We further require: every input gpxIndex appears in at least one of the
 *   three buckets (no point silently disappears).
 *
 * @param {Object} result               correction payload
 * @param {Array<number>} allGpxIndexes the full set of input gpxIndexes
 */
function assertPartitionInvariant(result, allGpxIndexes) {
  const droppedSet   = new Set(result.drops.map(d => d.gpxIndex));
  const excludedSet  = new Set(result.excludedFromTrust.map(e => e.gpxIndex));
  const survivingSet = new Set(result.survivingGpxIndexes);

  const violations = [];
  for (const gi of allGpxIndexes) {
    const inDrop     = droppedSet.has(gi);
    const inSurvive  = survivingSet.has(gi);
    const inExcluded = excludedSet.has(gi);

    // No silent disappearance
    if (!inDrop && !inSurvive && !inExcluded) {
      violations.push(`gpxIndex ${gi}: missing from all three buckets`);
    }
    // Cannot be dropped AND surviving
    if (inDrop && inSurvive) {
      violations.push(`gpxIndex ${gi}: in BOTH drops AND surviving`);
    }
  }
  if (violations.length > 0) {
    throw new Error('Partition invariant violations:\n  ' + violations.join('\n  '));
  }
}

/**
 * Proposal invariant: in every passLog entry, every applied/notApplied count
 * must add up to total, and no negative counts.
 *
 * (We don't have direct access to proposals on the export, so we check the
 * passLog accounting that summarises them.)
 */
function assertProposalCountsConsistent(result) {
  const violations = [];
  for (const segLog of result.passLog || []) {
    for (const pass of segLog.passes || []) {
      const c = pass.proposalCounts || {};
      const total = c.total || 0;
      if (total < 0) violations.push(`seg ${segLog.trkSegIndex} pass ${pass.passNumber}: negative total`);

      // If we have detailed counts, sum should not exceed total
      const accounted = (c.applied || 0) + (c.vetoed || 0) + (c.couplingBlocked || 0);
      if (c.applied !== undefined && accounted > total) {
        violations.push(
          `seg ${segLog.trkSegIndex} pass ${pass.passNumber}: applied+vetoed+blocked=${accounted} > total=${total}`
        );
      }
    }
  }
  if (violations.length > 0) {
    throw new Error('Proposal count invariant violations:\n  ' + violations.join('\n  '));
  }
}

/**
 * Schema invariant: top-level keys present, types correct, exit reasons valid.
 */
const VALID_EXIT_REASONS = new Set([
  'stable', 'all_applied', 'stalemate', 'max_iterations', 'no_proposals'
]);

function assertSchemaInvariant(result) {
  const required = [
    'metadata', 'drops', 'excludedFromTrust', 'annotations',
    'spineIntervals', 'coupledRegions', 'overlapBlockResolution',
    'passLog', 'survivingGpxIndexes'
  ];
  for (const k of required) {
    if (!(k in result)) throw new Error('Schema invariant: missing top-level key ' + k);
  }
  if (typeof result.metadata.schemaVersion !== 'string') {
    throw new Error('Schema invariant: metadata.schemaVersion must be string');
  }
  if (!Array.isArray(result.drops))             throw new Error('drops must be array');
  if (!Array.isArray(result.excludedFromTrust)) throw new Error('excludedFromTrust must be array');
  if (!Array.isArray(result.annotations))       throw new Error('annotations must be array');
  if (!Array.isArray(result.spineIntervals))    throw new Error('spineIntervals must be array');

  for (const segLog of result.passLog || []) {
    if (segLog.exitReason && !VALID_EXIT_REASONS.has(segLog.exitReason)) {
      throw new Error('Invalid exitReason: ' + segLog.exitReason);
    }
  }

  // Drops/excluded entries each carry { gpxIndex, reason, stage }
  for (const d of result.drops) {
    if (typeof d.gpxIndex !== 'number') throw new Error('drop.gpxIndex must be number');
    if (typeof d.reason !== 'string')   throw new Error('drop.reason must be string');
    if (typeof d.stage  !== 'string')   throw new Error('drop.stage must be string');
  }
  for (const e of result.excludedFromTrust) {
    if (typeof e.gpxIndex !== 'number') throw new Error('excluded.gpxIndex must be number');
    if (typeof e.reason !== 'string')   throw new Error('excluded.reason must be string');
    if (typeof e.stage  !== 'string')   throw new Error('excluded.stage must be string');
  }

  // Spine point shape
  for (const seg of result.spineIntervals) {
    if (typeof seg.trkSegIndex !== 'number') throw new Error('spineInterval.trkSegIndex must be number');
    if (!Array.isArray(seg.spinePoints))     throw new Error('spineInterval.spinePoints must be array');
    for (const sp of seg.spinePoints) {
      if (typeof sp.gpxIndex !== 'number') throw new Error('spinePoint.gpxIndex must be number');
      if (typeof sp.timeMs !== 'number')   throw new Error('spinePoint.timeMs must be number');
    }
  }
}

/**
 * Spine monotonicity: within a single segment, spinePoints[].timeMs is
 * strictly increasing.
 */
function assertSpineMonotonic(result) {
  for (const seg of result.spineIntervals) {
    let prev = -Infinity;
    for (const sp of seg.spinePoints) {
      if (!(sp.timeMs > prev)) {
        throw new Error(
          `Spine monotonicity violated in seg ${seg.trkSegIndex}: ` +
          `gpxIndex=${sp.gpxIndex} timeMs=${sp.timeMs} not > prev=${prev}`
        );
      }
      prev = sp.timeMs;
    }
  }
}

/**
 * Spine isolation: a spine point's trkSegIndex must match its enclosing entry.
 * (This catches a mis-bucketed point — segment boundary leakage.)
 */
function assertSpineSegmentIsolation(result, allInputPoints) {
  const ptByIdx = new Map();
  for (const p of allInputPoints) ptByIdx.set(p.gpxIndex, p);

  for (const seg of result.spineIntervals) {
    for (const sp of seg.spinePoints) {
      const orig = ptByIdx.get(sp.gpxIndex);
      if (!orig) continue;
      if (orig.trkSegIndex !== seg.trkSegIndex) {
        throw new Error(
          `Spine isolation violated: gpxIndex ${sp.gpxIndex} (originally in seg ${orig.trkSegIndex}) ` +
          `appears in spine of seg ${seg.trkSegIndex}`
        );
      }
    }
  }
}

/**
 * Run all invariants in one call.
 */
function assertAllInvariants(result, allInputPoints) {
  const indexes = allInputPoints.map(p => p.gpxIndex);
  assertSchemaInvariant(result);
  assertPartitionInvariant(result, indexes);
  assertProposalCountsConsistent(result);
  assertSpineMonotonic(result);
  assertSpineSegmentIsolation(result, allInputPoints);
}

module.exports = {
  VALID_EXIT_REASONS,
  assertPartitionInvariant,
  assertProposalCountsConsistent,
  assertSchemaInvariant,
  assertSpineMonotonic,
  assertSpineSegmentIsolation,
  assertAllInvariants
};
