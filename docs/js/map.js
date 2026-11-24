/**
 * Map module - MapLibre GL JS with centroid markers colored by imagery source.
 * TM projects: circles. MapSwipe projects: diamonds. fAIr: triangles.
 */
window.DashboardMap = (function () {
  'use strict';

  var map = null;

  /** Escape HTML special characters to prevent XSS from external data. */
  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  /** Validate that a URL is safe for use in an href (https only). */
  function safeUrl(url) {
    if (!url) return '';
    var s = String(url).trim();
    if (s.indexOf('https://') === 0 || s.indexOf('http://') === 0) return s;
    return '';
  }

  var IMAGERY_COLORS = window.DashboardData.IMAGERY_COLORS;
  var IMAGERY_ORDER = window.DashboardData.IMAGERY_ORDER;

  /** MapLibre 'match' expression mapping imagery -> value(name). */
  function imageryMatch(valueFn) {
    var expr = ['match', ['get', 'imagery']];
    IMAGERY_ORDER.forEach(function (name) {
      if (name !== 'Not specified') expr.push(name, valueFn(name));
    });
    expr.push(valueFn('Not specified'));
    return expr;
  }

  /** Build the legend from the shared palette so it never drifts. */
  function renderLegend() {
    var el = document.getElementById('imagery-legend');
    if (!el) return;
    el.innerHTML = '';
    IMAGERY_ORDER.forEach(function (name) {
      var row = document.createElement('div');
      row.className = 'map-legend-item';
      var dot = document.createElement('span');
      dot.className = 'map-legend-dot';
      dot.style.background = IMAGERY_COLORS[name];
      row.appendChild(dot);
      row.appendChild(document.createTextNode(' ' + name));
      el.appendChild(row);
    });
  }

  /**
   * Draw a diamond (tall rhombus) on a canvas with fill color and white border.
   * Returns the canvas ImageData for use with map.addImage().
   */
  function createDiamondImage(size, fillColor) {
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var cx = size / 2;
    var cy = size / 2;
    var hw = size * 0.38; // horizontal half-width (narrower)
    var hh = size * 0.46; // vertical half-height (taller)

    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);      // top
    ctx.lineTo(cx + hw, cy);      // right
    ctx.lineTo(cx, cy + hh);      // bottom
    ctx.lineTo(cx - hw, cy);      // left
    ctx.closePath();

    // White border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = size * 0.1;
    ctx.lineJoin = 'miter';
    ctx.stroke();

    // Fill
    ctx.fillStyle = fillColor;
    ctx.fill();

    return ctx.getImageData(0, 0, size, size);
  }

  /** Register all diamond images for each imagery color. */
  function addDiamondImages(map) {
    var imgSize = 20; // base pixel size
    Object.keys(IMAGERY_COLORS).forEach(function (name) {
      var img = createDiamondImage(imgSize, IMAGERY_COLORS[name]);
      map.addImage('diamond-' + name, img);
    });
  }

  /**
   * Draw an upward-pointing triangle on a canvas with fill color and white border.
   * Returns the canvas ImageData for use with map.addImage().
   */
  function createTriangleImage(size, fillColor) {
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var cx = size / 2;
    var pad = size * 0.08;
    var top = pad;
    var bottom = size - pad;
    var hw = size * 0.44; // horizontal half-width

    ctx.beginPath();
    ctx.moveTo(cx, top);              // top center
    ctx.lineTo(cx + hw, bottom);      // bottom right
    ctx.lineTo(cx - hw, bottom);      // bottom left
    ctx.closePath();

    // White border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = size * 0.1;
    ctx.lineJoin = 'miter';
    ctx.stroke();

    // Fill
    ctx.fillStyle = fillColor;
    ctx.fill();

    return ctx.getImageData(0, 0, size, size);
  }

  /** Register all triangle images for each imagery color. */
  function addTriangleImages(map) {
    var imgSize = 20;
    Object.keys(IMAGERY_COLORS).forEach(function (name) {
      var img = createTriangleImage(imgSize, IMAGERY_COLORS[name]);
      map.addImage('triangle-' + name, img);
    });
  }

  function init() {
    renderLegend();
    map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm-tiles',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [20, 10],
      zoom: 1.4,
      maxZoom: 18,
      hash: 'map',  // sync zoom/lat/lng to URL as #map=z/lat/lng
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', function () {
      // Diamond icons for MapSwipe (one per imagery color)
      addDiamondImages(map);

      // Triangle icons for fAIr (one per imagery color)
      addTriangleImages(map);

      // Shared GeoJSON source
      map.addSource('project-centroids', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Layer 1: TM projects - solid circles
      map.addLayer({
        id: 'tm-points',
        type: 'circle',
        source: 'project-centroids',
        filter: ['==', ['get', 'tool'], 'tm'],
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            2, 3,
            8, 6,
          ],
          'circle-color': imageryMatch(function (n) { return IMAGERY_COLORS[n]; }),
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 0.5,
          'circle-opacity': 0.8,
        },
      });

      // Layer 2: MapSwipe projects - colored diamond icons
      map.addLayer({
        id: 'ms-points',
        type: 'symbol',
        source: 'project-centroids',
        filter: ['==', ['get', 'tool'], 'mapswipe'],
        layout: {
          'icon-image': imageryMatch(function (n) { return 'diamond-' + n; }),
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            2, 0.45,
            8, 0.8,
          ],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-opacity': 0.85,
        },
      });

      // Layer 3: fAIr datasets - colored triangle icons
      map.addLayer({
        id: 'fair-points',
        type: 'symbol',
        source: 'project-centroids',
        filter: ['==', ['get', 'tool'], 'fair'],
        layout: {
          'icon-image': imageryMatch(function (n) { return 'triangle-' + n; }),
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            2, 0.45,
            8, 0.8,
          ],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-opacity': 0.85,
        },
      });

      // Popup on click (all tool layers)
      var clickLayers = ['tm-points', 'ms-points', 'fair-points'];
      clickLayers.forEach(function (layerId) {
        map.on('click', layerId, function (e) {
          if (!e.features || !e.features.length) return;
          var props = e.features[0].properties;
          var coords = e.features[0].geometry.coordinates.slice();
          showPopup(coords, props);
        });

        map.on('mouseenter', layerId, function () {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, function () {
          map.getCanvas().style.cursor = '';
        });
      });
    });
  }

  var EXCLUSION_LABELS = {
    no_activity: 'no mapping activity',
    area_over_1m_km2: 'area over 1M km\u00b2',
  };

  /** Format a value that may legitimately be 0; null/undefined -> N/A. */
  function orNA(v, suffix) {
    if (v == null || v === '' || v === 'null') return 'N/A';
    var n = Number(v);
    return esc(isNaN(n) ? v : n.toLocaleString()) + (suffix || '');
  }

  function showPopup(coords, props) {
    var area = props.areaSqKm
      ? Number(props.areaSqKm).toLocaleString() + ' km\u00b2'
      : 'N/A';

    var toolBadge = props.toolLabel
      ? '<span class="popup-tool-badge">' + esc(props.toolLabel) + '</span> '
      : '';

    var html =
      '<div class="popup-title">' + toolBadge + esc(props.name || 'Untitled') + '</div>' +
      '<div class="popup-detail">' +
      '<strong>Imagery:</strong> ' + esc(props.imagery) + '<br>' +
      '<strong>Area:</strong> ' + area + '<br>' +
      '<strong>Status:</strong> ' + esc(props.status);

    if (props.tool === 'mapswipe') {
      html += '<br><strong>Contributors:</strong> ' + orNA(props.contributors) +
        ' | <strong>Results:</strong> ' + orNA(props.results);
    } else if (props.tool === 'fair') {
      html += '<br><strong>Models:</strong> ' + orNA(props.results);
    } else {
      html += '<br><strong>Mapped:</strong> ' + orNA(props.pctMapped, '%') +
        ' | <strong>Validated:</strong> ' + orNA(props.pctValidated, '%');
      if (props.contributors != null) {
        html += '<br><strong>Mappers:</strong> ' + orNA(props.contributors);
      }
    }
    if (props.excludedReason) {
      html += '<br><em class="popup-excluded">Excluded by default: ' +
        esc(EXCLUSION_LABELS[props.excludedReason] || props.excludedReason) + '</em>';
    }

    html += '</div>';

    var url = safeUrl(props.projectUrl);
    if (url) {
      var linkLabel = props.tool === 'mapswipe' ? 'View on MapSwipe'
        : props.tool === 'fair' ? 'View on fAIr'
        : 'View on Tasking Manager';
      html += '<a class="popup-link" href="' + esc(url) +
        '" target="_blank" rel="noopener">' + linkLabel + ' &rarr;</a>';
    }

    new maplibregl.Popup({ offset: 10 })
      .setLngLat(coords)
      .setHTML(html)
      .addTo(map);
  }

  var isFirstRender = true;

  function updateMarkers(projects) {
    if (!map) return;

    var src = map.getSource('project-centroids');
    if (!src) {
      map.on('load', function () {
        updateMarkers(projects);
      });
      return;
    }

    var features = [];
    projects.forEach(function (p) {
      if (!p.centroid || p.centroid[0] == null || p.centroid[1] == null) return;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p.centroid },
        properties: {
          uid: p.uid,
          name: p.name || '',
          tool: p.tool || 'tm',
          toolLabel: p.toolLabel || 'Tasking Manager',
          imagery: p.imagery || 'Not specified',
          areaSqKm: p.areaSqKm,
          status: p.status,
          projectUrl: p.projectUrl || '',
          pctMapped: p.pctMapped,
          pctValidated: p.pctValidated,
          contributors: p.contributors,
          results: p.results,
          excludedReason: p.excludedReason || '',
        },
      });
    });

    src.setData({ type: 'FeatureCollection', features: features });

    // On first render (page load), keep the initial map position
    if (isFirstRender) {
      isFirstRender = false;
      return;
    }

    // Fit map to the extent of visible data
    if (features.length === 0) return;
    var minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
    features.forEach(function (f) {
      var c = f.geometry.coordinates;
      if (c[0] < minLng) minLng = c[0];
      if (c[0] > maxLng) maxLng = c[0];
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
    });

    // If the data spans most of the globe, use a fixed default view
    // instead of fitBounds (which would zoom out too far and wrap)
    var lngSpan = maxLng - minLng;
    var latSpan = maxLat - minLat;
    if (lngSpan > 300 || latSpan > 120) {
      map.flyTo({ center: [20, 10], zoom: 1.4, duration: 500 });
    } else {
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
        padding: 40,
        maxZoom: 12,
        duration: 500,
      });
    }
  }

  return {
    init: init,
    updateMarkers: updateMarkers,
  };
})();
