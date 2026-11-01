// admin-ads.js — Onglet « Publicités » : que font les visiteurs de la pub
// ouverte à chaque action (compteurs écrits par asrar-main, /api/track type
// « ad_stats », lus par api/stats.js action « ads »).

(function () {
  "use strict";

  const nf = new Intl.NumberFormat("fr-FR");
  const fmt = (n) => nf.format(Math.round(Number(n) || 0));
  const pct = (n) => (n == null ? "—" : nf.format(n) + " %");

  let ADS = null, ADS_AT = 0, ADS_PERIOD = "d30";

  // Même gabarit .stat que Statistiques ; `sub` affiche le pourcentage.
  const tile = ({ icon, val, label, sub, tone, span }) => `
    <div class="stat${span ? " span2" : ""}">
      <div class="stat-top">
        <span class="stat-ic ${tone || ""}">${ic(icon)}</span>
        ${sub ? `<span class="stat-delta">${esc(sub)}</span>` : ""}
      </div>
      <div class="stat-val">${fmt(val)}</div>
      <div class="stat-lbl">${esc(label)}</div>
    </div>`;

  const relTime = (ms) => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 10) return "à l'instant";
    if (s < 60) return "il y a " + s + " s";
    const m = Math.round(s / 60);
    if (m < 60) return "il y a " + m + " min";
    return "il y a " + Math.round(m / 60) + " h";
  };

  window.loadAds = async function () {
    const chart = $("adsChart");
    if (chart) chart.innerHTML = "<div class='empty'>Chargement…</div>";
    try { ADS = await api("stats", { action: "ads" }); ADS_AT = Date.now(); renderAds(); }
    catch (e) { if (chart) chart.innerHTML = "<div class='empty'>" + esc(e.message) + "</div>"; }
  };

  window.renderAds = function () {
    if (!ADS) return;
    const p = (ADS.periods && ADS.periods[ADS_PERIOD]) || { opened: 0, quick: 0, closed: 0, open: 0 };
    if ($("adsKpis")) $("adsKpis").innerHTML =
      tile({ icon: "ads", val: p.opened, label: "Publicités mesurées", tone: "gold" }) +
      tile({ icon: "block", val: p.quick, label: "Sautées tout de suite", sub: pct(p.quickRate) }) +
      tile({ icon: "clock", val: p.closed, label: "Fermées avant la fin", sub: pct(p.closedRate) }) +
      tile({ icon: "visits", val: p.open, label: "Laissées ouvertes", sub: pct(p.openRate), tone: "gold" });
    renderAdsChart();
    if ($("adsUpdated")) $("adsUpdated").textContent = ADS_AT ? "Mis à jour " + relTime(ADS_AT) : "";
  };

  // 7 j : un jour par colonne ; 30/90 j : paquets de 7 jours (chunkWeekly).
  function renderAdsChart() {
    const el = $("adsChart");
    if (!el || !ADS) return;
    const nDays = { d7: 7, d30: 30, d90: 90 }[ADS_PERIOD];
    const keys = ["opened", "quick", "closed", "open"];
    const daily = (ADS.daily || []).slice(-nDays);
    const rows = nDays <= 7 ? daily : chunkWeekly(daily, keys);
    if (!rows.some((r) => r.opened > 0)) {
      el.innerHTML = "<div class='empty'>Aucune publicité mesurée sur cette période.</div>";
      return;
    }
    el.innerHTML = barChartHtml(rows, {
      series: [
        { key: "opened", color: "linear-gradient(180deg,var(--gold-2),var(--gold))", label: "Mesurées" },
        { key: "quick", cls: "uniq", color: "linear-gradient(180deg,#6fc3e0,#2d7ea8)", label: "Sautées tout de suite" }
      ],
      valueKey: "opened",
      tooltip: (r) => frDate(r.bucket) + " · " + fmt(r.opened) + " mesurées · " + fmt(r.quick) + " sautées · " +
        fmt(r.closed) + " fermées avant la fin · " + fmt(r.open) + " laissées ouvertes"
    });
  }

  const seg = $("adsPeriodSeg");
  if (seg) seg.querySelectorAll("[data-period]").forEach((b) => b.onclick = () => {
    ADS_PERIOD = b.getAttribute("data-period");
    seg.querySelectorAll("[data-period]").forEach((x) => x.classList.toggle("active", x === b));
    renderAds();
  });
  if ($("btnReloadAds")) $("btnReloadAds").onclick = () => loadAds();
})();
