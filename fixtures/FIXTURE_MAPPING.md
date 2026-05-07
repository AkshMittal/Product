# Fixture Mapping: Old → New Structure

When migrating fixtures from `adversarial-custom-test/` to the new organization, use this table.

## Audit Layer

### audit/ingestion/ — GPX parsing & segment boundary detection
```
adv-01-exact-2pct-boundary.gpx          → fixtures/audit/ingestion/
adv-01-exact-2pct-boundary.audit.v2.json

adv-02-near-boundary-float.gpx          → fixtures/audit/ingestion/
adv-02-near-boundary-float.audit.v2.json

adv-09-mixed-point-types.gpx            → fixtures/audit/ingestion/
adv-09-mixed-point-types.audit.v2.json

adv-31-single-trackpoint.gpx            → fixtures/audit/ingestion/
adv-31-single-trackpoint.audit.v2.json
```

### audit/timestamp/ — Timestamp parsing & monotonicity detection
```
adv-03-single-valid-timestamp.gpx       → fixtures/audit/timestamp/
adv-03-single-valid-timestamp.audit.v2.json

adv-04-all-identical-timestamps.gpx     → fixtures/audit/timestamp/
adv-04-all-identical-timestamps.audit.v2.json

adv-05-alternating-backtracking.gpx     → fixtures/audit/timestamp/
adv-05-alternating-backtracking.audit.v2.json

adv-10-timestamp-format-variants.gpx    → fixtures/audit/timestamp/
adv-10-timestamp-format-variants.audit.v2.json

adv-11-backtracking-after-invalid-gap.gpx → fixtures/audit/timestamp/
adv-11-backtracking-after-invalid-gap.audit.v2.json

adv-33-empty-time-element-mid-track.gpx → fixtures/audit/timestamp/
adv-33-empty-time-element-mid-track.audit.v2.json

adv-34-missing-time-vs-empty-time.gpx   → fixtures/audit/timestamp/
adv-34-missing-time-vs-empty-time.audit.v2.json

adv-35-time-whitespace-only-body.gpx    → fixtures/audit/timestamp/
adv-35-time-whitespace-only-body.audit.v2.json
```

### audit/sampling/ — Δt density & spacing
```
adv-06-large-forward-jump.gpx           → fixtures/audit/sampling/
adv-06-large-forward-jump.audit.v2.json

adv-07-dateline-crossing.gpx            → fixtures/audit/sampling/
adv-07-dateline-crossing.audit.v2.json

adv-37-reject-mid-track-sampling-motion-pair-counts.gpx → fixtures/audit/sampling/
adv-37-reject-mid-track-sampling-motion-pair-counts.audit.v2.json
```

### audit/motion/ — Speed stats & kinematic properties
```
adv-26-motion-ele-boundary-inclusive.gpx → fixtures/audit/motion/
adv-26-motion-ele-boundary-inclusive.audit.v2.json

adv-27-motion-ele-above-ceiling.gpx     → fixtures/audit/motion/
adv-27-motion-ele-above-ceiling.audit.v2.json

adv-28-motion-omit-ele-element.gpx      → fixtures/audit/motion/
adv-28-motion-omit-ele-element.audit.v2.json

adv-29-motion-stacked-backward-and-elebad.gpx → fixtures/audit/motion/
adv-29-motion-stacked-backward-and-elebad.audit.v2.json

adv-30-motion-mixed-time-backward-zero.gpx → fixtures/audit/motion/
adv-30-motion-mixed-time-backward-zero.audit.v2.json
```

### audit/elevation/ — Elevation stats
```
adv-08-polar-latitude.gpx               → fixtures/audit/elevation/
adv-08-polar-latitude.audit.v2.json

adv-32-unparsable-ele-element.gpx       → fixtures/audit/elevation/
adv-32-unparsable-ele-element.audit.v2.json
```

### audit/e2e-audit/ — Full audit pipeline
```
adv-12-large-scale-20k.gpx              → fixtures/audit/e2e-audit/
adv-12-large-scale-20k.audit.v2.json
```

