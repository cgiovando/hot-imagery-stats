/**
 * Map module — MapLibre GL JS with centroid markers colored by imagery source.
 */
window.DashboardMap = (function () {
  'use strict';

  var map = null;

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
      center: [20, 5],
      zoom: 2,
      maxZoom: 18,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', function () {
      // Centroid markers (from summary data, updated on filter)
      map.addSource('project-centroids', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'project-points',
        type: 'circle',
        source: 'project-centroids',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 3,
            8, 6,
          ],
          'circle-color': [
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
          ],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1,
          'circle-opacity': 0.8,
        },
      });

      // Popup on click
      map.on('click', 'project-points', function (e) {
        if (!e.features || !e.features.length) return;
        var props = e.features[0].properties;
        var coords = e.features[0].geometry.coordinates.slice();

        var area = props.areaSqKm
          ? Number(props.areaSqKm).toLocaleString() + ' km\u00b2'
          : 'N/A';

        var html =
          '<div class="popup-title">#' + props.projectId + ': ' + (props.name || 'Untitled') + '</div>' +
          '<div class="popup-detail">' +
          '<strong>Imagery:</strong> ' + props.imagery + '<br>' +
          '<strong>Area:</strong> ' + area + '<br>' +
          '<strong>Status:</strong> ' + props.status + '<br>' +
          '<strong>Mapped:</strong> ' + (props.pctMapped != null ? props.pctMapped + '%' : 'N/A') +
          ' | <strong>Validated:</strong> ' + (props.pctValidated != null ? props.pctValidated + '%' : 'N/A') +
          '</div>' +
          '<a class="popup-link" href="https://tasks.hotosm.org/projects/' + props.projectId +
          '" target="_blank" rel="noopener">View on Tasking Manager &rarr;</a>';

        new maplibregl.Popup({ offset: 10 })
          .setLngLat(coords)
          .setHTML(html)
          .addTo(map);
      });

      // Cursor
      map.on('mouseenter', 'project-points', function () {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'project-points', function () {
        map.getCanvas().style.cursor = '';
      });
    });
  }

  function updateMarkers(projects) {
    if (!map) return;

    // Wait until the source is ready
    var src = map.getSource('project-centroids');
    if (!src) {
      // Map not loaded yet — retry once when ready
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
          projectId: p.id,
          name: p.name || '',
          imagery: p.imagery || 'Not specified',
          areaSqKm: p.areaSqKm,
          status: p.status,
          pctMapped: p.pctMapped,
          pctValidated: p.pctValidated,
        },
      });
    });

    src.setData({ type: 'FeatureCollection', features: features });
  }

  return {
    init: init,
    updateMarkers: updateMarkers,
  };
})();
