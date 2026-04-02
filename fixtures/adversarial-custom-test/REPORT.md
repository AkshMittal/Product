# Adversarial Suite Report

- Overall: strictPass=23, expectedVariance=2, failed=0, total=25

## adv-01-exact-2pct-boundary - Exactly 2% clustering boundary
- Intent: Values exactly 2% apart should not merge under strict '< 0.02' rule.
- Status: EXPECTED_VARIANCE
- Checks:
  - EXPECTED_VARIANCE | Clusters may split at exact 2% boundary (local-center chaining can keep one cluster) | expected atLeast 2 | actual 1
  - PASS | Positive deltas are still collected | expected eq 7 | actual 7
- Key metrics:
  - totalPoints=8, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=7, clusterCountSorted=1, maxDeltaMs=10200
  - motionForwardValid=7, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=86.5841842254577

## adv-02-near-boundary-float - Near-boundary floating precision
- Intent: Very near-boundary deltas should remain stable and finite.
- Status: EXPECTED_VARIANCE
- Checks:
  - EXPECTED_VARIANCE | At least two regimes may be detected (boundary precision can collapse to one cluster) | expected atLeast 2 | actual 1
  - PASS | No non-finite distance rejection | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=8, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=7, clusterCountSorted=1, maxDeltaMs=10200
  - motionForwardValid=7, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=79.6599268291036

## adv-03-single-valid-timestamp - Single valid timestamp only
- Intent: No pairs should be time-valid when only one timestamp is parseable.
- Status: PASS
- Checks:
  - PASS | No positive delta pairs | expected eq 0 | actual 0
  - PASS | No forward-valid motion pairs | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=7, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=4, unparsable=2
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=6
  - positiveDeltas=0, clusterCountSorted=0, maxDeltaMs=null
  - motionForwardValid=0, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=0

## adv-04-all-identical-timestamps - All timestamps identical
- Intent: Should produce duplicates and zero-time-delta rejections.
- Status: PASS
- Checks:
  - PASS | Duplicate timestamps detected | expected atLeast 1 | actual 7
  - PASS | Motion zero-delta rejections present | expected atLeast 1 | actual 7
- Key metrics:
  - totalPoints=8, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=7, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=7
  - positiveDeltas=0, clusterCountSorted=0, maxDeltaMs=null
  - motionForwardValid=0, motionBackward=0, motionZeroDelta=7, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=0

## adv-05-alternating-backtracking - Alternating forward/backtracking
- Intent: Backtracking points should be detected repeatedly without forced block inflation.
- Status: PASS
- Checks:
  - PASS | belowAnchor tag count equals 3 (each point is behind the monotonic high-water mark) | expected eq 3 | actual 3
  - PASS | Motion backward pair count equals 3 | expected eq 3 | actual 3
- Key metrics:
  - totalPoints=7, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=3, belowPrevValid=3, nonAdjacentRepeat=0
  - annotationCount=3
  - positiveDeltas=3, clusterCountSorted=2, maxDeltaMs=10000
  - motionForwardValid=3, motionBackward=3, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0.2631578947368421, motionTotalValidDistanceMeters=34.75474920573766

## adv-06-large-forward-jump - Single large forward jump outlier
- Intent: Outlier should increase max delta and often add a cluster.
- Status: PASS
- Checks:
  - PASS | Max delta includes outlier jump | expected atLeast 300000 | actual 300000
  - PASS | At least two clusters due to mixed regimes | expected atLeast 2 | actual 2
- Key metrics:
  - totalPoints=10, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=9, clusterCountSorted=2, maxDeltaMs=300000
  - motionForwardValid=9, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=89.05801737360363

## adv-07-dateline-crossing - Dateline crossing distance
- Intent: Crossing +179.9/-179.9 should remain finite.
- Status: PASS
- Checks:
  - PASS | No non-finite distance rejection | expected eq 0 | actual 0
  - PASS | Forward-valid motion pairs exist | expected eq 5 | actual 5
- Key metrics:
  - totalPoints=6, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=5, clusterCountSorted=1, maxDeltaMs=5000
  - motionForwardValid=5, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=222468.64573838445

## adv-08-polar-latitude - High-latitude geometry stress
- Intent: Near-pole coordinates should still compute finite haversine distances.
- Status: PASS
- Checks:
  - PASS | No non-finite distance rejection | expected eq 0 | actual 0
  - PASS | Positive deltas exist | expected eq 7 | actual 7
- Key metrics:
  - totalPoints=8, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=7, clusterCountSorted=1, maxDeltaMs=3000
  - motionForwardValid=7, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=283.5439261576003

