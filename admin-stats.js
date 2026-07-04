// admin-stats.js — Statistiques, visites, audit, configuration

(function () {
  "use strict";

  // ── Audit ──
  window.loadAudit = async function () {
    $("auditList").innerHTML = "<div class='empty'>Lecture analytique du journal d'audit…</div>";
    try {
      const d = await api("stats", { action: "audit" });
      $("auditList").innerHTML = (d.rows || []).map((r) => `
        <div class="row">
          <div class="audit-meta">
            <span class="audit-action">${esc(r.action)}</span>
            <span class="audit-target">${esc(r.target || "—")}</span>
          </div>
          <div class="audit-details muted">
            Opérateur : <b>${esc(r.by)}</b> · Date : ${when(r.at)} ${r.details ? ' · Spécifications : <i>' + esc(r.details) + '</i>' : ''}
          </div>
        </div>
      `).join("") || "<div class='empty'>Le journal d'audit est totalement vierge.</div>";
    } catch (e) {
      $("auditList").innerHTML = `<div class='empty' style='color:var(--danger);'>Erreur d'accès au journal : ${esc(e.message)}</div>`;
    }
  };

  // ── Configuration ──
  window.loadConfig = async function () {
    try {
      const d = await api("stats", { action: "config_get" });
      $("cfgMaintenance").checked = !!d.config.maintenance;
      $("cfgAnnouncement").value = d.config.announcement || "";
    } catch (e) {}
  };

  $("btnSaveCfg").onclick = async () => {
    if ($("cfgMaintenance").checked && !confirm("⚠️ ALERTE CRITIQUE : Activer le mode maintenance ?\nTous les utilisateurs réguliers se heurteront à une barrière d'accès.")) return;
    try {
      await api("stats", { 
        action: "config_set", 
        config: { 
          maintenance: $("cfgMaintenance").checked, 
          announcement: $("cfgAnnouncement").value.trim() 
        } 
      });
      showToast("Les modifications de configuration système sont en ligne.");
    } catch (e) { showToast(e.message, "err"); }
  };

  // ── Analytics ──
  let ANA = null;
  const kpi = (val, lbl) => `<div class="kpi"><div class="kpi-val">${esc(val)}</div><div class="kpi-lbl">${esc(lbl)}</div></div>`;
  const hbars = (items, labelFn) => {
    if (!items || !items.length) return "<div class='empty'>Aucune donnée.</div>";
    const m = Math.max(1, ...items.map((i) => i.count));
    return items.map((i) => `<div class="hbar">
      <div class="hbar-lbl">${esc(labelFn(i))}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(i.count / m * 100)}%"></div></div>
      <div class="hbar-n">${i.count}</div></div>`).join("");
  };
  const shortBucket = (b) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(b)) return b.slice(5);
    if (/^\d{4}-S\d{2}$/.test(b)) return b.slice(5);
    if (/^\d{4}-\d{2}$/.test(b)) return b.slice(5) + "/" + b.slice(2, 4);
    return b;
  };

  window.loadAnalytics = async function () {
    $("anaPages").innerHTML = "<div class='empty'>Chargement…</div>";
    try { ANA = await api("stats", { action: "analytics" }); renderAnalytics(); }
    catch (e) { $("anaPages").innerHTML = "<div class='empty'>" + esc(e.message) + "</div>"; }
  };
  window.renderAnalytics = function () {
    if (!ANA) return;
    const t = ANA.totals || {};
    $("anaKpis").innerHTML =
      kpi(t.uniqueAllTime ?? 0, "Visiteurs uniques (total)") +
      kpi(t.totalVisits ?? 0, "Visites cumulées") +
      kpi(t.events ?? 0, "Événements enregistrés") +
      kpi(t.boutiques ?? 0, "Boutiques") +
      kpi(t.likesTotal ?? 0, "Aimes cumulés");
    $("anaPages").innerHTML = hbars(ANA.topPages, (i) => i.page);
    $("anaTypes").innerHTML = hbars(ANA.types, (i) => i.type);
    $("anaBoutiques").innerHTML = (ANA.boutiques || []).map((b) => `
      <div class="bq-row">
        ${b.img ? `<img src="${esc(b.img)}" alt="">` : `<div class="frame" style="width:42px;height:42px;flex:0 0 42px"><div class="noimg" style="font-size:.55rem">—</div></div>`}
        <div class="bq-meta">
          <div class="bq-name">${esc(b.name)}</div>
          <div class="bq-sub">${esc(b.number || "—")} · ${b.follow} follow</div>
        </div>
        <div class="bq-likes">❤ ${b.likes}</div>
      </div>`).join("") || "<div class='empty'>Aucune boutique.</div>";
  };
  if ($("btnReloadAnalytics")) $("btnReloadAnalytics").onclick = loadAnalytics;

  // ── Visites ──
  let VIS_GRAN = "daily";
  window.loadVisits = async function () {
    $("visBars").innerHTML = "<div class='empty'>Chargement…</div>";
    try { if (!ANA) ANA = await api("stats", { action: "analytics" }); renderVisits(); }
    catch (e) { $("visBars").innerHTML = "<div class='empty'>" + esc(e.message) + "</div>"; }
  };
  window.renderVisits = function () {
    if (!ANA) return;
    const rows = ANA[VIS_GRAN] || [];
    const t = ANA.totals || {};
    const unit = { daily: "jours", weekly: "semaines", monthly: "mois" }[VIS_GRAN];
    $("visKpis").innerHTML =
      kpi(t.uniqueAllTime ?? 0, "Visiteurs uniques (total)") +
      kpi(t.totalVisits ?? 0, "Visites cumulées") +
      kpi(t.days ?? 0, "Jours actifs") +
      kpi(rows.length, "Périodes (" + unit + ")");
    const maxTotal = Math.max(1, ...rows.map((r) => r.total));
    $("visBars").innerHTML = rows.map((r) => {
      const hT = Math.max(2, Math.round(r.total / maxTotal * 160));
      const hU = Math.max(2, Math.round(r.unique / maxTotal * 160));
      return `<div class="bar-col" title="${esc(r.bucket)} : ${r.total} visites · ${r.unique} uniques">
        <div class="bar-n">${r.total}</div>
        <div style="display:flex; align-items:flex-end; gap:3px; height:160px">
          <div class="bar-fill" style="height:${hT}px; width:14px"></div>
          <div class="bar-fill uniq" style="height:${hU}px; width:14px"></div>
        </div>
        <div class="bar-x">${esc(shortBucket(r.bucket))}</div>
      </div>`;
    }).join("") || "<div class='empty'>Aucune visite enregistrée.</div>";
    $("visTable").innerHTML = rows.slice().reverse().map((r) =>
      `<tr><td>${esc(r.bucket)}</td><td class="num">${r.unique}</td><td class="num">${r.total}</td></tr>`
    ).join("") || "<tr><td colspan='3' class='muted'>Aucune donnée.</td></tr>";
    $("visFeed").innerHTML = (ANA.recent || []).map((e) => `
      <div class="row">
        <div><b>${esc(e.email || "—")}</b> <span class="muted">· ${esc(e.page)}</span></div>
        <div class="muted">${esc(e.type)} · ${when(e.at)}</div>
      </div>`).join("") || "<div class='empty'>Aucune activité récente.</div>";
  };
  document.querySelectorAll("#visSeg [data-gran]").forEach((b) => b.onclick = () => {
    document.querySelectorAll("#visSeg [data-gran]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    VIS_GRAN = b.getAttribute("data-gran");
    renderVisits();
  });
  if ($("btnReloadVisits")) $("btnReloadVisits").onclick = () => { ANA = null; loadVisits(); };

})();
