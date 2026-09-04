// admin-formation-access.js — Minutes de visioconférence "Formation mystique"
// par formation + e-mail — INDÉPENDANT de l'accès premium général (voir
// admin-users.js / api/users.js) : chaque formation se paie à la minute,
// réservée via WhatsApp depuis l'app (asrar-main, lib/whatsapp.js
// openFormationBooking), créditée manuellement ici après paiement.
// Sous-onglet « Formations » de #tab-users (voir admin-users.js pour la
// sous-navigation .seg et le composant carte partagé).

(function () {
  "use strict";

  const fmaListEl = $("fmaList");
  if (!fmaListEl) return; // page sans cet onglet

  let FORMATIONS = {}; // { key: {titre, ...} } — pour le menu déroulant et les libellés

  async function loadFormationsOptions() {
    try {
      const d = await api("content", { action: "list", node: "formations" });
      FORMATIONS = d.value || {};
    } catch (e) { FORMATIONS = {}; }
  }

  // Exposé globalement : admin-users.js (Historique) affiche le libellé de la
  // formation pour les crédits épuisés, sans dépendre de l'ordre de chargement.
  window.formationLabel = (key) => (FORMATIONS[key] && FORMATIONS[key].titre) || key;

  // ── Modale « Créditer des minutes » ──
  window.openFormationCreditModal = function () {
    const entries = Object.entries(FORMATIONS);
    $("bigcard").innerHTML = `
      <div class="bighead"><h3>Créditer des minutes</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button></div>
      <label class="field-lg"><span>Formation</span>
        <select id="fcFormation">
          ${entries.length ? entries.map(([k, v]) => `<option value="${esc(k)}">${esc((v && v.titre) || k)}</option>`).join("")
            : `<option value="">Aucune formation créée</option>`}
        </select></label>
      <label class="field-lg"><span>Utilisateur</span>
        <input type="email" id="fcEmail" placeholder="exemple@gmail.com" autocomplete="off"></label>
      <label class="field-lg"><span>Minutes</span>
        <input type="number" id="fcMinutes" min="1" step="1" value="10"></label>
      <p class="field-hint" id="fcSummary">—</p>
      <p id="fcMsg" class="msg"></p>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:22px">
        <button id="btnCancelFc" class="btn text">Annuler</button>
        <button id="btnSubmitFc" class="btn primary" data-icon="check">Créditer les minutes</button>
      </div>`;
    $("big").hidden = false;

    const formationEl = $("fcFormation"), emailEl = $("fcEmail"), minutesEl = $("fcMinutes"), summaryEl = $("fcSummary");
    const updateSummary = () => {
      const min = Number(minutesEl.value) || 0;
      const label = (FORMATIONS[formationEl.value] && FORMATIONS[formationEl.value].titre) || formationEl.value || "—";
      const email = emailEl.value.trim() || "—";
      summaryEl.textContent = min + " min · " + label + " → " + email;
    };
    [formationEl, emailEl, minutesEl].forEach((el) => el.oninput = updateSummary);
    updateSummary();

    $("btnCancelBig").onclick = $("btnCancelFc").onclick = () => { $("big").hidden = true; };

    $("btnSubmitFc").onclick = async () => {
      const formationKey = formationEl.value;
      const email = emailEl.value.trim();
      const minutes = Number(minutesEl.value);
      const msg = $("fcMsg");
      if (!formationKey) { msg.className = "msg err"; msg.textContent = "Choisissez une formation."; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.className = "msg err"; msg.textContent = "E-mail invalide."; return; }
      if (!(minutes > 0)) { msg.className = "msg err"; msg.textContent = "Nombre de minutes invalide."; return; }

      const btn = $("btnSubmitFc");
      btn.disabled = true;
      try {
        await api("formation-access", { action: "grant_minutes", formationKey, email, minutes });
        $("big").hidden = true;
        showToast("✅ " + minutes + " min créditées à " + email + " pour « " + formationLabel(formationKey) + " ».");
        loadFormationMinuteGrants();
      } catch (e) { msg.className = "msg err"; msg.textContent = e.message; btn.disabled = false; }
    };
  };
  const btnOpenFc = $("btnOpenFormationCredit");
  if (btnOpenFc) btnOpenFc.onclick = () => openFormationCreditModal();

  // ── Liste des crédits accordés (cartes compactes, même gabarit que les
  // abonnements — voir accessCardHtml dans admin-users.js) ──
  window.FMA_LIST = []; // exposé globalement pour l'Historique (admin-users.js)
  async function loadFormationMinuteGrants() {
    try {
      const d = await api("formation-access", { action: "list_minutes" });
      window.FMA_LIST = d.items || [];
      const fmaCount = $("fmaCount");
      if (fmaCount) fmaCount.textContent = "(" + (d.total || 0) + ")";
      const segCount = $("fmaSegCount");
      if (segCount) segCount.textContent = d.total || "";
      renderFormationMinuteGrants();
      // Si l'onglet Historique est déjà affiché (rare, mais possible après un
      // rechargement d'onglet), le tenir à jour maintenant que FMA_LIST l'est.
      const historyPanel = $("usersub-history");
      if (historyPanel && !historyPanel.hidden && typeof renderHistory === "function") renderHistory();
    } catch (e) {
      if (fmaListEl) fmaListEl.innerHTML = "<div class='empty'>" + esc(e.message) + "</div>";
    }
  }

  function renderFormationMinuteGrants() {
    fmaListEl.innerHTML = window.FMA_LIST.map((r) => `
      <div class="access-card">
        <div class="access-card-main">
          <div class="access-card-top">
            <span class="access-email">${esc(r.email)}</span>
            <span class="access-status ${r.minutes > 0 ? "on" : "off"}">${r.minutes > 0 ? r.minutes + " min" : "Épuisé"}</span>
          </div>
          <div class="access-sub">${esc(formationLabel(r.formationKey))}${r.grantedBy ? " · par " + esc(r.grantedBy) : ""}</div>
        </div>
        <div class="access-card-acts">
          <button class="btn text danger-text" data-fma-revoke="${esc(r.formationKey)}|${esc(r.email)}">Révoquer</button>
        </div>
      </div>`).join("") || "<div class='empty'>Aucun crédit accordé pour l'instant.</div>";

    document.querySelectorAll("[data-fma-revoke]").forEach((b) => b.onclick = async () => {
      const [formationKey, em] = b.getAttribute("data-fma-revoke").split("|");
      if (!(await uiConfirm({
        title: "Révoquer le crédit", danger: true, icon: "block", confirmText: "Révoquer",
        message: "Révoquer les minutes de " + em + " pour « " + formationLabel(formationKey) + " » ?"
      }))) return;
      try {
        await api("formation-access", { action: "revoke_minutes", formationKey, email: em });
        showToast("Crédit révoqué.");
        loadFormationMinuteGrants();
      } catch (e) { showToast(e.message, "err"); }
    });
  }

  // Appelé par showTab() (admin-core.js) à chaque visite de l'onglet Utilisateurs,
  // comme loadAccess() — la liste des formations peut avoir changé entretemps.
  window.loadFormationMinutes = async function () {
    await loadFormationsOptions();
    await loadFormationMinuteGrants();
  };
})();
