/* Shared helpers and site-wide behaviour (header, theme, status, reveal animations). */
(() => {
  "use strict";
  const dataEl = document.getElementById("i18n");
  const DICT = dataEl ? JSON.parse(dataEl.textContent) : {};
  const root = document.documentElement;
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const T = (key, vars) => {
    let s = DICT[key] !== undefined ? DICT[key] : key;
    if (vars) for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  };

  const FEATURES = [
    { key: "uniformity_cell_size", group: "size" }, { key: "uniformity_cell_shape", group: "size" },
    { key: "single_epithelial_cell_size", group: "size" },
    { key: "bare_nuclei", group: "nucleus", optional: true }, { key: "bland_chromatin", group: "nucleus" },
    { key: "normal_nucleoli", group: "nucleus" }, { key: "mitoses", group: "nucleus" },
    { key: "clump_thickness", group: "tissue" }, { key: "marginal_adhesion", group: "tissue" },
  ];
  const PRESETS = {
    benign:    { clump_thickness: 2, uniformity_cell_size: 1, uniformity_cell_shape: 1, marginal_adhesion: 1, single_epithelial_cell_size: 2, bare_nuclei: 1, bland_chromatin: 2, normal_nucleoli: 1, mitoses: 1 },
    malignant: { clump_thickness: 8, uniformity_cell_size: 10, uniformity_cell_shape: 10, marginal_adhesion: 8, single_epithelial_cell_size: 6, bare_nuclei: 10, bland_chromatin: 7, normal_nucleoli: 10, mitoses: 1 },
  };
  const fname = (key) => T(`f.${key}.l`);
  const pct = (p) => Math.min(99.9, Math.max(0.1, p * 100)).toFixed(1).replace(/\.0$/, "");

  const COLORS = ["#14a89b", "#e8a838", "#e5386d"];
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function scoreColor(v) {                          // 1..10 -> green / amber / rose
    const x = (v - 1) / 9 * 2, i = Math.min(1, Math.floor(x)), f = x - i;
    const a = rgb(COLORS[i]), b = rgb(COLORS[i + 1]);
    return `rgb(${a.map((c, j) => Math.round(c + (b[j] - c) * f)).join(",")})`;
  }

  /* ---------- network ---------- */
  async function api(path, { method = "GET", body } = {}) {
    let res;
    try {
      res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    } catch (_) { return { ok: false, status: 0, error: T("js.err_network") }; }
    let data = null;
    try { data = await res.json(); } catch (_) { /* not JSON */ }
    if (res.ok) return { ok: true, status: res.status, data };
    const known = { 429: T("js.err_rate"), 503: T("js.err_model") };
    return { ok: false, status: res.status, data, error: (data && data.error && res.status === 400 ? data.error : known[res.status]) || T("js.err_generic") };
  }

  /* ---------- UI helpers ---------- */
  let toastTimer;
  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast(T("js.copied")); }
    catch (_) {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast(T("js.copied")); } catch (__) { toast(T("js.copy_failed")); }
      ta.remove();
    }
  }
  function setGauge(prefix, p) {
    const needle = document.getElementById(`${prefix}-needle`);
    if (needle) needle.style.transform = `rotate(${(-90 + 180 * p).toFixed(1)}deg)`;
  }
  /* Diverging influence bars. items: [{feature, value, influence}] */
  function renderExplain(ul, items, { limit = 9, span = 40 } = {}) {
    ul.innerHTML = "";
    const shown = items.slice(0, limit);
    const max = Math.max(0.01, ...shown.map((e) => Math.abs(e.influence)));
    shown.forEach((e) => {
      const li = document.createElement("li");
      const w = Math.abs(e.influence) / max * span, pos = e.influence >= 0;
      li.innerHTML = '<span class="name"></span><div class="diverge"><div class="bar"></div><span class="val"></span></div>';
      const name = li.querySelector(".name");
      name.textContent = fname(e.feature);
      const em = document.createElement("em"); em.textContent = e.value === null ? "—" : e.value; name.appendChild(em);
      const bar = li.querySelector(".bar"), val = li.querySelector(".val");
      bar.className = "bar " + (pos ? "bar--pos" : "bar--neg");
      val.textContent = (pos ? "+" : "−") + Math.round(Math.abs(e.influence) * 100) + "%";
      if (pos) val.style.left = `calc(50% + ${w}% + 6px)`; else val.style.right = `calc(50% + ${w}% + 6px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = w + "%"; }));
      ul.appendChild(li);
    });
  }

  /* ---------- header, theme, nav ---------- */
  const header = $("#site-header");
  const onScroll = () => header && header.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  const themeBtn = $("#theme-toggle");
  if (themeBtn) themeBtn.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("cs-theme", next); } catch (_) { /* ignore */ }
    document.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  });

  const nav = $("#nav"), menuBtn = $("#menu-btn");
  if (nav && menuBtn) {
    const setOpen = (open) => { nav.classList.toggle("is-open", open); menuBtn.setAttribute("aria-expanded", String(open)); };
    menuBtn.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
    nav.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  }

  /* ---------- footer status ---------- */
  const statusEl = $("#status");
  if (statusEl) {
    api("/health").then((r) => {
      const ok = r.ok && r.data && r.data.model_ready;
      statusEl.dataset.state = !r.ok ? "error" : ok ? "ok" : "down";
      $("#status-text").textContent = !r.ok ? T("js.status_unreachable") : ok ? T("js.status_ok") : T("js.status_down");
    });
  }

  /* ---------- reveal on scroll ---------- */
  const items = $$(".reveal");
  if (items.length && "IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("reveal-ready");
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    items.forEach((el, i) => { el.style.transitionDelay = `${(i % 6) * 60}ms`; io.observe(el); });
  }

  window.CS = { T, $, $$, FEATURES, PRESETS, fname, pct, scoreColor, api, toast, copyText, setGauge, renderExplain,
                lang: root.lang, maxBatch: Number(document.body.dataset.maxBatch || 1000) };
})();