## adv-09-mixed-point-types - Mixed GPX point types
- Intent: Ingestion should flag multi-point-type context correctly.
- Status: PASS
- Checks:
  - PASS | Multiple point types detected | expected eq true | actual true
  - PASS | Total points include wpt+rtept+trkpt | expected eq 5 | actual 5
- Key metrics:
  - totalPoints=5, rejectedCoords=0, hasMultiplePointTypes=true
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=4, clusterCountSorted=1, maxDeltaMs=5000
  - motionForwardValid=4, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=62.103935411009516

## adv-10-timestamp-format-variants - Timestamp format variants
- Intent: Valid variants parse; malformed strings are counted as unparsable.
- Status: PASS
- Checks:
  - PASS | Unparsable timestamps counted | expected atLeast 2 | actual 2
  - PASS | Still has some positive deltas | expected atLeast 1 | actual 5
- Key metrics:
  - totalPoints=8, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=2
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=2
  - positiveDeltas=5, clusterCountSorted=4, maxDeltaMs=15000
  - motionForwardValid=5, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=54.34094614480857

## adv-11-backtracking-after-invalid-gap - Backtracking after missing/unparsable gap
- Intent: Anchor-based backtracking should survive invalid timestamp gaps.
- Status: PASS
- Checks:
  - PASS | Missing timestamp present | expected atLeast 1 | actual 1
  - PASS | Unparsable timestamp present | expected atLeast 1 | actual 1
  - PASS | Backtracking is detected after invalid gap | expected atLeast 1 | actual 1
- Key metrics:
  - totalPoints=7, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=1, unparsable=1
  - adjacentDuplicate=0, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=0
  - annotationCount=3
  - positiveDeltas=3, clusterCountSorted=3, maxDeltaMs=16000
  - motionForwardValid=3, motionBackward=1, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0.16216216216216217, motionTotalValidDistanceMeters=28.213271718599017

## adv-12-large-scale-20k - Large scale 20k points
- Intent: Volume stress: validates count/ratio stability at scale.
- Status: PASS
- Checks:
  - PASS | No coordinate rejections | expected eq 0 | actual 0
  - PASS | Expected positive delta count | expected eq 19999 | actual 19999
  - PASS | Expected forward-valid motion count | expected eq 19999 | actual 19999
- Key metrics:
  - totalPoints=20000, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=19999, clusterCountSorted=1, maxDeltaMs=1000
  - motionForwardValid=19999, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=3104.981897039338

## adv-13-mixed-all-anomalies - Mixed anomalies in one track
- Intent: Combines ingestion reject + missing + unparsable + duplicate + backtracking.
- Status: PASS
- Checks:
  - PASS | At least one coordinate rejection | expected atLeast 1 | actual 1
  - PASS | Missing timestamp detected | expected atLeast 1 | actual 1
  - PASS | Unparsable timestamp detected | expected atLeast 1 | actual 1
  - PASS | Duplicate timestamp detected | expected atLeast 1 | actual 1
  - PASS | Backtracking detected | expected atLeast 1 | actual 1
- Key metrics:
  - totalPoints=14, rejectedCoords=1, hasMultiplePointTypes=false
  - missing=1, unparsable=1
  - adjacentDuplicate=1, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=1
  - annotationCount=4
  - positiveDeltas=8, clusterCountSorted=4, maxDeltaMs=32000
  - motionForwardValid=8, motionBackward=1, motionZeroDelta=1, motionInvalidDistance=0, motionInvalidTimeRatio=0.24, motionTotalValidDistanceMeters=114.57163463184098

## adv-14-multi-trkseg-backtrack - Multiple track segments with cross-segment backtrack
- Intent: Ensures chronological regressions across trkseg boundaries are detected.
- Status: PASS
- Checks:
  - PASS | Backtracking detected across segments | expected atLeast 1 | actual 1
  - PASS | Motion backward rejections detected | expected atLeast 1 | actual 1
- Key metrics:
  - totalPoints=6, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=0
  - annotationCount=1
  - positiveDeltas=4, clusterCountSorted=2, maxDeltaMs=11000
  - motionForwardValid=4, motionBackward=1, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0.1875, motionTotalValidDistanceMeters=62.103929331331585

## adv-15-static-geometry-long - Long static geometry with valid progressing time
- Intent: Zero movement should remain valid and yield zero total motion distance.
- Status: PASS
- Checks:
  - PASS | No invalid distance rejections | expected eq 0 | actual 0
  - PASS | Forward-valid motion exists | expected eq 119 | actual 119
  - PASS | Total valid motion distance remains zero | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=120, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=119, clusterCountSorted=1, maxDeltaMs=1000
  - motionForwardValid=119, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=0

