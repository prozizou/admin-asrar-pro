// admin-users.js — Gestion des utilisateurs et accès premium

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
      btnGrant.disabled = true;
      try {
        await api("users", payload);
        msg.className = "msg ok";
        msg.textContent = "✅ Accès accordé à " + email + (life ? " (à vie)." : " jusqu'au " + fmtDate(payload.expiresAt) + ".");
        $("accEmail").value = ""; $("accLifetime").checked = false;
        $("accDate").disabled = false; $("accDate").value = "";
        loadAccess(); loadUsers();
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
  if (accSearchEl) accSearchEl.oninput = renderAccess;

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
          <div class="muted">Expiration : ${fmtDate(r.expiresAt)}${r.grantedBy ? " · par " + esc(r.grantedBy) : ""}</div>
        </div>
        <div class="acts">
          <button class="btn text" data-acc-edit="${esc(r.email)}">Prolonger</button>
          <button class="btn text danger-text" data-acc-revoke="${esc(r.email)}">Révoquer</button>
        </div>
      </div>`).join("") || "<div class='empty'>Aucun accès accordé pour l'instant.</div>";

    document.querySelectorAll("[data-acc-revoke]").forEach((b) => b.onclick = async () => {
      const em = b.getAttribute("data-acc-revoke");
      if (!confirm("Révoquer l'accès premium de " + em + " ?")) return;
      try { await api("users", { action: "revoke_access", email: em }); showToast("Accès révoqué."); loadAccess(); loadUsers(); }
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

  // ── Utilisateurs ──
  window.loadUsers = async function () {
    const usersList = $("usersList");
    if (!usersList) return;
    usersList.innerHTML = "<tr><td colspan='5' class='muted' style='text-align:center;'>Interrogation des comptes de l'écosystème…</td></tr>";
    try {
      const d = await api("users", { action: "list" });
      const rows = d.users || [];
      
      const render = (arr) => {
        usersList.innerHTML = arr.map((u) => `
          <tr class="${u.banned ? 'disabled-row' : ''}">
            <td>
              <span class="user-email">${esc(u.email)}</span><br>
              <small class="user-uid muted">${u.uid}</small>
            </td>
            <td><small>${when(u.created)}</small></td>
            <td><small>${when(u.lastSeen)}</small></td>
            <td>
              ${u.isSuper ? `<span class="badge gold">SUPER-ADMIN</span>` : `
                <label class="chk-lbl">
                  <input type="checkbox" class="act-role" data-uid="${u.uid}" data-role="admin" ${u.isAdmin ? 'checked' : ''}> Administrateur
                </label>
              `}
              <div style="margin-top: 5px;">
                <label class="chk-lbl">
                  <input type="checkbox" class="act-role" data-uid="${u.uid}" data-role="vip" ${u.isVip ? 'checked' : ''}> Accès VIP global
                </label>
              </div>
              <div class="muted" style="margin-top:6px">
                ${u.sub ? (u.subActive ? '💎 Abonné · ' + esc(u.sub) : '⛔ Abonnement expiré') : 'Aucun abonnement'}
              </div>
            </td>
            <td>
              <button class="btn text act-access" data-email="${esc(u.email)}">Gérer l'accès</button>
              ${u.isSuper ? '' : `
                <button class="btn text ${u.banned ? 'success-text' : 'danger-text'} act-ban" data-uid="${u.uid}" data-ban="${!u.banned}">
                  ${u.banned ? "Réactiver ✔" : "Révoquer / Bannir ⛔"}
                </button>
              `}
            </td>
          </tr>
        `).join("") || "<tr><td colspan='5' style='text-align:center;'>Aucun chercheur ne correspond à vos filtres.</td></tr>";

        document.querySelectorAll(".act-role").forEach((chk) => {
          chk.onchange = async () => {
            const uid = chk.getAttribute("data-uid");
            const role = chk.getAttribute("data-role");
            const isChecked = chk.checked;
            const action = role === "admin" ? (isChecked ? "admin_on" : "admin_off") : (isChecked ? "vip_on" : "vip_off");
            try {
              await api("users", { action, uid });
              showToast("Autorisations d'accès recalculées.");
            } catch (e) {
              chk.checked = !isChecked; 
              showToast(e.message, "err"); 
            }
          };
        });

        document.querySelectorAll(".act-access").forEach((b) => {
          b.onclick = () => prefillAccess(b.getAttribute("data-email"));
        });

        document.querySelectorAll(".act-ban").forEach((b) => {
          b.onclick = async () => {
            const uid = b.getAttribute("data-uid");
            const operationalBan = b.getAttribute("data-ban") === "true";
            if (operationalBan && !confirm("Voulez-vous révoquer définitivement les jetons et interdire l'accès à ce compte ?")) return;
            try {
              await api("users", { action: operationalBan ? "ban" : "unban", uid });
              showToast(operationalBan ? "Utilisateur exclu du système." : "Compte de l'utilisateur restauré.");
              loadUsers();
            } catch (e) { showToast(e.message, "err"); }
          };
        });
      };

      let filtered = rows, ushown = 50;
      const draw = () => {
        render(filtered.slice(0, ushown));
        const moreBtn = $("btnMoreUsers");
        if (moreBtn) {
          moreBtn.hidden = ushown >= filtered.length;
          moreBtn.textContent = "Afficher 50 de plus (" + Math.max(0, filtered.length - ushown) + " restants)";
        }
      };
      const resetUsers = (arr) => { filtered = arr; ushown = 50; draw(); };
      const moreUsersBtn = $("btnMoreUsers");
      if (moreUsersBtn) moreUsersBtn.onclick = () => { ushown += 50; draw(); };
      resetUsers(rows);

      const userSearch = $("userSearch");
      if (userSearch) {
        userSearch.oninput = (e) => {
          const query = e.target.value.toLowerCase().trim();
          resetUsers(rows.filter(u => u.email.toLowerCase().includes(query) || u.uid.includes(query)));
        };
      }

    } catch (e) { usersList.innerHTML = `<tr><td colspan='5' style='color:var(--danger); text-align:center;'>${esc(e.message)}</td></tr>`; }
  };

})();