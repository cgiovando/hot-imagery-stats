/**
 * Filter UI module - cascading dropdowns that narrow options based on
 * other active filters.
 */
window.DashboardFilters = (function () {
  'use strict';

  var onFilterChange = null;
  var updating = false; // guard against re-entrant calls during repopulation

  var FILTER_IDS = [
    'filter-tool',
    'filter-year',
    'filter-imagery',
    'filter-country',
    'filter-org',
    'filter-status',
  ];

  function init(callback) {
    onFilterChange = callback;

    FILTER_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', handleFilterChange);
    });

    var resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) resetBtn.addEventListener('click', resetFilters);
  }

  /** Initial population from the full dataset (no filters active). */
  function populateDropdowns() {
    var Data = window.DashboardData;

    // Tool
    var toolSelect = document.getElementById('filter-tool');
    if (toolSelect) {
      var toolMap = {};
      Data.getAllProjects().forEach(function (p) {
        if (p.tool && p.toolLabel) toolMap[p.tool] = p.toolLabel;
      });
      populateToolSelect(toolSelect, toolMap, null);
    }

    populateSelect('filter-year', Data.getUniqueYears(), 'All years', null);
    populateSelect('filter-imagery', Data.getUniqueValues('imagery'), 'All sources', null);
    populateSelect('filter-country', Data.getUniqueValues('country'), 'All countries', null);
    populateSelect('filter-org', Data.getUniqueValues('org'), 'All organizations', null);
    populateSelect('filter-status', ['PUBLISHED', 'ARCHIVED', 'DRAFT'], 'All statuses', null);
  }

  /**
   * Repopulate all dropdowns based on current filters (cascading).
   * Each dropdown shows values available given all OTHER active filters.
   */
  function refreshDropdowns(filters) {
    var Data = window.DashboardData;

    // Tool dropdown
    var toolVals = Data.getAvailableValues('tool', filters);
    var toolMap = {};
    Object.keys(toolVals).forEach(function (key) {
      var parts = key.split('|');
      toolMap[parts[0]] = parts[1];
    });
    var toolSelect = document.getElementById('filter-tool');
    if (toolSelect) {
      populateToolSelect(toolSelect, toolMap, filters.tool);
    }

    // Year
    var yearVals = Data.getAvailableValues('year', filters);
    var years = Object.keys(yearVals).map(Number).sort(function (a, b) { return a - b; });
    populateSelect('filter-year', years, 'All years', filters.year);

    // Imagery
    var imgVals = Data.getAvailableValues('imagery', filters);
    populateSelect('filter-imagery', Object.keys(imgVals).sort(), 'All sources', filters.imagery);

    // Country
    var countryVals = Data.getAvailableValues('country', filters);
    populateSelect('filter-country', Object.keys(countryVals).sort(), 'All countries', filters.country);

    // Org
    var orgVals = Data.getAvailableValues('org', filters);
    populateSelect('filter-org', Object.keys(orgVals).sort(), 'All organizations', filters.org);

    // Status
    var statusVals = Data.getAvailableValues('status', filters);
    populateSelect('filter-status', Object.keys(statusVals).sort(), 'All statuses', filters.status);
  }

  function populateToolSelect(select, toolMap, currentValue) {
    select.innerHTML = '';
    var defaultOpt = document.createElement('option');
    defaultOpt.value = 'All';
    defaultOpt.textContent = 'All tools';
    select.appendChild(defaultOpt);

    Object.keys(toolMap).sort().forEach(function (code) {
      var opt = document.createElement('option');
      opt.value = code;
      opt.textContent = toolMap[code];
      select.appendChild(opt);
    });

    // Restore selection if still valid, otherwise reset
    if (currentValue && toolMap[currentValue]) {
      select.value = currentValue;
    } else {
      select.value = 'All';
    }
  }

  function populateSelect(elementId, values, defaultLabel, currentValue) {
    var select = document.getElementById(elementId);
    if (!select) return;

    select.innerHTML = '';

    var defaultOpt = document.createElement('option');
    defaultOpt.value = 'All';
    defaultOpt.textContent = defaultLabel;
    select.appendChild(defaultOpt);

    values.forEach(function (val) {
      var opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      select.appendChild(opt);
    });

    // Restore selection if still valid, otherwise reset
    var strVal = currentValue != null ? String(currentValue) : null;
    if (strVal && values.indexOf(strVal) !== -1) {
      select.value = strVal;
    } else if (strVal && values.map(String).indexOf(strVal) !== -1) {
      select.value = strVal;
    } else if (currentValue != null) {
      // Value no longer available - reset this filter
      select.value = 'All';
    }
  }

  function getCurrentFilters() {
    return {
      tool: getSelectValue('filter-tool'),
      year: getSelectValue('filter-year', true),
      imagery: getSelectValue('filter-imagery'),
      country: getSelectValue('filter-country'),
      org: getSelectValue('filter-org'),
      status: getSelectValue('filter-status'),
    };
  }

  function getSelectValue(id, asInt) {
    var el = document.getElementById(id);
    if (!el) return null;
    var val = el.value;
    if (val === 'All') return null;
    return asInt ? parseInt(val, 10) : val;
  }

  function handleFilterChange() {
    if (updating) return; // prevent re-entrant calls during dropdown refresh
    updating = true;

    var filters = getCurrentFilters();

    // Refresh all dropdowns to show only contextually valid options
    refreshDropdowns(filters);

    // Re-read filters in case any were reset during refresh
    filters = getCurrentFilters();

    updating = false;

    if (onFilterChange) {
      onFilterChange(filters);
    }
  }

  function resetFilters() {
    updating = true;
    FILTER_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = 'All';
    });
    // Repopulate with full dataset
    populateDropdowns();
    updating = false;
    handleFilterChange();
  }

  return {
    init: init,
    populateDropdowns: populateDropdowns,
    getCurrentFilters: getCurrentFilters,
    resetFilters: resetFilters,
  };
})();
