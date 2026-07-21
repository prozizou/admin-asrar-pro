// admin-dashboard.js — Vue d'ensemble (écran d'accueil du panneau).
// Agrège les KPIs métier (revenus, abonnés, visites, comptes) via l'action
// serveur `stats:overview`, avec tendances 30 j, sparkline 14 j et activité récente.

(function () {
  "use strict";

  const nf = new Intl.NumberFormat("fr-FR");
  const fmt = (n) => nf.format(Math.round(Number(n) || 0));
  const money = (n) => fmt(n) + " F";

  // Carte KPI : icône + valeur + libellé + (optionnel) puce de tendance / sous-texte.
  const stat = ({ icon, val, label, sub, delta, tone }) => `
    <div class="stat">
      <div class="stat-top">
        <span class="stat-ic ${tone || ""}">${ic(icon)}</span>
        ${delta != null ? `<span class="stat-delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}">${ic("trend")}${delta > 0 ? "+" : ""}${fmt(delta)}</span>` : ""}
      </div>
      <div class="stat-val">${esc(val)}</div>
      <div class="stat-lbl">${esc(label)}</div>
      ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}
    </div>`;

  const shortcut = (tab, icon, label) =>
    `<button class="shortcut" data-goto="${tab}">${ic(icon)}<span>${esc(label)}</span></button>`;

  window.loadDashboard = async function () {
    const root = $("dashGrid");
    if (!root) return;
    root.innerHTML = skeleton("kpis", 8);
    const feed = $("dashRecent");
    if (feed) feed.innerHTML = skeleton("list", 5);
    const spark = $("dashSpark");
    if (spark) spark.innerHTML = "";

    try {
      const d = await api("stats", { action: "overview" });
      const k = d.kpis || {};

      root.innerHTML =
        stat({ icon: "revenue", tone: "gold", val: money(k.revenue30), label: "Revenus (30 j)", sub: "Total : " + money(k.revenueTotal) }) +
        stat({ icon: "market", val: fmt(k.sales30), label: "Ventes (30 j)", sub: "Total : " + fmt(k.salesTotal) }) +
        stat({ icon: "gift", tone: "gold", val: fmt(k.activeSubs), label: "Abonnés actifs" }) +
        stat({ icon: "users", val: fmt(k.usersTotal), label: "Comptes", delta: k.new30, sub: "+" + fmt(k.new7) + " sur 7 j" }) +
        stat({ icon: "visits", val: fmt(k.unique30), label: "Visiteurs uniques (30 j)", sub: "Aujourd'hui : " + fmt(k.uniqueToday) }) +
        stat({ icon: "analytics", val: fmt(k.visits30), label: "Visites (30 j)", sub: "Aujourd'hui : " + fmt(k.visitsToday) }) +
        stat({ icon: "market", val: fmt(k.boutiques), label: "Boutiques" }) +
        stat({ icon: "settings", val: fmt(k.admins) + " / " + fmt(k.vips), label: "Admins / VIP" });

      // Sparkline 14 jours (visites totales, uniques en surimpression).
      if (spark) {
        const rows = d.spark || [];
        const max = Math.max(1, ...rows.map((r) => r.total));
        spark.innerHTML = `
          <div class="bar" style="border:none;padding:0;margin-bottom:10px">
            <h3 style="margin:0">Fréquentation · 14 derniers jours</h3>
            <span class="legend" style="margin:0">
              <span><i style="background:linear-gradient(180deg,var(--gold-2),var(--gold))"></i>Visites</span>
              <span><i style="background:var(--info);opacity:.6"></i>Uniques</span>
            </span>
          </div>
          <div class="spark-bars">
            ${rows.map((r) => {
              const hT = Math.max(3, Math.round(r.total / max * 100));
              const hU = Math.max(2, Math.round(r.uniq / max * 100));
              return `<div class="spark-col" title="${esc(r.d)} · ${r.total} visites · ${r.uniq} uniques">
                <div class="spark-stack">
                  <div class="spark-fill" style="height:${hT}%"></div>
                  <div class="spark-fill uniq" style="height:${hU}%"></div>
                </div>
                <span class="spark-x">${esc(r.d)}</span>
              </div>`;
            }).join("")}
          </div>`;
      }

      // Activité récente.
      if (feed) {
        feed.innerHTML = (d.recent || []).map((e) => `
          <div class="row">
            <div><b>${esc(e.email || "—")}</b> <span class="muted">· ${esc(e.page)}</span></div>
            <div class="muted">${esc(e.type)} · ${when(e.at)}</div>
          </div>`).join("") || "<div class='empty'>Aucune activité récente.</div>";
      }
    } catch (e) {
      root.innerHTML = `<div class='empty' style='grid-column:1/-1;color:var(--danger)'>Erreur de chargement : ${esc(e.message)}</div>`;
      if (feed) feed.innerHTML = "";
    }
  };

  // Raccourcis → navigation vers les onglets.
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (b && typeof showTab === "function") showTab(b.getAttribute("data-goto"));
  });

  // Bouton d'actualisation.
  const rl = $("btnReloadDash");
  if (rl) rl.onclick = loadDashboard;

  // Expose le générateur de raccourcis (utilisé au rendu initial du HTML).
  window.__dashShortcut = shortcut;
})();
