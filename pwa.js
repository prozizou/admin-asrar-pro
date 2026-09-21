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
    try { if (localStorage.getItem("adm_installed") === "1") return; } catch (_) {}
    var b = document.createElement("button");
    b.textContent = "Installer l'application";
    b.className = "btn primary pwa-install";
    b.onclick = function () {
      dp.prompt(); dp.userChoice.then(function (c) {
        try { if (c && c.outcome === "accepted") localStorage.setItem("adm_installed", "1"); } catch (_) {}
        b.remove();
      });
    };
    document.body.appendChild(b);
  });
  window.addEventListener("appinstalled", function () { try { localStorage.setItem("adm_installed", "1"); } catch (_) {} });
})();
