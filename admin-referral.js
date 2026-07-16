// admin-referral.js — Onglet « Parrainage » : suivi, anti-fraude, paramètres.
// Dépend de admin-core.js ($ , api, esc, when, showToast).

(function () {
  "use strict";

  let REF = null;          // dernière réponse "overview"
  let filter = "";

  const nf = (n) => Number(n || 0).toLocaleString("fr-FR");
  const kpi = (val, lbl) => `<div class="kpi"><div class="kpi-val">${esc(val)}</div><div class="kpi-lbl">${esc(lbl)}</div></div>`;

  // ── Chargement ──────────────────────────────────────────────
  window.loadReferral = async function () {
    const list = $("refList");
    if (!list) return;
    list.innerHTML = "<div class='empty'>Lecture du programme de parrainage…</div>";
    try {
      REF = await api("referral", { action: "overview" });
      renderReferral();
    } catch (e) {
      list.innerHTML = `<div class='empty' style='color:var(--danger)'>${esc(e.message)}</div>`;
    }
  };

  function renderReferral() {
    if (!REF) return;
    const t = REF.totals, s = REF.settings;

    $("refKpis").innerHTML =
      kpi(nf(t.sponsors), "Parrains") +
      kpi(nf(t.invited), "Filleuls crédités") +
      kpi(nf(t.clicks), "Clics sur les liens") +
      kpi(t.conv + " %", "Clic → inscription") +
      kpi(nf(t.points), "Points en circulation") +
      kpi(nf(t.rewards), "Abonnements gagnés") +
      kpi(nf(t.pending), "Clics non crédités") +
      kpi(nf(t.blocked), "Parrains suspendus");

    // Paramètres
    $("refEnabled").checked = !!s.enabled;
    $("refPpi").value  = s.pointsPerInvite;
    $("refGoal").value = s.pointsForReward;
    $("refDays").value = s.rewardDays;
    $("refAge").value  = s.maxAccountAgeDays;
    $("refHint").textContent =
      s.pointsForReward / s.pointsPerInvite + " filleuls = " + s.rewardDays + " jours d'abonnement offerts.";

    // Alertes
    const alerts = REF.alerts || [];
    $("refAlerts").innerHTML = alerts.length
      ? alerts.map((a) => `<div class="row">
          <div><b>${esc(a.email || a.uid)}</b> <span class="muted">· ${esc(a.why)}</span></div>
          <div class="row-actions">
            <button class="btn text" data-kids="${esc(a.uid)}">Voir les filleuls</button>
            <button class="btn text danger-text" data-block="${esc(a.uid)}">Suspendre</button>
          </div></div>`).join("")
      : "<div class='empty'>Aucun comportement suspect détecté.</div>";
    $("refAlertCount").textContent = alerts.length ? "(" + alerts.length + ")" : "";

    renderSponsors();
    wire();
  }

  function renderSponsors() {
    const q = filter.trim().toLowerCase();
    const rows = (REF.sponsors || []).filter((s) =>
      !q || (s.email || "").toLowerCase().includes(q) || (s.code || "").toLowerCase().includes(q));
    $("refCount").textContent = rows.length + " parrain(s)";

    $("refList").innerHTML = rows.length ? rows.map((s) => `
      <div class="row ${s.blocked ? "row-off" : ""}">
        <div class="ref-main">
          <div><b>${esc(s.email || s.uid)}</b>
            <span class="tag">${esc(s.code || "—")}</span>
            ${s.blocked ? '<span class="tag danger">suspendu</span>' : ""}
            ${s.rewards ? `<span class="tag ok">${s.rewards} abo gagné(s)</span>` : ""}
          </div>
          <div class="muted">
            ${nf(s.points)} pts · ${s.invited} filleul(s) · ${nf(s.clicks)} clic(s)
            ${s.conv !== null ? " · conv. " + s.conv + " %" : ""}
            ${s.invited24h ? " · <b>" + s.invited24h + " en 24 h</b>" : ""}
            · reste ${nf(s.toReward)} pts
            ${s.lastAt ? " · dernier : " + when(s.lastAt) : ""}
          </div>
        </div>
        <div class="row-actions">
          <button class="btn text" data-kids="${esc(s.uid)}">Filleuls</button>
          <button class="btn text" data-adjust="${esc(s.uid)}">± Points</button>
          <button class="btn text" data-reset="${esc(s.uid)}">↻ Code</button>
          ${s.blocked
            ? `<button class="btn text" data-unblock="${esc(s.uid)}">Réactiver</button>`
            : `<button class="btn text danger-text" data-block="${esc(s.uid)}">Suspendre</button>`}
        </div>
      </div>`).join("")
      : "<div class='empty'>Aucun parrain pour l'instant.</div>";
  }

  // ── Actions ─────────────────────────────────────────────────
  function wire() {
    document.querySelectorAll("[data-kids]").forEach((b) => b.onclick = () => showChildren(b.dataset.kids));
    document.querySelectorAll("[data-adjust]").forEach((b) => b.onclick = () => adjust(b.dataset.adjust));
    document.querySelectorAll("[data-reset]").forEach((b) => b.onclick = () => resetCode(b.dataset.reset));
    document.querySelectorAll("[data-block]").forEach((b) => b.onclick = () => setBlock(b.dataset.block, true));
    document.querySelectorAll("[data-unblock]").forEach((b) => b.onclick = () => setBlock(b.dataset.unblock, false));
  }

  async function showChildren(uid) {
    const box = $("refKids");
    box.hidden = false;
    box.innerHTML = "<div class='empty'>Chargement des filleuls…</div>";
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      const d = await api("referral", { action: "children", uid });
      const s = (REF.sponsors || []).find((x) => x.uid === uid) || {};
      box.innerHTML = `
        <div class="bar"><h3 style="margin:0">Filleuls de ${esc(s.email || uid)} <span class="muted">(${d.total})</span></h3>
          <button class="btn text" id="refKidsClose">✕ Fermer</button></div>
        ${d.rows.length ? d.rows.map((r) => `
          <div class="row">
            <div><b>${esc(r.email || r.uid)}</b>
              <span class="tag ${r.credited ? "ok" : "danger"}">${r.credited ? "+ points" : "non crédité"}</span>
              ${r.reason ? `<span class="muted"> · ${esc(r.reason)}</span>` : ""}
            </div>
            <div class="muted">${when(r.at)}</div>
          </div>`).join("") : "<div class='empty'>Aucun filleul.</div>"}`;
      $("refKidsClose").onclick = () => { box.hidden = true; };
    } catch (e) { box.innerHTML = `<div class='empty' style='color:var(--danger)'>${esc(e.message)}</div>`; }
  }

  async function adjust(uid) {
    const s = (REF.sponsors || []).find((x) => x.uid === uid) || {};
    const raw = prompt("Points à ajouter (négatif pour retirer) pour " + (s.email || uid) + " :\nActuel : " + (s.points || 0) + " pts", "10");
    if (raw === null) return;
    const delta = Number(raw);
    if (!Number.isFinite(delta) || delta === 0) { showToast("Valeur invalide.", "err"); return; }
    const reason = prompt("Motif (obligatoire, inscrit au journal d'audit) :", "");
    if (!reason) { showToast("Motif obligatoire.", "err"); return; }
    try {
      const d = await api("referral", { action: "adjust", uid, delta, reason });
      showToast("Points : " + d.points);
      loadReferral(); loadAudit();
    } catch (e) { showToast(e.message, "err"); }
  }

  async function setBlock(uid, on) {
    const s = (REF.sponsors || []).find((x) => x.uid === uid) || {};
    if (on && !confirm("Suspendre le parrainage de " + (s.email || uid) + " ?\nSes futurs filleuls ne rapporteront plus de points.")) return;
    let reason = "";
    if (on) { reason = prompt("Motif de la suspension :", "Fraude suspectée") || ""; }
    try {
      await api("referral", { action: on ? "block" : "unblock", uid, reason });
      showToast(on ? "Parrain suspendu." : "Parrain réactivé.");
      loadReferral(); loadAudit();
    } catch (e) { showToast(e.message, "err"); }
  }

  async function resetCode(uid) {
    const s = (REF.sponsors || []).find((x) => x.uid === uid) || {};
    if (!confirm("Régénérer le code de " + (s.email || uid) + " ?\n⚠️ Tous les liens déjà partagés avec l'ancien code cesseront de le créditer.")) return;
    try {
      const d = await api("referral", { action: "reset_code", uid });
      showToast("Nouveau code : " + d.code);
      loadReferral(); loadAudit();
    } catch (e) { showToast(e.message, "err"); }
  }

  // ── Recherche & paramètres ──────────────────────────────────
  const search = $("refSearch");
  if (search) search.oninput = () => { filter = search.value; if (REF) renderSponsors(), wire(); };

  const reload = $("btnReloadReferral");
  if (reload) reload.onclick = () => loadReferral();

  const save = $("btnSaveReferral");
  if (save) save.onclick = async () => {
    const settings = {
      enabled: $("refEnabled").checked,
      pointsPerInvite: Number($("refPpi").value),
      pointsForReward: Number($("refGoal").value),
      rewardDays: Number($("refDays").value),
      maxAccountAgeDays: Number($("refAge").value)
    };
    const msg = $("refMsg");
    try {
      const d = await api("referral", { action: "settings_set", settings });
      REF.settings = d.settings;
      msg.className = "msg ok";
      msg.textContent = "Paramètres appliqués — le hub les prend en compte immédiatement.";
      renderReferral(); loadAudit();
    } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
  };
})();
