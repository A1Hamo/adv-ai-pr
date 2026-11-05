/* Runs in <head> to apply the saved theme before first paint (no flash). */
(function () {
  var d = document.documentElement, t = null;
  d.classList.add("js");
  try { t = localStorage.getItem("cs-theme"); } catch (e) { /* storage unavailable */ }
  if (t !== "dark" && t !== "light") t = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  d.setAttribute("data-theme", t);
})();
