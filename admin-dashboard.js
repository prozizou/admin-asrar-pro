// admin-dashboard.js — Vue d'ensemble (écran d'accueil du panneau).
// Agrège les KPIs métier (revenus, abonnés, visites, comptes) via l'action
// serveur `stats:overview`, avec tendances 30 j, sparkline 7 j et activité récente.

(function () {
  "use strict";

  const nf = new Intl.NumberFormat("fr-FR");
  const fmt = (n) => nf.format(Math.round(Number(n) || 0));
  const money = (n) => fmt(n) + " F";

  // Avatar du flux d'activité : initiale + teinte dérivée de l'e-mail (stable,
  // pas de dépendance externe) — juste assez de distinction visuelle entre lignes.
  const initial = (email) => (email && email !== "—" ? email.trim()[0].toUpperCase() : "?");
  const hue = (email) => {
    let h = 0;
    for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % 360;
    return h;
  };
  // Heure seule (colonne étroite, alignée à droite) — la date complète reste
  // dans le [title] du survol si besoin ; ce flux ne couvre de toute façon que
  // les tout derniers événements.
  const shortTime = (t) => t ? new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";

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

      // Sparkline : 7 derniers jours (sur les 14 renvoyés par le serveur) —
      // plus lisible qu'une bande de 14 barres serrées, dates plus espacées.
      if (spark) {
        const rows = (d.spark || []).slice(-7);
        const max = Math.max(1, ...rows.map((r) => r.total));
        spark.innerHTML = `
          <div class="bar" style="border:none;padding:0;margin-bottom:10px">
            <h3 style="margin:0">Fréquentation · 7 derniers jours</h3>
            <span class="legend" style="margin:0">
              <span><i style="background:linear-gradient(180deg,var(--gold-2),var(--gold))"></i>Visites</span>
              <span><i style="background:linear-gradient(180deg,#6fc3e0,#2d7ea8)"></i>Uniques</span>
            </span>
          </div>
          <div class="spark-bars">
            ${rows.map((r) => {
              const hT = Math.max(3, Math.round(r.total / max * 100));
              const hU = Math.max(2, Math.round(r.uniq / max * 100));
              return `<div class="spark-col" title="${esc(r.d)} · ${r.total} visites · ${r.uniq} uniques">
                <span class="spark-tip">${fmt(r.total)} vis. · ${fmt(r.uniq)} uniq.</span>
                <div class="spark-stack">
                  <div class="spark-fill" style="height:${hT}%"></div>
                  <div class="spark-fill uniq" style="height:${hU}%"></div>
                </div>
                <span class="spark-x">${esc(r.d)}</span>
              </div>`;
            }).join("")}
          </div>`;
      }

      // Activité récente — lignes denses (avatar + email + page + type + heure).
      if (feed) {
        feed.innerHTML = (d.recent || []).map((e) => {
          const email = e.email || "—";
          return `
          <div class="feed-row">
            <span class="feed-avatar" style="--h:${hue(email)}">${esc(initial(email))}</span>
            <div class="feed-main">
              <span class="feed-email">${esc(email)}</span>
              <span class="feed-page">${esc(e.page)}</span>
            </div>
            <span class="feed-type">${esc(e.type)}</span>
            <span class="feed-time" title="${esc(when(e.at))}">${shortTime(e.at)}</span>
          </div>`;
        }).join("") || "<div class='empty'>Aucune activité récente.</div>";
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

  // Sparkline : tap pour afficher l'infobulle — le [title] natif ne se
  // déclenche pas au tap sur mobile. Un seul barreau actif à la fois.
  // Délégué sur document (persiste même quand loadDashboard() reconstruit
  // le HTML des barres à chaque rechargement).
  document.addEventListener("click", (e) => {
    const col = e.target.closest(".spark-col");
    if (!col) return;
    const wasActive = col.classList.contains("tip-active");
    document.querySelectorAll(".spark-col.tip-active").forEach((c) => c.classList.remove("tip-active"));
    if (!wasActive) col.classList.add("tip-active");
  });

  // Bouton d'actualisation.
  const rl = $("btnReloadDash");
  if (rl) rl.onclick = loadDashboard;

  // Expose le générateur de raccourcis (utilisé au rendu initial du HTML).
  window.__dashShortcut = shortcut;
})();
