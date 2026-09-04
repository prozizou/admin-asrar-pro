// admin-referral.js — Onglet « Parrainage » : Vue d'ensemble, Parrains, Réglages.
// Dépend de admin-core.js ($ , api, esc, when, showToast, uiConfirm, uiPrompt, ic).

(function () {
  "use strict";

  const nf = new Intl.NumberFormat("fr-FR");
  const fmt = (n) => nf.format(Math.round(Number(n) || 0));
  const fmtPct = (n) => nf.format(Math.abs(n)) + " %";
  const relTime = (ms) => {
    if (!ms) return "";
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 10) return "à l'instant";
    if (s < 60) return "il y a " + s + " s";
    const m = Math.round(s / 60);
    if (m < 60) return "il y a " + m + " min";
    const h = Math.round(m / 60);
    if (h < 24) return "il y a " + h + " h";
    return "il y a " + Math.round(h / 24) + " j";
  };
  // Même composant carte KPI que le Dashboard/Analytique (icône, valeur,
  // libellé, puce de tendance) — pas un second gabarit pour cet onglet.
  const statTile = ({ icon, val, label, deltaPct, tone, span }) => `
    <div class="stat${span ? " span2" : ""}">
      <div class="stat-top">
        <span class="stat-ic ${tone || ""}">${ic(icon)}</span>
        ${deltaPct != null ? `<span class="stat-delta ${deltaPct > 0 ? "up" : deltaPct < 0 ? "down" : ""}">${ic("trend")}${deltaPct > 0 ? "+" : ""}${fmtPct(deltaPct)}</span>` : ""}
      </div>
      <div class="stat-val">${fmt(val)}</div>
      <div class="stat-lbl">${esc(label)}</div>
    </div>`;

  let REF = null, REF_AT = 0, REF_PERIOD = "d30", FILTER = "all";

  // ── Chargement ──────────────────────────────────────────────
  window.loadReferral = async function () {
    const list = $("refList");
    if (list) list.innerHTML = "<div class='empty'>Lecture du programme de parrainage…</div>";
    try {
      REF = await api("referral", { action: "overview" });
      REF_AT = Date.now();
      renderReferral();
    } catch (e) {
      if (list) list.innerHTML = `<div class='empty' style='color:var(--danger)'>${esc(e.message)}</div>`;
    }
  };

  function renderReferral() {
    if (!REF) return;
    renderOverview();
    renderSponsors();
    renderSettings();
    const segCount = $("refSegCount");
    if (segCount) segCount.textContent = REF.totals.sponsors || "";
    const upd = $("refUpdated");
    if (upd) upd.textContent = REF_AT ? "Mis à jour " + relTime(REF_AT) : "";
  }

  // ── Sous-navigation (Vue d'ensemble / Parrains / Réglages) ──
  const REF_SUBS = ["overview", "sponsors", "settings"];
  window.showRefSub = function (sub) {
    document.querySelectorAll("#refSeg [data-refsub]").forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-refsub") === sub));
    REF_SUBS.forEach((s) => { const el = $("refsub-" + s); if (el) el.hidden = s !== sub; });
  };
  document.querySelectorAll("#refSeg [data-refsub]").forEach((b) =>
    b.onclick = () => showRefSub(b.getAttribute("data-refsub")));

  // ── Vue d'ensemble ──────────────────────────────────────────
  const periodSeg = $("refPeriodSeg");
  if (periodSeg) periodSeg.querySelectorAll("[data-period]").forEach((b) => b.onclick = () => {
    REF_PERIOD = b.getAttribute("data-period");
    periodSeg.querySelectorAll("[data-period]").forEach((x) => x.classList.toggle("active", x === b));
    renderOverview();
  });

  function renderOverview() {
    if (!REF) return;
    const t = REF.totals, per = (REF.periods && REF.periods[REF_PERIOD]) || {};

    if ($("refKpis")) $("refKpis").innerHTML =
      statTile({ icon: "users", val: per.sponsors ?? 0, label: "Nouveaux parrains", deltaPct: per.deltaSponsors, tone: "gold" }) +
      statTile({ icon: "gift", val: per.invited ?? 0, label: "Nouveaux filleuls crédités", deltaPct: per.deltaInvited }) +
      statTile({ icon: "referral", val: t.active ?? 0, label: "Parrains actifs (total)" }) +
      statTile({ icon: "block", val: t.blocked ?? 0, label: "Parrains suspendus", tone: t.blocked ? "danger" : "" });

    // Ligne secondaire — mesures cumulatives sans horodatage d'événement
    // (compteurs bruts côté hub) : pas de delta fabriqué pour elles, cf. api/referral.js.
    if ($("refSecondary")) $("refSecondary").textContent =
      fmt(t.clicks) + " clics au total · conversion " + t.conv + " % · " +
      fmt(t.points) + " points en circulation · " + fmt(t.rewards) + " récompense(s) accordée(s)";

    renderFraud();
    renderRefChart();
  }

  function renderFraud() {
    const alerts = REF.alerts || [];
    const title = $("refFraudTitle"), toggle = $("refFraudToggle"), listEl = $("refFraudList"), summary = $("refFraudSummary");
    if (!title) return;
    if (!alerts.length) {
      title.innerHTML = `<span class="fraud-ok">${ic("check")}</span> Anti-fraude : aucune anomalie détectée`;
      if (toggle) toggle.hidden = true;
      if (listEl) { listEl.hidden = true; listEl.innerHTML = ""; }
      summary.onclick = null;
      summary.style.cursor = "default";
      return;
    }
    title.innerHTML = `<span class="fraud-warn">${ic("warning")}</span> Anti-fraude : ${alerts.length} comportement(s) suspect(s)`;
    if (toggle) toggle.hidden = false;
    summary.style.cursor = "pointer";
    const render = () => {
      listEl.innerHTML = alerts.map((a) => `
        <div class="row">
          <div><b>${esc(a.email || a.uid)}</b> <span class="muted">· ${esc(a.why)}</span></div>
          <div class="row-actions">
            <button class="btn text" data-fraud-profile="${esc(a.uid)}">Voir le profil</button>
            <button class="btn text danger-text" data-fraud-block="${esc(a.uid)}">Suspendre</button>
          </div></div>`).join("");
      listEl.querySelectorAll("[data-fraud-profile]").forEach((b) => b.onclick = () => openSponsorProfile(b.getAttribute("data-fraud-profile")));
      listEl.querySelectorAll("[data-fraud-block]").forEach((b) => b.onclick = () => setBlock(b.getAttribute("data-fraud-block"), true));
    };
    const toggleOpen = () => { listEl.hidden = !listEl.hidden; if (!listEl.hidden) render(); };
    summary.onclick = toggleOpen;
    if (toggle) toggle.onclick = (e) => { e.stopPropagation(); toggleOpen(); };
  }

  // Graphique « Performance » — filleuls crédités/jour, une seule série
  // (contrairement à Analytique, aucune notion d'« uniques » ici). La série
  // ne couvre que les 90 derniers jours (seule donnée renvoyée par le
  // serveur) : la période « Tout » l'affiche donc en entier plutôt qu'un
  // historique complet non disponible.
  function renderRefChart() {
    const el = $("refChart");
    if (!el || !REF) return;
    const nDays = { d7: 7, d30: 30, d90: 90 }[REF_PERIOD];
    const rows = (REF.daily || []).slice(nDays ? -nDays : -90);
    if (!rows.length || !rows.some((r) => r.invited > 0)) { el.innerHTML = "<div class='empty'>Aucun filleul crédité sur cette période.</div>"; return; }
    const max = Math.max(1, ...rows.map((r) => r.invited));
    el.innerHTML = `<div class="spark-bars">
      ${rows.map((r) => {
        const h = Math.max(3, Math.round(r.invited / max * 100));
        return `<div class="spark-col" title="${esc(r.bucket)} · ${fmt(r.invited)} filleul(s)">
          <span class="spark-tip">${fmt(r.invited)} filleul(s)</span>
          <div class="spark-stack"><div class="spark-fill" style="height:${h}%"></div></div>
          <span class="spark-x">${esc(r.bucket.slice(5))}</span>
        </div>`;
      }).join("")}
    </div>`;
  }

  // ── Parrains ────────────────────────────────────────────────
  const filterChips = $("refFilterChips");
  if (filterChips) filterChips.querySelectorAll("[data-filter]").forEach((b) => b.onclick = () => {
    FILTER = b.getAttribute("data-filter");
    filterChips.querySelectorAll("[data-filter]").forEach((x) => x.classList.toggle("active", x === b));
    renderSponsors();
  });
  const search = $("refSearch");
  if (search) search.oninput = () => renderSponsors();

  function renderSponsors() {
    if (!REF) return;
    const q = (search ? search.value : "").trim().toLowerCase();
    let rows = REF.sponsors || [];
    if (FILTER === "active") rows = rows.filter((s) => !s.blocked && s.invited > 0);
    else if (FILTER === "watch") rows = rows.filter((s) => (REF.alerts || []).some((a) => a.uid === s.uid));
    else if (FILTER === "blocked") rows = rows.filter((s) => s.blocked);
    if (q) rows = rows.filter((s) => (s.email || "").toLowerCase().includes(q) || (s.code || "").toLowerCase().includes(q));

    const refCount = $("refCount");
    if (refCount) refCount.textContent = "(" + rows.length + ")";

    const watchSet = new Set((REF.alerts || []).map((a) => a.uid));
    const list = $("refList");
    if (!list) return;
    list.innerHTML = rows.length ? rows.map((s) => `
      <div class="access-card ${s.blocked ? "off" : ""}">
        <div class="access-card-main">
          <div class="access-card-top">
            <span class="access-email">${esc(s.email || s.uid)}</span>
            <span class="tag code">${esc(s.code || "—")}</span>
            ${s.blocked ? '<span class="access-status off">Suspendu</span>' : watchSet.has(s.uid) ? '<span class="access-status off">À surveiller</span>' : ""}
          </div>
          <div class="access-sub">${fmt(s.invited)} filleul(s) · ${fmt(s.points)} pts · ${fmt(s.rewards)} récompense(s)</div>
        </div>
        <div class="access-card-acts">
          <button class="btn text" data-ref-profile="${esc(s.uid)}">Voir le profil →</button>
          <div class="kebab">
            <button class="kebab-btn" title="Plus d'actions">${ic("more") || "⋮"}</button>
            <div class="kebab-menu" hidden>
              <button data-ref-adjust="${esc(s.uid)}">± Ajuster les points</button>
              <button data-ref-reset="${esc(s.uid)}">↻ Régénérer le code</button>
              ${s.blocked
                ? `<button data-ref-unblock="${esc(s.uid)}">Réactiver</button>`
                : `<button class="danger-text" data-ref-block="${esc(s.uid)}">Suspendre</button>`}
            </div>
          </div>
        </div>
      </div>`).join("")
      : "<div class='empty'>Aucun parrain pour l'instant.</div>";

    list.querySelectorAll("[data-ref-profile]").forEach((b) => b.onclick = () => openSponsorProfile(b.getAttribute("data-ref-profile")));
    list.querySelectorAll("[data-ref-adjust]").forEach((b) => b.onclick = () => adjust(b.getAttribute("data-ref-adjust")));
    list.querySelectorAll("[data-ref-reset]").forEach((b) => b.onclick = () => resetCode(b.getAttribute("data-ref-reset")));
    list.querySelectorAll("[data-ref-block]").forEach((b) => b.onclick = () => setBlock(b.getAttribute("data-ref-block"), true));
    list.querySelectorAll("[data-ref-unblock]").forEach((b) => b.onclick = () => setBlock(b.getAttribute("data-ref-unblock"), false));
  }

  // ── Profil d'un parrain (modale — remplace le bloc « Filleuls » inline) ──
  window.openSponsorProfile = async function (uid) {
    const s = (REF.sponsors || []).find((x) => x.uid === uid) || {};
    $("bigcard").innerHTML = `
      <div class="bighead"><h3>${esc(s.email || uid)}</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button></div>
      <div class="kpis" style="margin-bottom:18px">
        <div class="kpi"><div class="kpi-val">${fmt(s.points)}</div><div class="kpi-lbl">Points</div></div>
        <div class="kpi"><div class="kpi-val">${fmt(s.invited)}</div><div class="kpi-lbl">Filleuls</div></div>
        <div class="kpi"><div class="kpi-val">${fmt(s.clicks)}</div><div class="kpi-lbl">Clics</div></div>
        <div class="kpi"><div class="kpi-val">${fmt(s.rewards)}</div><div class="kpi-lbl">Récompenses</div></div>
      </div>
      <p class="muted" style="margin-bottom:10px">Code : <span class="tag code">${esc(s.code || "—")}</span>
        ${s.lastAt ? " · dernière activité " + when(s.lastAt) : ""}</p>
      <h3 style="margin-bottom:10px">Filleuls</h3>
      <div class="list" id="sponsorKids"><div class="empty">Chargement…</div></div>`;
    $("big").hidden = false;
    $("btnCancelBig").onclick = () => { $("big").hidden = true; };
    try {
      const d = await api("referral", { action: "children", uid });
      $("sponsorKids").innerHTML = d.rows.length ? d.rows.map((r) => `
        <div class="row">
          <div><b>${esc(r.email || r.uid)}</b>
            <span class="tag ${r.credited ? "ok" : "danger"}">${r.credited ? "+ points" : "non crédité"}</span>
            ${r.reason ? `<span class="muted"> · ${esc(r.reason)}</span>` : ""}
          </div>
          <div class="muted">${when(r.at)}</div>
        </div>`).join("") : "<div class='empty'>Aucun filleul.</div>";
    } catch (e) {
      $("sponsorKids").innerHTML = `<div class='empty' style='color:var(--danger)'>${esc(e.message)}</div>`;
    }
  };

  // ── Actions ─────────────────────────────────────────────────
  async function adjust(uid) {
    const s = (REF.sponsors || []).find((x) => x.uid === uid) || {};
    const raw = await uiPrompt({ title: "Ajuster les points", icon: "referral", inputType: "number", default: "10",
      message: "Parrain : " + (s.email || uid) + " · actuel : " + (s.points || 0) + " pts.\nNégatif pour retirer." });
    if (raw === null) return;
    const delta = Number(raw);
    if (!Number.isFinite(delta) || delta === 0) { showToast("Valeur invalide.", "err"); return; }
    const reason = await uiPrompt({ title: "Motif de l'ajustement", icon: "audit", placeholder: "Obligatoire — inscrit au journal d'audit" });
    if (!reason) { showToast("Motif obligatoire.", "err"); return; }
    try {
      const d = await api("referral", { action: "adjust", uid, delta, reason });
      showToast("Points : " + d.points);
      loadReferral();
    } catch (e) { showToast(e.message, "err"); }
  }

  async function setBlock(uid, on) {
    const s = (REF.sponsors || []).find((x) => x.uid === uid) || {};
    if (on && !(await uiConfirm({ title: "Suspendre le parrain", danger: true, icon: "block", confirmText: "Suspendre",
      message: "Suspendre le parrainage de " + (s.email || uid) + " ?\nSes futurs filleuls ne rapporteront plus de points." }))) return;
    let reason = "";
    if (on) { reason = (await uiPrompt({ title: "Motif de la suspension", icon: "warning", default: "Fraude suspectée" })) || ""; }
    try {
      await api("referral", { action: on ? "block" : "unblock", uid, reason });
      showToast(on ? "Parrain suspendu." : "Parrain réactivé.");
      loadReferral();
    } catch (e) { showToast(e.message, "err"); }
  }

  async function resetCode(uid) {
    const s = (REF.sponsors || []).find((x) => x.uid === uid) || {};
    if (!(await uiConfirm({ title: "Régénérer le code", danger: true, icon: "refresh", confirmText: "Régénérer",
      message: "Régénérer le code de " + (s.email || uid) + " ?\nTous les liens déjà partagés avec l'ancien code cesseront de le créditer." }))) return;
    try {
      const d = await api("referral", { action: "reset_code", uid });
      showToast("Nouveau code : " + d.code);
      loadReferral();
    } catch (e) { showToast(e.message, "err"); }
  }

  // ── Réglages ────────────────────────────────────────────────
  // Bouton « Enregistrer » désactivé tant que rien n'a changé — évite un
  // gros bouton primaire toujours actif à côté de champs déjà à jour.
  const SETTINGS_FIELDS = ["refEnabled", "refPpi", "refGoal", "refDays", "refAge"];
  let SETTINGS_SNAPSHOT = "";
  function currentSettingsJson() {
    return JSON.stringify({
      enabled: $("refEnabled") ? $("refEnabled").checked : false,
      pointsPerInvite: $("refPpi") ? $("refPpi").value : "",
      pointsForReward: $("refGoal") ? $("refGoal").value : "",
      rewardDays: $("refDays") ? $("refDays").value : "",
      maxAccountAgeDays: $("refAge") ? $("refAge").value : ""
    });
  }
  function checkSettingsDirty() {
    const save = $("btnSaveReferral");
    if (save) save.disabled = currentSettingsJson() === SETTINGS_SNAPSHOT;
  }
  SETTINGS_FIELDS.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", checkSettingsDirty);
    el.addEventListener("change", checkSettingsDirty);
  });

  function renderSettings() {
    if (!REF) return;
    const s = REF.settings;
    if ($("refEnabled")) $("refEnabled").checked = !!s.enabled;
    if ($("refPpi")) $("refPpi").value = s.pointsPerInvite;
    if ($("refGoal")) $("refGoal").value = s.pointsForReward;
    if ($("refDays")) $("refDays").value = s.rewardDays;
    if ($("refAge")) $("refAge").value = s.maxAccountAgeDays;
    if ($("refHint")) $("refHint").textContent =
      s.pointsForReward / s.pointsPerInvite + " filleuls invités = " + s.rewardDays + " jours d'abonnement offerts.";
    SETTINGS_SNAPSHOT = currentSettingsJson();
    checkSettingsDirty();
  }

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
    save.disabled = true; save.textContent = "Enregistrement…";
    try {
      const d = await api("referral", { action: "settings_set", settings });
      REF.settings = d.settings;
      if (msg) { msg.className = "msg ok"; msg.textContent = "Paramètres appliqués — asrar-main les prend en compte immédiatement."; }
      renderSettings();
    } catch (e) {
      if (msg) { msg.className = "msg err"; msg.textContent = e.message; }
      save.disabled = false;
    } finally { save.textContent = "Enregistrer"; }
  };

  const reload = $("btnReloadReferral");
  if (reload) reload.onclick = () => loadReferral();
})();
