/**
 * Timestamp Audit Module
 * Observational audit pass for timestamp data in GPX points
 * Does NOT mutate, reorder, or normalize timestamps
 */

/**
 * Audits timestamps in an array of points
 * Uses anchor-based monotonic detection for backtracking blocks
 * @param {Array} points - Array of point objects with timeRaw property
 * @returns {Object} Audit metadata object with counters
 */
function auditTimestamps(points) {
  // Initialize counters
  const totalPointsChecked = points.length;
  let missingTimestampCount = 0;
  let unparsableTimestampCount = 0;
  let duplicateTimestampCount = 0;
  let strictlyIncreasingCount = 0; // Points in increasing order
  let maxBacktrackingDepthMs = null; // null if no backtracking observed
  
  // Collect flagged events
  const missingTimestampEvents = [];
  const backtrackingPointEvents = [];
  const duplicateTimestampEvents = [];
  
  // Anchor-based backtracking detection
  let anchorTimestampMs = null; // Monotonic high-water mark; only advances on forward movement
  const backtrackingBlocks = [];
  let totalBacktrackingPoints = 0;
  
  // Current backtracking block state
  let inBlock = false;
  let currentBlockStartIndex = null;
  let currentBlockEndIndex = null;
  let currentBlockLength = 0;
  let currentBlockMaxDepthMs = 0;
  
  // Contiguous duplicate timestamp block detection
  const duplicateTimestampBlocks = [];
  let inDuplicateBlock = false;
  let currentDuplicateBlockStartIndex = null;
  let currentDuplicateBlockEndIndex = null;
  let currentDuplicateBlockLength = 0;
  let currentDuplicateBlockTime = null;
  
  // Contiguous missing timestamp block detection
  const missingTimestampBlocks = [];
  let inMissingBlock = false;
  let currentMissingBlockStartIndex = null;
  let currentMissingBlockEndIndex = null;
  let currentMissingBlockLength = 0;
  
  // Contiguous unparsable timestamp block detection
  const unparsableTimestampBlocks = [];
  const unparsableTimestampEvents = [];
  let inUnparsableBlock = false;
  let currentUnparsableBlockStartIndex = null;
  let currentUnparsableBlockEndIndex = null;
  let currentUnparsableBlockLength = 0;
  
  // Raw session duration tracking
  let firstValidTimestampMs = null;
  
  let lastValidTimestampMs = null;
  let lastValidTimestampGpxIndex = null;
  let lastValidTimestampRaw = null;
  
  // Helper to format time for display
  const formatTime = (timeRaw) => {
    if (!timeRaw) return '';
    const d = new Date(timeRaw);
    if (isNaN(d.getTime())) return timeRaw;
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };
  
  // Iterate through all points
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const currentGpxIndex = point.gpxIndex;
    const timeRaw = point.timeRaw;
    
    // Check for missing timestamp
    if (timeRaw === null) {
      missingTimestampCount++;
      missingTimestampEvents.push({
        index: currentGpxIndex
      });
      if (!inMissingBlock) {
        inMissingBlock = true;
        currentMissingBlockStartIndex = currentGpxIndex;
        currentMissingBlockEndIndex = currentGpxIndex;
        currentMissingBlockLength = 1;
      } else {
        currentMissingBlockEndIndex = currentGpxIndex;
        currentMissingBlockLength++;
      }
      continue; // Skip comparison for missing timestamps
    }
    
    // Close open missing-timestamp block (only keep blocks with length > 1)
    if (inMissingBlock) {
      if (currentMissingBlockLength > 1) {
        missingTimestampBlocks.push({
          startIndex: currentMissingBlockStartIndex,
          endIndex: currentMissingBlockEndIndex,
          length: currentMissingBlockLength
        });
      }
      inMissingBlock = false;
      currentMissingBlockStartIndex = null;
      currentMissingBlockEndIndex = null;
      currentMissingBlockLength = 0;
    }
    
    // Attempt to parse timestamp
    const timestampMs = Date.parse(timeRaw);
    
    // Check if parsing failed
    if (isNaN(timestampMs)) {
      unparsableTimestampCount++;
      unparsableTimestampEvents.push({
        index: currentGpxIndex,
        rawTime: timeRaw
      });
      if (!inUnparsableBlock) {
        inUnparsableBlock = true;
        currentUnparsableBlockStartIndex = currentGpxIndex;
        currentUnparsableBlockEndIndex = currentGpxIndex;
        currentUnparsableBlockLength = 1;
      } else {
        currentUnparsableBlockEndIndex = currentGpxIndex;
        currentUnparsableBlockLength++;
      }
      continue; // Skip comparison for unparsable timestamps
    }
    
    // Close open unparsable-timestamp block (only keep blocks with length > 1)
    if (inUnparsableBlock) {
      if (currentUnparsableBlockLength > 1) {
        unparsableTimestampBlocks.push({
          startIndex: currentUnparsableBlockStartIndex,
          endIndex: currentUnparsableBlockEndIndex,
          length: currentUnparsableBlockLength
        });
      }
      inUnparsableBlock = false;
      currentUnparsableBlockStartIndex = null;
      currentUnparsableBlockEndIndex = null;
      currentUnparsableBlockLength = 0;
    }
    
    // Track first valid timestamp (set once)
    if (firstValidTimestampMs === null) {
      firstValidTimestampMs = timestampMs;
    }
    
    // At this point, we have a valid parsed timestamp
    // Compare with last valid timestamp (if exists)
    if (lastValidTimestampMs !== null) {
      // Check for duplicate timestamp (equal to previous valid)
      if (timestampMs === lastValidTimestampMs) {
        duplicateTimestampCount++;
        duplicateTimestampEvents.push({
          index: currentGpxIndex,
          prevIndex: lastValidTimestampGpxIndex,
          time: formatTime(timeRaw)
        });
        // Track duplicate timestamp block
        if (!inDuplicateBlock) {
          inDuplicateBlock = true;
          // Backtracking-style semantics:
          // first duplicate event remains singleton unless another duplicate follows.
          currentDuplicateBlockStartIndex = currentGpxIndex;
          currentDuplicateBlockEndIndex = currentGpxIndex;
          currentDuplicateBlockLength = 1;
          currentDuplicateBlockTime = formatTime(timeRaw);
        } else {
          currentDuplicateBlockEndIndex = currentGpxIndex;
          currentDuplicateBlockLength++;
        }
      }
      // Forward: timestamp at or above anchor
      else if (timestampMs >= anchorTimestampMs) {
        strictlyIncreasingCount++;
        
        // Close open duplicate timestamp block if any (only keep blocks with length > 1)
        if (inDuplicateBlock) {
          if (currentDuplicateBlockLength > 1) {
            duplicateTimestampBlocks.push({
              startIndex: currentDuplicateBlockStartIndex,
              endIndex: currentDuplicateBlockEndIndex,
              length: currentDuplicateBlockLength,
              time: currentDuplicateBlockTime
            });
          }
          inDuplicateBlock = false;
          currentDuplicateBlockStartIndex = null;
          currentDuplicateBlockEndIndex = null;
          currentDuplicateBlockLength = 0;
          currentDuplicateBlockTime = null;
        }
        
        // Close open backtracking block if any (only keep blocks with length > 1)
        if (inBlock) {
          if (currentBlockLength > 1) {
            backtrackingBlocks.push({
              startIndex: currentBlockStartIndex,
              endIndex: currentBlockEndIndex,
              length: currentBlockLength,
              maxDepthFromAnchorMs: currentBlockMaxDepthMs
            });
          }
          inBlock = false;
          currentBlockStartIndex = null;
          currentBlockEndIndex = null;
          currentBlockLength = 0;
          currentBlockMaxDepthMs = 0;
        }
        
        // Update anchor to new high-water mark
        anchorTimestampMs = timestampMs;
      }
      // Backtracking: timestamp below anchor
      else {
        // Close open duplicate timestamp block if any (only keep blocks with length > 1)
        if (inDuplicateBlock) {
          if (currentDuplicateBlockLength > 1) {
            duplicateTimestampBlocks.push({
              startIndex: currentDuplicateBlockStartIndex,
              endIndex: currentDuplicateBlockEndIndex,
              length: currentDuplicateBlockLength,
              time: currentDuplicateBlockTime
            });
          }
          inDuplicateBlock = false;
          currentDuplicateBlockStartIndex = null;
          currentDuplicateBlockEndIndex = null;
          currentDuplicateBlockLength = 0;
          currentDuplicateBlockTime = null;
        }
        
        totalBacktrackingPoints++;
        
        const depth = anchorTimestampMs - timestampMs;
        
        // Update maxBacktrackingDepthMs (global max across all blocks)
        if (maxBacktrackingDepthMs === null || depth > maxBacktrackingDepthMs) {
          maxBacktrackingDepthMs = depth;
        }
        
        // Track backtracking block
        if (!inBlock) {
          // Start new block
          inBlock = true;
          currentBlockStartIndex = currentGpxIndex;
          currentBlockEndIndex = currentGpxIndex;
          currentBlockLength = 1;
          currentBlockMaxDepthMs = depth;
        } else {
          // Continue existing block
          currentBlockEndIndex = currentGpxIndex;
          currentBlockLength++;
          if (depth > currentBlockMaxDepthMs) {
            currentBlockMaxDepthMs = depth;
          }
        }
        
        // Log backtracking event
        backtrackingPointEvents.push({
          index: currentGpxIndex,
          prevIndex: lastValidTimestampGpxIndex,
          prevTime: formatTime(lastValidTimestampRaw),
          currTime: formatTime(timeRaw)
        });
      }
    } else {
      // First valid timestamp: initialize anchor
      anchorTimestampMs = timestampMs;
    }
    
    // Update last valid timestamp for next comparison
    lastValidTimestampMs = timestampMs;
    lastValidTimestampGpxIndex = currentGpxIndex;
    lastValidTimestampRaw = timeRaw;
  }
  
  // Close any open duplicate timestamp block at end of file (only keep blocks with length > 1)
  if (inDuplicateBlock && currentDuplicateBlockLength > 1) {
    duplicateTimestampBlocks.push({
      startIndex: currentDuplicateBlockStartIndex,
      endIndex: currentDuplicateBlockEndIndex,
      length: currentDuplicateBlockLength,
      time: currentDuplicateBlockTime
    });
  }
  
  // Compute largest duplicate timestamp block length
  let largestDuplicateTimestampBlockLength = 0;
  for (let db = 0; db < duplicateTimestampBlocks.length; db++) {
    if (duplicateTimestampBlocks[db].length > largestDuplicateTimestampBlockLength) {
      largestDuplicateTimestampBlockLength = duplicateTimestampBlocks[db].length;
    }
  }
  
  // Close any open missing-timestamp block at end of file (only keep blocks with length > 1)
  if (inMissingBlock && currentMissingBlockLength > 1) {
    missingTimestampBlocks.push({
      startIndex: currentMissingBlockStartIndex,
      endIndex: currentMissingBlockEndIndex,
      length: currentMissingBlockLength
    });
  }
  
  // Compute largest missing-timestamp block length
  let largestMissingTimestampBlockLength = 0;
  for (let mb = 0; mb < missingTimestampBlocks.length; mb++) {
    if (missingTimestampBlocks[mb].length > largestMissingTimestampBlockLength) {
      largestMissingTimestampBlockLength = missingTimestampBlocks[mb].length;
    }
  }
  
  // Close any open backtracking block at end of file (only keep blocks with length > 1)
  if (inBlock && currentBlockLength > 1) {
    backtrackingBlocks.push({
      startIndex: currentBlockStartIndex,
      endIndex: currentBlockEndIndex,
      length: currentBlockLength,
      maxDepthFromAnchorMs: currentBlockMaxDepthMs
    });
  }
  
  // Close any open unparsable-timestamp block at end of file (only keep blocks with length > 1)
  if (inUnparsableBlock && currentUnparsableBlockLength > 1) {
    unparsableTimestampBlocks.push({
      startIndex: currentUnparsableBlockStartIndex,
      endIndex: currentUnparsableBlockEndIndex,
      length: currentUnparsableBlockLength
    });
  }
  
  // Compute largest unparsable-timestamp block length
  let largestUnparsableTimestampBlockLength = 0;
  for (let ub = 0; ub < unparsableTimestampBlocks.length; ub++) {
    if (unparsableTimestampBlocks[ub].length > largestUnparsableTimestampBlockLength) {
      largestUnparsableTimestampBlockLength = unparsableTimestampBlocks[ub].length;
    }
  }
  
  // Compute largest backtracking block length
  let largestBacktrackingBlockLength = 0;
  for (let b = 0; b < backtrackingBlocks.length; b++) {
    if (backtrackingBlocks[b].length > largestBacktrackingBlockLength) {
      largestBacktrackingBlockLength = backtrackingBlocks[b].length;
    }
  }
  
  // Raw session duration: last valid timestamp - first valid timestamp (in original point order)
  let rawSessionDurationSec = null;
  if (firstValidTimestampMs !== null && lastValidTimestampMs !== null) {
    rawSessionDurationSec = (lastValidTimestampMs - firstValidTimestampMs) / 1000;
  }
  
  // Build audit metadata object
  const validParsedTimestampCount =
    totalPointsChecked - missingTimestampCount - unparsableTimestampCount;
  const missingTimestampRatio = totalPointsChecked > 0 ? missingTimestampCount / totalPointsChecked : 0;
  const unparsableTimestampRatio = totalPointsChecked > 0 ? unparsableTimestampCount / totalPointsChecked : 0;
  const duplicateTimestampRatio = totalPointsChecked > 0 ? duplicateTimestampCount / totalPointsChecked : 0;

  // Build singleton-only anomaly views (events not included in any length>1 block).
  const collectBlockIndices = (blocks) => {
    const blockIndexSet = new Set();
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      for (let idx = block.startIndex; idx <= block.endIndex; idx++) {
        blockIndexSet.add(idx);
      }
    }
    return blockIndexSet;
  };

  const filterSingletonEvents = (events, blocks) => {
    const blockedIndices = collectBlockIndices(blocks);
    const singletonEvents = [];
    for (let ei = 0; ei < events.length; ei++) {
      const event = events[ei];
      if (!blockedIndices.has(event.index)) {
        singletonEvents.push(event);
      }
    }
    return singletonEvents;
  };

  const missingTimestampSinglePointEvents =
    filterSingletonEvents(missingTimestampEvents, missingTimestampBlocks);
  const unparsableTimestampSinglePointEvents =
    filterSingletonEvents(unparsableTimestampEvents, unparsableTimestampBlocks);
  const duplicateTimestampSinglePointEvents =
    filterSingletonEvents(duplicateTimestampEvents, duplicateTimestampBlocks);
  const backtrackingSinglePointEvents =
    filterSingletonEvents(backtrackingPointEvents, backtrackingBlocks);

  const auditMetadata = {
    audit: {
      temporal: {
        totalPointsEvaluated: totalPointsChecked,
        session: {
          rawSessionDurationSec: rawSessionDurationSec,
          parseableTimestampPointCount: validParsedTimestampCount
        },
        temporalOrder: {
          monotonicForwardCount: strictlyIncreasingCount,
          missing: {
            pointCount: missingTimestampCount,
            pointCountOverTotalPointsRatio: missingTimestampRatio,
            maxBlockLength: largestMissingTimestampBlockLength,
            blocks: missingTimestampBlocks,
            isolatedPointCount: missingTimestampSinglePointEvents.length,
            isolatedPointEvents: missingTimestampSinglePointEvents
          },
          unparsable: {
            pointCount: unparsableTimestampCount,
            pointCountOverTotalPointsRatio: unparsableTimestampRatio,
            maxBlockLength: largestUnparsableTimestampBlockLength,
            blocks: unparsableTimestampBlocks,
            isolatedPointCount: unparsableTimestampSinglePointEvents.length,
            isolatedPointEvents: unparsableTimestampSinglePointEvents
          },
          duplicate: {
            pointCount: duplicateTimestampCount,
            pointCountOverTotalPointsRatio: duplicateTimestampRatio,
            maxBlockLength: largestDuplicateTimestampBlockLength,
            blocks: duplicateTimestampBlocks,
            isolatedPointCount: duplicateTimestampSinglePointEvents.length,
            isolatedPointEvents: duplicateTimestampSinglePointEvents
          },
          backtracking: {
            pointCount: totalBacktrackingPoints,
            maxDepthFromAnchorMs: maxBacktrackingDepthMs,
            maxBlockLength: largestBacktrackingBlockLength,
            blocks: backtrackingBlocks,
            isolatedPointCount: backtrackingSinglePointEvents.length,
            isolatedPointEvents: backtrackingSinglePointEvents
          }
        }
      }
    }
  };
  
  // // TEMPORARY: Backtracking block detection verification
  // console.log('=== Backtracking Block Detection ===');
  // console.log('totalBacktrackingPoints:', totalBacktrackingPoints);
  // console.log('maxBacktrackingDepthMs:', maxBacktrackingDepthMs);
  // console.log('backtrackingBlocks:', backtrackingBlocks.length);
  // for (let bbl = 0; bbl < backtrackingBlocks.length; bbl++) {
  //   const bblk = backtrackingBlocks[bbl];
  //   console.log('  block ' + bbl + ': startIndex=' + bblk.startIndex + ', endIndex=' + bblk.endIndex + ', length=' + bblk.length + ', maxDepthMs=' + bblk.maxDepthMs);
  // }
  // console.log('largestBacktrackingBlockLength:', largestBacktrackingBlockLength);
  // console.log('=====================================');
  //
  // // TEMPORARY: Duplicate timestamp block detection verification
  // console.log('=== Duplicate Timestamp Block Detection ===');
  // console.log('duplicateTimestampCount:', duplicateTimestampCount);
  // console.log('duplicateTimestampRatio:', totalPointsChecked > 0 ? (duplicateTimestampCount / totalPointsChecked).toFixed(4) : 0);
  // console.log('duplicateTimestampBlocks (length > 1):', duplicateTimestampBlocks.length);
  // for (let dbl = 0; dbl < duplicateTimestampBlocks.length; dbl++) {
  //   const dblk = duplicateTimestampBlocks[dbl];
  //   console.log('  block ' + dbl + ': startIndex=' + dblk.startIndex + ', endIndex=' + dblk.endIndex + ', length=' + dblk.length);
  // }
  // console.log('largestDuplicateTimestampBlockLength:', largestDuplicateTimestampBlockLength);
  // console.log('============================================');
  //
  // // TEMPORARY: Missing timestamp block detection verification
  // console.log('=== Missing Timestamp Block Detection ===');
  // console.log('missingTimestampCount:', missingTimestampCount);
  // console.log('missingTimestampRatio:', totalPointsChecked > 0 ? (missingTimestampCount / totalPointsChecked).toFixed(4) : 0);
  // console.log('missingTimestampBlocks (length > 1):', missingTimestampBlocks.length);
  // for (let mbl = 0; mbl < missingTimestampBlocks.length; mbl++) {
  //   const blk = missingTimestampBlocks[mbl];
  //   console.log('  block ' + mbl + ': startIndex=' + blk.startIndex + ', endIndex=' + blk.endIndex + ', length=' + blk.length);
  // }
  // console.log('largestMissingTimestampBlockLength:', largestMissingTimestampBlockLength);
  // console.log('=========================================');
  
  // Console log the audit results
  // console.log('=== Timestamp Audit Results ===');
  // console.log('Total points checked:', totalPointsChecked);
  // console.log('Missing timestamps:', missingTimestampCount);
  // console.log('Unparsable timestamps:', unparsableTimestampCount);
  // console.log('Duplicate timestamps:', duplicateTimestampCount);
  // console.log('Backtracking points:', totalBacktrackingPoints);
  // console.log('Strictly increasing timestamps:', strictlyIncreasingCount);
  // if (maxBacktrackingDepthMs !== null) {
  //   console.log('Maximum backtracking depth (ms):', maxBacktrackingDepthMs);
  //   console.log('Maximum backtracking depth (seconds):', Math.round(maxBacktrackingDepthMs / 1000));
  // } else {
  //   console.log('Maximum backtracking depth (ms):', 'N/A (no backtracking observed)');
  // }
  // console.log('================================');
  
  return auditMetadata;
}
