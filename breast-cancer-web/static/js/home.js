(() => {
  "use strict";
  const { T, $, $$, PRESETS, api, pct, setGauge, renderExplain } = window.CS;

  /* ----- live demo card ----- */
  const verdict = $("#mock-verdict"), label = $("#mock-verdict-label"), prob = $("#mock-verdict-prob"), bars = $("#mock-bars");
  async function runDemo(kind) {
    $$("[data-demo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.demo === kind)));
    const r = await api("/api/predict", { method: "POST", body: { features: PRESETS[kind] } });
    if (!r.ok) { label.textContent = "—"; prob.textContent = ""; setGauge("mock", 0); bars.innerHTML = ""; return; }
    const d = r.data, mal = d.label === "malignant";
    setGauge("mock", d.probability_malignant);
    verdict.className = "verdict " + (mal ? "verdict--mal" : "verdict--ben");
    label.textContent = T(mal ? "js.verdict_malignant" : "js.verdict_benign");
    prob.textContent = mal ? T("js.prob_text_malignant", { p: pct(d.probability_malignant) }) : T("js.prob_text_benign", { p: pct(d.probability_benign) });
    bars.innerHTML = "";
    const top = d.explanation.slice(0, 4), max = Math.max(0.01, ...top.map((e) => Math.abs(e.influence)));
    top.forEach((e) => {
      const li = document.createElement("li"), pos = e.influence >= 0;
      li.innerHTML = '<span></span><div class="track"><i class="fill"></i></div>';
      li.firstChild.textContent = T(`f.${e.feature}.l`);
      const fill = li.querySelector(".fill");
      fill.style.background = pos ? "#ff6b96" : "#35c9b8";
      bars.appendChild(li);
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = (Math.abs(e.influence) / max * 100) + "%"; }));
    });
  }
  $$("[data-demo]").forEach((b) => b.addEventListener("click", () => runDemo(b.dataset.demo)));
  if ($("#mock")) runDemo("malignant");

  /* ----- model comparison teaser (F1-score, test set) ----- */
  const host = $("#home-compare");
  if (host) fetch("/static/data/project_results.json").then((r) => r.json()).then((res) => {
    const lang = document.documentElement.lang === "ar" ? "ar" : "en";
    const rows = [...res.models].sort((a, b) => b.test.f1 - a.test.f1);
    host.innerHTML = `<h3 style="font-size:16px">${T("m.f1")}</h3>`;
    const min = 0.85;
    rows.forEach((m, i) => {
      const row = document.createElement("div");
      row.className = "bar-row" + (i === 0 ? " is-top" : "");
      row.innerHTML = '<span></span><div class="track"><i class="fill"></i></div><strong></strong>';
      row.firstChild.textContent = m.name[lang];
      row.querySelector("strong").textContent = m.test.f1.toFixed(3);
      host.appendChild(row);
      const fill = row.querySelector(".fill");
      const go = () => { fill.style.width = ((m.test.f1 - min) / (1 - min) * 100) + "%"; };
      if ("IntersectionObserver" in window) {
        new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { go(); o.disconnect(); } }, { threshold: 0.3 }).observe(row);
      } else go();
    });
  }).catch(() => { host.hidden = true; });
})();
