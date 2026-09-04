// admin-users.js — Gestion des accès (onglet Utilisateurs) : Abonnements
// (accès premium par e-mail), Historique. Formations vit dans
// admin-formation-access.js, mais partage ce même onglet (sous-navigation
// .seg) et le composant carte/kebab défini ici.

(function () {
  "use strict";

  window.fmtDate = function (v) {
    return v === "lifetime" ? "À vie" : (typeof v === "number" ? new Date(v).toLocaleDateString("fr-FR") : "—");
  };

  // Paliers (FCFA) → libellé humain. « Palier » / montants bruts sont un
  // détail d'implémentation (cf. lib/plans.js côté asrar-main) : l'admin n'a
  // besoin de voir que le niveau réel.
  const LEVEL_LABELS = { 15000: "Premium · 3 mois", 25000: "Premium · 6 mois", 45000: "Premium · 1 an", 999999: "Illimité" };
  window.levelLabel = (level) => LEVEL_LABELS[level] || (level ? "Niveau " + level : "Standard");

  // ── Sous-navigation (Abonnements / Formations / Historique) ──
  const SUBS = ["subs", "formations", "history"];
  window.showUsersSub = function (sub) {
    document.querySelectorAll("#usersSeg [data-usersub]").forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-usersub") === sub));
    SUBS.forEach((s) => { const el = $("usersub-" + s); if (el) el.hidden = s !== sub; });
    if (sub === "history") renderHistory();
  };
  document.querySelectorAll("#usersSeg [data-usersub]").forEach((b) =>
    b.onclick = () => showUsersSub(b.getAttribute("data-usersub")));

  // ── Modale « Accorder un accès » (aussi utilisée pour « Prolonger ») ──
  // Remplace l'ancien formulaire permanent (email + date + 4 boutons de durée
  // + case à cocher + palier + bouton, tous visibles en même temps) par une
  // modale à la demande : la liste reste l'écran principal.
  window.openGrantAccessModal = function (prefillEmail) {
    const isExtend = !!prefillEmail;
    $("bigcard").innerHTML = `
      <div class="bighead"><h3>${isExtend ? "Prolonger l'accès" : "Accorder un accès"}</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button></div>
      <label class="field-lg"><span>Utilisateur</span>
        <input type="email" id="gaEmail" placeholder="exemple@gmail.com" autocomplete="off"
          value="${esc(prefillEmail || "")}" ${isExtend ? "readonly" : ""}></label>
      <label class="field-lg"><span>Durée de l'accès</span>
        <div class="chip-group" id="gaChips">
          <button type="button" class="chip" data-months="1">1 mois</button>
          <button type="button" class="chip active" data-months="3">3 mois</button>
          <button type="button" class="chip" data-months="6">6 mois</button>
          <button type="button" class="chip" data-months="12">1 an</button>
          <button type="button" class="chip" data-months="custom">Personnalisée</button>
          <button type="button" class="chip" data-months="lifetime">Accès permanent</button>
        </div></label>
      <label class="field-lg" id="gaDateWrap"><span>Expiration</span>
        <input type="date" id="gaDate" disabled></label>
      <label class="field-lg"><span>Niveau d'accès</span>
        <select id="gaLevel">
          <option value="">Automatique (selon la durée)</option>
          <option value="15000">Premium — 3 mois</option>
          <option value="25000">Premium — 6 mois</option>
          <option value="45000">Premium — 1 an (PDF + polices Al-Qalam)</option>
          <option value="999999">Illimité</option>
        </select></label>
      <p class="field-hint">Détermine l'accès au PDF et aux polices Al-Qalam du hub. « Automatique » le déduit de la durée choisie ci-dessus.</p>
      <p id="gaMsg" class="msg"></p>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:22px">
        <button id="btnCancelGa" class="btn text">Annuler</button>
        <button id="btnSubmitGa" class="btn primary" data-icon="check">${isExtend ? "Prolonger l'accès" : "Accorder l'accès"}</button>
      </div>`;
    $("big").hidden = false;

    let months = "3";
    const dateEl = $("gaDate");
    const chips = () => document.querySelectorAll("#gaChips .chip");
    const setMonths = (v) => {
      months = v;
      chips().forEach((c) => c.classList.toggle("active", c.getAttribute("data-months") === v));
      if (v === "lifetime") { dateEl.value = ""; dateEl.disabled = true; }
      else if (v === "custom") { dateEl.disabled = false; if (!dateEl.value) dateEl.focus(); }
      else {
        const d = new Date(); d.setMonth(d.getMonth() + Number(v));
        dateEl.value = d.toISOString().slice(0, 10);
        dateEl.disabled = true;
      }
    };
    chips().forEach((c) => c.onclick = () => setMonths(c.getAttribute("data-months")));
    setMonths(months);

    $("btnCancelBig").onclick = $("btnCancelGa").onclick = () => { $("big").hidden = true; };

    $("btnSubmitGa").onclick = async () => {
      const email = $("gaEmail").value.trim();
      const msg = $("gaMsg");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.className = "msg err"; msg.textContent = "E-mail invalide."; return; }

      const payload = { action: "grant_access", email };
      let expiresLabel;
      if (months === "lifetime") {
        payload.lifetime = true;
        expiresLabel = "à vie";
      } else {
        const dateVal = dateEl.value;
        if (!dateVal) { msg.className = "msg err"; msg.textContent = "Choisissez une date d'expiration."; return; }
        const ms = new Date(dateVal + "T23:59:59").getTime();
        if (!(ms > Date.now())) { msg.className = "msg err"; msg.textContent = "La date doit être dans le futur."; return; }
        payload.expiresAt = ms;
        expiresLabel = "jusqu'au " + fmtDate(ms);
      }
      const lvl = Number($("gaLevel").value);
      if (lvl) payload.level = lvl;

      const btn = $("btnSubmitGa");
      btn.disabled = true;
      try {
        const r = await api("users", payload);
        $("big").hidden = true;
        showToast("✅ Accès accordé à " + email + " (" + expiresLabel + ")" + (r && r.level ? " · " + levelLabel(r.level) : "") + ".");
        loadAccess();
      } catch (e) { msg.className = "msg err"; msg.textContent = e.message; btn.disabled = false; }
    };
  };
  const btnOpenGrant = $("btnOpenGrant");
  if (btnOpenGrant) btnOpenGrant.onclick = () => openGrantAccessModal();

  // ── Liste des abonnements (cartes compactes) ──
  let ACCESS = [];
  window.loadAccess = async function () {
    try {
      const d = await api("users", { action: "list_access" });
      ACCESS = d.items || [];
      const accCount = $("accCount");
      if (accCount) accCount.textContent = "(" + (d.total || 0) + ")";
      const segCount = $("subsSegCount");
      if (segCount) segCount.textContent = d.total || "";
      renderAccess();
    } catch (e) {
      const accessList = $("accessList");
      if (accessList) accessList.innerHTML = "<div class='empty'>" + esc(e.message) + "</div>";
    }
  };

  const accSearchEl = $("accSearch");
  if (accSearchEl) accSearchEl.oninput = () => renderAccess();

  window.accessCardHtml = function (r) {
    const sub = levelLabel(r.level) + " · " +
      (r.active ? "Expire le " + fmtDate(r.expiresAt) : "Expiré le " + fmtDate(r.expiresAt));
    return `
      <div class="access-card">
        <div class="access-card-main">
          <div class="access-card-top">
            <span class="access-email">${esc(r.email)}</span>
            <span class="access-status ${r.active ? "on" : "off"}">${r.active ? "Actif" : "Expiré"}</span>
            ${r.source === "referral" ? '<span class="badge gold">🎁 parrainage</span>' : ""}
          </div>
          <div class="access-sub">${esc(sub)}</div>
        </div>
        <div class="access-card-acts">
          <button class="btn text" data-acc-edit="${esc(r.email)}">Prolonger</button>
          <div class="kebab">
            <button class="kebab-btn" title="Plus d'actions">${ic("more") || "⋮"}</button>
            <div class="kebab-menu" hidden>
              <button class="danger-text" data-acc-revoke="${esc(r.email)}">Révoquer</button>
            </div>
          </div>
        </div>
      </div>`;
  };

  window.renderAccess = function () {
    const q = ($("accSearch") ? $("accSearch").value : "").toLowerCase().trim();
    const rows = ACCESS.filter((r) => !q || r.email.toLowerCase().includes(q));
    const accessList = $("accessList");
    if (!accessList) return;
    accessList.innerHTML = rows.map((r) => accessCardHtml(r)).join("") ||
      "<div class='empty'>Aucun accès accordé pour l'instant.</div>";
    wireAccessActions(accessList);
  };

  window.wireAccessActions = function (root) {
    root.querySelectorAll("[data-acc-revoke]").forEach((b) => b.onclick = async () => {
      const em = b.getAttribute("data-acc-revoke");
      if (!(await uiConfirm({ title: "Révoquer l'accès", danger: true, icon: "block", confirmText: "Révoquer",
        message: "Révoquer l'accès premium de " + em + " ?" }))) return;
      try { await api("users", { action: "revoke_access", email: em }); showToast("Accès révoqué."); loadAccess(); }
      catch (e) { showToast(e.message, "err"); }
    });
    root.querySelectorAll("[data-acc-edit]").forEach((b) => b.onclick = () => openGrantAccessModal(b.getAttribute("data-acc-edit")));
  };

  // ── Historique — abonnements expirés/révoqués + crédits de minutes épuisés,
  // fusionnés et triés par date d'octroi décroissante. Pas de journal d'audit
  // général (retiré du panneau) : seulement ce qui concerne les accès.
  window.renderHistory = function () {
    const historyList = $("historyList");
    if (!historyList) return;
    const past = (ACCESS || []).filter((r) => !r.active);
    // FMA_LIST est exposé par admin-formation-access.js (même onglet).
    const exhausted = (window.FMA_LIST || []).filter((r) => !(r.minutes > 0));
    const rows = [
      ...past.map((r) => ({ at: r.at || 0, html: accessCardHtml(r) })),
      ...exhausted.map((r) => ({
        at: r.grantedAt || 0,
        html: `<div class="access-card"><div class="access-card-main">
          <div class="access-card-top">
            <span class="access-email">${esc(r.email)}</span>
            <span class="access-status off">Épuisé</span>
          </div>
          <div class="access-sub">${esc((window.formationLabel ? formationLabel(r.formationKey) : r.formationKey))} · crédité le ${esc(when(r.grantedAt))}</div>
        </div></div>`
      }))
    ].sort((a, b) => b.at - a.at);

    historyList.innerHTML = rows.map((r) => r.html).join("") ||
      "<div class='empty'>Aucun octroi passé pour l'instant.</div>";
    wireAccessActions(historyList); // les cartes d'abonnements expirés restent « Prolonger/Révoquer »-ables
  };

})();
