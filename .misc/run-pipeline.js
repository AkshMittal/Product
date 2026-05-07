'use strict';

/**
 * run-pipeline.js
 *
 * Node.js test script: loads GPX files from dataset/, runs the full
 * audit → correction pipeline, and prints a structured findings report.
 *
 * Audit modules are browser-only (no module.exports), so they're loaded
 * into a jsdom vm context via vm.runInContext.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');
const { runCorrection } = require('./packages/correction/index');

// ── Build vm context with jsdom DOMParser ─────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html>');
const win = dom.window;

const vmContext = vm.createContext({
  DOMParser:    win.DOMParser,
  FileReader:   win.FileReader,
  console,
  // stubs for browser globals audit modules may reference
  document:     win.document,
});

function loadBrowserModule(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  vm.runInContext(src, vmContext);
}

// Load audit modules in dependency order
const auditDir = path.join(__dirname, 'packages/audit/pipeline');
loadBrowserModule(path.join(auditDir, 'export-fault-detection.js'));
loadBrowserModule(path.join(auditDir, 'gpx-ingestion-module.js'));
loadBrowserModule(path.join(auditDir, 'timestamp-audit.js'));
loadBrowserModule(path.join(auditDir, 'sampling-audit.js'));
loadBrowserModule(path.join(auditDir, 'motion-audit.js'));
loadBrowserModule(path.join(auditDir, 'elevation-audit.js'));
loadBrowserModule(path.join(auditDir, 'audit-export-module.js'));

// Pull function refs from the vm context
const parseGPX              = vmContext.parseGPX;
const auditTimestamps       = vmContext.auditTimestamps;
const auditSampling         = vmContext.auditSampling;
const auditMotion           = vmContext.auditMotion;
const auditElevation        = vmContext.auditElevation;
const buildAuditExportPayload = vmContext.buildAuditExportPayload;

// ── Pipeline runner ───────────────────────────────────────────────────────

function runFullPipeline(gpxFilePath) {
  const fileName  = path.basename(gpxFilePath);
  const gpxString = fs.readFileSync(gpxFilePath, 'utf8');

  // 1) Ingest
  const ingestionResult = parseGPX(gpxString);
  const { points, audit: ingestionAudit } = ingestionResult;

  // 2) Audit modules
  const temporalResult  = auditTimestamps(points);
  const samplingResult  = auditSampling(points, fileName);
  const motionResult    = auditMotion(points, {});
  const elevationResult = auditElevation(points, {});

  // 3) Build audit payload
  const auditJson = buildAuditExportPayload({
    fileName,
    totalPointCount: points.length,
    ingestionAudit:  ingestionAudit.ingestion,
    temporalAudit:   temporalResult  && temporalResult.audit  && temporalResult.audit.temporal,
    samplingAudit:   samplingResult  && samplingResult.audit  && samplingResult.audit.sampling,
    motionAudit:     motionResult    && motionResult.audit    && motionResult.audit.motion,
    elevationAudit:  elevationResult && elevationResult.audit && elevationResult.audit.elevation,
  });

  // 4) Correction
  let correctionJson = null;
  let correctionError = null;
  try {
    correctionJson = runCorrection(auditJson, points, {});
  } catch (e) {
    correctionError = e.message;
  }

  return { fileName, points, auditJson, ingestionAudit, correctionJson, correctionError };
}

// ── Reporting helpers ─────────────────────────────────────────────────────

function countAuditAnomalies(auditJson) {
  const counts = {};
  const temporal = auditJson.audit && auditJson.audit.temporal && auditJson.audit.temporal.tagCounts;
  if (temporal) {
    for (const [k, v] of Object.entries(temporal)) {
      if (v > 0) counts['temporal.' + k] = v;
    }
  }
  const motion = auditJson.audit && auditJson.audit.motion && auditJson.audit.motion.tagCounts;
  if (motion) {
    for (const [k, v] of Object.entries(motion)) {
      if (v > 0) counts['motion.' + k] = v;
    }
  }
  return counts;
}

function correctionSummary(corr) {
  if (!corr) return null;
  return {
    drops:            corr.drops           ? corr.drops.length            : 0,
    excludedFromTrust: corr.excludedFromTrust ? corr.excludedFromTrust.length : 0,
    rearrangements:   corr.rearrangements  ? corr.rearrangements.length   : 0,
    proposals:        corr.proposals       ? corr.proposals.length         : 0,
    appliedProposals: corr.proposals
      ? corr.proposals.filter(p => p.applied).length : 0,
    partitionOk:      corr.partitionInvariant ? corr.partitionInvariant.ok : null,
    phase2Drops:      corr.phase2 && corr.phase2.dropsApplied ? corr.phase2.dropsApplied : 0,
  };
}

function segmentSummary(ingestionAudit) {
  const ing  = ingestionAudit.ingestion;
  const segs = ing.segmentSummaries || [];
  return {
    count:  ing.counts.trkSegmentCount,
    multi:  ing.context.hasMultipleSegments,
    perSeg: segs.map(s => ({
      idx:    s.globalSegIndex !== undefined ? s.globalSegIndex : s.trkSegIndex,
      points: s.pointCount !== undefined ? s.pointCount : (s.acceptedCount !== undefined ? s.acceptedCount : '?'),
      minT:   s.minTimeMs ? new Date(s.minTimeMs).toISOString() : null,
      maxT:   s.maxTimeMs ? new Date(s.maxTimeMs).toISOString() : null,
    })),
  };
}

function correctionSegmentProfiles(corr) {
  if (!corr || !corr.segmentProfiles) return [];
  return corr.segmentProfiles.map(p => ({
    seg:       p.trkSegIndex,
    mode:      p.mode,
    idle:      p.correctionIdle,
    coverage:  p.coverageRatio !== undefined ? p.coverageRatio.toFixed(3) : '?',
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────

const datasetDir = path.join(__dirname, 'dataset');
const gpxFiles = fs.readdirSync(datasetDir)
  .filter(f => f.endsWith('.gpx'))
  .map(f => path.join(datasetDir, f));

console.log(`\n${'='.repeat(72)}`);
console.log(`GPX PIPELINE REPORT — ${gpxFiles.length} files`);
console.log(`${'='.repeat(72)}\n`);

for (const gpxPath of gpxFiles) {
  let result;
  try {
    result = runFullPipeline(gpxPath);
  } catch (e) {
    console.log(`[ERROR] ${path.basename(gpxPath)}: ${e.message}\n`);
    continue;
  }

  const { fileName, points, auditJson, ingestionAudit, correctionJson, correctionError } = result;
  const anomalies = countAuditAnomalies(auditJson);
  const hasAnomalies = Object.keys(anomalies).length > 0;
  const segs = segmentSummary(ingestionAudit);
  const csumm = correctionSummary(correctionJson);

  console.log(`── ${fileName}`);
  console.log(`   Points: ${points.length}  |  Segments: ${segs.count}${segs.multi ? ' *** MULTI-SEGMENT ***' : ''}`);

  // Per-segment table
  if (segs.count > 0) {
    for (const s of segs.perSeg) {
      const tRange = (s.minT && s.maxT)
        ? `${s.minT.slice(0,10)} → ${s.maxT.slice(0,10)}`
        : 'no timestamps';
      console.log(`     seg[${s.idx}]: ${s.points} pts  ${tRange}`);
    }
  }

  // Audit anomalies
  if (hasAnomalies) {
    console.log(`   Audit anomalies:`);
    for (const [k, v] of Object.entries(anomalies)) {
      console.log(`     ${k}: ${v}`);
    }
  } else {
    console.log(`   Audit: clean (no anomalies)`);
  }

  // Correction layer
  if (correctionError) {
    console.log(`   Correction: ERROR — ${correctionError}`);
  } else if (csumm) {
    const segProfiles = correctionSegmentProfiles(correctionJson);
    console.log(`   Correction:`);
    console.log(`     drops=${csumm.drops}  excluded=${csumm.excludedFromTrust}  rearrangements=${csumm.rearrangements}`);
    console.log(`     proposals=${csumm.proposals} (applied=${csumm.appliedProposals})  partitionOk=${csumm.partitionOk}`);
    if (csumm.phase2Drops > 0) {
      console.log(`     phase2 drops=${csumm.phase2Drops}`);
    }
    for (const p of segProfiles) {
      console.log(`     seg[${p.seg}]: mode=${p.mode}  idle=${p.idle}  coverage=${p.coverage}`);
    }
  }

  // Export full JSONs to output folder for detailed inspection
  const outDir = path.join(__dirname, 'pipeline-output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const baseName = fileName.replace('.gpx', '');
  fs.writeFileSync(path.join(outDir, `${baseName}.audit.json`),      JSON.stringify(auditJson,      null, 2));
  if (correctionJson) {
    fs.writeFileSync(path.join(outDir, `${baseName}.correction.json`), JSON.stringify(correctionJson, null, 2));
  }

  console.log(`   JSONs → pipeline-output/${baseName}.{audit,correction}.json`);
  console.log();
}

console.log(`${'='.repeat(72)}`);
console.log('Done. Full JSONs in pipeline-output/');
console.log(`${'='.repeat(72)}\n`);
