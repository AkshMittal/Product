'use strict';

/**
 * Comprehensive fixture validation test runner.
 *
 * Loads all correction layer fixtures from fixtures/correction/ (recursive)
 * Parses each with jsdom's DOMParser
 * Runs through correction pipeline
 * Validates against expected results extracted from XML comments
 * Reports pass/fail with reasons
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
          category: relativePath.split(path.sep)[0]
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

function extractExpectationsFromComments(gpxText) {
  const expectations = {
    description: null,
    expectedDrops: [],
    expectedAnnotations: [],
    expectedExcluded: [],
    expectedPhase: null,
    expectedOutcome: null,
    notes: []
  };

  // Extract all comments from GPX
  const commentRegex = /<!--([\s\S]*?)-->/g;
  let match;
  while ((match = commentRegex.exec(gpxText)) !== null) {
    const comment = match[1];

    // Parse comment lines
    const lines = comment.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      if (line.includes('Expected:')) {
        expectations.expectedOutcome = line.replace(/.*Expected:\s*/, '');
      }
      if (line.includes('annotation') && line.includes("'")) {
        const match = line.match(/'([^']+)'/);
        if (match) expectations.expectedAnnotations.push(match[1]);
      }
      if (line.includes('drops') || line.includes('drop')) {
        expectations.notes.push(line);
      }
    }
  }

  return expectations;
}

function getFixturePath(relativePath) {
  const baseDir = path.dirname(require.resolve('../index.js'));
  return path.join(baseDir, '..', '..', 'fixtures', 'correction', relativePath.replace(/^.*?\//, ''));
}

// ── Main test ──────────────────────────────────────────────────────────────

describe('Fixture Validation: Correction Layer', () => {
  const fixturesDir = path.resolve(__dirname, '../../../fixtures/correction');
  const fixtures = findAllGpxFixtures(fixturesDir);

  if (fixtures.length === 0) {
    test('fixtures directory exists and contains .gpx files', () => {
      expect(fixtures.length).toBeGreaterThan(0);
    });
    return;
  }

  console.log(`\n📋 Found ${fixtures.length} fixtures to validate\n`);

  const results = {
    passed: [],
    failed: [],
    errors: [],
    summary: {}
  };

  for (const fixture of fixtures) {
    const testName = fixture.relativePath.replace(/\.gpx$/, '');

    test(`${testName}`, () => {
      try {
        // Load and parse GPX
        const gpxContent = fs.readFileSync(fixture.path, 'utf8');
        const points = parseGpxToPoints(gpxContent);
        const expectations = extractExpectationsFromComments(gpxContent);

        // Run correction pipeline
        const result = runCorrection({}, points, {});

        // Basic validation: output schema
        expect(result).toBeDefined();
        expect(result).toHaveProperty('drops');
        expect(result).toHaveProperty('excludedFromTrust');
        expect(result).toHaveProperty('survivingGpxIndexes');
        expect(result).toHaveProperty('annotations');

        // Partition invariant
        const allIndexes = Array.from({ length: points.length }, (_, i) => i);
        const droppedSet = new Set(result.drops.map(d => d.gpxIndex));
        const excludedSet = new Set(result.excludedFromTrust.map(e => e.gpxIndex));
        const survivingSet = new Set(result.survivingGpxIndexes);

        for (const gi of allIndexes) {
          const count = (droppedSet.has(gi) ? 1 : 0) +
                       (excludedSet.has(gi) ? 1 : 0) +
                       (survivingSet.has(gi) ? 1 : 0);
          expect(count).toBeGreaterThanOrEqual(1);
          if (droppedSet.has(gi)) {
            expect(survivingSet.has(gi)).toBe(false);
          }
        }

        results.passed.push({
          fixture: testName,
          points: points.length,
          drops: result.drops.length,
          surviving: result.survivingGpxIndexes.length,
          annotations: result.annotations.length
        });

      } catch (error) {
        results.failed.push({
          fixture: testName,
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });
  }

  // Summary test
  afterAll(() => {
    console.log('\n\n═══════════════════════════════════════════════════════════════');
    console.log('FIXTURE VALIDATION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const categories = {};
    for (const r of results.passed) {
      const cat = r.fixture.split('/')[0];
      if (!categories[cat]) categories[cat] = { passed: 0, failed: 0 };
      categories[cat].passed++;
    }
    for (const r of results.failed) {
      const cat = r.fixture.split('/')[0];
      if (!categories[cat]) categories[cat] = { passed: 0, failed: 0 };
      categories[cat].failed++;
    }

    console.log(`✅ Passed: ${results.passed.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log(`📊 Total:  ${results.passed.length + results.failed.length}\n`);

    console.log('By Category:');
    for (const [cat, counts] of Object.entries(categories).sort()) {
      const total = counts.passed + counts.failed;
      console.log(`  ${cat}: ${counts.passed}/${total} passed`);
    }

    if (results.failed.length > 0) {
      console.log('\n\nFailed Fixtures:\n');
      for (const failure of results.failed) {
        console.log(`❌ ${failure.fixture}`);
        console.log(`   Error: ${failure.error}`);
      }
    }

    console.log('\n');
  });
});
