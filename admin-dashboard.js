// admin-dashboard.js — Vue d'ensemble (écran d'accueil du panneau).
// Agrège les données de `stats:overview` : quatre indicateurs,
// un graphique de trafic (sélecteur 7/30/90 j), une répartition des
// utilisateurs par pays (drapeau, nombre, %, classement) et une activité
// récente faite d'événements compréhensibles (connexion avec pays,
// inscription, achat, abonnement).

(function () {
  "use strict";

  const nf = new Intl.NumberFormat("fr-FR");
  const fmt = (n) => nf.format(Math.round(Number(n) || 0));
  const money = (n) => fmt(n) + " F";

  // Heure seule (colonne étroite, alignée à droite) — la date complète reste
  // dans le [title] du survol si besoin.
  const shortTime = (t) => t ? new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";

  // Drapeau à partir d'un code pays ISO 3166-1 alpha-2 — purement algorithmique
  // (indicateurs régionaux Unicode), aucune table de correspondance à tenir à
  // jour côté admin : le nom du pays, lui, vient tel quel de user_sessions
  // (déjà résolu côté serveur par asrar-main, cf. lib/countries.js).
  const flagEmoji = (code) => {
    if (!code || code.length !== 2) return "🏳️";
    return String.fromCodePoint(...code.toUpperCase().split("").map((c) => 127397 + c.charCodeAt(0)));
  };

  // ── Carte KPI principale : total et nouveaux octrois sur 30 jours.
  // The API returns totals within a window, not percentage growth. Labels
  // explicitly name the window rather than presenting a false trend.
  const stat = ({ icon, val, label, recent, unit = "", note = "", period = "TOTAL" }) => `
    <div class="stat"${note ? ` title="${esc(note)}"` : ""}>
      <div class="stat-top"><span class="stat-ic">${ic(icon)}</span><span class="metric-period">${esc(period)}</span></div>
      <div class="stat-lbl">${esc(label)}</div>
      <div class="stat-val">${esc(val)}${unit ? `<small>${esc(unit)}</small>` : ""}</div>
      <div class="stat-sub"><b>${esc(recent)}</b> sur 30 jours</div>
    </div>`;

  // ── Indicateur secondaire (contexte) : bande compacte, sans icône ni
  // bordure dorée — regroupe tout ce qui n'est pas un des 4 KPI clés.
  const miniStat = (val, label) => `
    <div class="stat-mini">
      <span class="stat-mini-val">${esc(val)}</span>
      <span class="stat-mini-lbl">${esc(label)}</span>
    </div>`;

  const shortcut = (tab, icon, label) =>
    `<button class="shortcut" data-goto="${tab}">${ic(icon)}<span>${esc(label)}</span></button>`;

  // ── Activité récente : un événement métier par ligne (pas un avatar par
  // e-mail) — connexion (avec pays), inscription, achat réel ou abonnement
  // offert par un admin.
  const FEED_META = {
    connection: { icon: "visits", cls: "signup", title: (e) => flagEmoji(e.countryCode) + " Nouvelle connexion" + (e.country ? " · " + e.country : "") },
    signup: { icon: "users", cls: "signup", title: () => "Nouvelle inscription" },
    purchase: { icon: "revenue", cls: "purchase", title: (e) => "Achat abonnement · " + money(e.amount) },
    grant: { icon: "gift", cls: "", title: () => "Abonnement offert (admin)" }
  };
  const feedRow = (e) => {
    const meta = FEED_META[e.type] || { icon: "sparkle", cls: "", title: () => "Événement" };
    return `
      <div class="feed-row">
        <span class="feed-ic ${meta.cls}">${ic(meta.icon)}</span>
        <div class="feed-main">
          <span class="feed-title">${esc(meta.title(e))}</span>
          <span class="feed-email">${esc(e.email || "—")}</span>
        </div>
        <span class="feed-time" title="${esc(when(e.at))}">${shortTime(e.at)}</span>
      </div>`;
  };

  // Données brutes conservées pour changer de période (7/30/90 j) sans
  // re-requête serveur — le spark renvoyé couvre déjà 90 jours.
  let DASH = null;
  let DASH_PERIOD = 7;
  let requestId = 0;

  window.loadDashboard = async function () {
    const root = $("dashGrid");
    if (!root) return;
    const currentRequest = ++requestId;
    const reload = $("btnReloadDash");
    reload.disabled = true;
    reload.classList.add("is-loading");
    root.setAttribute("aria-busy", "true");
    $("dashUpdated").textContent = "Actualisation…";
    $("dashTrafficSummary").textContent = "";
    DASH = null;
    root.innerHTML = skeleton("kpis", 4);
    const rootSec = $("dashGridSecondary");
    if (rootSec) rootSec.innerHTML = "";
    const feed = $("dashRecent");
    if (feed) feed.innerHTML = skeleton("list", 5);
    const spark = $("dashSpark");
    if (spark) spark.innerHTML = "";
    const countries = $("dashCountries");
    if (countries) countries.innerHTML = "<div class='empty'>Chargement…</div>";

    try {
      const data = await api("stats", { action: "overview" });
      if (currentRequest !== requestId) return;
      DASH = data;
      renderDashStats();
      renderDashChart();
      renderDashFeed();
      renderDashCountries();
      $("dashUpdated").textContent = "Mis à jour à " + shortTime(Date.now());
    } catch (e) {
      if (currentRequest !== requestId) return;
      root.innerHTML = `<div class="load-error" role="alert"><p>Le tableau de bord n'a pas pu être chargé. ${esc(e.message)}</p><button class="btn text" id="retryDashboard">Réessayer</button></div>`;
      $("retryDashboard").onclick = loadDashboard;
      $("dashUpdated").textContent = "Actualisation impossible";
      if (spark) spark.innerHTML = '<div class="empty">Le trafic sera affiché après le chargement des données.</div>';
      if (feed) feed.innerHTML = "";
      if (countries) countries.innerHTML = "";
    } finally {
      if (currentRequest === requestId) {
        reload.disabled = false;
        reload.classList.remove("is-loading");
        root.setAttribute("aria-busy", "false");
      }
    }
  };

  function renderDashStats() {
    const root = $("dashGrid");
    const rootSec = $("dashGridSecondary");
    if (!DASH || !root) return;
    const k = DASH.kpis || {};

    root.innerHTML =
      stat({ icon: "revenue", val: fmt(k.revenueTotal), unit: "FCFA", label: "Valeur des accès", recent: money(k.revenue30), note: "Valorisation des accès selon leur palier, y compris les octrois manuels. Ce montant ne constitue pas un relevé des paiements encaissés." }) +
      stat({ icon: "market", val: fmt(k.salesTotal), label: "Accès valorisés", recent: fmt(k.sales30) + " accès", note: "Accès dont le palier ou le montant est supérieur à zéro, y compris les octrois manuels." }) +
      stat({ icon: "gift", val: fmt(k.activeSubs), label: "Abonnements actifs", recent: fmt(k.newSubs30) + " octrois", period: "EN COURS" }) +
      stat({ icon: "users", val: fmt(k.usersTotal), label: "Utilisateurs", recent: fmt(k.new30) + " inscriptions" });

    if (rootSec) rootSec.innerHTML =
      miniStat(fmt(k.unique30), "Visiteurs uniques (30 j)") +
      miniStat(fmt(k.visits30), "Visites (30 j)") +
      miniStat(fmt(k.boutiques), "Boutiques") +
      miniStat(fmt(k.admins) + " / " + fmt(k.vips), "Admins / VIP");
  }

  // Exact, data-driven SVG chart. The expandable table exposes the same
  // figures to keyboard users, screen readers and small-screen readers.
  function renderDashChart() {
    const spark = $("dashSpark");
    if (!spark || !DASH) return;
    const daily = (DASH.spark || []).slice(-DASH_PERIOD);
    const rows = DASH_PERIOD <= 7 ? daily : chunkWeekly(daily, ["total", "unique"]);
    const total = daily.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
    $("dashTrafficSummary").innerHTML = `<strong>${fmt(total)}</strong><span>visites sur ${DASH_PERIOD} jours</span>`;
    if (!daily.some((row) => row.total > 0 || row.unique > 0)) {
      spark.innerHTML = '<div class="empty">Aucune visite enregistrée sur cette période.</div>';
      return;
    }
    const width = Math.max(280, spark.clientWidth || 580), height = 208, left = 37, right = 14, top = 16, bottom = 29;
    const max = Math.max(1, ...rows.map((row) => Math.max(Number(row.total) || 0, Number(row.unique) || 0)));
    const ceiling = Math.ceil(max / 4) * 4;
    const baseline = height - bottom;
    const x = (i) => left + i * (width - left - right) / Math.max(1, rows.length - 1);
    const y = (value) => baseline - Math.max(0, Number(value) || 0) / ceiling * (baseline - top);
    const path = (key) => rows.map((row, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(row[key]).toFixed(2)}`).join(" ");
    const periodLabel = (row) => (DASH_PERIOD > 7 ? "À partir du " : "") + frDate(row.bucket);
    const tooltip = (row) => `${periodLabel(row)} : ${fmt(row.total)} visites, ${fmt(row.unique)} ${DASH_PERIOD > 7 ? "visiteurs uniques cumulés par jour" : "visiteurs uniques"}`;
    const totalPath = path("total");
    const area = totalPath + ` L${x(rows.length - 1)},${baseline} L${left},${baseline} Z`;
    const labelEvery = Math.max(1, Math.ceil(rows.length / (width < 420 ? 3 : 6)));
    spark.innerHTML = `
      <svg class="traffic-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="trafficTitle trafficDescription">
        <title id="trafficTitle">Évolution du trafic sur ${DASH_PERIOD} jours</title>
        <desc id="trafficDescription">${fmt(total)} visites. Les valeurs détaillées sont disponibles dans le tableau ci-dessous.${DASH_PERIOD > 7 ? " Regroupement par tranches de 7 jours ; les uniques sont cumulés quotidiennement." : ""}</desc>
        <defs><linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#619c79" stop-opacity=".2"/><stop offset="100%" stop-color="#619c79" stop-opacity=".015"/></linearGradient></defs>
        ${[0, 1, 2, 3, 4].map((tick) => `<line class="chart-grid" x1="${left}" y1="${y(ceiling * tick / 4)}" x2="${width - right}" y2="${y(ceiling * tick / 4)}"/><text class="chart-label" x="${left - 8}" y="${y(ceiling * tick / 4) + 3}" text-anchor="end">${esc(fmt(ceiling * tick / 4))}</text>`).join("")}
        <path d="${area}" fill="url(#trafficFill)"/>
        <path class="chart-line unique" d="${path("unique")}"/>
        <path class="chart-line" d="${totalPath}"/>
        ${rows.map((row, i) => `<circle class="chart-point" cx="${x(i)}" cy="${y(row.total)}" r="5"><title>${esc(tooltip(row))}</title></circle>${i % labelEvery === 0 || i === rows.length - 1 ? `<text class="chart-label" x="${x(i)}" y="${height - 6}" text-anchor="${i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}">${esc(frDate(row.bucket))}</text>` : ""}`).join("")}
      </svg>
      <div class="legend"><span><i style="background:var(--gold)"></i>Visites</span><span><i style="background:#a69a6b"></i>${DASH_PERIOD > 7 ? "Uniques cumulés par jour" : "Visiteurs uniques"}</span></div>
      <details class="chart-data"><summary>Voir les valeurs${DASH_PERIOD > 7 ? " par semaine" : " par jour"}</summary><div class="chart-table-wrap"><table><caption class="sr-only">Données du trafic sur ${DASH_PERIOD} jours</caption><thead><tr><th scope="col">${DASH_PERIOD > 7 ? "Début de période" : "Date"}</th><th scope="col">Visites</th><th scope="col">${DASH_PERIOD > 7 ? "Uniques cumulés / jour" : "Uniques"}</th></tr></thead><tbody>${rows.map((row) => `<tr><th scope="row">${esc(frDate(row.bucket))}</th><td>${fmt(row.total)}</td><td>${fmt(row.unique)}</td></tr>`).join("")}</tbody></table></div></details>`;
  }

  function renderDashFeed() {
    const feed = $("dashRecent");
    if (!feed || !DASH) return;
    feed.innerHTML = (DASH.recent || []).map(feedRow).join("") ||
      "<div class='empty'>Aucune activité récente.</div>";
  }

  // Répartition par pays — quels pays utilisent le plus ASRAR PRO : rang,
  // drapeau, nom, nombre d'utilisateurs et pourcentage. Barre proportionnelle
  // au plus grand pays du classement — même composant visuel .hbar que
  // « Pages populaires » (Analytique), son générateur `hbars()` est privé à
  // admin-stats.js, d'où ce petit gabarit local plutôt qu'un partage inutile.
  function renderDashCountries() {
    const el = $("dashCountries");
    if (!el || !DASH) return;
    const rows = DASH.countryBreakdown || [];
    if (!rows.length) {
      el.innerHTML = "<div class='empty'>Aucune donnée de géolocalisation pour l'instant.</div>";
      return;
    }
    const countries = [...rows];
    if (DASH.unknownCountry?.users) countries.push({ ...DASH.unknownCountry, country: "Pays inconnu", countryCode: "" });
    const max = Math.max(1, ...countries.map((country) => Number(country.users) || 0));
    el.innerHTML = countries.map((country) => `
      <div class="country-row">
        <span class="country-flag" aria-hidden="true">${country.countryCode ? flagEmoji(country.countryCode) : "🌐"}</span>
        <span class="country-name">${esc(country.country)}</span>
        <span class="country-count">${fmt(country.users)} <small>${esc(country.pct)} %</small></span>
        <div class="country-track" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, Math.round((Number(country.users) || 0) / max * 100)))}%"></span></div>
      </div>`).join("");
  }

  // Sélecteur de période du graphique — aucune requête, DASH.spark couvre déjà 90 j.
  const periodSeg = $("dashPeriodSeg");
  if (periodSeg) periodSeg.querySelectorAll("[data-period]").forEach((b) => b.onclick = () => {
    DASH_PERIOD = Number(b.getAttribute("data-period")) || 7;
    periodSeg.querySelectorAll("[data-period]").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
    renderDashChart();
  });

  // Raccourcis → navigation vers les onglets.
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (b && typeof showTab === "function") showTab(b.getAttribute("data-goto"));
  });

  // Bouton d'actualisation.
  const rl = $("btnReloadDash");
  if (rl) rl.onclick = loadDashboard;
  if (typeof ResizeObserver !== "undefined" && $("dashSpark")) {
    let previousWidth = 0;
    new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width > 0 && width !== previousWidth) { previousWidth = width; renderDashChart(); }
    }).observe($("dashSpark"));
  }

  // Expose le générateur de raccourcis (utilisé au rendu initial du HTML).
  window.__dashShortcut = shortcut;
})();
