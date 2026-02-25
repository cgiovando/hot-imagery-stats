/**
 * Filter UI module — populates dropdowns and emits filter changes.
 */
window.DashboardFilters = (function () {
  'use strict';

  var onFilterChange = null;

  var FILTER_IDS = [
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

  function populateDropdowns() {
    var Data = window.DashboardData;

    populateSelect('filter-year', Data.getUniqueYears(), 'All years');

    populateSelect('filter-imagery', Data.getUniqueValues('imagery'), 'All sources');
    populateSelect('filter-country', Data.getUniqueValues('country'), 'All countries');
    populateSelect('filter-org', Data.getUniqueValues('org'), 'All organizations');
    populateSelect('filter-status', ['PUBLISHED', 'ARCHIVED', 'DRAFT'], 'All statuses');
  }

  function populateSelect(elementId, values, defaultLabel) {
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
  }

  function getCurrentFilters() {
    return {
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
    if (onFilterChange) {
      onFilterChange(getCurrentFilters());
    }
  }

  function resetFilters() {
    FILTER_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = 'All';
    });
    handleFilterChange();
  }

  return {
    init: init,
    populateDropdowns: populateDropdowns,
    getCurrentFilters: getCurrentFilters,
    resetFilters: resetFilters,
  };
})();
