(() => {
  "use strict";
  const { T, $, $$, copyText } = window.CS;
  const FEATS = { clump_thickness: 8, uniformity_cell_size: 10, uniformity_cell_shape: 10, marginal_adhesion: 8, single_epithelial_cell_size: 6, bare_nuclei: 10, bland_chromatin: 7, normal_nucleoli: 10, mitoses: 1 };
  const BENIGN = { clump_thickness: 2, uniformity_cell_size: 1, uniformity_cell_shape: 1, marginal_adhesion: 1, single_epithelial_cell_size: 2, bare_nuclei: 1, bland_chromatin: 2, normal_nucleoli: 1, mitoses: 1 };
  const ENDPOINTS = {
    predict: { method: "POST", path: "/api/predict", body: { features: FEATS } },
    batch: { method: "POST", path: "/api/predict/batch", body: { rows: [{ id: "A-001", features: BENIGN }, { id: "A-002", features: FEATS }] } },
    info: { method: "GET", path: "/api/model-info" },
    health: { method: "GET", path: "/health" },
  };

  /* code sample tabs */
  let active = "curl";
  $$(".code-tab").forEach((tab) => tab.addEventListener("click", () => {
    active = tab.dataset.code;
    $$(".code-tab").forEach((t) => { const on = t === tab; t.classList.toggle("is-active", on); t.setAttribute("aria-selected", String(on)); });
    $$("[data-code-panel]").forEach((p) => { p.hidden = p.dataset.codePanel !== active; });
  }));
  $("#code-copy").addEventListener("click", () => copyText($(`[data-code-panel="${active}"]`).textContent));

  /* try-it console */
  const select = $("#try-endpoint"), body = $("#try-body"), out = $("#try-out code"), pill = $("#try-status");
  function load() {
    const e = ENDPOINTS[select.value];
    body.value = e.body ? JSON.stringify(e.body, null, 2) : ""; body.disabled = !e.body;
  }
  select.addEventListener("change", load); load();
  $("#try-send").addEventListener("click", async () => {
    const e = ENDPOINTS[select.value], btn = $("#try-send");
    let payload;
    if (e.body) { try { payload = JSON.parse(body.value); } catch (err) { out.textContent = "JSON: " + err.message; pill.hidden = false; pill.className = "status-pill status-pill--err"; pill.textContent = "400"; return; } }
    btn.disabled = true; const t0 = performance.now();
    try {
      const res = await fetch(e.path, { method: e.method, headers: payload ? { "Content-Type": "application/json" } : undefined, body: payload ? JSON.stringify(payload) : undefined });
      const text = await res.text(); let shown = text; try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch (_) { /* keep raw */ }
      out.textContent = shown; pill.hidden = false; pill.className = "status-pill " + (res.ok ? "status-pill--ok" : "status-pill--err");
      pill.textContent = `${res.status} · ${Math.round(performance.now() - t0)} ms`;
    } catch (_) { out.textContent = T("js.err_network"); pill.hidden = false; pill.className = "status-pill status-pill--err"; pill.textContent = "—"; }
    btn.disabled = false;
  });
})();
