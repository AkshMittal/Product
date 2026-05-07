/**
 * Elevation Audit Module
 * Per-point observational labeling of the recorded elevation channel.
 * Does NOT mutate, reorder, smooth, or normalize elevation values.
 * Does NOT emit channel statistics, consecutive Δele, co-presence with time, or blocks —
 * those are derivable downstream from points and temporal/motion tags.
 *
 * Output shape (aligned with temporal audit):
 *   audit.elevation.tagCounts     — count per tag
 *   audit.elevation.tagIndex      — gpxIndex lists per tag
 *   audit.elevation.pointAnnotations — sparse; only anomalous points
 *
 * Tag mutual exclusion:
 *   missing vs unparsable — exactly one applies when there is no usable number:
 *     missing = no <ele> element (ingestion: eleAbsent === true)
 *     unparsable = <ele> present but not a finite number (ingestion: eleAbsent === false, ele === null)
 *   Legacy points without eleAbsent: ele === null is treated as missing.
 *   outOfBounds — only when ele is a finite number outside [validFloorM, validCeilingM];
 *     mutually exclusive with missing and unparsable.
 *   adjacentDuplicate — only on in-bounds numeric ele, equal to previous in-bounds ele;
 *     mutually exclusive with missing, unparsable, and outOfBounds.
 */

/**
 * @param {Array<{gpxIndex:number, ele:number|null, eleAbsent?:boolean}>} points
 * @param {Object} [params]
 * @param {number} [params.validFloorM=-500]
 * @param {number} [params.validCeilingM=9500]
 * @returns {Object}
 */
function auditElevation(points, params) {
  var validFloorM = -500;
  var validCeilingM = 9500;
  if (params && typeof params === 'object') {
    if (typeof params.validFloorM === 'number' && isFinite(params.validFloorM)) {
      validFloorM = params.validFloorM;
    }
    if (typeof params.validCeilingM === 'number' && isFinite(params.validCeilingM)) {
      validCeilingM = params.validCeilingM;
    }
  }

  var tagIndex = {
    missing: [],
    unparsable: [],
    outOfBounds: [],
    adjacentDuplicate: []
  };
  var pointAnnotations = [];
  var totalPointsEvaluated = 0;
  var validElevationPointCount = 0;
  var prevValidEle = null;

  for (var i = 0; i < points.length; i++) {
    var point = points[i];
    var gpxIndex = point.gpxIndex;
    var ele = point.ele;
    var eleAbsent = point.eleAbsent;
    totalPointsEvaluated++;

    if (eleAbsent === true) {
      tagIndex.missing.push(gpxIndex);
      pointAnnotations.push({ gpxIndex: gpxIndex, missing: true });
      prevValidEle = null;
      continue;
    }

    if (ele === null || typeof ele !== 'number' || isNaN(ele)) {
      if (eleAbsent === false) {
        tagIndex.unparsable.push(gpxIndex);
        pointAnnotations.push({ gpxIndex: gpxIndex, unparsable: true });
        prevValidEle = null;
        continue;
      }
      tagIndex.missing.push(gpxIndex);
      pointAnnotations.push({ gpxIndex: gpxIndex, missing: true });
      prevValidEle = null;
      continue;
    }

    if (ele < validFloorM || ele > validCeilingM) {
      tagIndex.outOfBounds.push(gpxIndex);
      pointAnnotations.push({
        gpxIndex: gpxIndex,
        outOfBounds: true,
        ele: ele
      });
      prevValidEle = null;
      continue;
    }

    validElevationPointCount++;

    var ann = { gpxIndex: gpxIndex, ele: ele };
    var hasTag = false;
    if (prevValidEle !== null && ele === prevValidEle) {
      ann.adjacentDuplicate = true;
      tagIndex.adjacentDuplicate.push(gpxIndex);
      hasTag = true;
    }
    if (hasTag) {
      pointAnnotations.push(ann);
    }

    prevValidEle = ele;
  }

  // ── Per-segment summary ────────────────────────────────────────────────────
  // ADR-correction-0013: raw per-segment payloads; correction layer classifies.
  var eleGpxToSeg = new Map();
  for (var epi = 0; epi < points.length; epi++) {
    eleGpxToSeg.set(points[epi].gpxIndex, points[epi].trkSegIndex);
  }
  var eleSegMap = new Map();
  for (var esi = 0; esi < points.length; esi++) {
    var eleSeg = points[esi].trkSegIndex;
    if (!eleSegMap.has(eleSeg)) {
      eleSegMap.set(eleSeg, {
        trkSegIndex: eleSeg,
        totalPointsEvaluated: 0,
        validElevationPointCount: 0,
        tagCounts: { missing: 0, unparsable: 0, outOfBounds: 0, adjacentDuplicate: 0 }
      });
    }
    eleSegMap.get(eleSeg).totalPointsEvaluated++;
  }
  for (var eai = 0; eai < pointAnnotations.length; eai++) {
    var eann = pointAnnotations[eai];
    var eannSeg = eleGpxToSeg.get(eann.gpxIndex);
    if (eannSeg === undefined || !eleSegMap.has(eannSeg)) continue;
    var eEntry = eleSegMap.get(eannSeg);
    if (eann.missing)            eEntry.tagCounts.missing++;
    if (eann.unparsable)         eEntry.tagCounts.unparsable++;
    if (eann.outOfBounds)        eEntry.tagCounts.outOfBounds++;
    if (eann.adjacentDuplicate)  eEntry.tagCounts.adjacentDuplicate++;
  }
  // Count valid elevation points per segment (not from annotations — need a pass)
  for (var evi = 0; evi < points.length; evi++) {
    var evpt = points[evi];
    var evSeg = eleGpxToSeg.get(evpt.gpxIndex);
    if (evSeg === undefined || !eleSegMap.has(evSeg)) continue;
    if (typeof evpt.ele === 'number' && isFinite(evpt.ele) && evpt.eleAbsent !== true &&
        evpt.ele >= validFloorM && evpt.ele <= validCeilingM) {
      eleSegMap.get(evSeg).validElevationPointCount++;
    }
  }
  var elevationPerSegment = Array.from(eleSegMap.values()).sort(function(a, b) { return a.trkSegIndex - b.trkSegIndex; });

  return {
    audit: {
      elevation: {
        totalPointsEvaluated: totalPointsEvaluated,
        validElevationPointCount: validElevationPointCount,
        parameters: {
          validFloorM: validFloorM,
          validCeilingM: validCeilingM
        },
        tagCounts: {
          missing: tagIndex.missing.length,
          unparsable: tagIndex.unparsable.length,
          outOfBounds: tagIndex.outOfBounds.length,
          adjacentDuplicate: tagIndex.adjacentDuplicate.length
        },
        tagIndex: tagIndex,
        pointAnnotations: pointAnnotations,
        perSegment: elevationPerSegment
      }
    }
  };
}
