// admin-bugs.js — Onglet « Bugs » : erreurs, lenteurs et signalements que les
// utilisateurs rencontrent dans l'application (écrits par asrar-main,
// /api/client-error ; lus et traités par api/bugs.js).
//
// Chaque carte est un bug REGROUPÉ (mêmes message et origine) : nombre
// d'occurrences, dernière apparition, appareils, version. Le détail montre la
// pile d'appels et les dernières occurrences (page, appareil, version, compte).
// « Résolu » : le bug disparaît de la liste des ouverts ; s'il se reproduit,
// il revient avec la mention « Revenu ».

(function () {
  "use strict";

  const nf = new Intl.NumberFormat("fr-FR");
  const fmt = (n) => nf.format(Math.round(Number(n) || 0));
  const KIND_LABELS = { error: "Erreur", lag: "Lenteur", user: "Signalement" };
  const KIND_ICONS = { error: "bug", lag: "clock", user: "users" };
  const PLATFORM_LABELS = { android_app: "Application Android", android_web: "Site sur Android", ios: "iPhone / iPad", desktop: "Ordinateur" };

  let BUGS = null, BUGS_AT = 0;
  const FILTER = { status: "open", kind: "all", q: "" };

  const seconds = (ms) => (ms ? nf.format(Math.round(ms / 100) / 10) + " s" : "");
  const relTime = (ms) => {
    if (!ms) return "—";
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return "à l'instant";
    const m = Math.round(s / 60);
    if (m < 60) return "il y a " + m + " min";
    const h = Math.round(m / 60);
    if (h < 48) return "il y a " + h + " h";
    return "il y a " + Math.round(h / 24) + " j";
  };
  const fullDate = (ms) => (ms ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms)) : "—");
  const platformsText = (p) => Object.entries(p || {}).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => (PLATFORM_LABELS[k] || k) + " (" + fmt(n) + ")").join(" · ");

  const tile = ({ icon, val, label, tone, sub }) => `
    <div class="stat">
      <div class="stat-top"><span class="stat-ic ${tone || ""}">${ic(icon)}</span>${sub ? `<span class="stat-delta">${esc(sub)}</span>` : ""}</div>
      <div class="stat-val">${fmt(val)}</div>
      <div class="stat-lbl">${esc(label)}</div>
    </div>`;

  window.loadBugs = async function () {
    const list = $("bugsList");
    if (list && !BUGS) list.innerHTML = "<div class='empty'>Chargement…</div>";
    try {
      BUGS = await api("bugs", { action: "list" });
      BUGS_AT = Date.now();
      renderBugs();
    } catch (e) {
      if (list) list.innerHTML = "<div class='empty' style='color:var(--danger)'>" + esc(e.message) + "</div>";
    }
  };

  window.renderBugs = function () {
    if (!BUGS) return;
    const t = BUGS.totals || {};
    if ($("bugsKpis")) $("bugsKpis").innerHTML =
      tile({ icon: "bug", val: t.open, label: "Bugs ouverts", tone: "gold", sub: t.regressed ? t.regressed + " revenu(s)" : "" }) +
      tile({ icon: "warning", val: t.errors7, label: "Erreurs (7 j)" }) +
      tile({ icon: "clock", val: t.lags7, label: "Lenteurs (7 j)" }) +
      tile({ icon: "users", val: t.reports7, label: "Signalements (7 j)", tone: "gold" });
    renderBugsChart();
    renderBugsList();
    if ($("bugsUpdated")) $("bugsUpdated").textContent = BUGS_AT ? "Mis à jour " + relTime(BUGS_AT) : "";
    const badge = $("bugsNavBadge");
    if (badge) { badge.textContent = t.open > 99 ? "99+" : String(t.open || ""); badge.hidden = !t.open; }
  };

  function renderBugsChart() {
    const el = $("bugsChart");
    if (!el) return;
    const daily = (BUGS.daily || []).map((r) => ({ ...r, total: r.error + r.lag + r.user }));
    // Petit écran : paquets de 7 jours (comme Publicités), sinon les valeurs se chevauchent.
    const rows = matchMedia("(max-width: 700px)").matches ? chunkWeekly(daily, ["total", "error", "lag", "user"]) : daily;
    if (!rows.some((r) => r.total > 0)) { el.innerHTML = "<div class='empty'>Aucun problème remonté sur les 30 derniers jours.</div>"; return; }
    el.innerHTML = barChartHtml(rows, {
      series: [
        { key: "total", color: "linear-gradient(180deg,var(--gold-2),var(--gold))", label: "Tous les problèmes" },
        { key: "error", cls: "uniq", color: "var(--chart-2)", label: "Erreurs" }
      ],
      valueKey: "total",
      tooltip: (r) => frDate(r.bucket) + " · " + fmt(r.error) + " erreurs · " + fmt(r.lag) + " lenteurs · " + fmt(r.user) + " signalements"
    });
  }

  function filtered() {
    const q = FILTER.q.trim().toLowerCase();
    return (BUGS.groups || []).filter((g) =>
      (FILTER.status === "all" || g.status === FILTER.status) &&
      (FILTER.kind === "all" || g.kind === FILTER.kind) &&
      (!q || [g.message, g.detail, g.page, g.reporter, g.label].join(" ").toLowerCase().includes(q)));
  }

  function bugCardHtml(g) {
    const title = g.kind === "user" ? g.detail.split("\n")[0] : g.message;
    const sub = [
      g.page,
      g.kind === "lag" && g.avgMs ? "moyenne " + seconds(g.avgMs) + " · max " + seconds(g.maxMs) : "",
      g.kind === "user" && g.reporter ? g.reporter : "",
      g.lastVersion ? "version " + g.lastVersion : "",
      platformsText(g.platforms)
    ].filter(Boolean).join(" · ");
    return `<div class="access-card bug-card${g.status === "resolved" ? " off" : ""}" data-bug="${esc(g.id)}" tabindex="0" role="button" aria-label="Voir le détail : ${esc(title)}">
      <span class="bug-kind bug-kind-${esc(g.kind)}">${ic(KIND_ICONS[g.kind] || "bug")}</span>
      <div class="access-card-main">
        <div class="access-card-top">
          <span class="access-email bug-title">${esc(title)}</span>
          ${g.regressed ? '<span class="badge expired">Revenu</span>' : ""}
          ${g.status === "resolved" ? '<span class="badge gold">Résolu</span>' : ""}
        </div>
        <div class="access-sub">${esc(KIND_LABELS[g.kind] || "")} · ${esc(sub)}</div>
      </div>
      <div class="bug-count"><b>${fmt(g.count)}</b><small>${esc(relTime(g.lastAt))}</small></div>
    </div>`;
  }

  function renderBugsList() {
    const el = $("bugsList");
    if (!el) return;
    const rows = filtered();
    if (!rows.length) {
      el.innerHTML = `<div class='empty'>${FILTER.status === "open" && !FILTER.q && FILTER.kind === "all" ? "Aucun bug ouvert. Tout fonctionne !" : "Aucun résultat pour ces filtres."}</div>`;
      return;
    }
    el.innerHTML = rows.map(bugCardHtml).join("");
    el.querySelectorAll("[data-bug]").forEach((card) => {
      const open = () => openBug(card.getAttribute("data-bug"));
      card.onclick = open;
      card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
    });
  }

  // Texte prêt à coller dans un ticket ou à transmettre au développeur.
  function bugAsText(g, events) {
    const lines = [
      "[" + (KIND_LABELS[g.kind] || g.kind) + "] " + (g.kind === "user" ? g.detail : g.message),
      "Page : " + g.page,
      "Occurrences : " + g.count + " (première " + fullDate(g.firstAt) + ", dernière " + fullDate(g.lastAt) + ")",
      g.lastVersion ? "Version : " + g.lastVersion : "",
      "Appareils : " + platformsText(g.platforms),
      g.stack ? "\nPile :\n" + g.stack : "",
      events.length ? "\nDernières occurrences :\n" + events.slice(0, 5).map((e) => "- " + fullDate(e.at) + " · " + (e.page || "") + " · " + (PLATFORM_LABELS[e.platform] || e.platform || "") + (e.version ? " · " + e.version : "") + (e.durationMs ? " · " + seconds(e.durationMs) : "")).join("\n") : ""
    ];
    return lines.filter(Boolean).join("\n");
  }

  window.openBug = async function (id) {
    $("bigcard").innerHTML = `<div class="bighead"><h3>Détail du problème</h3><button id="btnCloseBug" class="btn text">Fermer</button></div><div id="bugDetail"><div class="empty">Chargement…</div></div>`;
    $("big").hidden = false;
    $("btnCloseBug").onclick = closeBig;
    let d;
    try { d = await api("bugs", { action: "events", id }); }
    catch (e) { $("bugDetail").innerHTML = "<div class='empty' style='color:var(--danger)'>" + esc(e.message) + "</div>"; return; }
    const g = d.group, events = d.events || [];
    const facts = [
      ["Type", KIND_LABELS[g.kind] || g.kind],
      ["Page", g.page],
      ["Occurrences", fmt(g.count)],
      ["Première fois", fullDate(g.firstAt)],
      ["Dernière fois", fullDate(g.lastAt)],
      g.kind === "lag" ? ["Durée", "moyenne " + seconds(g.avgMs) + " · max " + seconds(g.maxMs)] : null,
      ["Appareils", platformsText(g.platforms) || "—"],
      ["Versions", Object.entries(g.versions || {}).map(([v, n]) => v.replace(/,/g, ".") + " (" + fmt(n) + ")").join(" · ") || "—"],
      g.reporter ? ["Signalé par", g.reporter] : null,
      g.status === "resolved" ? ["Résolu", fullDate(g.resolvedAt)] : null
    ].filter(Boolean);
    $("bugDetail").innerHTML = `
      <p class="bug-detail-msg">${esc(g.kind === "user" ? g.detail : g.message)}</p>
      <dl class="bug-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${g.stack ? `<h4>Pile d'appels</h4><pre class="bug-stack">${esc(g.stack)}</pre>` : ""}
      <h4>Dernières occurrences</h4>
      <div class="list bug-events">${events.length ? events.map((e) => `
        <div class="row"><div><b>${esc(fullDate(e.at))}</b> <span class="muted">· ${esc(e.page || "")} · ${esc(PLATFORM_LABELS[e.platform] || e.platform || "")}${e.version ? " · " + esc(e.version) : ""}${e.durationMs ? " · " + esc(seconds(e.durationMs)) : ""}</span>
          ${e.email ? `<div class="muted">${esc(e.email)}</div>` : ""}
          ${e.detail && g.kind !== "user" ? `<div class="muted">${esc(e.detail)}</div>` : ""}</div></div>`).join("") : "<div class='empty'>Aucune occurrence détaillée.</div>"}
      </div>
      <div class="bug-actions">
        <button class="btn" id="btnCopyBug">${ic("copy")} Copier le rapport</button>
        ${g.status === "open"
          ? `<button class="btn primary" id="btnResolveBug">${ic("check")} Marquer comme résolu</button>`
          : `<button class="btn" id="btnReopenBug">${ic("restore")} Rouvrir</button>`}
        <button class="btn danger" id="btnDeleteBug">${ic("trash")} Supprimer</button>
      </div>`;
    $("btnCopyBug").onclick = async () => {
      try { await navigator.clipboard.writeText(bugAsText(g, events)); showToast("Rapport copié."); }
      catch { showToast("Copie impossible sur cet appareil.", "err"); }
    };
    const act = async (action, message) => {
      try { await api("bugs", { action, id }); showToast(message); closeBig(); await loadBugs(); }
      catch (e) { showToast(e.message, "err"); }
    };
    if ($("btnResolveBug")) $("btnResolveBug").onclick = () => act("resolve", "Bug marqué comme résolu.");
    if ($("btnReopenBug")) $("btnReopenBug").onclick = () => act("reopen", "Bug rouvert.");
    $("btnDeleteBug").onclick = async () => {
      if (!(await uiConfirm({ title: "Supprimer ce bug", danger: true, icon: "trash", confirmText: "Supprimer",
        message: "Le bug et ses occurrences seront effacés. S'il se reproduit, il réapparaîtra comme nouveau." }))) return;
      act("delete", "Bug supprimé.");
    };
  };

  const bindSeg = (segId, attr, key) => {
    const seg = $(segId);
    if (!seg) return;
    seg.querySelectorAll("[" + attr + "]").forEach((b) => b.onclick = () => {
      FILTER[key] = b.getAttribute(attr);
      seg.querySelectorAll("[" + attr + "]").forEach((x) => x.classList.toggle("active", x === b));
      renderBugsList();
    });
  };
  bindSeg("bugsStatusSeg", "data-status", "status");
  bindSeg("bugsKindSeg", "data-kind", "kind");
  if ($("bugsSearch")) $("bugsSearch").oninput = (e) => { FILTER.q = e.target.value; if (BUGS) renderBugsList(); };
  if ($("btnReloadBugs")) $("btnReloadBugs").onclick = () => loadBugs();
  // Pastille du menu : nombre de bugs ouverts, chargé discrètement dès
  // l'ouverture du panneau (sans attendre la visite de l'onglet).
  let badgeLoaded = false;
  document.addEventListener("admin:tabchange", (event) => {
    if (badgeLoaded || event.detail.target === "bugs") { badgeLoaded = true; return; }
    badgeLoaded = true;
    api("bugs", { action: "list" }).then((d) => { if (!BUGS) { BUGS = d; BUGS_AT = Date.now(); renderBugs(); } }).catch(() => {});
  });
  if ($("btnPurgeBugs")) $("btnPurgeBugs").onclick = async () => {
    if (!(await uiConfirm({ title: "Supprimer les bugs résolus", danger: true, icon: "trash", confirmText: "Supprimer",
      message: "Tous les bugs marqués comme résolus seront effacés." }))) return;
    try { const r = await api("bugs", { action: "purge_resolved" }); showToast(fmt(r.removed) + " bug(s) supprimé(s)."); await loadBugs(); }
    catch (e) { showToast(e.message, "err"); }
  };
})();
