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

  // ── Aperçu des cartes : tolérant à tous les schémas de nœuds ──
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const cardTitle = (v, k) => isObj(v)
    ? (v.title || v.titre || v.nom || v.name || v.label || v.verset || v.sourate || k)
    : String(v ?? k);
  const cardDesc = (v) => isObj(v)
    ? String(v.faida || v.content || v.description || v.sirr || v.texte || v.details || v.benefit || "")
    : String(v ?? "");
  const cardImg = (v) => isObj(v) ? String(v.image || v.img || v.url || v.imageUrl || "") : "";

  // Champs « cœur » gérés par les grands encarts dédiés (les autres = champs libres).
  const CORE_FIELDS = ["title", "faida", "content", "image", "imageId"];
  // Convertit la valeur d'un champ libre selon son type détecté.
  function coerceField(el) {
    const t = el.getAttribute("data-ftype");
    if (t === "bool") return el.checked;
    if (t === "number") { const n = Number(el.value); return el.value.trim() === "" ? "" : (isNaN(n) ? el.value : n); }
    return el.value;
  }
  // Génère l'éditeur d'un champ libre (bool → interrupteur, nombre, texte court/long).
  function extraFieldHtml(key, val) {
    const type = typeof val === "boolean" ? "bool" : typeof val === "number" ? "number" : "string";
    let ctrl;
    if (type === "bool")
      ctrl = `<label class="switch"><input type="checkbox" data-ftype="bool" ${val ? "checked" : ""}><span></span></label>`;
    else if (type === "number")
      ctrl = `<input type="text" inputmode="decimal" data-ftype="number" value="${esc(val)}">`;
    else {
      const s = String(val ?? "");
      ctrl = (s.length > 60 || s.includes("\n"))
        ? `<textarea rows="3" data-ftype="string">${esc(s)}</textarea>`
        : `<input type="text" data-ftype="string" value="${esc(s)}">`;
    }
    return `<div class="xfield" data-fkey="${esc(key)}">
      <div class="xfield-h"><span>${esc(key)}</span>
      <button type="button" class="btn text danger-text xf-rm">✕ retirer</button></div>${ctrl}</div>`;
  }

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
    loadAccess();
  }

  // DÉTECTION DE L'APPAREIL (mobile vs PC) → classe sur <body> pour le CSS/JS.
  const mqMobile = window.matchMedia("(max-width: 820px)");
  const applyDevice = () => document.body.classList.toggle("is-mobile", mqMobile.matches);
  applyDevice();
  if (mqMobile.addEventListener) mqMobile.addEventListener("change", applyDevice);
  else window.addEventListener("resize", applyDevice);

  // GESTION ET NAVIGATION ENTRE LES ONGLETS
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-tab");

      $("tab-content").hidden = target !== "content";
      $("tab-market").hidden = target !== "market";
      $("tab-users").hidden = target !== "users";
      $("tab-audit").hidden = target !== "audit";
      $("tab-settings").hidden = target !== "settings";

      if (target === "market") loadMarket();
      if (target === "users") { loadUsers(); loadAccess(); }
      if (target === "audit") loadAudit();
    };
  });

  // SYSTÈME DE GESTION DES BIBLIOTHÈQUES (CONTENUS)
  let NODES_CACHE = {};
  async function loadNodesMenu() {
    try {
      const d = await api("content", { action: "nodes" });
      NODES_CACHE = d.nodes || {};
      $("nodeList").innerHTML = Object.entries(NODES_CACHE).map(([k, n]) =>
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
    $("contentActions").style.display = "flex";
    exitSelectMode();
    $("tab-content").classList.add("show-grid");   // mobile : bascule vers la grille
    $("btnBackNodes").hidden = false;
    loadGrid();
  }
  $("btnBackNodes").onclick = () => $("tab-content").classList.remove("show-grid");

  // ── Grille paginée (50 par page) + sélection multiple ──
  const PAGE = 50;
  let ITEMS = [], shown = 0, selectMode = false;
  const selected = new Set();

  async function loadGrid() {
    $("cardsGrid").innerHTML = "<div class='empty'>Extraction des enregistrements…</div>";
    $("btnMoreItems").hidden = true;
    try {
      const d = await api("content", { action: "list", node: CURRENT_NODE });
      ITEMS = Object.entries(d.value || {}).reverse();
      selected.clear(); shown = 0; updateBulk();
      if (!ITEMS.length) { $("cardsGrid").innerHTML = "<div class='empty'>Cette section ne contient aucun enregistrement.</div>"; return; }
      $("cardsGrid").innerHTML = "";
      renderMore();
      fillBulkTarget();
    } catch (e) { showToast(e.message, "err"); }
  }

  function cardHtml(k, v) {
    const img = cardImg(v), desc = cardDesc(v);
    return `<div class="card clickable ${selected.has(k) ? "sel" : ""}" data-key="${esc(k)}">
      ${selectMode ? `<label class="card-check"><input type="checkbox" data-chk ${selected.has(k) ? "checked" : ""}></label>` : ""}
      <div class="thumb">${img ? `<img src="${esc(img)}" alt="">` : `<div class="noimg">Aucun Média</div>`}</div>
      <div class="card-body">
        <div class="card-title">${esc(cardTitle(v, k))}</div>
        <p class="muted">${esc(desc).slice(0, 95)}${desc.length > 95 ? "…" : ""}</p>
      </div>
    </div>`;
  }

  function renderMore() {
    const next = ITEMS.slice(shown, shown + PAGE);
    $("cardsGrid").insertAdjacentHTML("beforeend", next.map(([k, v]) => cardHtml(k, v)).join(""));
    shown += next.length;
    $("btnMoreItems").hidden = shown >= ITEMS.length;
    $("btnMoreItems").textContent = "Afficher 50 de plus (" + (ITEMS.length - shown) + " restants)";
    wireCards();
  }
  $("btnMoreItems").onclick = renderMore;

  function rerender() {
    const count = Math.max(shown, PAGE);
    $("cardsGrid").innerHTML = "";
    const slice = ITEMS.slice(0, count);
    $("cardsGrid").innerHTML = slice.map(([k, v]) => cardHtml(k, v)).join("");
    shown = slice.length;
    $("btnMoreItems").hidden = shown >= ITEMS.length;
    $("btnMoreItems").textContent = "Afficher 50 de plus (" + (ITEMS.length - shown) + " restants)";
    wireCards();
  }

  function wireCards() {
    document.querySelectorAll("#cardsGrid .card").forEach((c) => {
      const k = c.getAttribute("data-key");
      c.onclick = (e) => {
        if (selectMode) { if (!e.target.closest("[data-chk]")) toggleSel(k, c); }
        else openEditor(k);
      };
      const chk = c.querySelector("[data-chk]");
      if (chk) chk.onchange = () => toggleSel(k, c, chk.checked);
    });
  }
  function toggleSel(k, card, force) {
    const on = force != null ? force : !selected.has(k);
    if (on) selected.add(k); else selected.delete(k);
    card.classList.toggle("sel", on);
    const chk = card.querySelector("[data-chk]"); if (chk) chk.checked = on;
    updateBulk();
  }
  function updateBulk() { const el = $("bulkCount"); if (el) el.textContent = selected.size + " sélectionné(s)"; }

  function enterSelectMode() { selectMode = true; $("bulkBar").hidden = false; $("btnSelectMode").textContent = "✕ Quitter"; rerender(); }
  function exitSelectMode() { selectMode = false; selected.clear(); $("bulkBar").hidden = true; $("btnSelectMode").textContent = "☑ Sélection"; if (ITEMS.length) rerender(); updateBulk(); }
  $("btnSelectMode").onclick = () => selectMode ? exitSelectMode() : enterSelectMode();

  function fillBulkTarget() {
    $("bulkTarget").innerHTML = "<option value=''>Déplacer vers…</option>" +
      Object.entries(NODES_CACHE).filter(([k]) => k !== CURRENT_NODE)
        .map(([k, n]) => `<option value="${esc(k)}">${esc(n.label)}</option>`).join("");
  }

  $("bulkSelectAll").onclick = () => {
    const vis = ITEMS.slice(0, shown).map(([k]) => k);
    const allOn = vis.length && vis.every((k) => selected.has(k));
    vis.forEach((k) => allOn ? selected.delete(k) : selected.add(k));
    rerender(); updateBulk();
  };
  $("bulkCancel").onclick = exitSelectMode;
  $("bulkDelete").onclick = async () => {
    if (!selected.size) return showToast("Aucun élément sélectionné.", "err");
    if (!confirm("Supprimer " + selected.size + " élément(s) ? (copie en corbeille, récupérable)")) return;
    try { const r = await api("content", { action: "bulk_delete", node: CURRENT_NODE, keys: [...selected] });
      showToast(r.count + " élément(s) supprimé(s)."); exitSelectMode(); loadGrid(); }
    catch (e) { showToast(e.message, "err"); }
  };
  $("bulkMove").onclick = async () => {
    const target = $("bulkTarget").value;
    if (!target) return showToast("Choisissez d'abord un nœud cible.", "err");
    if (!selected.size) return showToast("Aucun élément sélectionné.", "err");
    if (!confirm("Déplacer " + selected.size + " élément(s) vers « " + (NODES_CACHE[target] || {}).label + " » ?")) return;
    try { const r = await api("content", { action: "move", node: CURRENT_NODE, targetNode: target, keys: [...selected] });
      showToast(r.count + " élément(s) déplacé(s)."); exitSelectMode(); loadGrid(); }
    catch (e) { showToast(e.message, "err"); }
  };

  // ÉDITEUR GRAND FORMAT (MODALE CONVERSATIONNELLE)
  async function openEditor(key = null) {
    let item = { title: "", faida: "", content: "", image: "", imageId: "" };
    if (key) {
      try {
        const d = await api("content", { action: "get", node: CURRENT_NODE, key });
        item = isObj(d.value) ? d.value
             : { title: "", faida: "", content: String(d.value ?? ""), image: "", imageId: "" };
      } catch (e) { return showToast(e.message, "err"); }
    }

    // Champs libres = tout ce qui n'est pas un champ « cœur » (préservés + éditables).
    const extra = Object.entries(item).filter(([k]) => !CORE_FIELDS.includes(k));

    $("bigcard").innerHTML = `
      <div class="bighead">
        <h3>${key ? "Édition du document" : "Nouvel enregistrement"}</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button>
      </div>
      <div class="bigimg">
        <div class="frame" id="previewImg">${item.image ? `<img src="${esc(item.image)}" alt="Aperçu">` : `<div class="noimg">Aucun média associé</div>`}</div>
        <input type="file" id="fileField" accept="image/*" style="display:none">
        <button id="btnUpload" class="btn text">✨ Choisir une image</button>
      </div>
      <label class="field-lg"><span>Titre</span><input type="text" id="editTitle" value="${esc(item.title || "")}"></label>
      <label class="field-lg"><span>Faïda (résumé court)</span><textarea id="editFaida" rows="3">${esc(item.faida || "")}</textarea></label>
      <label class="field-lg"><span>Contenu détaillé</span><textarea id="editContent" rows="8">${esc(item.content || "")}</textarea></label>

      <div class="xfields-head">
        <span>Champs supplémentaires</span>
        <button type="button" id="btnAddField" class="btn text">＋ Ajouter un champ</button>
      </div>
      <div id="xfields">${extra.map(([k, v]) => extraFieldHtml(k, v)).join("")}</div>

      <div style="display:flex; justify-content:space-between; margin-top:25px; gap:15px;">
        ${key ? `<button id="btnDeleteBig" class="btn danger">Supprimer</button>` : `<div></div>`}
        <button id="btnSaveBig" class="btn primary">Enregistrer</button>
      </div>
    `;

    $("big").hidden = false;
    let localFile = null;

    const bindRemovers = () => document.querySelectorAll("#xfields .xf-rm")
      .forEach((b) => b.onclick = () => b.closest(".xfield").remove());
    bindRemovers();

    $("btnCancelBig").onclick = closeBig;
    $("btnUpload").onclick = () => $("fileField").click();
    $("fileField").onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      localFile = f;
      $("previewImg").innerHTML = `<img src="${URL.createObjectURL(f)}" alt="Aperçu local">`;
    };

    $("btnAddField").onclick = () => {
      const name = (prompt("Nom du nouveau champ (ex. auteur, prix, lien) :") || "").trim();
      if (!name) return;
      if (!/^[a-zA-Z0-9_\-]+$/.test(name)) return showToast("Nom de champ invalide (lettres, chiffres, _ ou -).", "err");
      if (CORE_FIELDS.includes(name) || document.querySelector(`#xfields [data-fkey="${name}"]`))
        return showToast("Ce champ existe déjà.", "err");
      $("xfields").insertAdjacentHTML("beforeend", extraFieldHtml(name, ""));
      bindRemovers();
    };

    $("btnSaveBig").onclick = async () => {
      const btn = $("btnSaveBig");
      btn.disabled = true; btn.textContent = "Enregistrement…";
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
          if (!cRes.ok) throw new Error(cData.error?.message || "L'envoi du média a échoué.");
          item.image = cData.secure_url;
          item.imageId = cData.public_id;
        }

        // Reconstruit l'enregistrement : champs cœur + champs libres du formulaire.
        const out = {};
        const title = $("editTitle").value.trim();
        if (!title) throw new Error("Le champ « Titre » ne peut rester vide.");
        out.title = title;
        const faida = $("editFaida").value.trim();
        const content = $("editContent").value.trim();
        if (faida) out.faida = faida;
        if (content) out.content = content;
        if (item.image) { out.image = item.image; if (item.imageId) out.imageId = item.imageId; }

        document.querySelectorAll("#xfields .xfield").forEach((f) => {
          const k = f.getAttribute("data-fkey");
          const el = f.querySelector("[data-ftype]");
          if (k && el && !CORE_FIELDS.includes(k)) out[k] = coerceField(el);
        });

        if (!key && item.createdAt == null) out.createdAt = Date.now();
        else if (item.createdAt != null && out.createdAt == null) out.createdAt = item.createdAt;

        await api("content", { action: key ? "set" : "add", node: CURRENT_NODE, key, value: out });
        $("big").hidden = true;
        showToast("Modifications enregistrées.");
        loadGrid();
      } catch (err) {
        showToast(err.message, "err");
        btn.disabled = false; btn.textContent = "Enregistrer";
      }
    };

    if (key) {
      $("btnDeleteBig").onclick = async () => {
        if (!confirm("⚠️ Envoyer cette entrée à la corbeille (récupérable) ?")) return;
        try {
          await api("content", { action: "delete", node: CURRENT_NODE, key });
          $("big").hidden = true;
          showToast("Entrée archivée dans la corbeille.");
          loadGrid();
        } catch (e) { showToast(e.message, "err"); }
      };
    }
  }

  function closeBig() { $("big").hidden = true; }
  // Fermer la grande vue : clic sur le fond sombre ou touche Échap.
  $("big").addEventListener("click", (e) => { if (e.target === $("big")) closeBig(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("big").hidden) closeBig(); });

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

        // Écouteurs : « Gérer l'accès » → pré-remplit le formulaire d'accès.
        document.querySelectorAll(".act-access").forEach((b) => {
          b.onclick = () => prefillAccess(b.getAttribute("data-email"));
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

      let filtered = rows, ushown = 50;
      const draw = () => {
        render(filtered.slice(0, ushown));
        $("btnMoreUsers").hidden = ushown >= filtered.length;
        $("btnMoreUsers").textContent = "Afficher 50 de plus (" + Math.max(0, filtered.length - ushown) + " restants)";
      };
      const resetUsers = (arr) => { filtered = arr; ushown = 50; draw(); };
      $("btnMoreUsers").onclick = () => { ushown += 50; draw(); };
      resetUsers(rows);

      $("userSearch").oninput = (e) => {
        const query = e.target.value.toLowerCase().trim();
        resetUsers(rows.filter(u => u.email.toLowerCase().includes(query) || u.uid.includes(query)));
      };

    } catch (e) { $("usersList").innerHTML = `<tr><td colspan='5' style='color:var(--danger); text-align:center;'>${esc(e.message)}</td></tr>`; }
  }

  // ══ ACCÈS PREMIUM PAR E-MAIL (abonnement manuel + date d'expiration) ══
  const fmtDate = (v) => v === "lifetime" ? "À vie"
    : (typeof v === "number" ? new Date(v).toLocaleDateString("fr-FR") : "—");

  // Boutons de durée rapide → remplissent la date d'expiration.
  document.querySelectorAll("[data-add-months]").forEach((b) => {
    b.onclick = () => {
      const d = new Date();
      d.setMonth(d.getMonth() + Number(b.getAttribute("data-add-months")));
      $("accDate").value = d.toISOString().slice(0, 10);
      $("accLifetime").checked = false;
      $("accDate").disabled = false;
    };
  });
  $("accLifetime").onchange = () => { $("accDate").disabled = $("accLifetime").checked; };

  $("btnGrantAccess").onclick = async () => {
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
    const btn = $("btnGrantAccess"); btn.disabled = true;
    try {
      await api("users", payload);
      msg.className = "msg ok";
      msg.textContent = "✅ Accès accordé à " + email + (life ? " (à vie)." : " jusqu'au " + fmtDate(payload.expiresAt) + ".");
      $("accEmail").value = ""; $("accLifetime").checked = false;
      $("accDate").disabled = false; $("accDate").value = "";
      loadAccess(); loadUsers();
    } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
    btn.disabled = false;
  };

  let ACCESS = [];
  async function loadAccess() {
    try {
      const d = await api("users", { action: "list_access" });
      ACCESS = d.items || [];
      $("accCount").textContent = "(" + (d.total || 0) + ")";
      renderAccess();
    } catch (e) { $("accessList").innerHTML = "<div class='empty'>" + esc(e.message) + "</div>"; }
  }
  $("accSearch").oninput = renderAccess;
  function renderAccess() {
    const q = ($("accSearch").value || "").toLowerCase().trim();
    const rows = ACCESS.filter((r) => !q || r.email.toLowerCase().includes(q));
    $("accessList").innerHTML = rows.map((r) => `
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
  }
  function prefillAccess(email) {
    $("accEmail").value = email;
    $("accEmail").scrollIntoView({ behavior: "smooth", block: "center" });
    $("accEmail").focus();
  }

  // ══ MARCHÉ — BOUTIQUES & PRODUITS ════════════════════════════
  let SHOPS = [], PRODUCTS = [], prodShown = 0;
  const fmtF = (n) => (Number(n) || 0).toLocaleString("fr-FR") + " F";
  const shopExp = (v) => v === "lifetime" ? "À vie" : (typeof v === "number" ? new Date(v).toLocaleDateString("fr-FR") : "—");

  async function loadMarket() {
    $("shopList").innerHTML = "<div class='empty'>Chargement des boutiques…</div>";
    $("prodGrid").innerHTML = "";
    try {
      const d = await api("market", { action: "list" });
      SHOPS = d.shops || []; PRODUCTS = d.products || [];
      $("shopCount").textContent = "(" + (d.totalShops || 0) + ")";
      $("prodCount").textContent = "(" + (d.totalProducts || 0) + ")";
      renderShops(); renderProductsReset();
    } catch (e) { $("shopList").innerHTML = "<div class='empty'>" + esc(e.message) + "</div>"; }
  }

  $("shopSearch").oninput = renderShops;
  function renderShops() {
    const q = ($("shopSearch").value || "").toLowerCase().trim();
    const rows = SHOPS.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q));
    $("shopList").innerHTML = rows.map((s) => {
      const state = s.active ? `<span class="badge gold">Active</span>`
                  : (s.expired ? `<span class="badge expired">Expirée</span>` : `<span class="badge expired">Inactive</span>`);
      return `<div class="row">
        <div>
          <b>${esc(s.name)}</b> ${state}
          <div class="muted">${esc(s.email || "e-mail inconnu")} · expire : ${shopExp(s.expiresAt)}
            · ${s.products} produit(s)${s.blockedProducts ? " · " + s.blockedProducts + " bloqué(s)" : ""}</div>
        </div>
        <div class="acts">
          <button class="btn text" data-shop-extend="${esc(s.uid)}">Prolonger</button>
          <button class="btn text" data-shop-rename="${esc(s.uid)}">Renommer</button>
          <button class="btn text" data-shop-notify="${esc(s.uid)}">Notifier</button>
          ${s.blockedProducts ? `<button class="btn text success-text" data-shop-restore="${esc(s.uid)}">Restaurer</button>` : ``}
          <button class="btn text danger-text" data-shop-revoke="${esc(s.uid)}">Révoquer</button>
          <button class="btn text danger-text" data-shop-delete="${esc(s.uid)}">Supprimer</button>
        </div>
      </div>`;
    }).join("") || "<div class='empty'>Aucune boutique.</div>";
    wireShopActions();
  }

  function wireShopActions() {
    const act = async (uid, payload, okMsg, confirmMsg) => {
      if (confirmMsg && !confirm(confirmMsg)) return;
      try { await api("market", Object.assign({ uid }, payload)); showToast(okMsg); loadMarket(); }
      catch (e) { showToast(e.message, "err"); }
    };
    const askDate = (label) => {
      const v = prompt(label + "\nFormat : AAAA-MM-JJ (ou « vie » pour un accès à vie) :", "");
      if (v == null) return undefined;
      if (v.trim().toLowerCase() === "vie") return "lifetime";
      const ms = new Date(v.trim() + "T23:59:59").getTime();
      if (!(ms > Date.now())) { showToast("Date invalide ou passée.", "err"); return undefined; }
      return ms;
    };
    document.querySelectorAll("[data-shop-extend]").forEach((b) => b.onclick = () => {
      const exp = askDate("Nouvelle date d'expiration de la boutique :");
      if (exp === undefined) return;
      act(b.getAttribute("data-shop-extend"), { action: "shop_restore", expiresAt: exp }, "Boutique prolongée / réactivée.");
    });
    document.querySelectorAll("[data-shop-rename]").forEach((b) => b.onclick = () => {
      const name = prompt("Nouveau nom de la boutique :", "");
      if (!name || !name.trim()) return;
      act(b.getAttribute("data-shop-rename"), { action: "shop_update", name: name.trim() }, "Boutique renommée.");
    });
    document.querySelectorAll("[data-shop-notify]").forEach((b) => b.onclick = () => {
      const message = prompt("Message à envoyer au vendeur :", "");
      if (!message || !message.trim()) return;
      act(b.getAttribute("data-shop-notify"), { action: "shop_notify", message: message.trim() }, "Notification envoyée.");
    });
    document.querySelectorAll("[data-shop-restore]").forEach((b) => b.onclick = () =>
      act(b.getAttribute("data-shop-restore"), { action: "shop_restore" }, "Produits rétablis en vente."));
    document.querySelectorAll("[data-shop-revoke]").forEach((b) => b.onclick = () =>
      act(b.getAttribute("data-shop-revoke"), { action: "shop_revoke" }, "Boutique révoquée : produits bloqués.",
          "Révoquer cette boutique ? Tous ses produits seront retirés de la vente (réversible)."));
    document.querySelectorAll("[data-shop-delete]").forEach((b) => b.onclick = () =>
      act(b.getAttribute("data-shop-delete"), { action: "shop_delete", withProducts: true }, "Boutique supprimée (corbeille).",
          "Supprimer définitivement cette boutique ET ses produits ? (copie en corbeille)"));
  }

  $("btnBlockExpired").onclick = async () => {
    if (!confirm("Bloquer TOUTES les boutiques dont l'abonnement est expiré ?\nLeurs produits seront retirés de la vente.")) return;
    try {
      const r = await api("market", { action: "block_expired" });
      showToast(r.shopsBlocked + " boutique(s) bloquée(s), " + r.productsBlocked + " produit(s) retiré(s).");
      loadMarket();
    } catch (e) { showToast(e.message, "err"); }
  };

  $("prodSearch").oninput = renderProductsReset;
  function renderProductsReset() { prodShown = 0; $("prodGrid").innerHTML = ""; renderProductsMore(); }
  function filteredProducts() {
    const q = ($("prodSearch").value || "").toLowerCase().trim();
    return PRODUCTS.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.vendeur || "").toLowerCase().includes(q));
  }
  function renderProductsMore() {
    const list = filteredProducts();
    const next = list.slice(prodShown, prodShown + PAGE);
    $("prodGrid").insertAdjacentHTML("beforeend", next.map((p) => `
      <div class="card ${p.blocked ? "blocked" : ""}">
        <div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="">` : `<div class="noimg">Aucun Média</div>`}</div>
        <div class="card-body">
          <div class="card-title">${esc(p.name)} ${p.blocked ? `<span class="badge expired">bloqué</span>` : ""}</div>
          <p class="muted">${fmtF(p.price)} · ${esc(p.vendeur || "—")}</p>
          <div class="acts" style="margin-top:8px">
            ${p.blocked
              ? `<button class="btn text success-text" data-prod-unblock="${esc(p.key)}">Débloquer</button>`
              : `<button class="btn text" data-prod-block="${esc(p.key)}">Bloquer</button>`}
            <button class="btn text danger-text" data-prod-del="${esc(p.key)}" data-blk="${p.blocked ? 1 : 0}">Supprimer</button>
          </div>
        </div>
      </div>`).join(""));
    prodShown += next.length;
    $("btnMoreProds").hidden = prodShown >= list.length;
    $("btnMoreProds").textContent = "Afficher 50 de plus (" + (list.length - prodShown) + " restants)";
    wireProductActions();
  }
  $("btnMoreProds").onclick = renderProductsMore;

  function wireProductActions() {
    const run = async (payload, msg, confirmMsg) => {
      if (confirmMsg && !confirm(confirmMsg)) return;
      try { await api("market", payload); showToast(msg); loadMarket(); } catch (e) { showToast(e.message, "err"); }
    };
    document.querySelectorAll("[data-prod-block]").forEach((b) => b.onclick = () =>
      run({ action: "product_block", key: b.getAttribute("data-prod-block") }, "Produit bloqué."));
    document.querySelectorAll("[data-prod-unblock]").forEach((b) => b.onclick = () =>
      run({ action: "product_unblock", key: b.getAttribute("data-prod-unblock") }, "Produit remis en vente."));
    document.querySelectorAll("[data-prod-del]").forEach((b) => b.onclick = () =>
      run({ action: "product_delete", key: b.getAttribute("data-prod-del"), blocked: b.getAttribute("data-blk") === "1" },
          "Produit supprimé (corbeille).", "Supprimer ce produit ? (copie en corbeille)"));
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


