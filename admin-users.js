// admin-users.js — Accès premium par e-mail (octroi, prolongation, révocation)

(function () {
  "use strict";

  const fmtDate = (v) => v === "lifetime" ? "À vie"
    : (typeof v === "number" ? new Date(v).toLocaleDateString("fr-FR") : "—");

  const accDateEl = $("accDate");
  const accLifetimeEl = $("accLifetime");

  if (accLifetimeEl && accDateEl) {
    accLifetimeEl.onchange = () => { accDateEl.disabled = accLifetimeEl.checked; };
    document.querySelectorAll("[data-add-months]").forEach((b) => {
      b.onclick = () => {
        const d = new Date();
        d.setMonth(d.getMonth() + Number(b.getAttribute("data-add-months")));
        accDateEl.value = d.toISOString().slice(0, 10);
        accLifetimeEl.checked = false;
        accDateEl.disabled = false;
      };
    });
  }

  const btnGrant = $("btnGrantAccess");
  if (btnGrant) {
    btnGrant.onclick = async () => {
      const email = $("accEmail").value.trim();
      const life = $("accLifetime").checked;
      const dateVal = $("accDate").value;
      const msg = $("accMsg");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.className = "msg err"; msg.textContent = "E-mail invalide."; return;
      }
      const payload = { action: "grant_access", email };
      if (life) {
        payload.lifetime = true;
      } else {
        if (!dateVal) { msg.className = "msg err"; msg.textContent = "Choisissez une date d'expiration ou « à vie »."; return; }
        const ms = new Date(dateVal + "T23:59:59").getTime();
        if (!(ms > Date.now())) { msg.className = "msg err"; msg.textContent = "La date doit être dans le futur."; return; }
        payload.expiresAt = ms;
      }
      // Palier : vide = automatique côté serveur (selon la durée).
      const lvl = $("accLevel") ? Number($("accLevel").value) : 0;
      if (lvl) payload.level = lvl;

      btnGrant.disabled = true;
      try {
        const r = await api("users", payload);
        msg.className = "msg ok";
        msg.textContent = "✅ Accès accordé à " + email + (life ? " (à vie)." : " jusqu'au " + fmtDate(payload.expiresAt) + ".")
          + (r && r.level ? " Palier " + r.level + "." : "");
        $("accEmail").value = ""; $("accLifetime").checked = false;
        $("accDate").disabled = false; $("accDate").value = "";
        loadAccess();
      } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
      btnGrant.disabled = false;
    };
  }

  let ACCESS = [];
  window.loadAccess = async function () {
    try {
      const d = await api("users", { action: "list_access" });
      ACCESS = d.items || [];
      const accCount = $("accCount");
      if (accCount) accCount.textContent = "(" + (d.total || 0) + ")";
      renderAccess();
    } catch (e) {
      const accessList = $("accessList");
      if (accessList) accessList.innerHTML = "<div class='empty'>" + esc(e.message) + "</div>";
    }
  };
  
  const accSearchEl = $("accSearch");
  if (accSearchEl) accSearchEl.oninput = () => renderAccess();

  window.renderAccess = function () {
    const q = ($("accSearch").value || "").toLowerCase().trim();
    const rows = ACCESS.filter((r) => !q || r.email.toLowerCase().includes(q));
    const accessList = $("accessList");
    if (!accessList) return;
    accessList.innerHTML = rows.map((r) => `
      <div class="row">
        <div>
          <b>${esc(r.email)}</b>
          <span class="badge ${r.active ? "gold" : "expired"}">${r.active ? "Actif" : "Expiré"}</span>
          ${r.source === "referral" ? '<span class="badge gold">🎁 parrainage</span>' : ""}
          <div class="muted">Expiration : ${fmtDate(r.expiresAt)}${r.level ? " · palier " + esc(r.level) : ""}${r.grantedBy ? " · par " + esc(r.grantedBy) : ""}</div>
        </div>
        <div class="acts">
          <button class="btn text" data-acc-edit="${esc(r.email)}">Prolonger</button>
          <button class="btn text danger-text" data-acc-revoke="${esc(r.email)}">Révoquer</button>
        </div>
      </div>`).join("") || "<div class='empty'>Aucun accès accordé pour l'instant.</div>";

    document.querySelectorAll("[data-acc-revoke]").forEach((b) => b.onclick = async () => {
      const em = b.getAttribute("data-acc-revoke");
      if (!(await uiConfirm({ title: "Révoquer l'accès", danger: true, icon: "block", confirmText: "Révoquer",
        message: "Révoquer l'accès premium de " + em + " ?" }))) return;
      try { await api("users", { action: "revoke_access", email: em }); showToast("Accès révoqué."); loadAccess(); }
      catch (e) { showToast(e.message, "err"); }
    });
    document.querySelectorAll("[data-acc-edit]").forEach((b) => b.onclick = () => prefillAccess(b.getAttribute("data-acc-edit")));
  };

  window.prefillAccess = function (email) {
    const accEmail = $("accEmail");
    if (!accEmail) return;
    accEmail.value = email;
    accEmail.scrollIntoView({ behavior: "smooth", block: "center" });
    accEmail.focus();
  };

})();