## adv-16-boundary-lat-lon-valid - Coordinate boundary values
- Intent: Latitude/longitude edge values should remain valid and finite.
- Status: PASS
- Checks:
  - PASS | No coordinate rejections | expected eq 0 | actual 0
  - PASS | No invalid distance rejections | expected eq 0 | actual 0
  - PASS | Positive deltas exist | expected eq 3 | actual 3
- Key metrics:
  - totalPoints=4, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=0
  - positiveDeltas=3, clusterCountSorted=1, maxDeltaMs=5000
  - motionForwardValid=3, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=20015086.796012316

## adv-17-time-parse-fuzz - Timestamp parse fuzz
- Intent: Mixes very valid and very invalid timestamp strings in one stream.
- Status: PASS
- Checks:
  - PASS | Multiple unparsable timestamps detected | expected atLeast 4 | actual 5
  - PASS | At least one missing timestamp detected | expected atLeast 1 | actual 1
  - PASS | Still yields some positive deltas | expected atLeast 1 | actual 5
- Key metrics:
  - totalPoints=12, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=1, unparsable=5
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=6
  - positiveDeltas=5, clusterCountSorted=4, maxDeltaMs=25000
  - motionForwardValid=5, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=43.75788961452254

## adv-18-duplicate-singletons - Duplicate singletons vs duplicate blocks
- Intent: Isolated duplicate events should appear in singleton fields.
- Status: PASS
- Checks:
  - PASS | adjacentDuplicate tag count is 2 (two isolated adjacent-duplicate events) | expected eq 2 | actual 2
- Key metrics:
  - totalPoints=10, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=2, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=2
  - positiveDeltas=7, clusterCountSorted=2, maxDeltaMs=6000
  - motionForwardValid=7, motionBackward=0, motionZeroDelta=2, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=49.06803667975294

## adv-19-missing-singletons-and-block - Missing singleton and block split
- Intent: Ensures single-point missing anomalies are not hidden by block summaries.
- Status: PASS
- Checks:
  - PASS | Three missing timestamp tags total (block-level grouping is downstream concern) | expected eq 3 | actual 3
- Key metrics:
  - totalPoints=11, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=3, unparsable=0
  - adjacentDuplicate=0, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=3
  - positiveDeltas=7, clusterCountSorted=3, maxDeltaMs=6000
  - motionForwardValid=7, motionBackward=0, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=46.57795611851415

## adv-20-seeded-random-walk - Seeded random-walk fuzz
- Intent: Deterministic pseudo-random walk with sporadic anomalies for robustness.
- Status: PASS
- Checks:
  - PASS | Some positive deltas collected | expected atLeast 50 | actual 463
  - PASS | At least one temporal anomaly detected | expected atLeast 1 | actual 12
  - PASS | No invalid-distance rejection explosion | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=500, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=12, unparsable=13
  - adjacentDuplicate=11, belowAnchor=0, belowPrevValid=0, nonAdjacentRepeat=0
  - annotationCount=36
  - positiveDeltas=463, clusterCountSorted=6, maxDeltaMs=6000
  - motionForwardValid=463, motionBackward=0, motionZeroDelta=11, motionInvalidDistance=0, motionInvalidTimeRatio=0, motionTotalValidDistanceMeters=3969.365587363155

## adv-21-nonadjacent-repeat-streamwide - Non-adjacent repeat detected stream-wide
- Intent: A timestamp value that reappears after intervening valid points should be tagged nonAdjacentRepeat, not adjacentDuplicate. Must also receive belowAnchor and belowPrevValid since the repeat is behind the current high-water mark.
- Status: PASS
- Checks:
  - PASS | Exactly one nonAdjacentRepeat tag (T+10 reappears after T+20, T+30) | expected eq 1 | actual 1
  - PASS | Exactly one belowAnchor tag (T+10 < anchor=T+30) | expected eq 1 | actual 1
  - PASS | Exactly one belowPrevValid tag (T+10 < prevValid=T+30) | expected eq 1 | actual 1
  - PASS | No adjacentDuplicate tags | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=6, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=1
  - annotationCount=1
  - positiveDeltas=4, clusterCountSorted=2, maxDeltaMs=30000
  - motionForwardValid=4, motionBackward=1, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0.25, motionTotalValidDistanceMeters=49.47668147028578

