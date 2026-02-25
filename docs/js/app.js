/**
 * App module — initialization and wiring.
 */
(function () {
  'use strict';

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

        // Initialize map
        window.DashboardMap.init();

        // Initial render
        var projects = window.DashboardData.getFilteredProjects();
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
