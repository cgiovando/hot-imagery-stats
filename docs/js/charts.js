/**
 * Charts module — renders Chart.js visualizations.
 */
window.DashboardCharts = (function () {
  'use strict';

  var IMAGERY_COLORS = {
    Bing: '#d73f3f',
    Esri: '#2b83ba',
    Mapbox: '#4264fb',
    Maxar: '#ff8c00',
    Custom: '#7b7b7b',
    Other: '#a3a3a3',
    'Not specified': '#d4d4d4',
  };

  var IMAGERY_ORDER = [
    'Bing',
    'Esri',
    'Mapbox',
    'Maxar',
    'Custom',
    'Other',
    'Not specified',
  ];

  var instances = {};

  function destroy(key) {
    if (instances[key]) {
      instances[key].destroy();
      delete instances[key];
    }
  }

  function updateAll(projects) {
    renderImageryProjects(projects);
    renderImageryArea(projects);
    renderTimeline(projects);
    renderCountries(projects);
  }

  /* ---- Projects by imagery ---- */
  function renderImageryProjects(projects) {
    var counts = {};
    projects.forEach(function (p) {
      var src = p.imagery || 'Not specified';
      counts[src] = (counts[src] || 0) + 1;
    });

    var labels = IMAGERY_ORDER.filter(function (s) { return counts[s]; });
    var data = labels.map(function (s) { return counts[s]; });
    var colors = labels.map(function (s) { return IMAGERY_COLORS[s] || '#999'; });

    destroy('imagery-projects');
    var ctx = document.getElementById('chart-imagery-projects');
    if (!ctx) return;

    instances['imagery-projects'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Projects',
            data: data,
            backgroundColor: colors,
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.parsed.x.toLocaleString() + ' projects';
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              callback: function (v) { return v.toLocaleString(); },
            },
          },
        },
      },
    });
  }

  /* ---- Area by imagery ---- */
  function renderImageryArea(projects) {
    var areas = {};
    projects.forEach(function (p) {
      var src = p.imagery || 'Not specified';
      areas[src] = (areas[src] || 0) + (p.areaSqKm || 0);
    });

    var labels = IMAGERY_ORDER.filter(function (s) { return areas[s]; });
    var data = labels.map(function (s) { return Math.round(areas[s]); });
    var colors = labels.map(function (s) { return IMAGERY_COLORS[s] || '#999'; });

    destroy('imagery-area');
    var ctx = document.getElementById('chart-imagery-area');
    if (!ctx) return;

    instances['imagery-area'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Area (km²)',
            data: data,
            backgroundColor: colors,
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.parsed.x.toLocaleString() + ' km²';
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              callback: function (v) { return v.toLocaleString(); },
            },
          },
        },
      },
    });
  }

  /* ---- Timeline (stacked by month) ---- */
  function renderTimeline(projects) {
    var monthlyData = {};

    projects.forEach(function (p) {
      if (!p.created) return;
      var month = p.created.substring(0, 7); // YYYY-MM
      var src = p.imagery || 'Not specified';
      if (!monthlyData[month]) monthlyData[month] = {};
      monthlyData[month][src] = (monthlyData[month][src] || 0) + 1;
    });

    var months = Object.keys(monthlyData).sort();

    var activeSources = {};
    Object.keys(monthlyData).forEach(function (m) {
      Object.keys(monthlyData[m]).forEach(function (src) {
        activeSources[src] = true;
      });
    });
    var sources = IMAGERY_ORDER.filter(function (s) { return activeSources[s]; });

    var datasets = sources.map(function (src) {
      return {
        label: src,
        data: months.map(function (m) { return monthlyData[m][src] || 0; }),
        backgroundColor: IMAGERY_COLORS[src] || '#999',
      };
    });

    destroy('timeline');
    var ctx = document.getElementById('chart-timeline');
    if (!ctx) return;

    instances['timeline'] = new Chart(ctx, {
      type: 'bar',
      data: { labels: months, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, padding: 12 },
          },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { maxTicksLimit: 24, maxRotation: 45, autoSkip: true },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: {
              callback: function (v) { return v.toLocaleString(); },
            },
          },
        },
      },
    });
  }

  /* ---- Top 20 countries ---- */
  function renderCountries(projects) {
    var counts = {};
    projects.forEach(function (p) {
      if (p.country && Array.isArray(p.country)) {
        p.country.forEach(function (c) {
          if (c) counts[c] = (counts[c] || 0) + 1;
        });
      }
    });

    var sorted = Object.keys(counts)
      .map(function (k) { return [k, counts[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 20);

    var labels = sorted.map(function (e) { return e[0]; });
    var data = sorted.map(function (e) { return e[1]; });

    destroy('countries');
    var ctx = document.getElementById('chart-countries');
    if (!ctx) return;

    instances['countries'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Projects',
            data: data,
            backgroundColor: '#d73f3f',
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.parsed.x.toLocaleString() + ' projects';
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              callback: function (v) { return v.toLocaleString(); },
            },
          },
        },
      },
    });
  }

  return {
    updateAll: updateAll,
    IMAGERY_COLORS: IMAGERY_COLORS,
  };
})();