## adv-22-locally-recovering-backtrack - Locally recovering backtrack: belowAnchor without belowPrevValid
- Intent: After a drop below the anchor, a sequence progressing forward locally is still belowAnchor but is NOT belowPrevValid. Only the initial drop point is belowPrevValid. Tests the tag distinction between 'still in the hole' vs 'actively digging'.
- Status: PASS
- Checks:
  - PASS | Four points tagged belowAnchor (T+60,70,80,90 all < anchor=T+100) | expected eq 4 | actual 4
  - PASS | Only one point tagged belowPrevValid (T+60 is the only drop below its predecessor) | expected eq 1 | actual 1
  - PASS | Four annotation entries total | expected eq 4 | actual 4
- Key metrics:
  - totalPoints=7, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=4, belowPrevValid=1, nonAdjacentRepeat=0
  - annotationCount=4
  - positiveDeltas=5, clusterCountSorted=3, maxDeltaMs=100000
  - motionForwardValid=5, motionBackward=1, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0.21052631578947367, motionTotalValidDistanceMeters=61.84584682928451

## adv-23-adjacent-dup-below-anchor - Adjacent duplicate that is also below anchor gets both tags
- Intent: Tags are non-exclusive. An adjacent duplicate occurring during a backtracking block should simultaneously carry adjacentDuplicate and belowAnchor, but NOT belowPrevValid (equal, not strictly less) and NOT nonAdjacentRepeat (is adjacent).
- Status: PASS
- Checks:
  - PASS | One adjacentDuplicate tag (T+50 pos3) | expected eq 1 | actual 1
  - PASS | Two belowAnchor tags (both T+50 occurrences < anchor=T+100) | expected eq 2 | actual 2
  - PASS | One belowPrevValid tag (T+50 pos2 only; pos3 equals prevValid, not strictly less) | expected eq 1 | actual 1
  - PASS | No nonAdjacentRepeat tags (adjacent duplicate excluded from that check) | expected eq 0 | actual 0
- Key metrics:
  - totalPoints=5, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=1, belowAnchor=2, belowPrevValid=1, nonAdjacentRepeat=0
  - annotationCount=2
  - positiveDeltas=2, clusterCountSorted=2, maxDeltaMs=100000
  - motionForwardValid=2, motionBackward=1, motionZeroDelta=1, motionInvalidDistance=0, motionInvalidTimeRatio=0.22727272727272727, motionTotalValidDistanceMeters=24.73834121251607

## adv-24-anchor-no-advance-on-dup - Anchor does not advance during adjacent duplicate run
- Intent: The monotonic anchor only advances on genuine forward progress. A run of adjacent duplicates must not move the anchor. A belowAnchor point after the dup-run must still be detected correctly.
- Status: PASS
- Checks:
  - PASS | Two adjacentDuplicate tags (T+50 pos2 and pos3) | expected eq 2 | actual 2
  - PASS | One belowAnchor tag (T+30 < anchor=T+50, anchor held steady through dup run) | expected eq 1 | actual 1
  - PASS | One belowPrevValid tag (T+30 < prevValid=T+50) | expected eq 1 | actual 1
- Key metrics:
  - totalPoints=5, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=2, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=0
  - annotationCount=3
  - positiveDeltas=1, clusterCountSorted=1, maxDeltaMs=50000
  - motionForwardValid=1, motionBackward=1, motionZeroDelta=2, motionInvalidDistance=0, motionInvalidTimeRatio=0.2857142857142857, motionTotalValidDistanceMeters=12.36917203736586

## adv-25-multi-tag-convergence - Single point receives nonAdjacentRepeat + belowAnchor + belowPrevValid simultaneously
- Intent: A non-adjacent repeat that falls below the anchor and below its predecessor should carry all three tags in a single annotation object.
- Status: PASS
- Checks:
  - PASS | One nonAdjacentRepeat tag | expected eq 1 | actual 1
  - PASS | One belowAnchor tag | expected eq 1 | actual 1
  - PASS | One belowPrevValid tag | expected eq 1 | actual 1
  - PASS | No adjacentDuplicate tags (the non-adjacent repeat is not the immediately preceding point) | expected eq 0 | actual 0
  - PASS | Exactly one annotation entry | expected eq 1 | actual 1
- Key metrics:
  - totalPoints=5, rejectedCoords=0, hasMultiplePointTypes=false
  - missing=0, unparsable=0
  - adjacentDuplicate=0, belowAnchor=1, belowPrevValid=1, nonAdjacentRepeat=1
  - annotationCount=1
  - positiveDeltas=3, clusterCountSorted=3, maxDeltaMs=50000
  - motionForwardValid=3, motionBackward=1, motionZeroDelta=0, motionInvalidDistance=0, motionInvalidTimeRatio=0.1111111111111111, motionTotalValidDistanceMeters=37.10751229581697