---

## Correction Layer

### correction/pre-segment/participation/ — Segment classification
```
adv-15-static-geometry-long.gpx         → fixtures/correction/pre-segment/participation/
adv-15-static-geometry-long.audit.v2.json
```

### correction/pre-segment/boundary-classification/ — Inter-segment boundaries
```
adv-16-boundary-lat-lon-valid.gpx       → fixtures/correction/pre-segment/boundary-classification/
adv-16-boundary-lat-lon-valid.audit.v2.json

adv-36-gpx-gap-same-time-non-adjacent-dup.gpx → fixtures/correction/pre-segment/boundary-classification/
adv-36-gpx-gap-same-time-non-adjacent-dup.audit.v2.json
```

### correction/pre-segment/reversal-check/ — Time-decreasing segment detection
```
adv-14-multi-trkseg-backtrack.gpx       → fixtures/correction/pre-segment/reversal-check/
adv-14-multi-trkseg-backtrack.audit.v2.json
```

### correction/pre-segment/deterministic-export/ — Chunk reordering & annotations
```
adv-17-time-parse-fuzz.gpx              → fixtures/correction/pre-segment/deterministic-export/
adv-17-time-parse-fuzz.audit.v2.json
```

### correction/proposals/block/ — Monotonicity-violating runs
```
adv-19-missing-singletons-and-block.gpx → fixtures/correction/proposals/block/
adv-19-missing-singletons-and-block.audit.v2.json
```

### correction/proposals/singleton/ — Isolated out-of-order points
```
adv-19-missing-singletons-and-block.gpx → fixtures/correction/proposals/singleton/
adv-19-missing-singletons-and-block.audit.v2.json
(Shared with block; no separate fixture needed)
```

### correction/proposals/duplicate/ — Adjacent-exact duplicates
```
adv-18-duplicate-singletons.gpx         → fixtures/correction/proposals/duplicate/
adv-18-duplicate-singletons.audit.v2.json

adv-23-adjacent-dup-below-anchor.gpx    → fixtures/correction/proposals/duplicate/
adv-23-adjacent-dup-below-anchor.audit.v2.json

adv-24-anchor-no-advance-on-dup.gpx     → fixtures/correction/proposals/duplicate/
adv-24-anchor-no-advance-on-dup.audit.v2.json
```

### correction/apply/kinematic-guard/ — Kinematic guard disposition
```
adv-27-motion-ele-above-ceiling.gpx     → fixtures/correction/apply/kinematic-guard/
adv-27-motion-ele-above-ceiling.audit.v2.json
```

### correction/phases/phase-1-multipass/ — Multipass ≥3 iterations
```
adv-22-locally-recovering-backtrack.gpx → fixtures/correction/phases/phase-1-multipass/
adv-22-locally-recovering-backtrack.audit.v2.json

adv-25-multi-tag-convergence.gpx        → fixtures/correction/phases/phase-1-multipass/
adv-25-multi-tag-convergence.audit.v2.json
```

### correction/e2e/ — Rich end-to-end fixtures
```
adv-13-mixed-all-anomalies.gpx          → fixtures/correction/e2e/
adv-13-mixed-all-anomalies.audit.v2.json

adv-20-seeded-random-walk.gpx           → fixtures/correction/e2e/
adv-20-seeded-random-walk.audit.v2.json

adv-21-nonadjacent-repeat-streamwide.gpx → fixtures/correction/e2e/
adv-21-nonadjacent-repeat-streamwide.audit.v2.json
```

---

## Summary

- **37 fixtures** total (19 audit-focused, 18 correction-focused)
- **audit/** — 20 fixtures across 6 modules + 1 e2e
- **correction/** — 17 fixtures across 4 pre-segment + 3 proposals + 3 phases + 3 e2e
- Old location: `fixtures/adversarial-custom-test/{gpx,json}/`
- New structure: organized by layer → module → concern
- Each fixture has paired `.gpx` + `.audit.v2.json` files
- Optional: `.correction.v2.json` added per-test as snapshot baselines
