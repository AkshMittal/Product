# Adversarial Suite Expected Outcomes

These are assertion targets for each adversarial GPX case.

## adv-01-exact-2pct-boundary
- Title: Exactly 2% clustering boundary
- Why: Values exactly 2% apart should not merge under strict '< 0.02' rule.
- soft-expect: Clusters may split at exact 2% boundary (local-center chaining can keep one cluster) [clusterCountSorted atLeast 2]
- expect: Positive deltas are still collected [positiveDeltas eq 7]

## adv-02-near-boundary-float
- Title: Near-boundary floating precision
- Why: Very near-boundary deltas should remain stable and finite.
- soft-expect: At least two regimes may be detected (boundary precision can collapse to one cluster) [clusterCountSorted atLeast 2]
- expect: No non-finite distance rejection [motionInvalidDistance eq 0]

## adv-03-single-valid-timestamp
- Title: Single valid timestamp only
- Why: No pairs should be time-valid when only one timestamp is parseable.
- expect: No positive delta pairs [positiveDeltas eq 0]
- expect: No forward-valid motion pairs [motionForwardValid eq 0]

## adv-04-all-identical-timestamps
- Title: All timestamps identical
- Why: Should produce duplicates and zero-time-delta rejections.
- expect: Duplicate timestamps detected [duplicateTs atLeast 1]
- expect: Motion zero-delta rejections present [motionZeroDelta atLeast 1]

## adv-05-alternating-backtracking
- Title: Alternating forward/backtracking
- Why: Backtracking points should be detected repeatedly without forced block inflation.
- expect: Temporal backtracking count equals 3 [backtracking eq 3]
- expect: Motion backward pair count equals 3 [motionBackward eq 3]

## adv-06-large-forward-jump
- Title: Single large forward jump outlier
- Why: Outlier should increase max delta and often add a cluster.
- expect: Max delta includes outlier jump [maxDeltaMs atLeast 300000]
- expect: At least two clusters due to mixed regimes [clusterCountSorted atLeast 2]

## adv-07-dateline-crossing
- Title: Dateline crossing distance
- Why: Crossing +179.9/-179.9 should remain finite.
- expect: No non-finite distance rejection [motionInvalidDistance eq 0]
- expect: Forward-valid motion pairs exist [motionForwardValid eq 5]

## adv-08-polar-latitude
- Title: High-latitude geometry stress
- Why: Near-pole coordinates should still compute finite haversine distances.
- expect: No non-finite distance rejection [motionInvalidDistance eq 0]
- expect: Positive deltas exist [positiveDeltas eq 7]

## adv-09-mixed-point-types
- Title: Mixed GPX point types
- Why: Ingestion should flag multi-point-type context correctly.
- expect: Multiple point types detected [hasMultiplePointTypes eq true]
- expect: Total points include wpt+rtept+trkpt [totalPoints eq 5]

## adv-10-timestamp-format-variants
- Title: Timestamp format variants
- Why: Valid variants parse; malformed strings are counted as unparsable.
- expect: Unparsable timestamps counted [unparsableTs atLeast 2]
- expect: Still has some positive deltas [positiveDeltas atLeast 1]

## adv-11-backtracking-after-invalid-gap
- Title: Backtracking after missing/unparsable gap
- Why: Anchor-based backtracking should survive invalid timestamp gaps.
- expect: Missing timestamp present [missingTs atLeast 1]
- expect: Unparsable timestamp present [unparsableTs atLeast 1]
- expect: Backtracking is detected after invalid gap [backtracking atLeast 1]

## adv-12-large-scale-20k
- Title: Large scale 20k points
- Why: Volume stress: validates count/ratio stability at scale.
- expect: No coordinate rejections [rejectedCoords eq 0]
- expect: Expected positive delta count [positiveDeltas eq 19999]
- expect: Expected forward-valid motion count [motionForwardValid eq 19999]

## adv-13-mixed-all-anomalies
- Title: Mixed anomalies in one track
- Why: Combines ingestion reject + missing + unparsable + duplicate + backtracking.
- expect: At least one coordinate rejection [rejectedCoords atLeast 1]
- expect: Missing timestamp detected [missingTs atLeast 1]
- expect: Unparsable timestamp detected [unparsableTs atLeast 1]
- expect: Duplicate timestamp detected [duplicateTs atLeast 1]
- expect: Backtracking detected [backtracking atLeast 1]

## adv-14-multi-trkseg-backtrack
- Title: Multiple track segments with cross-segment backtrack
- Why: Ensures chronological regressions across trkseg boundaries are detected.
- expect: Backtracking detected across segments [backtracking atLeast 1]
- expect: Motion backward rejections detected [motionBackward atLeast 1]

## adv-15-static-geometry-long
- Title: Long static geometry with valid progressing time
- Why: Zero movement should remain valid and yield zero total motion distance.
- expect: No invalid distance rejections [motionInvalidDistance eq 0]
- expect: Forward-valid motion exists [motionForwardValid eq 119]
- expect: Total valid motion distance remains zero [motionTotalValidDistanceMeters eq 0]

## adv-16-boundary-lat-lon-valid
- Title: Coordinate boundary values
- Why: Latitude/longitude edge values should remain valid and finite.
- expect: No coordinate rejections [rejectedCoords eq 0]
- expect: No invalid distance rejections [motionInvalidDistance eq 0]
- expect: Positive deltas exist [positiveDeltas eq 3]

## adv-17-time-parse-fuzz
- Title: Timestamp parse fuzz
- Why: Mixes very valid and very invalid timestamp strings in one stream.
- expect: Multiple unparsable timestamps detected [unparsableTs atLeast 4]
- expect: At least one missing timestamp detected [missingTs atLeast 1]
- expect: Still yields some positive deltas [positiveDeltas atLeast 1]

## adv-18-duplicate-singletons
- Title: Duplicate singletons vs duplicate blocks
- Why: Isolated duplicate events should appear in singleton fields.
- expect: Duplicate count is 2 [duplicateTs eq 2]
- expect: Duplicate singleton count is 2 [duplicateSingles eq 2]
- expect: No duplicate block of length >1 [duplicateBlocks eq 0]

## adv-19-missing-singletons-and-block
- Title: Missing singleton and block split
- Why: Ensures single-point missing anomalies are not hidden by block summaries.
- expect: Three missing timestamps total [missingTs eq 3]
- expect: One missing block exists [missingBlocks eq 1]
- expect: One missing singleton remains visible [missingSingles eq 1]

## adv-20-seeded-random-walk
- Title: Seeded random-walk fuzz
- Why: Deterministic pseudo-random walk with sporadic anomalies for robustness.
- expect: Some positive deltas collected [positiveDeltas atLeast 50]
- expect: At least one temporal anomaly detected [missingTs atLeast 1]
- expect: No invalid-distance rejection explosion [motionInvalidDistance eq 0]
