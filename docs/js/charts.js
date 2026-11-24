/**
 * Charts module - renders Chart.js visualizations.
 */
window.DashboardCharts = (function () {
  'use strict';

  var Data = window.DashboardData;
  var IMAGERY_COLORS = Data.IMAGERY_COLORS;
  var IMAGERY_ORDER = Data.IMAGERY_ORDER;

  var instances = {};
  var lastProjects = [];
  var timelineGranularity = 'year'; // 'year' | 'month'

  function destroy(key) {
    if (instances[key]) {
      instances[key].destroy();
      delete instances[key];
    }
  }

  function color(src) { return IMAGERY_COLORS[src] || '#999'; }
  function fmt(v) { return Math.round(v).toLocaleString(); }

  function init() {
    var toggle = document.getElementById('timeline-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-granularity]');
      if (!btn) return;
      timelineGranularity = btn.getAttribute('data-granularity');
      Array.prototype.forEach.call(toggle.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      renderTimeline(lastProjects);
    });
  }

  function updateAll(projects) {
    lastProjects = projects;
    renderImageryBars(projects, 'imagery-projects', 'chart-imagery-projects', function () { return 1; }, ' projects');
    renderImageryBars(projects, 'imagery-area', 'chart-imagery-area', function (p) { return p.areaSqKm || 0; }, ' km²');
    renderAreaByYear(projects);
    renderTimeline(projects);
    renderCountries(projects);
  }

  /** Sum `valueFn` per imagery source. */
  function totalsByImagery(projects, valueFn) {
    var totals = {};
    projects.forEach(function (p) {
      var src = p.imagery || 'Not specified';
      totals[src] = (totals[src] || 0) + valueFn(p);
    });
    return totals;
  }

  /** Sum `valueFn` per (bucket, imagery source); returns stacked datasets. */
  function stackedByImagery(projects, bucketFn, valueFn) {
    var buckets = {};
    var active = {};
    projects.forEach(function (p) {
      var b = bucketFn(p);
      if (b == null) return;
      var src = p.imagery || 'Not specified';
      if (!buckets[b]) buckets[b] = {};
      buckets[b][src] = (buckets[b][src] || 0) + valueFn(p);
      active[src] = true;
    });
    return { buckets: buckets, sources: IMAGERY_ORDER.filter(function (s) { return active[s]; }) };
  }

  function datasetsFor(stack, labels) {
    return stack.sources.map(function (src) {
      return {
        label: src,
        data: labels.map(function (l) { return Math.round((stack.buckets[l] || {})[src] || 0); }),
        backgroundColor: color(src),
      };
    });
  }

  function horizontalBarOptions(unit) {
    return {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function (ctx) { return fmt(ctx.parsed.x) + unit; } } },
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: function (v) { return v.toLocaleString(); } } },
        y: { ticks: { autoSkip: false } },
      },
    };
  }

  function stackedOptions(unit, horizontal) {
    var valueAxis = horizontal ? 'x' : 'y';
    var catAxis = horizontal ? 'y' : 'x';
    var scales = {};
    scales[valueAxis] = {
      stacked: true,
      beginAtZero: true,
      ticks: { callback: function (v) { return v.toLocaleString(); } },
    };
    scales[catAxis] = { stacked: true, ticks: { autoSkip: horizontal ? false : true, maxRotation: 45 } };
    return {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
        tooltip: {
          mode: 'index',
          intersect: false,
          filter: function (item) { return item.raw > 0; },
          callbacks: {
            label: function (ctx) { return ctx.dataset.label + ': ' + fmt(ctx.raw) + unit; },
            footer: function (items) {
              var total = items.reduce(function (s, i) { return s + i.raw; }, 0);
              return 'Total: ' + fmt(total) + unit;
            },
          },
        },
      },
      scales: scales,
    };
  }

  function draw(key, canvasId, config) {
    destroy(key);
    var ctx = document.getElementById(canvasId);
    if (!ctx) return;
    instances[key] = new Chart(ctx, config);
  }

  /* ---- Projects / area by imagery (horizontal bars) ---- */
  function renderImageryBars(projects, key, canvasId, valueFn, unit) {
    var totals = totalsByImagery(projects, valueFn);
    var labels = IMAGERY_ORDER.filter(function (s) { return totals[s]; });
    draw(key, canvasId, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          data: labels.map(function (s) { return Math.round(totals[s]); }),
          backgroundColor: labels.map(color),
          borderRadius: 4,
        }],
      },
      options: horizontalBarOptions(unit),
    });
  }

  function yearOf(p) {
    return p.created ? p.created.substring(0, 4) : null;
  }

  /* ---- Area by imagery per year (stacked) ---- */
  function renderAreaByYear(projects) {
    var stack = stackedByImagery(projects, yearOf, function (p) { return p.areaSqKm || 0; });
    var years = Object.keys(stack.buckets).sort();
    draw('area-year', 'chart-area-year', {
      type: 'bar',
      data: { labels: years, datasets: datasetsFor(stack, years) },
      options: stackedOptions(' km²', false),
    });
  }

  /* ---- Projects over time (stacked, yearly or monthly) ---- */
  function renderTimeline(projects) {
    var bucketFn = timelineGranularity === 'month'
      ? function (p) { return p.created ? p.created.substring(0, 7) : null; }
      : yearOf;
    var stack = stackedByImagery(projects, bucketFn, function () { return 1; });
    var labels = Object.keys(stack.buckets).sort();
    var options = stackedOptions(' projects', false);
    if (timelineGranularity === 'month') options.scales.x.ticks.maxTicksLimit = 24;
    draw('timeline', 'chart-timeline', {
      type: 'bar',
      data: { labels: labels, datasets: datasetsFor(stack, labels) },
      options: options,
    });
  }

  /* ---- Top 20 countries (stacked by imagery) ---- */
  function renderCountries(projects) {
    var counts = {};
    projects.forEach(function (p) {
      (p.country || []).forEach(function (c) { if (c) counts[c] = (counts[c] || 0) + 1; });
    });
    var top = Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, 20);
    var topSet = {};
    top.forEach(function (c) { topSet[c] = true; });

    // A project tagged with several countries counts once per country.
    var expanded = [];
    projects.forEach(function (p) {
      (p.country || []).forEach(function (c) {
        if (topSet[c]) expanded.push({ country: c, imagery: p.imagery });
      });
    });
    var stack = stackedByImagery(expanded, function (e) { return e.country; }, function () { return 1; });

    var wrap = document.getElementById('chart-countries-wrap');
    if (wrap) wrap.style.height = Math.max(180, top.length * 24 + 70) + 'px';

    draw('countries', 'chart-countries', {
      type: 'bar',
      data: { labels: top, datasets: datasetsFor(stack, top) },
      options: stackedOptions(' projects', true),
    });
  }

  return {
    init: init,
    updateAll: updateAll,
  };
})();
