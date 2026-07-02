// admin.js — Panneau ASRAR PRO. Édition EN LIGNE par cartes.
(function () {
  "use strict";

  // Récupération de la configuration Firebase injectée par l'API
  const cfg = window.FIREBASE_CONFIG || {};
  if (!cfg.apiKey || !cfg.projectId) {
    document.body.innerHTML = `
      <div style="color:#e8cd78; font-family:system-ui; text-align:center; padding:60px 20px; background:#0d0b07; min-height:100vh;">
        <h2>Configuration Firebase Introuvable</h2>
        <p style="color:#a89a7d; margin-top:10px;">Veuillez vérifier les variables d'environnement sur votre tableau de bord Vercel.</p>
      </div>`;
    throw new Error("CRITICAL: Configuration Firebase manquante.");
  }

  // Initialisation de Firebase localisé
  firebase.initializeApp(cfg);
  const auth = firebase.auth();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

  // Utilitaires de manipulation du DOM et de sécurisation
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const when = (t) => t ? new Date(t).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";

  let USER_TOKEN = null;
  let CURRENT_NODE = null;

  // SYSTÈME DE NOTIFICATIONS TOAST FLUIDES
  function showToast(msg, type = "ok") {
    const container = $("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type === "err" ? "danger" : "success"}`;
    toast.textContent = msg;
    container.appendChild(toast);
    
    // Animation de sortie et nettoyage automatique
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-10px)";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // APPEL API FETCH INTERNE CENTRALISÉ
  async function api(endpoint, payload = {}) {
    if (USER_TOKEN) payload.idToken = USER_TOKEN;
    const res = await fetch("/api/" + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Une erreur inconnue est survenue côté serveur.");
    return data;
  }

  // OBSERVATEUR DE L'ÉTAT D'AUTHENTIFICATION
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      try {
        USER_TOKEN = await user.getIdToken(true);
        $("login").hidden = true;
        $("app").hidden = false;
        initDashboard();
      } catch (err) {
        auth.signOut();
        showToast("Session corrompue ou droits insuffisants.", "err");
      }
    } else {
      USER_TOKEN = null;
      $("app").hidden = true;
      $("login").hidden = false;
    }
  });

  // FORMULAIRE DE CONNEXION DIRECTE (EMAIL / MOT DE PASSE)
  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    const msg = $("loginMsg");
    
    msg.className = "msg info";
    msg.textContent = "Signature spirituelle en cours de vérification…";

    try {
      await auth.signInWithEmailAndPassword(email, password);
      msg.textContent = "";
    } catch (err) {
      msg.className = "msg err";
      msg.textContent = "Identifiants incorrects ou privilèges insuffisants.";
    }
  };

  $("btnLogout").onclick = () => auth.signOut();

  // CHARGEMENT INITIAL DU TABLEAU DE BORD
  function initDashboard() {
    loadNodesMenu();
    loadAudit();
    loadConfig();
    loadUsers();
  }

  // GESTION ET NAVIGATION ENTRE LES ONGLETS
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-tab");
      
      $("tab-content").hidden = target !== "content";
      $("tab-users").hidden = target !== "users";
      $("tab-audit").hidden = target !== "audit";
      $("tab-settings").hidden = target !== "settings";
      
      if (target === "users") loadUsers();
      if (target === "audit") loadAudit();
    };
  });

  // SYSTÈME DE GESTION DES BIBLIOTHÈQUES (CONTENUS)
  async function loadNodesMenu() {
    try {
      const d = await api("content", { action: "nodes" });
      $("nodeList").innerHTML = Object.entries(d.nodes).map(([k, n]) => 
        `<button class="menu-item" data-node="${k}">
          <b>${esc(n.label)}</b>
          <span class="muted">${esc(n.page)}</span>
         </button>`
      ).join("");

      document.querySelectorAll("[data-node]").forEach((b) => {
        b.onclick = () => {
          document.querySelectorAll("[data-node]").forEach((m) => m.classList.remove("active"));
          b.classList.add("active");
          selectNode(b.getAttribute("data-node"), b.querySelector("b").textContent);
        };
      });
    } catch (e) { showToast(e.message, "err"); }
  }

  function selectNode(node, title) {
    CURRENT_NODE = node;
    $("currentNodeTitle").textContent = title;
    $("btnAddItem").style.display = "inline-block";
    loadGrid();
  }

  async function loadGrid() {
    $("cardsGrid").innerHTML = "<div class='empty'>Extraction des parchemins en cours…</div>";
    try {
      const d = await api("content", { action: "list", node: CURRENT_NODE });
      const entries = Object.entries(d.value || {});
      if (!entries.length) {
        $("cardsGrid").innerHTML = "<div class='empty'>Cette section ne contient aucun enregistrement pour le moment.</div>";
        return;
      }
      
      $("cardsGrid").innerHTML = entries.reverse().map(([k, v]) => `
        <div class="card clickable" data-key="${k}">
          <div class="thumb">${v.image ? `<img src="${esc(v.image)}" alt="">` : `<div class="noimg">Aucun Média</div>`}</div>
          <div class="card-body">
            <div class="card-title">${esc(v.title || "Sans Titre")}</div>
            <p class="muted">${esc(v.faida || v.content || "").slice(0, 95)}…</p>
          </div>
        </div>
      `).join("");

      document.querySelectorAll(".card.clickable").forEach((c) => {
        c.onclick = () => openEditor(c.getAttribute("data-key"));
      });
    } catch (e) { showToast(e.message, "err"); }
  }

  // ÉDITEUR GRAND FORMAT (MODALE CONVERSATIONNELLE)
  async function openEditor(key = null) {
    let item = { title: "", faida: "", content: "", image: "", imageId: "" };
    if (key) {
      try {
        const d = await api("content", { action: "get", node: CURRENT_NODE, key });
        item = d.value || item;
      } catch (e) { return showToast(e.message, "err"); }
    }

    $("bigcard").innerHTML = `
      <div class="bighead">
        <h3>${key ? "Édition du Document" : "Nouvel Enregistrement Mystique"}</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button>
      </div>
      <div class="bigimg">
        <div class="frame">${item.image ? `<img src="${esc(item.image)}" id="previewImg" alt="Aperçu">` : `<div class="noimg" id="previewImg">Aucun média associé</div>`}</div>
        <input type="file" id="fileField" accept="image/*" style="display:none">
        <button id="btnUpload" class="btn text">✨ Assigner un visuel précieux</button>
      </div>
      <label class="field-lg"><span>Titre Sacré</span><input type="text" id="editTitle" value="${esc(item.title)}"></label>
      <label class="field-lg"><span>Résumé court (Faida)</span><textarea id="editFaida" rows="3">${esc(item.faida || "")}</textarea></label>
      <label class="field-lg"><span>Contenu Textuel Explicatif Extrême</span><textarea id="editContent" rows="8">${esc(item.content || "")}</textarea></label>
      <div style="display:flex; justify-content:space-between; margin-top:25px; gap:15px;">
        ${key ? `<button id="btnDeleteBig" class="btn danger">Détruire l'entrée</button>` : `<div></div>`}
        <button id="btnSaveBig" class="btn primary">Sauvegarder dans la base</button>
      </div>
    `;

    $("big").hidden = false;
    let localFile = null;

    $("btnCancelBig").onclick = () => $("big").hidden = true;
    $("btnUpload").onclick = () => $("fileField").click();
    $("fileField").onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      localFile = f;
      const url = URL.createObjectURL(f);
      $("previewImg").innerHTML = `<img src="${url}" alt="Aperçu local">`;
    };

    $("btnSaveBig").onclick = async () => {
      $("btnSaveBig").disabled = true;
      $("btnSaveBig").textContent = "Fusion transitoire avec le cloud…";
      try {
        if (localFile) {
          const sign = await api("cloudinary-sign", { folder: CURRENT_NODE });
          const fd = new FormData();
          fd.append("file", localFile);
          fd.append("api_key", sign.apiKey);
          fd.append("timestamp", sign.timestamp);
          fd.append("signature", sign.signature);
          fd.append("folder", sign.folder);
          
          const cRes = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/image/upload`, { method: "POST", body: fd });
          const cData = await cRes.json();
          if (!cRes.ok) throw new Error(cData.error?.message || "L'envoi du média Cloudinary a échoué.");
          item.image = cData.secure_url;
          item.imageId = cData.public_id;
        }

        item.title = $("editTitle").value.trim();
        item.faida = $("editFaida").value.trim();
        item.content = $("editContent").value.trim();

        if (!item.title) throw new Error("Le champ 'Titre' ne peut rester vide.");

        await api("content", { action: key ? "set" : "add", node: CURRENT_NODE, key, value: item });
        $("big").hidden = true;
        showToast("Modifications appliquées avec succès.");
        loadGrid();
      } catch (err) {
        showToast(err.message, "err");
        $("btnSaveBig").disabled = false;
        $("btnSaveBig").textContent = "Sauvegarder dans la base";
      }
    };

    if (key) {
      $("btnDeleteBig").onclick = async () => {
        if (!confirm("⚠️ Attention : Êtes-vous sûr de vouloir envoyer cette entrée à la corbeille ?")) return;
        try {
          await api("content", { action: "delete", node: CURRENT_NODE, key });
          $("big").hidden = true;
          showToast("Document archivé dans la corbeille.");
          loadGrid();
        } catch (e) { showToast(e.message, "err"); }
      };
    }
  }

  $("btnAddItem").onclick = () => openEditor(null);

  // CONTROLER DES UTILISATEURS (ADMIN / VIP / BANNISSEMENT)
  async function loadUsers() {
    $("usersList").innerHTML = "<tr><td colspan='5' class='muted' style='text-align:center;'>Interrogation des comptes de l'écosystème…</td></tr>";
    try {
      const d = await api("users", { action: "list" });
      const rows = d.users || [];
      
      const render = (arr) => {
        $("usersList").innerHTML = arr.map((u) => `
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
            </td>
            <td>
              ${u.isSuper ? '—' : `
                <button class="btn text ${u.banned ? 'success-text' : 'danger-text'} act-ban" data-uid="${u.uid}" data-ban="${!u.banned}">
                  ${u.banned ? "Réactiver ✔" : "Révoquer / Bannir ⛔"}
                </button>
              `}
            </td>
          </tr>
        `).join("") || "<tr><td colspan='5' style='text-align:center;'>Aucun chercheur ne correspond à vos filtres.</td></tr>";

        // Écouteurs d'action sur les rôles
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

        // Écouteurs d'action sur le bannissement
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

      render(rows);

      $("userSearch").oninput = (e) => {
        const query = e.target.value.toLowerCase().trim();
        render(rows.filter(u => u.email.toLowerCase().includes(query) || u.uid.includes(query)));
      };

    } catch (e) { $("usersList").innerHTML = `<tr><td colspan='5' style='color:var(--danger); text-align:center;'>${esc(e.message)}</td></tr>`; }
  }

  // ══ JOURNAL D'AUDIT (RÉSOLUTION COMPLÈTE DU BUG DE LA FONCTION INTERNE ROW) ══
  async function loadAudit() {
    $("auditList").innerHTML = "<div class='empty'>Lecture analytique du journal d'audit…</div>";
    try {
      const d = await api("stats", { action: "audit" });
      
      // Reconstruction propre sans appel à une fonction row() absente
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
  }

  // CONFIGURATION GLOBALE DU SYSTÈME (MAINTENANCE & ANNONCE)
  async function loadConfig() {
    try {
      const d = await api("stats", { action: "config_get" });
      $("cfgMaintenance").checked = !!d.config.maintenance;
      $("cfgAnnouncement").value = d.config.announcement || "";
    } catch (e) {}
  }

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

})();


