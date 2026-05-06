'use strict';

/**
 * Detailed diagnostic test runner for correction fixtures.
 *
 * Loads all fixtures, runs them through the pipeline, and produces
 * a detailed diagnostic report of what passed/failed and why.
 *
 * This test is primarily for analysis — it collects results and
 * reports them comprehensively rather than asserting strict expected values.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { runCorrection } = require('../index');

// ── Helpers ────────────────────────────────────────────────────────────────

function findAllGpxFixtures(baseDir) {
  const fixtures = [];

  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.gpx')) {
        const relativePath = path.relative(baseDir, fullPath);
        fixtures.push({
          path: fullPath,
          relativePath,
          filename: entry.name
        });
      }
    }
  }

  walkDir(baseDir);
  return fixtures.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function parseGpxToPoints(gpxText) {
  const dom = new JSDOM(gpxText, { contentType: 'application/xml' });
  const doc = dom.window.document;

  const points = [];
  const trksegElements = doc.querySelectorAll('trkseg');

  let gpxIndex = 0;
  trksegElements.forEach((trkseg, trkSegIndex) => {
    const trkptElements = trkseg.querySelectorAll('trkpt');
    trkptElements.forEach(trkpt => {
      const lat = parseFloat(trkpt.getAttribute('lat'));
      const lon = parseFloat(trkpt.getAttribute('lon'));

      let ele = null;
      let eleAbsent = true;
      const eleEl = trkpt.querySelector('ele');
      if (eleEl && eleEl.textContent) {
        eleAbsent = false;
        ele = parseFloat(eleEl.textContent);
        if (isNaN(ele)) ele = null;
      }

      let timeMs = null;
      let timeAbsent = true;
      const timeEl = trkpt.querySelector('time');
      if (timeEl && timeEl.textContent) {
        timeAbsent = false;
        const ms = Date.parse(timeEl.textContent.trim());
        timeMs = isNaN(ms) ? null : ms;
      }

      points.push({
        gpxIndex,
        trkSegIndex,
        lat,
        lon,
        ele: eleAbsent ? null : ele,
        eleAbsent,
        timeAbsent,
        timeMs
      });

      gpxIndex++;
    });
  });

  return points;
}

function formatTime(ms) {
  if (!ms) return 'null';
  return new Date(ms).toISOString().substring(11, 19);
}

function validatePartitionInvariant(result, totalPoints) {
  const droppedSet = new Set(result.drops.map(d => d.gpxIndex));
  const excludedSet = new Set(result.excludedFromTrust.map(e => e.gpxIndex));
  const survivingSet = new Set(result.survivingGpxIndexes);

  const violations = [];
  for (let gi = 0; gi < totalPoints; gi++) {
    const inDrop = droppedSet.has(gi);
    const inExcluded = excludedSet.has(gi);
    const inSurvive = survivingSet.has(gi);
    const count = (inDrop ? 1 : 0) + (inExcluded ? 1 : 0) + (inSurvive ? 1 : 0);

    if (count === 0) {
      violations.push(`Point ${gi}: not in any collection`);
    }
    if (inDrop && inSurvive) {
      violations.push(`Point ${gi}: in both drops AND surviving (invalid)`);
    }
  }

  return violations;
}

// ── Main test ──────────────────────────────────────────────────────────────

describe('Fixture Diagnostic: Correction Layer', () => {
  const fixturesDir = path.resolve(__dirname, '../../../fixtures/correction');
  const fixtures = findAllGpxFixtures(fixturesDir);

  if (fixtures.length === 0) {
    test('fixtures directory has .gpx files', () => {
      expect(true).toBe(false);
    });
    return;
  }

  let summaryResults = [];

  for (const fixture of fixtures) {
    const testKey = fixture.relativePath.replace(/\.gpx$/, '').replace(/\\/g, '/');

    test(`${testKey}`, () => {
      let error = null;
      let invariantViolations = [];

      try {
        // Parse GPX
        const gpxContent = fs.readFileSync(fixture.path, 'utf8');
        const points = parseGpxToPoints(gpxContent);

        // Run pipeline
        const result = runCorrection({}, points, {});

        // Validate schema
        expect(result).toHaveProperty('drops');
        expect(result).toHaveProperty('excludedFromTrust');
        expect(result).toHaveProperty('survivingGpxIndexes');
        expect(result).toHaveProperty('annotations');

        // Validate partition invariant
        invariantViolations = validatePartitionInvariant(result, points.length);
        expect(invariantViolations.length).toBe(0);

        summaryResults.push({
          fixture: testKey,
          status: 'PASS',
          points: points.length,
          drops: result.drops.length,
          excluded: result.excludedFromTrust.length,
          surviving: result.survivingGpxIndexes.length,
          annotations: result.annotations.length,
          dropReasons: result.drops.map(d => d.reason),
          annotationKinds: result.annotations.map(a => a.kind)
        });

      } catch (err) {
        error = err.message;
        summaryResults.push({
          fixture: testKey,
          status: 'FAIL',
          error: error,
          invariantViolations: invariantViolations
        });
        throw err;
      }
    });
  }

  // Summary reporter
  afterAll(() => {
    const passed = summaryResults.filter(r => r.status === 'PASS');
    const failed = summaryResults.filter(r => r.status === 'FAIL');

    console.log('\n\n');
    console.log('═'.repeat(80));
    console.log('FIXTURE DIAGNOSTIC SUMMARY');
    console.log('═'.repeat(80));
    console.log(`\n✅ Passed: ${passed.length}/${summaryResults.length}`);
    console.log(`❌ Failed: ${failed.length}/${summaryResults.length}\n`);

    // Group by category
    const byCategory = {};
    for (const result of summaryResults) {
      const parts = result.fixture.split('/');
      const cat = parts[0];
      if (!byCategory[cat]) byCategory[cat] = { passed: 0, failed: 0, list: [] };
      if (result.status === 'PASS') {
        byCategory[cat].passed++;
      } else {
        byCategory[cat].failed++;
      }
      byCategory[cat].list.push(result);
    }

    console.log('By Category:\n');
    for (const [cat, info] of Object.entries(byCategory).sort()) {
      const total = info.passed + info.failed;
      const pct = Math.round(100 * info.passed / total);
      console.log(`  📁 ${cat}`);
      console.log(`     ${info.passed}/${total} passed (${pct}%)`);

      if (info.failed > 0) {
        const failures = info.list.filter(r => r.status === 'FAIL');
        for (const f of failures) {
          console.log(`     ❌ ${f.fixture.split('/').slice(1).join('/')}`);
          if (f.error) console.log(`        Error: ${f.error}`);
        }
      }
    }

    console.log('\n' + '─'.repeat(80));
    console.log('PASSED FIXTURES DETAIL:\n');

    for (const result of passed.sort((a, b) => a.fixture.localeCompare(b.fixture))) {
      console.log(`✅ ${result.fixture}`);
      console.log(`   Points: ${result.points} → Drops: ${result.drops}, Excluded: ${result.excluded}, Surviving: ${result.surviving}`);
      if (result.drops > 0) {
        console.log(`   Drop reasons: ${[...new Set(result.dropReasons)].join(', ')}`);
      }
      if (result.annotations > 0) {
        console.log(`   Annotations: ${[...new Set(result.annotationKinds)].join(', ')}`);
      }
    }

    if (failed.length > 0) {
      console.log('\n' + '─'.repeat(80));
      console.log('FAILED FIXTURES DETAIL:\n');

      for (const result of failed.sort((a, b) => a.fixture.localeCompare(b.fixture))) {
        console.log(`❌ ${result.fixture}`);
        if (result.error) {
          console.log(`   Error: ${result.error}`);
        }
        if (result.invariantViolations && result.invariantViolations.length > 0) {
          console.log(`   Invariant violations:`);
          for (const v of result.invariantViolations) {
            console.log(`     - ${v}`);
          }
        }
      }
    }

    console.log('\n' + '═'.repeat(80));
  });
});
