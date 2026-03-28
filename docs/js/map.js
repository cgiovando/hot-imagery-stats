/**
 * Map module - MapLibre GL JS with centroid markers colored by imagery source.
 * TM projects: circles. MapSwipe projects: diamonds.
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

  var IMAGERY_COLOR_EXPR = [
    'match',
    ['get', 'imagery'],
    'Bing', '#d73f3f',
    'Esri', '#2b83ba',
    'Mapbox', '#4264fb',
    'Maxar', '#ff8c00',
    'Custom', '#7b7b7b',
    'Other', '#a3a3a3',
    'Not specified', '#d4d4d4',
    '#d4d4d4',
  ];

  var IMAGERY_COLORS = {
    'Bing': '#d73f3f',
    'Esri': '#2b83ba',
    'Mapbox': '#4264fb',
    'Maxar': '#ff8c00',
    'Custom': '#7b7b7b',
    'Other': '#a3a3a3',
    'Not specified': '#d4d4d4',
  };

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

  function init() {
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
          'circle-color': IMAGERY_COLOR_EXPR,
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
          'icon-image': [
            'match',
            ['get', 'imagery'],
            'Bing', 'diamond-Bing',
            'Esri', 'diamond-Esri',
            'Mapbox', 'diamond-Mapbox',
            'Maxar', 'diamond-Maxar',
            'Custom', 'diamond-Custom',
            'Other', 'diamond-Other',
            'diamond-Not specified',
          ],
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

      // Popup on click (both layers)
      var clickLayers = ['tm-points', 'ms-points'];
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
      html += '<br><strong>Contributors:</strong> ' + esc(props.contributors || 'N/A') +
        ' | <strong>Results:</strong> ' + esc(props.results || 'N/A');
    } else {
      html += '<br><strong>Mapped:</strong> ' + (props.pctMapped != null ? esc(props.pctMapped) + '%' : 'N/A') +
        ' | <strong>Validated:</strong> ' + (props.pctValidated != null ? esc(props.pctValidated) + '%' : 'N/A');
    }

    html += '</div>';

    var url = safeUrl(props.projectUrl);
    if (url) {
      var linkLabel = props.tool === 'mapswipe' ? 'View on MapSwipe' : 'View on Tasking Manager';
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
