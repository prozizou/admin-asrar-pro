// Apply the saved preference before painting, including on the sign-in screen.
(function () {
  let theme = "light";
  try { theme = localStorage.getItem("adm_theme") || theme; } catch (_) { /* Private browsing. */ }
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
})();
