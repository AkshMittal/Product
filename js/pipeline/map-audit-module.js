/**
 * Audit Map Module
 * Standalone diagnostic Leaflet map for case-study visualization.
 * Reads the processed points array (read-only). Does not modify
 * ingestion, audit, or chart logic.
 *
 * Exposes: initializeAuditMap(pointsArray)
 *
 * Drag / toggle / positioning of the container is handled separately
 * in index.html (DOMContentLoaded), so the map panel is interactive
 * even before a GPX file is loaded.
 */

/* Previous map instance (module-level so we can destroy on reload) */
var _auditMapInstance = null;

/**
 * Initialise (or re-initialise) the Leaflet map with a new points array.
 *
 * @param {Array<{gpxIndex: number, lat: number, lon: number}>} points
 *   The processed ingestion points array (read-only).
 */
function initializeAuditMap(points) {
  if (!points || points.length === 0) { return; }

  var mapDiv      = document.getElementById('audit-map-div');
  var body        = document.getElementById('audit-map-body');
  var searchIn    = document.getElementById('audit-map-search-input');
  var searchBtn   = document.getElementById('audit-map-search-btn');
  var recenterBtn = document.getElementById('audit-map-recenter-btn');
  if (!mapDiv || !body || !searchIn || !searchBtn || !recenterBtn) { return; }

  /* ── Expand the map panel before creating the map so Leaflet has real dimensions ── */
  var wasHidden = body.classList.contains('hidden');
  if (wasHidden) {
    body.classList.remove('hidden');
    /* Force synchronous reflow so the container has computed dimensions */
    void body.offsetHeight;
  }

  /* ── Destroy previous map instance if one exists ── */
  if (_auditMapInstance) {
    _auditMapInstance.remove();
    _auditMapInstance = null;
  }

  /* ── Build index lookup (gpxIndex → array position) ── */
  var indexMap = {};
  for (var i = 0; i < points.length; i++) {
    indexMap[points[i].gpxIndex] = i;
  }

  /* ── Create map ── */
  var map = L.map(mapDiv, {
    zoomControl: true,
    attributionControl: true
  }).setView([0, 0], 2);

  _auditMapInstance = map;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  /* ── Build LatLng array + polyline ── */
  var latLngs = [];
  for (var j = 0; j < points.length; j++) {
    latLngs.push([points[j].lat, points[j].lon]);
  }

  var polyline = L.polyline(latLngs, {
    color: '#000000',
    weight: 3,
    opacity: 1
  }).addTo(map);

  /* ── Compute route bounds and fit map ── */
  var routeBounds = polyline.getBounds();

  if (latLngs.length > 0 && routeBounds.isValid()) {
    map.fitBounds(routeBounds);
  }

  /* ── Recenter button ── */
  var newRecenterBtn = recenterBtn.cloneNode(true);
  recenterBtn.parentNode.replaceChild(newRecenterBtn, recenterBtn);
  recenterBtn = newRecenterBtn;
  recenterBtn.addEventListener('click', function () {
    if (routeBounds && routeBounds.isValid()) {
      map.fitBounds(routeBounds);
    }
  });

  /* ── Tooltip on polyline hover / click ── */
  var tooltip = L.tooltip({ permanent: false, sticky: true });
  var pinnedTooltip = null;

  polyline.on('mousemove', function (e) {
    if (pinnedTooltip) { map.removeLayer(pinnedTooltip); pinnedTooltip = null; }
    var closest = nearestPointIndex(e.latlng);
    if (closest !== null) {
      tooltip.setLatLng(e.latlng).setContent('gpxIndex: ' + points[closest].gpxIndex);
      if (!map.hasLayer(tooltip)) { tooltip.addTo(map); }
    }
  });

  polyline.on('mouseout', function () {
    if (map.hasLayer(tooltip)) { map.removeLayer(tooltip); }
  });

  polyline.on('click', function (e) {
    var closest = nearestPointIndex(e.latlng);
    if (closest !== null) {
      if (pinnedTooltip) { map.removeLayer(pinnedTooltip); }
      pinnedTooltip = L.tooltip({ permanent: true })
        .setLatLng([points[closest].lat, points[closest].lon])
        .setContent('gpxIndex: ' + points[closest].gpxIndex)
        .addTo(map);
    }
  });

  function nearestPointIndex(latlng) {
    var bestDist = Infinity;
    var bestIdx = null;
    var lat = latlng.lat;
    var lng = latlng.lng;
    for (var k = 0; k < points.length; k++) {
      var dLat = points[k].lat - lat;
      var dLng = points[k].lon - lng;
      var d2 = dLat * dLat + dLng * dLng;
      if (d2 < bestDist) {
        bestDist = d2;
        bestIdx = k;
      }
    }
    return bestIdx;
  }

  /* ── Search bar ── */
  function doSearch() {
    var val = parseInt(searchIn.value, 10);
    if (!isFinite(val)) { return; }
    if (!(val in indexMap)) { return; }

    var centerIdx = indexMap[val];
    var targetLatLng = L.latLng(points[centerIdx].lat, points[centerIdx].lon);

    var lo = Math.max(0, centerIdx - 100);
    var hi = Math.min(points.length - 1, centerIdx + 100);

    var bounds = [];
    for (var s = lo; s <= hi; s++) {
      bounds.push([points[s].lat, points[s].lon]);
    }
    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds));
      map.setView(targetLatLng, map.getZoom());
    }

    if (pinnedTooltip) { map.removeLayer(pinnedTooltip); }
    pinnedTooltip = L.tooltip({ permanent: true })
      .setLatLng(targetLatLng)
      .setContent('gpxIndex: ' + points[centerIdx].gpxIndex)
      .addTo(map);
  }

  searchBtn.addEventListener('click', doSearch);
  searchIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { doSearch(); }
  });

  /* Panel is guaranteed visible at this point; invalidate and re-fit after
     a tick so Leaflet recalculates tile coverage with final dimensions */
  setTimeout(function () {
    map.invalidateSize();
    if (routeBounds && routeBounds.isValid()) {
      map.fitBounds(routeBounds);
    }
  }, 50);
}
