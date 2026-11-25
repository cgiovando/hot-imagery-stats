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
    'filter-year-from',
    'filter-year-to',
    'filter-imagery',
    'filter-country',
    'filter-org',
    'filter-status',
    'filter-driver',
  ];

  function init(callback) {
    onFilterChange = callback;

    FILTER_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', handleFilterChange);
    });

    var excl = document.getElementById('filter-include-excluded');
    if (excl) excl.addEventListener('change', handleFilterChange);
    var ment = document.getElementById('filter-include-mentioned');
    if (ment) ment.addEventListener('change', handleFilterChange);

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

    populateSelect('filter-year-from', Data.getUniqueYears(), 'From: any', null, 'From ');
    populateSelect('filter-year-to', Data.getUniqueYears(), 'To: any', null, 'To ');
    populateSelect('filter-imagery', Data.getUniqueValues('imagery'), 'All imagery', null);
    populateSelect('filter-country', Data.getUniqueValues('country'), 'All countries', null);
    populateSelect('filter-org', Data.getUniqueValues('org'), 'All organizations', null);
    populateSelect('filter-status', Data.getUniqueValues('status'), 'All statuses', null);
    populateDriverSelect(Data.getAvailableValues('driver', {}), null);

    var exclLabel = document.getElementById('excluded-count');
    if (exclLabel) exclLabel.textContent = Data.getExcludedCount().toLocaleString();
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
    populateSelect('filter-year-from', years, 'From: any', filters.yearFrom, 'From ');
    populateSelect('filter-year-to', years, 'To: any', filters.yearTo, 'To ');

    // Imagery
    var imgVals = Data.getAvailableValues('imagery', filters);
    populateSelect('filter-imagery', Object.keys(imgVals).sort(), 'All imagery', filters.imagery);

    // Country
    var countryVals = Data.getAvailableValues('country', filters);
    populateSelect('filter-country', Object.keys(countryVals).sort(), 'All countries', filters.country);

    // Org
    var orgVals = Data.getAvailableValues('org', filters);
    populateSelect('filter-org', Object.keys(orgVals).sort(), 'All organizations', filters.org);

    // Status
    var statusVals = Data.getAvailableValues('status', filters);
    populateSelect('filter-status', Object.keys(statusVals).sort(), 'All statuses', filters.status);

    populateDriverSelect(Data.getAvailableValues('driver', filters), filters.driver);
  }

  /** Driver dropdown: labelled keys in taxonomy order, then "No driver". */
  function populateDriverSelect(available, currentValue) {
    var select = document.getElementById('filter-driver');
    if (!select) return;
    var Data = window.DashboardData;
    var labels = Data.getDriverLabels();
    select.innerHTML = '';
    var add = function (value, text) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      select.appendChild(opt);
    };
    add('All', 'All drivers');
    Object.keys(labels).forEach(function (k) {
      if (available[k]) add(k, labels[k]);
    });
    if (available[Data.NO_DRIVER]) add(Data.NO_DRIVER, 'No driver identified');
    select.value = currentValue && available[currentValue] ? currentValue : 'All';
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

  function populateSelect(elementId, values, defaultLabel, currentValue, prefix) {
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
      opt.textContent = (prefix || '') + val;
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
      yearFrom: getSelectValue('filter-year-from', true),
      yearTo: getSelectValue('filter-year-to', true),
      imagery: getSelectValue('filter-imagery'),
      country: getSelectValue('filter-country'),
      org: getSelectValue('filter-org'),
      status: getSelectValue('filter-status'),
      driver: getSelectValue('filter-driver'),
      includeExcluded: isIncludeExcluded(),
      includeMentioned: isChecked('filter-include-mentioned'),
    };
  }

  /** Highlight filters that are set, update the More badge and Reset. */
  function markActive() {
    var f = getCurrentFilters();
    FILTER_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle('is-active', el.value !== 'All');
    });
    var more = (f.status ? 1 : 0) + (f.includeExcluded ? 1 : 0) + (f.includeMentioned ? 1 : 0);
    var badge = document.getElementById('more-badge');
    if (badge) {
      badge.textContent = more;
      badge.hidden = more === 0;
    }
    var any = more > 0 || FILTER_IDS.some(function (id) {
      var el = document.getElementById(id);
      return el && el.value !== 'All';
    });
    var reset = document.getElementById('btn-reset-filters');
    if (reset) reset.setAttribute('aria-disabled', any ? 'false' : 'true');
  }

  function isChecked(id) {
    var el = document.getElementById(id);
    return !!(el && el.checked);
  }

  function isIncludeExcluded() {
    var el = document.getElementById('filter-include-excluded');
    return !!(el && el.checked);
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
    var excl = document.getElementById('filter-include-excluded');
    if (excl) excl.checked = false;
    var ment = document.getElementById('filter-include-mentioned');
    if (ment) ment.checked = false;
    // Repopulate with full dataset
    populateDropdowns();
    updating = false;
    handleFilterChange();
  }

  return {
    init: init,
    populateDropdowns: populateDropdowns,
    getCurrentFilters: getCurrentFilters,
    markActive: markActive,
    resetFilters: resetFilters,
  };
})();
