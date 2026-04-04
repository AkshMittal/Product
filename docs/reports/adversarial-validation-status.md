# Adversarial Validation Status

> **Note (2026-04):** This file is a **historical run snapshot**. The harness and JSON schema have since moved to label-based **temporal** (`tagCounts`, `pointAnnotations`) and **motion** (`tagCounts`, `tagIndex`, `pairAnnotations`). For current field paths, see [`project/pipeline/json-schema-v2-glossary.md`](../project/pipeline/json-schema-v2-glossary.md) and `scripts/generate-gpx-adversarial-suite.js` `metric()`.

Date: 2026-03-20  
Branch: `case-study`  
Runner: `.\.tools\node-v24.13.1-win-x64\node.exe`

## Execution

Command executed:

`.\.tools\node-v24.13.1-win-x64\node.exe scripts\generate-gpx-adversarial-suite.js`

Artifacts generated/updated:

- `fixtures/adversarial-custom-test/EXPECTED.md`
- `fixtures/adversarial-custom-test/REPORT.md`
- `fixtures/adversarial-custom-test/gpx/adv-*.gpx` (20 files regenerated)

## Result Summary

Final rerun after updating adversarial harness mappings to schema v2:

- Total cases: 20
- Strict pass: 18
- Expected variance: 2
- Failed: 0
- Non-failing total: 20/20

Expected-variance cases (by design, not hard failures):

- `adv-01-exact-2pct-boundary`
- `adv-02-near-boundary-float`

Both cases are marked `EXPECTED_VARIANCE` because clustering can remain a single regime under local-center chaining at/near threshold boundaries.

## Fix Applied Before Final Rerun

Updated `scripts/generate-gpx-adversarial-suite.js` metric extraction (as of that date) toward schema v2. **Superseded mapping today:**

- ingestion: `ingestion.counts.*` (unchanged)
- temporal: `temporal.tagCounts.*`, `temporal.pointAnnotations.length` (not legacy bucket `pointCount` / `isolatedPointCount` as primary)
- sampling: `sampling.time.deltaStatistics.*`, `sampling.time.clustering.*` (see glossary for exact paths)
- motion: `motion.summary.consecutivePairCount`, `motion.tagCounts.*`, `motion.pairAnnotations`; derived clean-pair metric uses `consecutivePairCount - pairAnnotations.length` (not `evaluatedPairs.forwardValidPairCount`, `rejections.*`, `time.*`, `distance.*`, or `speed.*`)

## Current Status Decision

- Adversarial generation: COMPLETE
- Adversarial validation against expected outcomes: PASSING (no hard failures)
- Pipeline health conclusion from this suite: GOOD for currently modeled adversarial coverage

## Notes

- The suite rewrites `fixtures/adversarial-custom-test/gpx/adv-*.gpx` and writes `fixtures/adversarial-custom-test/EXPECTED.md` and `fixtures/adversarial-custom-test/REPORT.md` on each run.
- This status reflects the final rerun where the harness and pipeline schema were aligned.

