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
    var qs = params.toString();
    var newURL = window.location.pathname + (qs ? '?' + qs : '');
    history.replaceState(null, '', newURL);
  }

  /** Apply URL params to filter dropdowns. */
  function applyURLFilters(urlFilters) {
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
            '<p class="text-gray-500">' + error.message + '</p>' +
            '<button onclick="location.reload()" ' +
            'class="mt-4 px-4 py-2 bg-hot-red text-white rounded-lg hover:bg-hot-red-dark">' +
            'Retry</button></div>';
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
    // Total projects
    setCardValue('card-total-projects', projects.length.toLocaleString());

    // Total area
    var totalArea = 0;
    projects.forEach(function (p) { totalArea += p.areaSqKm || 0; });
    setCardValue('card-total-area', Math.round(totalArea).toLocaleString());

    // % using Bing
    var bingCount = 0;
    projects.forEach(function (p) { if (p.imagery === 'Bing') bingCount++; });
    var pctBing = projects.length > 0 ? Math.round((bingCount / projects.length) * 100) : 0;
    setCardValue('card-pct-bing', pctBing + '%');

    // Unique countries
    var countries = {};
    projects.forEach(function (p) {
      if (p.country && Array.isArray(p.country)) {
        p.country.forEach(function (c) { if (c) countries[c] = true; });
      }
    });
    setCardValue('card-countries', Object.keys(countries).length.toLocaleString());
  }

  function setCardValue(cardId, value) {
    var card = document.getElementById(cardId);
    if (!card) return;
    var valueEl = card.querySelector('.card-value');
    if (valueEl) valueEl.textContent = value;
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
