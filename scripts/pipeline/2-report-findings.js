'use strict';

/**
 * 2-report-findings.js
 *
 * Reads all audit/correction JSON pairs from pipeline-output/csv/,
 * checks each for anomalies, multi-segments, and correction actions,
 * and prints a structured findings report.
 *
 * Usage:
 *   node 2-report-findings.js [--input-dir DIR]
 *
 * Options:
 *   --input-dir    Where to read JSON pairs from (default: pipeline-output/csv)
 */

const fs   = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(flag, def) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const INPUT_DIR = getArg('--input-dir', path.join(__dirname, 'pipeline-output/csv'));

// ── Helpers ───────────────────────────────────────────────────────────────

function auditAnomalies(auditJson) {
  const out = {};
  const temporal = auditJson.audit?.temporal?.tagCounts;
  if (temporal) for (const [k, v] of Object.entries(temporal)) if (v > 0) out['temporal.' + k] = v;
  const motion = auditJson.audit?.motion?.tagCounts;
  if (motion) for (const [k, v] of Object.entries(motion)) if (v > 0) out['motion.' + k] = v;
  return out;
}

function segInfo(auditJson) {
  const ing  = auditJson.audit?.ingestion;
  if (!ing) return { count: 0, multi: false, segs: [] };
  return {
    count: ing.counts?.trkSegmentCount || 0,
    multi: ing.context?.hasMultipleSegments || false,
    segs:  (ing.segmentSummaries || []).map(s => ({
      idx:    s.globalSegIndex ?? s.trkSegIndex,
      points: s.pointCount ?? '?',
      minT:   s.minTimeMs ? new Date(s.minTimeMs).toISOString().slice(0, 10) : null,
      maxT:   s.maxTimeMs ? new Date(s.maxTimeMs).toISOString().slice(0, 10) : null,
    })),
  };
}

function corrSummary(corrJson) {
  if (!corrJson) return null;
  if (corrJson.correctionError) return { error: corrJson.correctionError };
  return {
    drops:       corrJson.drops?.length             ?? 0,
    excluded:    corrJson.excludedFromTrust?.length  ?? 0,
    rearranged:  corrJson.rearrangements?.length     ?? 0,
    proposals:   corrJson.proposals?.length          ?? 0,
    applied:     corrJson.proposals?.filter(p => p.applied).length ?? 0,
    partitionOk: corrJson.partitionInvariant?.ok     ?? null,
    segProfiles: (corrJson.segmentProfiles || []).map(p => ({
      seg: p.trkSegIndex, mode: p.mode, idle: p.correctionIdle,
      coverage: p.coverageRatio?.toFixed(3) ?? '?',
    })),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

if (!fs.existsSync(INPUT_DIR)) {
  console.error(`Input dir not found: ${INPUT_DIR}`);
  console.error('Run 1-extract-and-run.js first.');
  process.exit(1);
}

const files = fs.readdirSync(INPUT_DIR);
const auditFiles = files.filter(f => f.endsWith('.audit.json'));
const errorFiles = files.filter(f => f.endsWith('.error.json'));

const stats = {
  total: auditFiles.length + errorFiles.length,
  clean: 0,
  withAnomalies: 0,
  multiSegment: 0,
  withCorrActions: 0,
  partitionFailed: 0,
  errors: errorFiles.length,
};

console.log(`\n${'='.repeat(72)}`);
console.log(`FINDINGS REPORT — ${INPUT_DIR}`);
console.log(`Total tracks: ${stats.total}  (${errorFiles.length} pipeline errors)`);
console.log(`${'='.repeat(72)}\n`);

// Report errors first
for (const ef of errorFiles) {
  const errData = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, ef), 'utf8'));
  console.log(`[ERROR] ${errData.name || errData.trackId}: ${errData.error}`);
}
if (errorFiles.length > 0) console.log();

// Analyse audit/correction pairs
for (const af of auditFiles) {
  const base = af.replace('.audit.json', '');
  const auditJson = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, af), 'utf8'));
  const corrPath  = path.join(INPUT_DIR, `${base}.correction.json`);
  const corrJson  = fs.existsSync(corrPath)
    ? JSON.parse(fs.readFileSync(corrPath, 'utf8'))
    : null;

  const meta      = auditJson.meta || {};
  const segs      = segInfo(auditJson);
  const anomalies = auditAnomalies(auditJson);
  const cs        = corrSummary(corrJson);

  const hasAnomalies   = Object.keys(anomalies).length > 0;
  const hasCorrActions = cs && !cs.error && (cs.drops > 0 || cs.excluded > 0 || cs.applied > 0);
  const partitionFail  = cs && !cs.error && cs.partitionOk === false;

  if (segs.multi)       stats.multiSegment++;
  if (hasAnomalies)     stats.withAnomalies++;
  if (hasCorrActions)   stats.withCorrActions++;
  if (partitionFail)    stats.partitionFailed++;
  if (!hasAnomalies && !segs.multi && !hasCorrActions && !partitionFail) { stats.clean++; continue; }

  // Print interesting tracks
  const label = meta.name || meta.trackId || base;
  console.log(`── ${label}`);
  if (meta.url)       console.log(`   URL: ${meta.url}`);
  if (meta.startTime) console.log(`   Date: ${meta.startTime}`);
  console.log(`   Points: ${auditJson.metadata?.summary?.totalPointCount ?? '?'}  |  Segments: ${segs.count}${segs.multi ? ' *** MULTI-SEGMENT ***' : ''}`);

  for (const s of segs.segs) {
    const tRange = s.minT ? `${s.minT} → ${s.maxT}` : 'no timestamps';
    console.log(`     seg[${s.idx}]: ${s.points} pts  ${tRange}`);
  }

  if (hasAnomalies) {
    console.log(`   Audit: ${Object.entries(anomalies).map(([k,v]) => `${k}:${v}`).join('  ')}`);
  }

  if (!cs) {
    console.log(`   Correction: no output`);
  } else if (cs.error) {
    console.log(`   Correction ERROR: ${cs.error}`);
  } else {
    console.log(`   Correction: drops=${cs.drops} excluded=${cs.excluded} rearranged=${cs.rearranged} applied=${cs.applied}/${cs.proposals} partitionOk=${cs.partitionOk}`);
    for (const p of cs.segProfiles) {
      console.log(`     seg[${p.seg}]: mode=${p.mode}  idle=${p.idle}  coverage=${p.coverage}`);
    }
  }
  console.log();
}

// Summary
console.log(`${'='.repeat(72)}`);
console.log(`SUMMARY`);
console.log(`  Total processed:    ${stats.total}`);
console.log(`  Clean (no issues):  ${stats.clean}`);
console.log(`  With anomalies:     ${stats.withAnomalies}`);
console.log(`  Multi-segment:      ${stats.multiSegment}`);
console.log(`  Correction acted:   ${stats.withCorrActions}`);
console.log(`  Partition failures: ${stats.partitionFailed}`);
console.log(`  Pipeline errors:    ${stats.errors}`);
console.log(`${'='.repeat(72)}\n`);
