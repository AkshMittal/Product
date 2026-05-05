# Fixtures Directory

This directory contains GPX test fixtures organized by pipeline layer and module.

## Structure Overview

```
fixtures/
├── audit/              37 fixtures → 20 audit-layer tests (input parsing & per-segment detection)
│   ├── ingestion/      4 fixtures  → GPX parsing, segment boundaries
│   ├── timestamp/      8 fixtures  → Timestamp parsing, monotonicity anomalies
│   ├── sampling/       3 fixtures  → Δt density and spacing
│   ├── motion/         5 fixtures  → Speed stats, kinematic properties
│   ├── elevation/      2 fixtures  → Elevation stats
│   └── e2e-audit/      1 fixture   → Full audit pipeline (all modules)
│
├── correction/         17 fixtures → Correction-layer pipeline modules
│   ├── pre-segment/    5 categories
│   │   ├── participation/            1 fixture
│   │   ├── boundary-classification/  2 fixtures
│   │   ├── reversal-check/           1 fixture
│   │   └── deterministic-export/     1 fixture
│   │
│   ├── proposals/      3 types
│   │   ├── block/      1 fixture
│   │   ├── singleton/  (shared with block)
│   │   └── duplicate/  3 fixtures
│   │
│   ├── gates/          2 types
│   │   ├── overlap/    (verified in apply tests)
│   │   └── coupling/   (verified in apply tests)
│   │
│   ├── apply/          2 types
│   │   ├── kinematic-guard/  1 fixture
│   │   └── resolution/       (covered by proposal application)
│   │
│   ├── phases/         3 phases
│   │   ├── phase-1-multipass/  2 fixtures (≥3 iterations)
│   │   ├── phase-2-edge/       (covered in e2e tests)
│   │   └── phase-3-diagnostic/ (covered in e2e tests)
│   │
│   └── e2e/            3 fixtures (rich, multi-anomaly end-to-end)
│
└── adversarial-custom-test/  [LEGACY: migration in progress]
    ├── gpx/            (original 37 fixtures)
    └── json/           (original 37 audit output JSONs)
```

## File Format

Each fixture consists of paired files:

### Required
- `<name>.gpx` — Raw GPX input (test data)
- `<name>.audit.v2.json` — Expected audit module output (schema validation baseline)

### Optional
- `<name>.correction.v2.json` — Expected correction module output (snapshot baseline for e2e tests)

## Usage in Tests

### Loading a fixture:

```javascript
const fs = require('fs');
const path = require('path');

const fixtureDir = path.join(__dirname, '../../fixtures/audit/timestamp');
const gpxPath = path.join(fixtureDir, 'adv-03-single-valid-timestamp.gpx');
const gpxContent = fs.readFileSync(gpxPath, 'utf-8');
const expectedAudit = require(path.join(fixtureDir, 'adv-03-single-valid-timestamp.audit.v2.json'));
```

### Test pattern:

```javascript
describe('audit/timestamp', () => {
  it('detects monotonicity violations in adv-03', () => {
    const result = runAuditTimestampModule(gpxContent);
    expect(result.perSegment).toEqual(expectedAudit.perSegment);
  });
});
```

## Fixture Inventory

See `FIXTURE_ORGANIZATION.md` for detailed categorization of each fixture.
See `FIXTURE_MAPPING.md` for legacy location → new location mapping.

## Migration Status

All 37 fixtures exist in `adversarial-custom-test/`. Migration to new structure:
- [ ] Copy fixtures to organized directories (per FIXTURE_MAPPING.md)
- [ ] Update test file paths to reference new locations
- [ ] Verify all tests pass
- [ ] Mark adversarial-custom-test/ as legacy

## Test Commands

```bash
# Run all fixture-based tests
npm test

# Run fixture tests for a specific module
npx jest --testPathPattern="audit/timestamp"

# Run a single fixture test
npx jest --testPathPattern="phase-1-multipass"

# List all fixtures by category
ls -R fixtures/audit
ls -R fixtures/correction
```

## Fixture Naming Convention

- Adversarial fixtures are numbered sequentially: `adv-NN-<description>.gpx`
- Descriptive names indicate what they test:
  - `timestamp-*` → timestamp parsing and monotonicity
  - `backtracking`, `backtrack` → time-decreasing sequences
  - `boundary-*` → segment boundaries
  - `motion-*` → speed and kinematic properties
  - `duplicate-*` → adjacent-exact duplicates
  - `block-*` → monotonicity-violating runs
  - `multipass-*` → multi-iteration fixes
  - `e2e-*` → end-to-end complex scenarios
