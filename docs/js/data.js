/**
 * Data module - fetches and filters project data.
 */
window.DashboardData = (function () {
  'use strict';

  var DATA_URL = 'projects_summary.json';

  // Single source of truth for imagery colors and display order (used by
  // charts, map markers and the map legend).
  var IMAGERY_ORDER = [
    'Bing', 'Esri', 'Mapbox', 'Maxar',
    'OAM Drone', 'OAM Satellite', 'OAM Aircraft', 'OAM Unknown',
    'Custom', 'Other', 'Not specified',
  ];
  var IMAGERY_COLORS = {
    'Bing': '#d73f3f',
    'Esri': '#2b83ba',
    'Mapbox': '#4264fb',
    'Maxar': '#ff8c00',
    'OAM Drone': '#10b981',
    'OAM Satellite': '#8b5cf6',
    'OAM Aircraft': '#ec4899',
    'OAM Unknown': '#0f766e',
    'Custom': '#57534e',
    'Other': '#a16207',
    'Not specified': '#c7c2bd',
  };

  var rawData = null;
  var allProjects = [];
  var filteredProjects = [];

  function loadData() {
    return fetch(DATA_URL)
      .then(function (response) {
        if (!response.ok) throw new Error('Failed to load project data');
        return response.json();
      })
      .then(function (data) {
        rawData = data;
        allProjects = data.projects || [];
        filteredProjects = allProjects.slice();
        return data;
      });
  }

  var NO_DRIVER = '__none__';

  function getDriverLabels() {
    return (rawData && rawData.driverLabels) || {};
  }

  /** Driver keys that count for filtering, given the mentions toggle. */
  function driversOf(p, includeMentioned) {
    var list = (p.drivers || []).slice();
    if (includeMentioned) list = list.concat(p.driversMentioned || []);
    return list;
  }

  function getGenerated() {
    return rawData ? rawData.generated : null;
  }

  function getAllProjects() {
    return allProjects;
  }

  function getFilteredProjects() {
    return filteredProjects;
  }

  /** Core filter logic - applies a filters object to a project. */
  function matchesFilters(p, filters, excludeKey) {
    if (p.excluded && !filters.includeExcluded) return false;
    if (excludeKey !== 'tool' && filters.tool) {
      if (p.tool !== filters.tool) return false;
    }
    if (excludeKey !== 'year' && (filters.yearFrom || filters.yearTo)) {
      if (!p.created) return false;
      var year = parseInt(p.created.substring(0, 4), 10);
      // Accept the bounds in either order.
      var lo = Math.min(filters.yearFrom || -Infinity, filters.yearTo || Infinity);
      var hi = Math.max(filters.yearFrom || -Infinity, filters.yearTo || Infinity);
      if (filters.yearFrom && !filters.yearTo) { lo = filters.yearFrom; hi = Infinity; }
      if (filters.yearTo && !filters.yearFrom) { lo = -Infinity; hi = filters.yearTo; }
      if (year < lo || year > hi) return false;
    }
    if (excludeKey !== 'imagery' && filters.imagery && filters.imagery !== 'All') {
      if (p.imagery !== filters.imagery) return false;
    }
    if (excludeKey !== 'country' && filters.country && filters.country !== 'All') {
      if (!p.country || p.country.indexOf(filters.country) === -1) return false;
    }
    if (excludeKey !== 'org' && filters.org && filters.org !== 'All') {
      if (p.org !== filters.org) return false;
    }
    if (excludeKey !== 'status' && filters.status && filters.status !== 'All') {
      if (p.status !== filters.status) return false;
    }
    if (excludeKey !== 'driver' && filters.driver && filters.driver !== 'All') {
      var ds = driversOf(p, filters.includeMentioned);
      if (filters.driver === NO_DRIVER) {
        if (ds.length) return false;
      } else if (ds.indexOf(filters.driver) === -1) {
        return false;
      }
    }
    return true;
  }

  function applyFilters(filters) {
    filteredProjects = allProjects.filter(function (p) {
      return matchesFilters(p, filters);
    });
    return filteredProjects;
  }

  /**
   * Get available values for a filter field, given all OTHER active filters.
   * This powers cascading dropdowns: selecting Tool=MapSwipe narrows the
   * Country dropdown to only countries with MapSwipe projects, etc.
   */
  function getAvailableValues(field, filters) {
    var values = {};
    allProjects.forEach(function (p) {
      if (!matchesFilters(p, filters, field)) return;
      if (field === 'year') {
        if (p.created) {
          var y = parseInt(p.created.substring(0, 4), 10);
          if (!isNaN(y)) values[y] = true;
        }
      } else if (field === 'tool') {
        if (p.toolLabel) values[p.tool + '|' + p.toolLabel] = true;
      } else if (field === 'driver') {
        var ds = driversOf(p, filters.includeMentioned);
        if (!ds.length) values[NO_DRIVER] = true;
        ds.forEach(function (d) { values[d] = true; });
      } else {
        var val = p[field];
        if (Array.isArray(val)) {
          val.forEach(function (v) { if (v) values[v] = true; });
        } else if (val) {
          values[val] = true;
        }
      }
    });
    return values;
  }

  // Keep these for initial population (before any filters are set)
  function getUniqueYears() {
    var years = {};
    allProjects.forEach(function (p) {
      if (p.created) {
        var y = parseInt(p.created.substring(0, 4), 10);
        if (!isNaN(y)) years[y] = true;
      }
    });
    return Object.keys(years)
      .map(Number)
      .sort(function (a, b) { return a - b; });
  }

  function getExcludedCount() {
    return allProjects.filter(function (p) { return p.excluded; }).length;
  }

  function getUniqueValues(field) {
    var values = {};
    allProjects.forEach(function (p) {
      var val = p[field];
      if (Array.isArray(val)) {
        val.forEach(function (v) { if (v) values[v] = true; });
      } else if (val) {
        values[val] = true;
      }
    });
    return Object.keys(values).sort();
  }

  /* ---- CSV export ---- */
  var CSV_COLUMNS = [
    'uid', 'tool', 'sourceId', 'name', 'status', 'imagery', 'country', 'org',
    'created', 'areaSqKm', 'lon', 'lat', 'pctMapped', 'pctValidated',
    'contributors', 'drivers', 'driversMentioned', 'phase', 'campaigns',
    'excluded', 'excludedReason', 'projectUrl',
  ];

  /** Quote a CSV cell; neutralize spreadsheet formulas in text cells. */
  function csvCell(value, isText) {
    if (value == null) return '';
    var s = String(value);
    if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /** GeoJSON FeatureCollection of project centroids (null geometry if none). */
  function toGeoJSON(projects) {
    var features = projects.map(function (p) {
      var props = {};
      CSV_COLUMNS.forEach(function (col) {
        if (col !== 'lon' && col !== 'lat') props[col] = p[col] === undefined ? null : p[col];
      });
      return {
        type: 'Feature',
        geometry: p.centroid ? { type: 'Point', coordinates: p.centroid } : null,
        properties: props,
      };
    });
    return JSON.stringify({ type: 'FeatureCollection', features: features });
  }

  function toCSV(projects) {
    var numeric = { sourceId: 1, areaSqKm: 1, lon: 1, lat: 1, pctMapped: 1, pctValidated: 1, contributors: 1 };
    var lines = [CSV_COLUMNS.join(',')];
    projects.forEach(function (p) {
      var row = CSV_COLUMNS.map(function (col) {
        var v;
        if (col === 'lon') v = p.centroid ? p.centroid[0] : null;
        else if (col === 'lat') v = p.centroid ? p.centroid[1] : null;
        else if (Array.isArray(p[col])) v = p[col].join('; ');
        else v = p[col];
        return csvCell(v, !numeric[col]);
      });
      lines.push(row.join(','));
    });
    return lines.join('\r\n');
  }

  return {
    IMAGERY_ORDER: IMAGERY_ORDER,
    IMAGERY_COLORS: IMAGERY_COLORS,
    getExcludedCount: getExcludedCount,
    getDriverLabels: getDriverLabels,
    driversOf: driversOf,
    NO_DRIVER: NO_DRIVER,
    toCSV: toCSV,
    toGeoJSON: toGeoJSON,
    loadData: loadData,
    getGenerated: getGenerated,
    getAllProjects: getAllProjects,
    getFilteredProjects: getFilteredProjects,
    applyFilters: applyFilters,
    getAvailableValues: getAvailableValues,
    getUniqueYears: getUniqueYears,
    getUniqueValues: getUniqueValues,
  };
})();
