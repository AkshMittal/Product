'use strict';

/**
 * parse-csv-gpx.js
 *
 * Streams the hikr.org CSV, extracts inline GPX XML from the `gpx` column,
 * and runs the full audit → correction pipeline on each track.
 *
 * Usage:
 *   node parse-csv-gpx.js [--limit N] [--offset N] [--output-dir DIR]
 *
 * Options:
 *   --limit N       Process only N tracks (default: all)
 *   --offset N      Skip first N tracks (default: 0)
 *   --output-dir    Write per-track JSON pairs here (default: pipeline-output/csv/)
 *   --summary-only  Print summary report only, skip writing JSON files
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { parse } = require('csv-parse');
const { JSDOM } = require('jsdom');
const { runCorrection } = require('./packages/correction/index');

// ── Parse CLI args ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag, defaultVal) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : defaultVal;
}
const LIMIT       = getArg('--limit',      null);
const OFFSET      = parseInt(getArg('--offset', '0'), 10);
const OUTPUT_DIR  = getArg('--output-dir', path.join(__dirname, 'pipeline-output/csv'));
const SUMMARY_ONLY = args.includes('--summary-only');

const limitN = LIMIT ? parseInt(LIMIT, 10) : Infinity;

// ── Set up jsdom vm context for audit modules (browser-only) ──────────────

const dom = new JSDOM('<!DOCTYPE html>');
const vmContext = vm.createContext({
  DOMParser: dom.window.DOMParser,
  console,
  document: dom.window.document,
});

function loadBrowserModule(filePath) {
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), vmContext);
}

const auditDir = path.join(__dirname, 'packages/audit/pipeline');
loadBrowserModule(path.join(auditDir, 'export-fault-detection.js'));
loadBrowserModule(path.join(auditDir, 'gpx-ingestion-module.js'));
loadBrowserModule(path.join(auditDir, 'timestamp-audit.js'));
loadBrowserModule(path.join(auditDir, 'sampling-audit.js'));
loadBrowserModule(path.join(auditDir, 'motion-audit.js'));
loadBrowserModule(path.join(auditDir, 'elevation-audit.js'));
loadBrowserModule(path.join(auditDir, 'audit-export-module.js'));

const parseGPX               = vmContext.parseGPX;
const auditTimestamps        = vmContext.auditTimestamps;
const auditSampling          = vmContext.auditSampling;
const auditMotion            = vmContext.auditMotion;
const auditElevation         = vmContext.auditElevation;
const buildAuditExportPayload = vmContext.buildAuditExportPayload;

// ── Pipeline ──────────────────────────────────────────────────────────────

function runPipeline(gpxString, trackId, trackName) {
  const fileName = trackName || trackId || 'unknown';

  const ingestionResult = parseGPX(gpxString);
  const { points, audit: ingestionAudit } = ingestionResult;

  const temporalResult  = auditTimestamps(points);
  const samplingResult  = auditSampling(points, fileName);
  const motionResult    = auditMotion(points, {});
  const elevationResult = auditElevation(points, {});

  const auditJson = buildAuditExportPayload({
    fileName,
    totalPointCount: points.length,
    ingestionAudit:  ingestionAudit.ingestion,
    temporalAudit:   temporalResult  && temporalResult.audit  && temporalResult.audit.temporal,
    samplingAudit:   samplingResult  && samplingResult.audit  && samplingResult.audit.sampling,
    motionAudit:     motionResult    && motionResult.audit    && motionResult.audit.motion,
    elevationAudit:  elevationResult && elevationResult.audit && elevationResult.audit.elevation,
  });

  let correctionJson = null;
  let correctionError = null;
  try {
    correctionJson = runCorrection(auditJson, points, {});
  } catch (e) {
    correctionError = e.message;
  }

  return { points, auditJson, ingestionAudit, correctionJson, correctionError };
}

// ── Reporting ─────────────────────────────────────────────────────────────

function auditAnomalies(auditJson) {
  const out = {};
  const temporal = auditJson.audit && auditJson.audit.temporal && auditJson.audit.temporal.tagCounts;
  if (temporal) for (const [k, v] of Object.entries(temporal)) if (v > 0) out['temporal.' + k] = v;
  const motion = auditJson.audit && auditJson.audit.motion && auditJson.audit.motion.tagCounts;
  if (motion) for (const [k, v] of Object.entries(motion)) if (v > 0) out['motion.' + k] = v;
  return out;
}

function segInfo(ingestionAudit) {
  const ing  = ingestionAudit.ingestion;
  const segs = (ing.segmentSummaries || []).map(s => ({
    idx:    s.globalSegIndex !== undefined ? s.globalSegIndex : s.trkSegIndex,
    points: s.pointCount !== undefined ? s.pointCount : '?',
    minT:   s.minTimeMs ? new Date(s.minTimeMs).toISOString().slice(0, 10) : null,
    maxT:   s.maxTimeMs ? new Date(s.maxTimeMs).toISOString().slice(0, 10) : null,
  }));
  return { count: ing.counts.trkSegmentCount, multi: ing.context.hasMultipleSegments, segs };
}

function corrSummary(corr) {
  if (!corr) return null;
  return {
    drops:             corr.drops             ? corr.drops.length             : 0,
    excluded:          corr.excludedFromTrust  ? corr.excludedFromTrust.length : 0,
    rearrangements:    corr.rearrangements     ? corr.rearrangements.length    : 0,
    proposals:         corr.proposals          ? corr.proposals.length          : 0,
    applied:           corr.proposals          ? corr.proposals.filter(p => p.applied).length : 0,
    partitionOk:       corr.partitionInvariant  ? corr.partitionInvariant.ok    : null,
    segProfiles:       (corr.segmentProfiles || []).map(p => ({
      seg: p.trkSegIndex, mode: p.mode, idle: p.correctionIdle,
      coverage: p.coverageRatio !== undefined ? p.coverageRatio.toFixed(3) : '?',
    })),
  };
}

// ── Main streaming loop ───────────────────────────────────────────────────

if (!SUMMARY_ONLY) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const csvPath = path.join(__dirname, 'dataset/gpx-tracks-from-hikr.org.csv');

const stats = { total: 0, withAnomalies: 0, multiSegment: 0, errors: 0 };
let processed = 0;
let skipped = 0;

console.log(`\n${'='.repeat(72)}`);
console.log(`GPX CSV PIPELINE — hikr.org dataset`);
if (limitN < Infinity) console.log(`Limit: ${limitN}  Offset: ${OFFSET}`);
console.log(`${'='.repeat(72)}\n`);

const parser = fs.createReadStream(csvPath)
  .pipe(parse({
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }));

parser.on('data', (row) => {
  if (skipped < OFFSET) { skipped++; return; }
  if (processed >= limitN) { parser.destroy(); return; }

  stats.total++;
  processed++;

  const trackId   = row._id || `row-${stats.total}`;
  const trackName = row.name || trackId;
  const gpxString = row.gpx;

  if (!gpxString || gpxString.trim().length === 0) {
    console.log(`[SKIP] ${trackId}: empty gpx column`);
    return;
  }

  let result;
  try {
    result = runPipeline(gpxString, trackId, trackName);
  } catch (e) {
    stats.errors++;
    console.log(`[ERROR] ${trackId} — ${trackName}: ${e.message}`);
    return;
  }

  const { points, auditJson, ingestionAudit, correctionJson, correctionError } = result;
  const segs      = segInfo(ingestionAudit);
  const anomalies = auditAnomalies(auditJson);
  const cs        = corrSummary(correctionJson);
  const hasAnomalies = Object.keys(anomalies).length > 0;
  const hasCorrActions = cs && (cs.drops > 0 || cs.excluded > 0 || cs.applied > 0);

  if (segs.multi) stats.multiSegment++;
  if (hasAnomalies) stats.withAnomalies++;
  if (correctionError) stats.errors++;

  // Only print tracks with something interesting
  if (hasAnomalies || segs.multi || correctionError || hasCorrActions) {
    console.log(`── [${stats.total}] ${trackName} (${trackId})`);
    console.log(`   Points: ${points.length}  |  Segments: ${segs.count}${segs.multi ? ' *** MULTI-SEGMENT ***' : ''}`);
    for (const s of segs.segs) {
      const tRange = s.minT ? `${s.minT} → ${s.maxT}` : 'no timestamps';
      console.log(`     seg[${s.idx}]: ${s.points} pts  ${tRange}`);
    }
    if (hasAnomalies) {
      console.log(`   Audit anomalies: ${Object.entries(anomalies).map(([k,v]) => `${k}:${v}`).join('  ')}`);
    }
    if (correctionError) {
      console.log(`   Correction ERROR: ${correctionError}`);
    } else if (cs) {
      console.log(`   Correction: drops=${cs.drops} excluded=${cs.excluded} rearrangements=${cs.rearrangements} applied=${cs.applied}/${cs.proposals} partitionOk=${cs.partitionOk}`);
      for (const p of cs.segProfiles) {
        console.log(`     seg[${p.seg}]: mode=${p.mode}  idle=${p.idle}  coverage=${p.coverage}`);
      }
    }

    if (!SUMMARY_ONLY) {
      const safe = trackId.replace(/[^a-zA-Z0-9_-]/g, '_');
      fs.writeFileSync(path.join(OUTPUT_DIR, `${safe}.audit.json`),      JSON.stringify(auditJson,      null, 2));
      if (correctionJson) {
        fs.writeFileSync(path.join(OUTPUT_DIR, `${safe}.correction.json`), JSON.stringify(correctionJson, null, 2));
      }
      console.log(`   → pipeline-output/csv/${safe}.{audit,correction}.json`);
    }
    console.log();
  }

  if (stats.total % 100 === 0) {
    process.stderr.write(`\r[progress] processed=${stats.total}  anomalies=${stats.withAnomalies}  multiSeg=${stats.multiSegment}  errors=${stats.errors}`);
  }
});

parser.on('end', () => {
  process.stderr.write('\n');
  console.log(`${'='.repeat(72)}`);
  console.log(`SUMMARY`);
  console.log(`  Processed:      ${stats.total}`);
  console.log(`  With anomalies: ${stats.withAnomalies}`);
  console.log(`  Multi-segment:  ${stats.multiSegment}`);
  console.log(`  Errors:         ${stats.errors}`);
  console.log(`${'='.repeat(72)}\n`);
});

parser.on('error', (err) => {
  console.error('CSV parse error:', err.message);
  process.exit(1);
});
