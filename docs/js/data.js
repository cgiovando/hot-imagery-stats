/**
 * Data module — fetches and filters project data from S3.
 */
window.DashboardData = (function () {
  'use strict';

  var DATA_URL =
    'https://insta-tm.s3.us-east-1.amazonaws.com/projects_summary.json';

  var rawData = null;
  var allProjects = [];
  var filteredProjects = [];

  function loadData() {
    return fetch(DATA_URL)
      .then(function (response) {
        if (!response.ok) throw new Error('Failed to load data: ' + response.status);
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

  function applyFilters(filters) {
    filteredProjects = allProjects.filter(function (p) {
      // Year filter
      if (p.created) {
        var year = parseInt(p.created.substring(0, 4), 10);
        if (filters.yearFrom && year < filters.yearFrom) return false;
        if (filters.yearTo && year > filters.yearTo) return false;
      } else {
        if (filters.yearFrom || filters.yearTo) return false;
      }

      // Imagery
      if (filters.imagery && filters.imagery !== 'All') {
        if (p.imagery !== filters.imagery) return false;
      }

      // Country
      if (filters.country && filters.country !== 'All') {
        if (!p.country || p.country.indexOf(filters.country) === -1) return false;
      }

      // Organization
      if (filters.org && filters.org !== 'All') {
        if (p.org !== filters.org) return false;
      }

      // Status
      if (filters.status && filters.status !== 'All') {
        if (p.status !== filters.status) return false;
      }

      return true;
    });

    return filteredProjects;
  }

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
    getUniqueYears: getUniqueYears,
    getUniqueValues: getUniqueValues,
  };
})();
