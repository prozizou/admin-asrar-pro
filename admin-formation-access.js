// admin-formation-access.js — Minutes de visioconférence "Formation mystique"
// par formation + e-mail — INDÉPENDANT de l'accès premium général (voir
// admin-users.js / api/users.js) : chaque formation se paie à la minute,
// réservée via WhatsApp depuis l'app (asrar-main, lib/whatsapp.js
// openFormationBooking), créditée manuellement ici après paiement.

(function () {
  "use strict";

  const fmaFormationEl = $("fmaFormation");
  if (!fmaFormationEl) return; // page sans cet onglet

  let FORMATIONS = {}; // { key: {titre, ...} } — pour le menu déroulant et les libellés

  async function loadFormationsOptions() {
    try {
      const d = await api("content", { action: "list", node: "formations" });
      FORMATIONS = d.value || {};
      const entries = Object.entries(FORMATIONS);
      fmaFormationEl.innerHTML = entries.length
        ? entries.map(([k, v]) => `<option value="${esc(k)}">${esc((v && v.titre) || k)}</option>`).join("")
        : `<option value="">Aucune formation créée</option>`;
    } catch (e) {
      fmaFormationEl.innerHTML = `<option value="">Erreur de chargement</option>`;
    }
  }

  const formationLabel = (key) => (FORMATIONS[key] && FORMATIONS[key].titre) || key;

  const btnGrant = $("btnGrantFormationMinutes");
  if (btnGrant) {
    btnGrant.onclick = async () => {
      const formationKey = fmaFormationEl.value;
      const email = $("fmaEmail").value.trim();
      const minutes = Number($("fmaMinutes").value);
      const msg = $("fmaMsg");
      if (!formationKey) { msg.className = "msg err"; msg.textContent = "Choisissez une formation."; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.className = "msg err"; msg.textContent = "E-mail invalide."; return; }
      if (!(minutes > 0)) { msg.className = "msg err"; msg.textContent = "Nombre de minutes invalide."; return; }

      btnGrant.disabled = true;
      try {
        await api("formation-access", { action: "grant_minutes", formationKey, email, minutes });
        msg.className = "msg ok";
        msg.textContent = "✅ " + minutes + " min créditées à " + email + " pour « " + formationLabel(formationKey) + " ».";
        $("fmaEmail").value = "";
        loadFormationMinuteGrants();
      } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
      btnGrant.disabled = false;
    };
  }

  let FMA_LIST = [];
  async function loadFormationMinuteGrants() {
    try {
      const d = await api("formation-access", { action: "list_minutes" });
      FMA_LIST = d.items || [];
      const fmaCount = $("fmaCount");
      if (fmaCount) fmaCount.textContent = "(" + (d.total || 0) + ")";
      renderFormationMinuteGrants();
    } catch (e) {
      const fmaList = $("fmaList");
      if (fmaList) fmaList.innerHTML = "<div class='empty'>" + esc(e.message) + "</div>";
    }
  }

  function renderFormationMinuteGrants() {
    const fmaList = $("fmaList");
    if (!fmaList) return;
    fmaList.innerHTML = FMA_LIST.map((r) => `
      <div class="row">
        <div>
          <b>${esc(r.email)}</b>
          <span class="badge ${r.minutes > 0 ? "gold" : "expired"}">${r.minutes > 0 ? r.minutes + " min" : "épuisé"}</span>
          <div class="muted">${esc(formationLabel(r.formationKey))}${r.grantedBy ? " · par " + esc(r.grantedBy) : ""}</div>
        </div>
        <div class="acts">
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
