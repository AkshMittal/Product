'use strict';

/**
 * run-full-pipeline.js
 *
 * Coordinator: runs 1-extract-and-run.js in batches of 500, then 2-report-findings.js once.
 * Pure Node — no bash/PowerShell dependency.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUTPUT_DIR = 'pipeline-output/csv';
const BATCH_SIZE = 500;

console.log('='.repeat(72));
console.log('Full Pipeline Coordinator — extracting all GPX tracks from hikr.org CSV');
console.log('='.repeat(72));
console.log('');

// Count actual CSV rows (not lines — GPX XML is multiline per cell)
const csvPath = path.join(__dirname, 'dataset/gpx-tracks-from-hikr.org.csv');
const countOut = execSync(
  `node -e "const fs=require('fs'),{parse}=require('csv-parse');let n=0;fs.createReadStream('dataset/gpx-tracks-from-hikr.org.csv').pipe(parse({columns:true,skip_empty_lines:true,relax_quotes:true,relax_column_count:true})).on('data',()=>n++).on('end',()=>process.stdout.write(String(n))).on('error',e=>{process.stderr.write(e.message);process.exit(1)});"`,
  { cwd: __dirname, encoding: 'utf8', timeout: 120000 }
);
const totalTracks = parseInt(countOut.trim(), 10);
const batchCount = Math.ceil(totalTracks / BATCH_SIZE);

console.log(`CSV has ~${totalTracks} tracks. Running ${batchCount} batches of ${BATCH_SIZE}...`);
console.log('');

// Clean output dir
if (fs.existsSync(OUTPUT_DIR)) {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Run batches
for (let i = 0; i < batchCount; i++) {
  const offset = i * BATCH_SIZE;
  const batchNum = i + 1;
  console.log(`[Batch ${batchNum}/${batchCount}] offset=${offset} limit=${BATCH_SIZE}`);

  try {
    execSync(
      `node 1-extract-and-run.js --offset ${offset} --limit ${BATCH_SIZE} --output-dir ${OUTPUT_DIR}`,
      { cwd: __dirname, stdio: 'inherit' }
    );
  } catch (e) {
    console.error(`Batch ${batchNum} failed:`, e.message);
    process.exit(1);
  }
  console.log('');
}

console.log('='.repeat(72));
console.log('All batches complete. Running findings report...');
console.log('='.repeat(72));
console.log('');

try {
  execSync(
    `node 2-report-findings.js --input-dir ${OUTPUT_DIR}`,
    { cwd: __dirname, stdio: 'inherit' }
  );
} catch (e) {
  console.error('Report failed:', e.message);
  process.exit(1);
}

console.log('='.repeat(72));
console.log('Pipeline coordinator finished.');
console.log('='.repeat(72));
