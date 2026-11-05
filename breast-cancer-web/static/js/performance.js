(() => {
  "use strict";
  const { T, $, api, lang } = window.CS;
  const L = lang === "ar" ? "ar" : "en";
  const METRICS = ["accuracy", "precision", "recall", "f1", "roc_auc"];
  const PALETTE = { ann: "--primary", svm: "#14a89b", rf: "#8b6cf0", knn: "#e8a838", dt: "#7a8ba0" };
  let results = null, info = null, selected = "ann";
  const charts = {};
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const color = (id) => PALETTE[id].startsWith("--") ? cssVar(PALETTE[id]) : PALETTE[id];
  const fmtKpi = (k, v) => k === "roc_auc" ? v.toFixed(3) : (v * 100).toFixed(1) + "%";

  function renderKpis() {
    const src = info && info.test_metrics ? info.test_metrics : results.models[0].test;
    const host = $("#kpi-row"); host.innerHTML = "";
    METRICS.forEach((k) => {
      const d = document.createElement("div"); d.className = "kpi";
      d.innerHTML = "<small></small><strong></strong><span></span>";
      d.children[0].textContent = T("m." + k); d.children[1].textContent = fmtKpi(k, src[k]); d.children[2].textContent = T("pf.k_" + k);
      host.appendChild(d);
    });
  }

  function chartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = cssVar("--muted"); Chart.defaults.borderColor = cssVar("--line");
  }
  function make(id, cfg) { const c = document.getElementById(id); if (!c || !window.Chart) return; if (charts[id]) charts[id].destroy(); charts[id] = new Chart(c, cfg); }
  const yAxis = (min) => ({ min, max: 1, ticks: { callback: (v) => v.toFixed(2) }, title: { display: true, text: T("js.axis", { min }), font: { size: 11 } }, grid: { color: cssVar("--line") } });

  function renderCharts() {
    chartDefaults();
    const M = results.models;
    make("chart-compare", { type: "bar",
      data: { labels: METRICS.map((m) => T("m." + m)), datasets: M.map((m) => ({ label: m.name[L], data: METRICS.map((k) => m.test[k]), backgroundColor: color(m.id), borderRadius: 5, borderSkipped: false })) },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: yAxis(0.85), x: { grid: { display: false } } },
        plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(4)}` } } } } });
    make("chart-cv", { type: "bar",
      data: { labels: M.map((m) => m.name[L]), datasets: [
        { label: T("js.cv_recall"), data: M.map((m) => m.cv.recall), backgroundColor: cssVar("--primary"), borderRadius: 5 },
        { label: T("js.cv_f1"), data: M.map((m) => m.cv.f1), backgroundColor: "#14a89b", borderRadius: 5 } ] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: yAxis(0.88), x: { grid: { display: false } } },
        plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(4)}` } } } } });
    const imp = info && info.feature_importance;
    $("#importance-card").hidden = !(imp && imp.length);
    if (imp && imp.length) make("chart-imp", { type: "bar",
      data: { labels: imp.map((d) => T(`f.${d.feature}.l`)), datasets: [{ label: T("js.imp_label"), data: imp.map((d) => d.importance), backgroundColor: cssVar("--primary"), borderRadius: 5 }] },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, scales: { x: { beginAtZero: true, grid: { color: cssVar("--line") } }, y: { grid: { display: false } } }, plugins: { legend: { display: false } } } });
  }

  function renderTable() {
    const body = document.querySelector("#compare-table tbody"); body.innerHTML = "";
    const best = METRICS.map((k) => Math.max(...results.models.map((m) => m.test[k])));
    results.models.forEach((m) => {
      const tr = document.createElement("tr"), first = document.createElement("td"); first.textContent = m.name[L]; tr.appendChild(first);
      METRICS.forEach((k, i) => { const td = document.createElement("td"); td.textContent = m.test[k].toFixed(4); if (m.test[k] === best[i]) td.className = "best"; tr.appendChild(td); });
      body.appendChild(tr);
    });
  }

  function renderCM() {
    const chips = $("#cm-chips"); chips.innerHTML = "";
    results.models.forEach((m) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = m.name[L];
      b.setAttribute("aria-pressed", String(m.id === selected)); b.addEventListener("click", () => { selected = m.id; renderCM(); }); chips.appendChild(b);
    });
    const m = results.models.find((x) => x.id === selected), c = m.cm;
    const cell = (cls, n, k) => `<div class="cell ${cls}"><b>${n}</b><span>${T(k)}</span></div>`;
    $("#cm").innerHTML = `<div></div><div class="ax">${T("js.cm_pred_b")}</div><div class="ax">${T("js.cm_pred_m")}</div>` +
      `<div class="ax">${T("js.cm_act_b")}</div>${cell("good", c.tn, "js.cm_tn")}${cell("bad", c.fp, "js.cm_fp")}` +
      `<div class="ax">${T("js.cm_act_m")}</div>${cell("bad focus", c.fn, "js.cm_fn")}${cell("good", c.tp, "js.cm_tp")}`;
    $("#cm-note").textContent = T("js.cm_note", { name: m.name[L], fn: c.fn, tot: c.fn + c.tp, fp: c.fp });
  }

  Promise.all([fetch("/static/data/project_results.json").then((r) => r.json()), api("/api/model-info")]).then(([res, i]) => {
    results = res; info = i.ok ? i.data : null;
    renderKpis(); renderTable(); renderCM(); renderCharts();
    document.addEventListener("themechange", renderCharts);
  });
})();
