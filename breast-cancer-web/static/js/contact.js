(() => {
  "use strict";
  const { T, $, $$, api } = window.CS;
  const form = $("#contact-form"), btn = $("#contact-send"), err = $("#contact-error");
  const clear = () => { err.hidden = true; $$(".field-error").forEach((e) => { e.hidden = true; e.textContent = ""; }); $$("[aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid")); };
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault(); clear();
    const data = Object.fromEntries(new FormData(form).entries());
    btn.disabled = true; btn.textContent = T("js.c_sending");
    const r = await api("/api/contact", { method: "POST", body: data });
    btn.disabled = false; btn.textContent = T("js.c_send");
    if (r.ok) { form.hidden = true; $("#contact-success").hidden = false; form.reset(); return; }
    const fields = r.data && r.data.fields;
    if (fields) {
      Object.keys(fields).forEach((k) => {
        const input = form.elements[k]; if (input) input.setAttribute("aria-invalid", "true");
        const msg = $(`[data-error="${k}"]`); if (msg) { msg.textContent = T("js.c_invalid"); msg.hidden = false; }
      });
      const first = Object.keys(fields).map((k) => form.elements[k]).find(Boolean); if (first) first.focus();
    } else { err.textContent = r.status === 429 ? r.error : T("js.c_error"); err.hidden = false; }
  });
  $("#contact-again").addEventListener("click", () => { $("#contact-success").hidden = true; form.hidden = false; clear(); form.elements.name.focus(); });
})();
