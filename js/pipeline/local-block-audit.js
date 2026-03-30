/**
 * Local Block Audit
 * Diagnostic-only helper: computes cumulative distance, net displacement, point count,
 * and elapsed time for a range of GPX indices using the ingestion points array directly.
 * No classification, thresholds, or interpretation. Does not use precomputed deltas.
 */

/**
 * Haversine distance between two points in meters
 * @param {number} lat1 - Latitude of first point in degrees
 * @param {number} lon1 - Longitude of first point in degrees
 * @param {number} lat2 - Latitude of second point in degrees
 * @param {number} lon2 - Longitude of second point in degrees
 * @returns {number} Distance in meters
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Audits a block of points by GPX index range using the ingestion points array directly.
 *
 * @param {Array<{gpxIndex: number, lat: number, lon: number, timeRaw: string|null}>} points - Ingestion points (from parseGPX)
 * @param {number} fromIndex - Start GPX index (inclusive)
 * @param {number} toIndex - End GPX index (inclusive)
 * @returns {{
 *   cumulativeDistanceM: number,
 *   netDisplacementM: number,
 *   pointCount: number,
 *   elapsedTimeSec: number|null
 * }}
 */
function auditLocalBlock(points, fromIndex, toIndex) {
  if (!points || points.length === 0) {
    return {
      cumulativeDistanceM: 0,
      netDisplacementM: 0,
      pointCount: 0,
      elapsedTimeSec: null
    };
  }

  const block = points
    .filter(p => p.gpxIndex >= fromIndex && p.gpxIndex <= toIndex)
    .sort((a, b) => a.gpxIndex - b.gpxIndex);

  const pointCount = block.length;

  let cumulativeDistanceM = 0;
  for (let i = 0; i < block.length - 1; i++) {
    const d = haversineMeters(
      block[i].lat,
      block[i].lon,
      block[i + 1].lat,
      block[i + 1].lon
    );
    if (isFinite(d) && d >= 0) {
      cumulativeDistanceM += d;
    }
  }

  let netDisplacementM = 0;
  if (block.length >= 2) {
    netDisplacementM = haversineMeters(
      block[0].lat,
      block[0].lon,
      block[block.length - 1].lat,
      block[block.length - 1].lon
    );
    if (!isFinite(netDisplacementM) || netDisplacementM < 0) {
      netDisplacementM = 0;
    }
  }

  let elapsedTimeSec = null;
  if (block.length >= 2 && block[0].timeRaw != null && block[block.length - 1].timeRaw != null) {
    const t0 = Date.parse(block[0].timeRaw);
    const t1 = Date.parse(block[block.length - 1].timeRaw);
    if (!isNaN(t0) && !isNaN(t1)) {
      elapsedTimeSec = (t1 - t0) / 1000;
    }
  }

  return {
    cumulativeDistanceM,
    netDisplacementM,
    pointCount,
    elapsedTimeSec
  };
}

(function () {
  function initBlockAuditPopup() {
    var popup = document.getElementById('block-audit-popup');
    var header = document.getElementById('block-audit-header');
    var body = document.getElementById('block-audit-body');
    var fromInput = document.getElementById('block-audit-from');
    var toInput = document.getElementById('block-audit-to');
    var runBtn = document.getElementById('block-audit-run');
    var resultEl = document.getElementById('block-audit-result');
    if (!popup || !header || !body || !fromInput || !toInput || !runBtn || !resultEl) { return; }

    var dragging = false;
    var dragStartX = 0;
    var dragStartY = 0;
    var popupStartLeft = 0;
    var popupStartTop = 0;
    var headerClicked = false;

    // Position: bottom-right
    popup.style.left = (window.innerWidth - popup.offsetWidth - 24) + 'px';
    popup.style.top = (window.innerHeight - (body.classList.contains('hidden') ? header.offsetHeight : popup.offsetHeight) - 24) + 'px';

    function clampToViewport(left, top) {
      var r = popup.getBoundingClientRect();
      var w = r.width;
      var h = r.height;
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      left = Math.max(0, Math.min(left, vw - w));
      top = Math.max(0, Math.min(top, vh - h));
      return { left: left, top: top };
    }

    // Bring to front on any interaction
    popup.addEventListener('mousedown', function () {
      if (typeof window._floatingToolZIndex !== 'number') { window._floatingToolZIndex = 1000; }
      popup.style.zIndex = ++window._floatingToolZIndex;
    });

    header.addEventListener('mousedown', function (e) {
      if (e.button !== 0) { return; }
      dragging = true;
      headerClicked = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      popupStartLeft = popup.offsetLeft;
      popupStartTop = popup.offsetTop;
    });

    window.addEventListener('mousemove', function (e) {
      if (!dragging) { return; }
      var dx = e.clientX - dragStartX;
      var dy = e.clientY - dragStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) { headerClicked = false; }
      var pos = clampToViewport(popupStartLeft + dx, popupStartTop + dy);
      popup.style.left = pos.left + 'px';
      popup.style.top = pos.top + 'px';
    });

    window.addEventListener('mouseup', function (e) {
      if (e.button !== 0) { return; }
      if (dragging && headerClicked) {
        body.classList.toggle('hidden');
      }
      dragging = false;
    });

    runBtn.addEventListener('click', function () {
      var points = window.currentPoints;
      var from = parseInt(fromInput.value, 10);
      var to = parseInt(toInput.value, 10);
      if (!Number.isFinite(from)) { from = 0; }
      if (!Number.isFinite(to)) { to = 0; }
      if (!points || !points.length) {
        resultEl.textContent = 'No points loaded. Parse a GPX file first.';
        return;
      }
      var out = auditLocalBlock(points, from, to);
      var lines = [
        'cumulativeDistanceM: ' + (out.cumulativeDistanceM != null ? out.cumulativeDistanceM.toFixed(2) : '0.00'),
        'netDisplacementM: ' + (out.netDisplacementM != null ? out.netDisplacementM.toFixed(2) : '0.00'),
        'pointCount: ' + out.pointCount,
        'elapsedTimeSec: ' + (out.elapsedTimeSec != null ? out.elapsedTimeSec.toFixed(2) : 'null')
      ];
      resultEl.textContent = lines.join('\n');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBlockAuditPopup);
  } else {
    initBlockAuditPopup();
  }
})();
