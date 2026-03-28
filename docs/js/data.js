/**
 * Data module - fetches and filters project data.
 */
window.DashboardData = (function () {
  'use strict';

  var DATA_URL = 'projects_summary.json';

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
    if (excludeKey !== 'tool' && filters.tool) {
      if (p.tool !== filters.tool) return false;
    }
    if (excludeKey !== 'year' && filters.year) {
      if (!p.created) return false;
      var year = parseInt(p.created.substring(0, 4), 10);
      if (year !== filters.year) return false;
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

  return {
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
