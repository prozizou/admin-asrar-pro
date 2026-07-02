// admin.js — Panneau ASRAR PRO. Édition EN LIGNE par cartes (ni JSON, ni modale).
// La sécurité est côté serveur : /api/* revérifie le statut admin à chaque appel.
(function () {
  "use strict";

  // Config Firebase PUBLIQUE fournie par /api/config.js (variables d'env Vercel).
  const cfg = window.FIREBASE_CONFIG || {};
  if (!cfg.apiKey || !cfg.projectId) {
    document.body.innerHTML = "<div style='color:#e8cd78;font-family:system-ui;" +
      "text-align:center;padding:60px 20px'><h2>Configuration manquante</h2>" +
      "<p>Les variables d'environnement Firebase ne sont pas définies sur Vercel " +
      "(FB_API_KEY, FB_AUTH_DOMAIN, FB_PROJECT_ID, FB_DB_URL).</p></div>";
    throw new Error("FIREBASE_CONFIG manquant");
  }
  firebase.initializeApp(cfg);
  const auth = firebase.auth();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const fmtF = (n) => (Number(n) || 0).toLocaleString("fr-FR") + " F";
  const when = (t) => (t ? new Date(t).toLocaleString("fr-FR") : "");
  const row = (main, acts) => "<div class='rowitem'><div class='main'>" + main + "</div><div class='acts'>" + (acts || "") + "</div></div>";

  async function api(path, payload) {
    const user = auth.currentUser;
    if (!user) throw new Error("Non connecté");
    const idToken = await user.getIdToken();
    const r = await fetch("/api/" + path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ idToken }, payload))
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Erreur " + r.status);
    return data;
  }

  // ── Connexion (par REDIRECTION : contourne le blocage COOP des popups) ──
  $("btnLogin").addEventListener("click", () => {
    $("loginMsg").textContent = "Redirection vers Google…";
    const p = new firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    auth.signInWithRedirect(p).catch((e) => {
      $("loginMsg").textContent = "Erreur : " + e.message;
    });
  });
  // Récupère le résultat au retour de Google (sinon erreur silencieuse).
  auth.getRedirectResult().catch((e) => {
    if (e && e.code && e.code !== "auth/no-auth-event")
      $("loginMsg").textContent = "Erreur : " + e.message;
  });
  $("btnLogout").addEventListener("click", () => auth.signOut().then(() => location.reload()));

  auth.onAuthStateChanged(async (user) => {
    if (!user) { $("login").hidden = false; $("app").hidden = true; return; }
    $("loginMsg").textContent = "Vérification des droits…";
    try {
      await loadDash();
      $("meEmail").textContent = user.email;
      $("login").hidden = true; $("app").hidden = false;
      loadNodes(); loadUsers(); loadConfig();
    } catch (e) { $("loginMsg").textContent = "⛔ " + e.message; auth.signOut(); }
  });

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== "tab-" + t.dataset.tab));
    if (t.dataset.tab === "audit") loadAudit();
    if (t.dataset.tab === "market") loadMarket();
  }));

  // ══ TABLEAU DE BORD ══════════════════════════════════════════
  $("rangeSel").addEventListener("change", loadDash);
  async function loadDash() {
    const d = await api("stats", { action: "overview", days: $("rangeSel").value });
    const today = d.daily[d.daily.length - 1] || { visits: 0, users: 0 };
    $("kpis").innerHTML =
      kpi(today.visits, "Visites aujourd'hui") +
      kpi(today.users, "Visiteurs aujourd'hui") +
      kpi(d.uniquePeriod ?? "—", "Visiteurs uniques (période)") +
      kpi(d.totalVisits ?? "—", "Visites totales (période)") +
      kpi(d.accounts ?? "—", "Comptes créés") +
      kpi(fmtF(d.revenue30), "Revenus 30 j") +
      kpi(fmtF(d.revenue), "Revenus totaux · " + d.sales + " ventes");
    bars($("chartDaily"), d.daily.map((x) => ({ v: x.visits, t: x.date + " · " + x.visits + " visites, " + x.users + " visiteurs" })));
    bars($("chartMonthly"), Object.entries(d.monthly).map(([m, x]) => ({ v: x.visits, t: m + " · " + x.visits + " visites" })));
    $("feed").innerHTML = (d.feed || []).map((f) =>
      row("<b>" + esc(f.email || f.uid) + "</b><span class='muted'>" + esc(f.type || "") +
          (f.page ? " · " + esc(f.page) : "") + " · " + when(f.at) + "</span>")).join("")
      || "<div class='empty'>Aucune activité pour l'instant.</div>";
  }
  const kpi = (v, l) => "<div class='kpi'><div class='v'>" + v + "</div><div class='l'>" + l + "</div></div>";
  function bars(el, data) {
    const max = Math.max(1, ...data.map((d) => d.v));
    el.innerHTML = data.map((d) =>
      "<div class='bar' style='height:" + Math.max(2, Math.round(d.v / max * 100)) + "%'>" +
      "<span class='tip'>" + esc(d.t) + "</span></div>").join("") || "<div class='empty'>Pas encore de données.</div>";
  }

  // ══ ÉDITEUR EN LIGNE (cartes) ════════════════════════════════
  const detectType = (v) => typeof v === "boolean" ? "bool" : typeof v === "number" ? "number"
    : (v && typeof v === "object") ? "json" : "string";

  function controlHtml(key, val) {
    const t = detectType(val);
    let ctrl;
    if (t === "bool")
      ctrl = "<label class='switch'><input type='checkbox' data-type='bool'" + (val ? " checked" : "") + "><span></span></label>";
    else if (t === "number")
      ctrl = "<input class='inp' type='text' inputmode='decimal' data-type='number' value='" + esc(val) + "'>";
    else if (t === "json")
      ctrl = "<textarea class='inp mono' data-type='json' rows='3'>" + esc(JSON.stringify(val, null, 2)) + "</textarea>";
    else {
      const s = String(val ?? "");
      ctrl = (s.length > 70 || s.includes("\n"))
        ? "<textarea class='inp' data-type='string' rows='3'>" + esc(s) + "</textarea>"
        : "<input class='inp' type='text' data-type='string' value='" + esc(s) + "'>";
    }
    return "<div class='field' data-key='" + esc(key) + "'>" +
      "<div class='field-h'><span class='lbl'>" + esc(key) + "</span>" +
      "<button class='rm' data-rm>✕ retirer</button></div>" + ctrl + "</div>";
  }
  function coerce(el) {
    const t = el.dataset.type;
    if (t === "bool") return el.checked;
    if (t === "number") { const n = Number(el.value); return isNaN(n) ? el.value : n; }
    if (t === "json") { try { return JSON.parse(el.value); } catch { throw new Error("Un champ avancé contient un format invalide."); } }
    return el.value;
  }
  function readFields(scope, rootObject) {
    const fields = [...scope.querySelectorAll(".field")];
    if (!rootObject) return coerce(fields[0].querySelector("[data-type]"));
    const o = {};
    fields.forEach((f) => { const k = f.dataset.key, el = f.querySelector("[data-type]"); if (k && el) o[k] = coerce(el); });
    return o;
  }

  // Carte réutilisable (contenus & produits). Valeur chargée à l'ouverture de l'édition.
  // Envoi d'image vers Cloudinary (upload SIGNÉ : le secret reste sur le serveur).
  async function uploadImage(file, node) {
    const idToken = await auth.currentUser.getIdToken();
    const folder = "asrar_admin/" + String(node || "divers").replace(/[^a-zA-Z0-9_-]/g, "_");
    const sig = await (await fetch("/api/cloudinary-sign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, folder })
    })).json();
    if (!sig.signature) throw new Error(sig.error || "Signature refusée.");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("api_key", sig.apiKey);
    fd.append("timestamp", sig.timestamp);
    fd.append("folder", sig.folder);
    fd.append("signature", sig.signature);
    const r = await fetch("https://api.cloudinary.com/v1_1/" + sig.cloudName + "/image/upload", { method: "POST", body: fd });
    const d = await r.json();
    if (!d.secure_url) throw new Error((d.error && d.error.message) || "Échec de l'envoi Cloudinary.");
    return { url: d.secure_url, id: d.public_id };
  }

  // Carte COMPACTE (vignette + titre). Un clic ouvre la GRANDE VUE éditable.
  function recordCard(opt) {
    const card = document.createElement("article");
    card.className = "card clickable";
    card.innerHTML =
      (opt.img ? "<div class='thumb'><img src='" + esc(opt.img) + "' alt='' loading='lazy'></div>"
               : "<div class='thumb'><span class='noimg'>Aucune image</span></div>") +
      "<div class='card-h'><h4 class='card-title'>" + esc(opt.title) + "</h4>" +
      (opt.key ? "<div class='card-actions'><button class='icon-btn danger' data-a='del' title='Supprimer'>🗑</button></div>" : "") +
      "</div>" + (opt.subtitle ? "<div class='card-sub'>" + opt.subtitle + "</div>" : "");
    card.onclick = (e) => {
      if (e.target.closest("[data-a=del]")) return;
      openBig(opt);
    };
    const del = card.querySelector("[data-a=del]");
    if (del) del.onclick = async () => {
      if (!confirm("Supprimer « " + opt.title + " » ?")) return;
      if (!confirm("⚠️ Confirmation finale — une copie part à la corbeille (30 jours).")) return;
      try { await api("content", { action: "delete", node: opt.node, key: opt.key }); opt.onChanged && opt.onChanged(); }
      catch (e) { alert(e.message); }
    };
    return card;
  }

  // ══ GRANDE VUE (édition confortable + image) ═════════════════
  async function openBig(opt) {
    const wrap = $("big"), box = $("bigcard");
    const node = opt.node, onChanged = opt.onChanged;
    const isNew = !opt.key;
    box.innerHTML = "<div class='empty'>Chargement…</div>";
    wrap.hidden = false;

    let value = {};
    if (!isNew) { try { value = (await api("content", { action: "get", node, key: opt.key })).value || {}; } catch (e) { box.innerHTML = "<div class='empty'>" + esc(e.message) + "</div>"; return; } }
    const rootObject = value && typeof value === "object" && !Array.isArray(value);

    // Détecte les clés d'image existantes pour préserver le schéma de la base.
    const imgKey = rootObject && ("image" in value ? "image" : "img" in value ? "img" : "url" in value ? "url" : null);
    const idKey = rootObject && ("imageId" in value ? "imageId" : "public_id" in value ? "public_id" : null);
    let img = imgKey ? value[imgKey] : "";
    let imgId = idKey ? value[idKey] : "";
    const OUT_IMG = imgKey || "image", OUT_ID = idKey || "imageId";

    function render() {
      let fields;
      if (isNew) {
        // Formulaire d'ajout simplifié : Titre + Faida (la clé est créée par l'app).
        fields =
          "<div class='field' data-key='titre'><div class='field-h'><span class='lbl'>Titre</span></div>" +
          "<input class='inp' data-type='string' value=''></div>" +
          "<div class='field' data-key='faida'><div class='field-h'><span class='lbl'>Faida (bienfait)</span></div>" +
          "<textarea class='inp' data-type='string' rows='4'></textarea></div>";
      } else if (rootObject) {
        const skip = [OUT_IMG, OUT_ID, "image", "img", "url", "imageId", "public_id"];
        fields = Object.entries(value).filter(([k]) => !skip.includes(k)).map(([k, v]) => controlHtml(k, v)).join("") +
          "<div class='addfield'><input class='inp' data-addk placeholder='nom du champ'>" +
          "<button class='btn ghost sm' data-a='addf'>＋ champ</button></div>";
      } else {
        fields = "<div class='field' data-key='__root__'><div class='field-h'><span class='lbl'>Valeur</span></div>" +
          "<textarea class='inp' data-type='string' rows='6'>" + esc(String(value ?? "")) + "</textarea></div>";
      }
      box.innerHTML =
        "<div class='bighead'><h3>" + esc(opt.title || (isNew ? "Nouvel élément" : opt.key)) + "</h3>" +
        "<button class='icon-btn' data-a='close'>✕</button></div>" +
        "<div class='bigimg'><div class='frame'>" +
        (img ? "<img src='" + esc(img) + "' alt=''>" : "<span class='noimg'>Aucune image</span>") +
        "</div><label class='btn ghost sm'>📷 Choisir une image<input type='file' accept='image/*' data-file></label>" +
        "<span class='msg' data-imgmsg></span></div>" +
        "<div class='card-fields'>" + fields + "</div>" +
        "<div class='msg' data-msg></div>" +
        "<div class='card-f'>" +
        (isNew ? "" : "<button class='btn sm' data-a='del' id='bigdel' style='color:var(--danger);border-color:var(--danger)'>🗑 Supprimer</button>") +
        "<button class='btn ghost sm' data-a='close'>Fermer</button>" +
        "<button class='btn primary sm' data-a='save'>Enregistrer</button></div>";
      wire();
    }

    const msg = (m, ok) => { const e = box.querySelector("[data-msg]"); if (e) { e.textContent = m; e.className = "msg " + (ok ? "ok" : "err"); } };
    const imgmsg = (m) => { const e = box.querySelector("[data-imgmsg]"); if (e) e.textContent = m; };

    function wire() {
      box.querySelectorAll("[data-a=close]").forEach((b) => b.onclick = close);
      box.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => b.closest(".field").remove());
      const addf = box.querySelector("[data-a=addf]");
      if (addf) addf.onclick = () => {
        const k = (box.querySelector("[data-addk]").value || "").trim();
        if (!k) return;
        if (/[.#$\[\]\/]/.test(k)) return msg("Nom de champ invalide.");
        box.querySelector(".card-fields").insertAdjacentHTML("afterbegin", controlHtml(k, ""));
        wire();
      };
      const file = box.querySelector("[data-file]");
      if (file) file.onchange = async () => {
        const f = file.files && file.files[0]; if (!f) return;
        imgmsg("Envoi de l'image…");
        try { const up = await uploadImage(f, node); img = up.url; imgId = up.id; render(); }
        catch (e) { imgmsg("⛔ " + e.message); }
      };
      const del = box.querySelector("[data-a=del]");
      if (del) del.onclick = doDelete;
      box.querySelector("[data-a=save]").onclick = doSave;
    }

    function close() { wrap.hidden = true; box.innerHTML = ""; }

    async function doSave() {
      let val;
      try {
        if (isNew) { const o = readFields(box, true); val = o; }
        else if (rootObject) val = readFields(box, true);
        else { val = readFields(box, false); }
      } catch (e) { return msg(e.message); }

      // Réintègre l'image (préserve le nom de champ d'origine).
      if (val && typeof val === "object" && !Array.isArray(val)) {
        if (img) { val[OUT_IMG] = img; if (imgId) val[OUT_ID] = imgId; }
        if (isNew) val.createdAt = Date.now();
      }
      const btn = box.querySelector("[data-a=save]"); btn.disabled = true;
      try {
        if (isNew) await api("content", { action: "add", node, value: val });
        else await api("content", { action: "set", node, key: opt.key, value: val });
        close(); onChanged && onChanged();
      } catch (e) { msg(e.message); btn.disabled = false; }
    }
    async function doDelete() {
      if (!confirm("Supprimer « " + (opt.title || opt.key) + " » ?")) return;
      if (!confirm("⚠️ Confirmation finale — une copie part à la corbeille (30 jours).")) return;
      try { await api("content", { action: "delete", node, key: opt.key }); close(); onChanged && onChanged(); }
      catch (e) { msg(e.message); }
    }

    render();
  }
  // Fermer la grande vue en cliquant sur le fond.
  $("big").addEventListener("click", (e) => { if (e.target === $("big")) { $("big").hidden = true; $("bigcard").innerHTML = ""; } });

  // ══ CONTENUS ═════════════════════════════════════════════════
  let NODES = {}, curNode = null;
  async function loadNodes() {
    NODES = (await api("content", { action: "nodes" })).nodes;
    const groups = {};
    Object.entries(NODES).forEach(([k, v]) => { (groups[v.group || "Autres"] = groups[v.group || "Autres"] || []).push([k, v]); });
    $("nodeSel").innerHTML = Object.entries(groups).map(([g, arr]) =>
      "<optgroup label='" + esc(g) + "'>" +
      arr.map(([k, v]) => "<option value='" + esc(k) + "'>" + esc(v.label) + "</option>").join("") + "</optgroup>").join("");
    $("nodeSel").onchange = loadItems;
    loadItems();
  }
  async function loadItems() {
    curNode = $("nodeSel").value;
    const meta = NODES[curNode] || {};
    $("nodeInfo").textContent = (meta.group ? meta.group + " · " : "") + (meta.page || "");
    const grid = $("itemList"); grid.innerHTML = "<div class='empty'>Chargement…</div>";
    try {
      const d = await api("content", { action: "list", node: curNode });
      grid.innerHTML = "";
      if (!d.items.length) { grid.innerHTML = "<div class='empty'>Vide. Cliquez « Ajouter » pour créer le premier élément.</div>"; return; }
      d.items.forEach((it) => grid.appendChild(recordCard({
        node: curNode, key: it.key,
        title: it.preview && it.preview !== "" ? it.preview : it.key,
        subtitle: "<span class='muted'>ID : " + esc(it.key) + "</span>",
        img: it.img || "",
        onChanged: loadItems
      })));
    } catch (e) { grid.innerHTML = "<div class='empty'>" + esc(e.message) + "</div>"; }
  }
  $("btnAdd").onclick = () => openBig({ node: curNode, key: null, title: "Nouvel élément", onChanged: loadItems });
  $("btnExport").onclick = async () => {
    const d = await api("content", { action: "export", node: curNode });
    const blob = new Blob([JSON.stringify(d.value, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = curNode.replace(/\//g, "_") + "_" + new Date().toISOString().slice(0, 10) + ".json";
    a.click(); URL.revokeObjectURL(a.href);
  };

  // ══ MARCHÉ ═══════════════════════════════════════════════════
  let PRODUCTS = [];
  async function loadMarket() {
    $("marketKpis").innerHTML = "<div class='empty'>Chargement…</div>";
    try {
      const d = await api("stats", { action: "market" });
      const s = d.summary;
      $("marketKpis").innerHTML =
        kpi(s.products, "Produits") + kpi(s.activeProducts, "Produits actifs") +
        kpi(s.sellers, "Vendeurs") + kpi(s.orders, "Commandes") +
        kpi(fmtF(s.marketRevenue), "Revenu commandes") + kpi(fmtF(s.vendorRevenue), "Ventes vendeurs");
      PRODUCTS = d.products; renderProducts();
      $("sellerList").innerHTML = d.sellers.map((v) =>
        row("<b>" + esc(v.shop) + "</b><span class='muted'>" + esc(v.email) + " · offre : " + esc(v.tier) + "</span>")).join("")
        || "<div class='empty'>Aucun vendeur inscrit.</div>";
    } catch (e) { $("marketKpis").innerHTML = "<div class='empty'>" + esc(e.message) + "</div>"; }
  }
  $("prodSearch").oninput = renderProducts;
  function renderProducts() {
    const q = $("prodSearch").value.trim().toLowerCase();
    const grid = $("prodList"); grid.innerHTML = "";
    const rows = PRODUCTS.filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.seller).toLowerCase().includes(q));
    if (!rows.length) { grid.innerHTML = "<div class='empty'>Aucun produit.</div>"; return; }
    rows.slice(0, 300).forEach((p) => grid.appendChild(recordCard({
      node: "det_produits", key: p.key, title: p.name, img: p.img || "",
      subtitle: "<span class='pill'>" + fmtF(p.price) + "</span> <span class='muted'>" + esc(p.seller) + "</span>" +
        (p.active ? "" : " <span class='tag danger'>inactif</span>"),
      onChanged: loadMarket
    })));
  }
  $("btnAddProduct").onclick = () => openBig({ node: "det_produits", key: null, title: "Nouveau produit", onChanged: loadMarket });

  // ══ UTILISATEURS ═════════════════════════════════════════════
  let USERS = [];
  async function loadUsers() {
    try {
      const d = await api("users", { action: "list" });
      USERS = d.users; $("userCount").textContent = "(" + d.total + ")"; renderUsers();
    } catch (e) { $("userList").innerHTML = "<div class='empty'>" + esc(e.message) + "</div>"; }
  }
  $("userSearch").oninput = renderUsers;
  function renderUsers() {
    const q = $("userSearch").value.trim().toLowerCase();
    const rows = USERS.filter((u) => !q || u.email.toLowerCase().includes(q));
    $("userList").innerHTML = rows.slice(0, 200).map((u) => {
      const badges =
        (u.isSuper ? "<span class='badge admin'>SUPER</span>" : u.isAdmin ? "<span class='badge admin'>ADMIN</span>" : "") +
        (u.isVip ? "<span class='badge vip'>VIP</span>" : "") +
        (u.sub ? "<span class='badge sub'>Abonné · " + esc(u.sub) + "</span>" : "") +
        (u.banned ? "<span class='badge ban'>BANNI</span>" : "");
      const acts =
        (u.banned ? "<button class='btn sm' data-act='unban' data-uid='" + u.uid + "'>♻️ Débannir</button>"
                  : "<button class='btn sm' data-act='ban' data-uid='" + u.uid + "'>🚫 Bannir</button>") +
        (u.sub ? "<button class='btn sm' data-act='revoke' data-uid='" + u.uid + "'>Retirer abo</button>"
               : "<button class='btn sm' data-act='grant' data-uid='" + u.uid + "'>🎁 Offrir abo</button>") +
        "<button class='btn sm' data-act='" + (u.isVip ? "vip_off" : "vip_on") + "' data-uid='" + u.uid + "'>" + (u.isVip ? "VIP −" : "VIP +") + "</button>" +
        (u.isSuper ? "" : "<button class='btn sm' data-act='" + (u.isAdmin ? "admin_off" : "admin_on") + "' data-uid='" + u.uid + "'>" + (u.isAdmin ? "Admin −" : "Admin +") + "</button>");
      return row("<b>" + esc(u.email) + "</b>" + badges +
        "<span class='muted'>Créé " + esc(u.created || "?") + " · Vu " + esc(u.lastSeen || "jamais") + "</span>", acts);
    }).join("") || "<div class='empty'>Aucun utilisateur trouvé.</div>";
  }
  $("userList").addEventListener("click", async (e) => {
    const act = e.target.getAttribute("data-act"); if (!act) return;
    const uid = e.target.getAttribute("data-uid");
    const u = USERS.find((x) => x.uid === uid); if (!u) return;
    const payload = { action: act, uid };
    if (act === "ban" && !confirm("Bannir " + u.email + " ?\nCompte désactivé + déconnexion partout (≤ 1 h).")) return;
    if (act === "revoke" && !confirm("Retirer l'abonnement de " + u.email + " ?")) return;
    if (act === "admin_on" && !confirm("Donner les droits ADMIN à " + u.email + " ?")) return;
    if (act === "grant") {
      const p = prompt("Offre :\n1 = 3 mois · 2 = 6 mois · 3 = 1 an · 4 = à vie", "3");
      const map = { "1": "sub_3m", "2": "sub_6m", "3": "sub_1y", "4": "sub_life" };
      if (!map[p]) return; payload.productId = map[p];
    }
    try { await api("users", payload); loadUsers(); } catch (err) { alert("⛔ " + err.message); }
  });

  // ══ JOURNAL ══════════════════════════════════════════════════
  async function loadAudit() {
    $("auditList").innerHTML = "<div class='empty'>Chargement…</div>";
    const d = await api("stats", { action: "audit" });
    $("auditList").innerHTML = (d.rows || []).map((r) =>
      row("<b>" + esc(r.action) + "</b> " + esc(r.target || "") +
          "<span class='muted'>par " + esc(r.by) + " · " + when(r.at) + (r.details ? " · " + esc(r.details) : "") + "</span>")).join("")
      || "<div class='empty'>Journal vide.</div>";
  }

  // ══ RÉGLAGES ═════════════════════════════════════════════════
  async function loadConfig() {
    try {
      const d = await api("stats", { action: "config_get" });
      $("cfgMaintenance").checked = !!d.config.maintenance;
      $("cfgAnnouncement").value = d.config.announcement || "";
    } catch (e) {}
  }
  $("btnSaveCfg").onclick = async () => {
    if ($("cfgMaintenance").checked && !confirm("⚠️ Activer le MODE MAINTENANCE ?\nLes utilisateurs verront un écran d'attente.")) return;
    try {
      await api("stats", { action: "config_set", config: { maintenance: $("cfgMaintenance").checked, announcement: $("cfgAnnouncement").value } });
      $("cfgMsg").textContent = "✅ Enregistré."; $("cfgMsg").className = "msg ok";
    } catch (e) { $("cfgMsg").textContent = e.message; $("cfgMsg").className = "msg err"; }
  };
})();
