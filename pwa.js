// pwa.js — Enregistrement du SW admin + mise à jour SUR PLACE + invite d'installation.
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;
  var refreshing = false;

  navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function (reg) {
    if (reg.waiting && navigator.serviceWorker.controller) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    reg.addEventListener("updatefound", function () {
      var nw = reg.installing; if (!nw) return;
      nw.addEventListener("statechange", function () {
        if (nw.state === "installed" && navigator.serviceWorker.controller) nw.postMessage({ type: "SKIP_WAITING" });
      });
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") reg.update().catch(function () {});
    });
  }).catch(function () {});

  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (refreshing) return; refreshing = true; location.reload();
  });

  // Invite d'installation (Android/Chrome).
  var dp = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); dp = e;
    if (localStorage.getItem("adm_installed") === "1") return;
    var b = document.createElement("button");
    b.textContent = "📲 Installer l'application";
    b.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;" +
      "background:linear-gradient(135deg,#e8cd78,#c9a227);color:#231a05;border:none;border-radius:12px;" +
      "padding:12px 18px;font-weight:700;font-family:system-ui;box-shadow:0 8px 24px rgba(0,0,0,.5);cursor:pointer";
    b.onclick = function () {
      dp.prompt(); dp.userChoice.then(function (c) {
        if (c && c.outcome === "accepted") localStorage.setItem("adm_installed", "1");
        b.remove();
      });
    };
    document.body.appendChild(b);
  });
  window.addEventListener("appinstalled", function () { localStorage.setItem("adm_installed", "1"); });
})();
