(() => {
  "use strict";
  const { T, $, $$, FEATURES, PRESETS, fname, pct, scoreColor, api, toast, copyText, setGauge, renderExplain, lang, maxBatch } = window.CS;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const locale = lang === "ar" ? "ar-EG" : "en-GB";
  const ORDER = ["clump_thickness", "uniformity_cell_size", "uniformity_cell_shape", "marginal_adhesion", "single_epithelial_cell_size", "bare_nuclei", "bland_chromatin", "normal_nucleoli", "mitoses"];

  /* =====================================================  tabs */
  const tabs = [$("#tab-single"), $("#tab-batch")], panels = [$("#panel-single"), $("#panel-batch")];
  function showTab(i, focus) {
    tabs.forEach((t, k) => { const on = k === i; t.classList.toggle("is-active", on); t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; panels[k].hidden = !on; });
    if (focus) tabs[i].focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => { showTab(i); history.replaceState(null, "", i ? "#batch" : location.pathname); });
    t.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") showTab(1 - i, true); });
  });
  const fromHash = () => showTab(location.hash === "#batch" ? 1 : 0);
  window.addEventListener("hashchange", fromHash); fromHash();

  /* =====================================================  single sample: form */
  function buildForm() {
    const host = $("#groups");
    ["size", "nucleus", "tissue"].forEach((g) => {
      const sec = el("section", "group"); sec.appendChild(el("h3", "", T("g." + g)));
      const grid = el("div", "fields");
      FEATURES.filter((f) => f.group === g).forEach((f) => {
        const row = el("div", "fld"); row.dataset.key = f.key;
        row.innerHTML = `<div class="fld__top"><label for="in-${f.key}"></label><output class="score" for="in-${f.key}" id="out-${f.key}">1</output></div>
          <p class="desc"></p>
          <input type="range" id="in-${f.key}" min="1" max="10" step="1" value="1">
          <div class="ticks" aria-hidden="true">${[1,2,3,4,5,6,7,8,9,10].map((n) => `<span>${n}</span>`).join("")}</div>
          ${f.optional ? `<label class="unknown"><input type="checkbox" id="unk-${f.key}"><span></span></label>` : ""}`;
        $("label", row).textContent = fname(f.key); $(".desc", row).textContent = T(`f.${f.key}.d`);
        if (f.optional) $(".unknown span", row).textContent = T("js.unknown");
        const input = $("input[type=range]", row), out = $("output", row);
        row._paint = () => { row.style.setProperty("--vc", scoreColor(+input.value)); out.textContent = input.disabled ? "—" : input.value; };
        input.addEventListener("input", row._paint); row._paint();
        if (f.optional) {
          const unk = $(`#unk-${f.key}`, row);
          unk.addEventListener("change", () => { input.disabled = unk.checked; row.classList.toggle("is-off", unk.checked); row._paint(); });
        }
        grid.appendChild(row);
      });
      sec.appendChild(grid); host.appendChild(sec);
    });
  }
  function setValues(values) {
    FEATURES.forEach((f) => {
      const row = $(`.fld[data-key="${f.key}"]`), input = $("input[type=range]", row);
      const missing = values[f.key] === null || values[f.key] === undefined;
      if (f.optional) { const unk = $(`#unk-${f.key}`, row); unk.checked = missing; input.disabled = missing; row.classList.toggle("is-off", missing); }
      if (!missing) input.value = values[f.key];
      row._paint();
    });
  }
  function readValues() {
    const out = {};
    FEATURES.forEach((f) => { const i = $(`#in-${f.key}`); out[f.key] = i.disabled ? null : Number(i.value); });
    return out;
  }

  /* =====================================================  single sample: result */
  let current = null;
  const history = [];
  const showState = (s) => { $("#result-empty").hidden = s !== "empty"; $("#result-body").hidden = s !== "body"; $("#result-error").hidden = s !== "error"; };
  const verdictText = (r) => T(r.label === "malignant" ? "js.verdict_malignant" : "js.verdict_benign");
  const probText = (r) => r.label === "malignant" ? T("js.prob_text_malignant", { p: pct(r.probability_malignant) }) : T("js.prob_text_benign", { p: pct(r.probability_benign) });

  function render(entry) {
    const r = entry.result, mal = r.label === "malignant";
    setGauge("res", r.probability_malignant);
    $("#verdict").className = "verdict " + (mal ? "verdict--mal" : "verdict--ben");
    $("#verdict-label").textContent = verdictText(r);
    $("#verdict-prob").textContent = probText(r);
    $("#confidence").textContent = T("js.conf_" + r.confidence);
    $("#p-mal").textContent = pct(r.probability_malignant) + "%";
    $("#p-ben").textContent = pct(r.probability_benign) + "%";
    $("#borderline").hidden = r.confidence !== "uncertain";
    $("#imputed").hidden = !(r.imputed && r.imputed.length);
    $("#explain-box").hidden = !(r.explanation && r.explanation.length);
    renderExplain($("#explain-list"), r.explanation || []);
    showState("body");
  }

  async function analyze(ev) {
    ev.preventDefault();
    const btn = $("#analyze-btn"); btn.disabled = true; btn.textContent = T("js.analyzing");
    const inputs = readValues(), ref = $("#ref").value.trim();
    const r = await api("/api/predict", { method: "POST", body: { features: inputs } });
    btn.disabled = false; btn.textContent = T("js.analyze");
    if (!r.ok) { $("#result-error").textContent = r.error; showState("error"); current = null; return; }
    current = { inputs, ref, result: r.data, time: new Date() };
    render(current); addHistory(current);
    if (window.matchMedia("(max-width: 980px)").matches) $("#result-title").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function addHistory(entry) {
    history.unshift(entry); if (history.length > 8) history.pop();
    const list = $("#history-list"); list.innerHTML = "";
    history.forEach((h) => {
      const li = el("li"), b = el("button", "history__item"); b.type = "button";
      const mal = h.result.label === "malignant";
      b.append(el("span", "pill " + (mal ? "pill--mal" : "pill--ben"), verdictText(h.result)),
               el("span", "", h.ref || "—"), el("strong", "", pct(h.result.probability_malignant) + "%"),
               el("small", "", h.time.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })));
      b.addEventListener("click", () => { setValues(h.inputs); $("#ref").value = h.ref; current = h; render(h); $("#result").scrollIntoView({ behavior: "smooth", block: "nearest" }); });
      li.appendChild(b); list.appendChild(li);
    });
    $("#history").hidden = false;
  }

  function summaryText(e) {
    const refPart = e.ref ? `${e.ref}: ` : "";
    return `${refPart}${verdictText(e.result)} (${probText(e.result)}). ${T("js.rep_notice")}`;
  }

  function buildReport(e) {
    const rep = $("#report"); rep.innerHTML = "";
    const brandName = ($(".brand__name") || {}).textContent || "";
    const head = el("div", "rep-head"), left = el("div");
    left.append(el("h1", "", T("js.rep_title")), el("div", "rep-meta", brandName));
    head.append(left, el("div", "rep-meta", e.time.toLocaleString(locale)));
    rep.appendChild(head);
    const meta = el("table"); const tb = el("tbody");
    const tr = el("tr"); tr.append(el("th", "", T("js.rep_ref")), el("td", "", e.ref || T("js.na"))); tb.appendChild(tr); meta.appendChild(tb); rep.appendChild(meta);
    const mal = e.result.label === "malignant";
    rep.appendChild(el("div", "rep-verdict " + (mal ? "mal" : "ben"), `${verdictText(e.result)} · ${probText(e.result)}`));
    rep.appendChild(el("p", "", T("js.conf_" + e.result.confidence)));
    const t = el("table"), th = el("thead"), hr = el("tr");
    hr.append(el("th", "", T("js.rep_measure")), el("th", "", T("js.rep_score"))); th.appendChild(hr); t.appendChild(th);
    const body = el("tbody");
    ORDER.forEach((k) => { const r = el("tr"); r.append(el("td", "", fname(k)), el("td", "", e.inputs[k] === null ? T("js.na") : String(e.inputs[k]))); body.appendChild(r); });
    t.appendChild(body); rep.appendChild(t);
    rep.appendChild(el("h2", "", T("js.rep_factors")));
    const ul = el("ul", "explain-list"); rep.appendChild(ul); renderExplain(ul, e.result.explanation || []);
    rep.appendChild(el("p", "rep-notice", T("js.rep_notice")));
  }

  /* =====================================================  single sample: wiring */
  buildForm();
  $("#form").addEventListener("submit", analyze);
  $("#preset-benign").addEventListener("click", () => setValues(PRESETS.benign));
  $("#preset-malignant").addEventListener("click", () => setValues(PRESETS.malignant));
  const reset = () => { setValues(Object.fromEntries(FEATURES.map((f) => [f.key, 1]))); $("#ref").value = ""; current = null; showState("empty"); };
  $("#reset").addEventListener("click", reset);
  $("#new-btn").addEventListener("click", () => { reset(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  $("#copy-btn").addEventListener("click", () => current && copyText(summaryText(current)));
  $("#print-btn").addEventListener("click", () => { if (!current) return; buildReport(current); setTimeout(() => window.print(), 250); });
  $("#history-clear").addEventListener("click", () => { history.length = 0; $("#history").hidden = true; toast(T("js.cleared")); });

  /* =====================================================  batch */
  let parsed = null, results = [], filter = "all", sort = { key: "index", dir: 1 };
  const fileInput = $("#file"), dz = $("#dropzone");
  const batchError = (msg) => { const b = $("#batch-error"); b.textContent = msg || ""; b.hidden = !msg; };

  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const first = text.split(/\r?\n/, 1)[0] || "";
    const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
      else cur += c;
    }
    row.push(cur); if (row.some((x) => x.trim() !== "")) rows.push(row);
    return rows;
  }

  async function handleFile(file) {
    batchError(""); $("#batch-results").hidden = true;
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/.test(file.type)) return batchError(T("js.b_err_type"));
    if (file.size > 3 * 1024 * 1024) return batchError(T("js.b_err_many", { max: maxBatch }));
    let text; try { text = await file.text(); } catch (_) { return batchError(T("js.b_err_read")); }
    const table = parseCsv(text);
    if (table.length < 2) return batchError(T("js.b_err_empty"));
    const norm = (h) => h.trim().toLowerCase().replace(/[\s\-]+/g, "_");
    const header = table[0].map(norm);
    const idIdx = header.findIndex((h) => ["id", "sample_id", "sample", "reference", "ref", "case"].includes(h));
    const idx = Object.fromEntries(FEATURES.map((f) => [f.key, header.indexOf(f.key)]));
    const missing = FEATURES.filter((f) => !f.optional && idx[f.key] < 0).map((f) => f.key);
    if (missing.length) return batchError(T("js.b_err_cols", { cols: missing.join(", ") }));
    const data = table.slice(1);
    if (data.length > maxBatch) return batchError(T("js.b_err_many", { max: maxBatch }));
    parsed = { file, rows: data.map((r) => {
      const features = {};
      FEATURES.forEach((f) => {
        const raw = idx[f.key] < 0 ? "" : (r[idx[f.key]] || "").trim();
        const n = Number(raw);
        features[f.key] = raw === "" || raw === "?" ? null : (Number.isFinite(n) ? n : raw);
      });
      return { id: idIdx >= 0 ? (r[idIdx] || "").trim() || null : null, features };
    }) };
    $("#file-name").textContent = file.name; $("#file-rows").textContent = T("js.b_rows", { n: parsed.rows.length });
    $("#file-chip").hidden = false; $("#batch-run").disabled = false;
  }

  function clearFile() { parsed = null; results = []; fileInput.value = ""; $("#file-chip").hidden = true; $("#batch-run").disabled = true; $("#batch-results").hidden = true; batchError(""); }
  dz.addEventListener("click", () => fileInput.click());
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("is-drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("is-drag"); }));
  dz.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
  fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
  $("#file-remove").addEventListener("click", clearFile);

  const csvCell = (v) => { let s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function download(name, text) {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }));
    const a = el("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("#template-btn").addEventListener("click", () => {
    const rows = [["id", ...ORDER], ["SAMPLE-001", ...ORDER.map((k) => PRESETS.benign[k])], ["SAMPLE-002", ...ORDER.map((k) => PRESETS.malignant[k])]];
    download("batch-template.csv", rows.map((r) => r.map(csvCell).join(",")).join("\r\n"));
  });

  $("#batch-run").addEventListener("click", async () => {
    if (!parsed) return;
    const btn = $("#batch-run"); btn.disabled = true; btn.textContent = T("js.b_processing"); batchError("");
    const r = await api("/api/predict/batch", { method: "POST", body: { rows: parsed.rows } });
    btn.textContent = T("js.b_analyze"); btn.disabled = false;
    if (!r.ok) return batchError(r.error);
    results = r.data.results; filter = "all"; sort = { key: "index", dir: 1 };
    renderSummary(r.data.summary); renderBatch(); $("#batch-results").hidden = false;
    $("#batch-results").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const CONF_RANK = { high: 0, moderate: 1, uncertain: 2 };
  const matches = (r, f) => f === "all" || (f === "errors" ? r.status === "error" : r.status === "ok" && (f === "uncertain" ? r.confidence === "uncertain" : r.label === f));
  function renderSummary(s) {
    const tiles = [["b.sum_rows", s.rows, ""], ["b.sum_malignant", s.malignant, "tile--mal"], ["b.sum_benign", s.benign, "tile--ben"], ["b.sum_uncertain", s.uncertain, "tile--unc"], ["b.sum_errors", s.errors, ""]];
    const host = $("#summary"); host.innerHTML = "";
    tiles.forEach(([k, v, cls]) => { const t = el("div", "tile " + cls); t.append(el("small", "", T(k)), el("strong", "", String(v))); host.appendChild(t); });
  }
  function renderBatch() {
    const counts = { all: results.length, malignant: 0, benign: 0, uncertain: 0, errors: 0 };
    results.forEach((r) => { if (r.status === "error") counts.errors++; else { counts[r.label]++; if (r.confidence === "uncertain") counts.uncertain++; } });
    const fl = $("#filters"); fl.innerHTML = "";
    [["all", "b.f_all"], ["malignant", "b.f_malignant"], ["benign", "b.f_benign"], ["uncertain", "b.f_uncertain"], ["errors", "b.f_errors"]].forEach(([k, lk]) => {
      if (k === "errors" && !counts.errors) return;
      const b = el("button", "chip", `${T(lk)} · ${counts[k]}`); b.type = "button"; b.setAttribute("aria-pressed", String(filter === k));
      b.addEventListener("click", () => { filter = k; renderBatch(); }); fl.appendChild(b);
    });
    const val = (r) => ({ index: r.index, id: (r.id || "").toLowerCase(), label: r.label || "zzz", p: r.probability_malignant ?? -1, confidence: CONF_RANK[r.confidence] ?? 9 })[sort.key];
    const list = results.filter((r) => matches(r, filter)).sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    $$("#batch-table thead th").forEach((th) => th.setAttribute("aria-sort", th.dataset.sort === sort.key ? (sort.dir > 0 ? "ascending" : "descending") : "none"));
    const body = $("#batch-table tbody"); body.innerHTML = "";
    if (!list.length) { const tr = el("tr"), td = el("td", "", T("js.b_none")); td.colSpan = 6; td.style.textAlign = "center"; tr.appendChild(td); body.appendChild(tr); return; }
    list.forEach((r) => {
      const tr = el("tr");
      tr.appendChild(el("td", "", String(r.index + 1))); tr.appendChild(el("td", "", r.id || "—"));
      const v = el("td"), c = el("td"), p = el("td"), n = el("td");
      if (r.status === "ok") {
        const mal = r.label === "malignant";
        v.appendChild(el("span", "pill " + (mal ? "pill--mal" : "pill--ben"), T(mal ? "js.b_verdict_malignant" : "js.b_verdict_benign")));
        p.textContent = pct(r.probability_malignant) + "%";
        c.appendChild(el("span", "pill " + (r.confidence === "uncertain" ? "pill--unc" : "pill--err"), T("js.b_conf_" + r.confidence)));
        n.textContent = r.imputed && r.imputed.length ? T("js.b_imputed") : "";
      } else { v.appendChild(el("span", "pill pill--err", "—")); p.textContent = "—"; c.textContent = "—"; n.textContent = r.error; n.style.color = "var(--malignant)"; }
      tr.append(v, p, c, n); body.appendChild(tr);
    });
  }
  $$("#batch-table thead th[data-sort]").forEach((th) => th.addEventListener("click", () => { sort = { key: th.dataset.sort, dir: sort.key === th.dataset.sort ? -sort.dir : 1 }; renderBatch(); }));

  $("#export-btn").addEventListener("click", () => {
    const head = ["row", "id", "verdict", "probability_malignant", "confidence", "notes", ...ORDER];
    const lines = [head.map(csvCell).join(",")];
    results.forEach((r) => {
      const f = parsed.rows[r.index].features;
      lines.push([r.index + 1, r.id, r.status === "ok" ? r.label : "error", r.probability_malignant, r.confidence, r.status === "ok" ? (r.imputed && r.imputed.length ? "bare_nuclei imputed" : "") : r.error, ...ORDER.map((k) => f[k])].map(csvCell).join(","));
    });
    download(`batch-results-${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\r\n"));
  });
})();
