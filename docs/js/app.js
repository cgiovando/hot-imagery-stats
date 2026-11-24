/**
 * App module - initialization, wiring, and URL param sync.
 */
(function () {
  'use strict';

  // Filter keys that map to URL params
  var PARAM_KEYS = ['tool', 'year', 'imagery', 'country', 'org', 'status'];

  // Map param names to select element IDs
  var PARAM_TO_SELECT = {
    tool: 'filter-tool',
    year: 'filter-year',
    imagery: 'filter-imagery',
    country: 'filter-country',
    org: 'filter-org',
    status: 'filter-status',
  };

  /** Read filters from URL search params. */
  function filtersFromURL() {
    var params = new URLSearchParams(window.location.search);
    var filters = {};
    PARAM_KEYS.forEach(function (key) {
      var val = params.get(key);
      if (val) filters[key] = val;
    });
    if (params.get('all') === '1') filters.includeExcluded = true;
    return filters;
  }

  /** Write current filters to URL search params (replaceState, no reload). */
  function filtersToURL(filters) {
    var params = new URLSearchParams();
    PARAM_KEYS.forEach(function (key) {
      if (filters[key] && filters[key] !== 'All') {
        params.set(key, filters[key]);
      }
    });
    if (filters.includeExcluded) params.set('all', '1');
    var qs = params.toString();
    var newURL = window.location.pathname + (qs ? '?' + qs : '');
    history.replaceState(null, '', newURL);
  }

  /** Apply URL params to filter dropdowns. */
  function applyURLFilters(urlFilters) {
    if (urlFilters.includeExcluded) {
      var excl = document.getElementById('filter-include-excluded');
      if (excl) excl.checked = true;
    }
    Object.keys(urlFilters).forEach(function (key) {
      var selectId = PARAM_TO_SELECT[key];
      if (!selectId) return;
      var el = document.getElementById(selectId);
      if (!el) return;
      // Check if the value exists as an option
      var val = urlFilters[key];
      var found = false;
      for (var i = 0; i < el.options.length; i++) {
        if (el.options[i].value === val) { found = true; break; }
      }
      if (found) el.value = val;
    });
  }

  function init() {
    var loadingOverlay = document.getElementById('loading-overlay');

    window.DashboardData
      .loadData()
      .then(function () {
        // Show generated timestamp
        var generated = window.DashboardData.getGenerated();
        var tsEl = document.getElementById('data-timestamp');
        if (tsEl && generated) {
          var date = new Date(generated);
          tsEl.textContent =
            'Data updated: ' +
            date.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            });
        }

        // Populate filter dropdowns
        window.DashboardFilters.init(onFilterChange);
        window.DashboardFilters.populateDropdowns();

        // Apply URL params to dropdowns (if any)
        var urlFilters = filtersFromURL();
        if (Object.keys(urlFilters).length > 0) {
          applyURLFilters(urlFilters);
        }

        var csvBtn = document.getElementById('btn-download-csv');
        if (csvBtn) csvBtn.addEventListener('click', downloadCSV);

        window.DashboardCharts.init();

        // Initialize map
        window.DashboardMap.init();

        // Trigger initial filter (reads current dropdown state)
        var filters = window.DashboardFilters.getCurrentFilters();
        var projects = window.DashboardData.applyFilters(filters);
        updateDashboard(projects);

        // Hide loading overlay
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
      })
      .catch(function (error) {
        console.error('Failed to initialize dashboard:', error);
        if (loadingOverlay) {
          loadingOverlay.innerHTML =
            '<div class="text-center p-8">' +
            '<p class="text-xl text-gray-700 mb-2">Failed to load data</p>' +
            '<p class="text-gray-500" id="load-error-msg"></p>' +
            '<button onclick="location.reload()" ' +
            'class="mt-4 px-4 py-2 bg-hot-red text-white rounded-lg hover:bg-hot-red-dark">' +
            'Retry</button></div>';
          var msg = document.getElementById('load-error-msg');
          if (msg) msg.textContent = error.message;
        }
      });
  }

  function onFilterChange(filters) {
    var projects = window.DashboardData.applyFilters(filters);
    filtersToURL(filters);
    updateDashboard(projects);
  }

  function updateDashboard(projects) {
    updateSummaryCards(projects);
    window.DashboardCharts.updateAll(projects);
    window.DashboardMap.updateMarkers(projects);
  }

  function updateSummaryCards(projects) {
    setCardValue('card-total-projects', projects.length.toLocaleString());

    var totalArea = 0, bingArea = 0, unspecifiedArea = 0;
    projects.forEach(function (p) {
      var a = p.areaSqKm || 0;
      totalArea += a;
      if (p.imagery === 'Bing') bingArea += a;
      if (!p.imagery || p.imagery === 'Not specified') unspecifiedArea += a;
    });
    setCardValue('card-total-area', Math.round(totalArea).toLocaleString());
    setCardValue('card-bing-area', Math.round(bingArea).toLocaleString());

    // Bing share is shown next to the unspecified share so it is never read
    // as a share of all imagery.
    var note = '';
    if (totalArea > 0) {
      note = pct(bingArea, totalArea) + ' of area';
      if (unspecifiedArea > 0) note += ' \u00b7 ' + pct(unspecifiedArea, totalArea) + ' source not specified';
    }
    setCardNote('card-bing-area', note);

    var countries = {};
    projects.forEach(function (p) {
      (p.country || []).forEach(function (c) { if (c) countries[c] = true; });
    });
    setCardValue('card-countries', Object.keys(countries).length.toLocaleString());
  }

  function pct(part, whole) {
    var v = (part / whole) * 100;
    return (v > 0 && v < 1 ? '<1' : Math.round(v)) + '%';
  }

  function setCardValue(cardId, value) {
    var card = document.getElementById(cardId);
    if (!card) return;
    var valueEl = card.querySelector('.card-value');
    if (valueEl) valueEl.textContent = value;
  }

  function setCardNote(cardId, text) {
    var card = document.getElementById(cardId);
    if (!card) return;
    var el = card.querySelector('.card-note');
    if (el) el.textContent = text;
  }

  function downloadCSV() {
    var csv = window.DashboardData.toCSV(window.DashboardData.getFilteredProjects());
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'hot-imagery-projects-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
