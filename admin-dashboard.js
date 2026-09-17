// admin-dashboard.js — Vue d'ensemble (écran d'accueil du panneau).
// Agrège les KPIs métier (revenus, ventes, abonnés actifs, utilisateurs) via
// l'action serveur `stats:overview` : 4 indicateurs clés avec variation
// 7/30 j, un graphique de trafic (sélecteur 7/30/90 j), une répartition des
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

  // ── Carte KPI principale : icône + valeur + libellé + variation 30 j
  // (puce) + variation 7 j (sous-texte) — même schéma pour les 4 cartes clés.
  const stat = ({ icon, val, label, sub, delta, deltaSuffix, tone }) => `
    <div class="stat">
      <div class="stat-top">
        <span class="stat-ic ${tone || ""}">${ic(icon)}</span>
        ${delta != null ? `<span class="stat-delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}">${ic("trend")}${delta > 0 ? "+" : ""}${fmt(delta)}${deltaSuffix || ""}</span>` : ""}
      </div>
      <div class="stat-val">${esc(val)}</div>
      <div class="stat-lbl">${esc(label)}</div>
      ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}
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

  window.loadDashboard = async function () {
    const root = $("dashGrid");
    if (!root) return;
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
      DASH = await api("stats", { action: "overview" });
      renderDashStats();
      renderDashChart();
      renderDashFeed();
      renderDashCountries();
    } catch (e) {
      root.innerHTML = `<div class='empty' style='grid-column:1/-1;color:var(--danger)'>Erreur de chargement : ${esc(e.message)}</div>`;
      if (feed) feed.innerHTML = "";
      if (countries) countries.innerHTML = "";
    }
  };

  function renderDashStats() {
    const root = $("dashGrid");
    const rootSec = $("dashGridSecondary");
    if (!DASH || !root) return;
    const k = DASH.kpis || {};

    // Les 4 indicateurs clés — puce = variation sur 30 j, sous-texte = 7 j.
    root.innerHTML =
      stat({ icon: "revenue", tone: "gold", val: money(k.revenueTotal), label: "Revenus", delta: k.revenue30, deltaSuffix: " F", sub: "+" + money(k.revenue7) + " sur 7 j" }) +
      stat({ icon: "market", val: fmt(k.salesTotal), label: "Ventes", delta: k.sales30, sub: "+" + fmt(k.sales7) + " sur 7 j" }) +
      stat({ icon: "gift", tone: "gold", val: fmt(k.activeSubs), label: "Abonnés actifs", delta: k.newSubs30, sub: "+" + fmt(k.newSubs7) + " sur 7 j" }) +
      stat({ icon: "users", val: fmt(k.usersTotal), label: "Utilisateurs", delta: k.new30, sub: "+" + fmt(k.new7) + " sur 7 j" });

    if (rootSec) rootSec.innerHTML =
      miniStat(fmt(k.unique30), "Visiteurs uniques (30 j)") +
      miniStat(fmt(k.visits30), "Visites (30 j)") +
      miniStat(fmt(k.boutiques), "Boutiques") +
      miniStat(fmt(k.admins) + " / " + fmt(k.vips), "Admins / VIP");
  }

  // Graphique de trafic — sélecteur 7/30/90 j (mêmes 90 j renvoyés par le
  // serveur, tranchés côté client) + vrai état vide si la période ne compte
  // aucune visite (pas un graphique à barres toutes nulles). 30/90 j sont
  // regroupés par semaine (comme Analytique) : des dizaines de barres
  // quotidiennes minuscules seraient illisibles.
  function renderDashChart() {
    const spark = $("dashSpark");
    if (!spark || !DASH) return;
    const daily = (DASH.spark || []).slice(-DASH_PERIOD);
    const rows = DASH_PERIOD <= 7 ? daily : chunkWeekly(daily, ["total", "unique"]);
    const hasData = daily.some((r) => r.total > 0 || r.unique > 0);
    spark.innerHTML = barChartHtml(hasData ? rows : [], {
      series: [
        { key: "total", color: "linear-gradient(180deg,var(--gold-2),var(--gold))", label: "Visites" },
        { key: "unique", cls: "uniq", color: "linear-gradient(180deg,#6fc3e0,#2d7ea8)", label: "Visiteurs uniques" }
      ],
      valueKey: "total",
      tooltip: (r) => frDate(r.bucket) + " · " + fmt(r.total) + " visites · " + fmt(r.unique) + " uniques",
      emptyText: "Aucune visite enregistrée sur cette période."
    });
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
    const max = Math.max(1, ...rows.map((c) => c.users));
    const rankRow = (c, i) => `
      <div class="hbar">
        <div class="hbar-lbl" title="${esc(c.country)}">${esc(String(i + 1))}. ${flagEmoji(c.countryCode)} ${esc(c.country)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(c.users / max * 100)}%"></div></div>
        <div class="hbar-n">${fmt(c.users)} · ${c.pct}%</div>
      </div>`;
    const unknown = DASH.unknownCountry && DASH.unknownCountry.users
      ? `<div class="hbar" style="opacity:.6">
          <div class="hbar-lbl">🌐 Pays inconnu</div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(DASH.unknownCountry.users / max * 100)}%"></div></div>
          <div class="hbar-n">${fmt(DASH.unknownCountry.users)} · ${DASH.unknownCountry.pct}%</div>
        </div>`
      : "";
    el.innerHTML = rows.map(rankRow).join("") + unknown;
  }

  // Sélecteur de période du graphique — aucune requête, DASH.spark couvre déjà 90 j.
  const periodSeg = $("dashPeriodSeg");
  if (periodSeg) periodSeg.querySelectorAll("[data-period]").forEach((b) => b.onclick = () => {
    DASH_PERIOD = Number(b.getAttribute("data-period")) || 7;
    periodSeg.querySelectorAll("[data-period]").forEach((x) => x.classList.toggle("active", x === b));
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

  // Expose le générateur de raccourcis (utilisé au rendu initial du HTML).
  window.__dashShortcut = shortcut;
})();
