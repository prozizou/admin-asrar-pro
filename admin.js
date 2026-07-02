// admin.js — Panneau ASRAR PRO. Édition EN LIGNE par cartes (ni JSON, ni modale).
// La sécurité est côté serveur : /api/* revérifie le statut admin à chaque appel.
(function () {
  "use strict";

  firebase.initializeApp({
    apiKey: "AIzaSyBLzPKzbiNYitUz7sv9Ftqm0oF20rA32Zk",
    authDomain: "asrar-bc059.firebaseapp.com",
    databaseURL: "https://asrar-bc059.firebaseio.com",
    projectId: "asrar-bc059"
  });
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
  function recordCard(opt) {
    const { node, onChanged } = opt;
    let key = opt.key || null, title = opt.title || key || "Nouvel élément";
    let rootObject = true, loaded = false, curVal = opt.value;
    const card = document.createElement("article");
    card.className = "card";

    function view() {
      card.classList.remove("editing");
      card.innerHTML =
        "<div class='card-h'><h4 class='card-title'>" + esc(title) + "</h4>" +
        "<div class='card-actions'>" +
        "<button class='icon-btn' data-a='edit' title='Modifier'>✎</button>" +
        (key ? "<button class='icon-btn danger' data-a='del' title='Supprimer'>🗑</button>" : "") +
        "</div></div>" +
        (opt.subtitle ? "<div class='card-sub'>" + opt.subtitle + "</div>" : "");
      card.querySelector("[data-a=edit]").onclick = enterEdit;
      const del = card.querySelector("[data-a=del]");
      if (del) del.onclick = doDelete;
    }

    async function enterEdit() {
      if (!loaded && key) {
        card.classList.add("loading");
        try { curVal = (await api("content", { action: "get", node, key })).value; loaded = true; }
        catch (e) { card.classList.remove("loading"); return alert(e.message); }
        card.classList.remove("loading");
      }
      rootObject = curVal && typeof curVal === "object" && !Array.isArray(curVal);
      edit();
    }

    function edit() {
      card.classList.add("editing");
      const keyRow = key ? "" :
        "<div class='field'><div class='field-h'><span class='lbl'>Identifiant (vide = automatique)</span></div>" +
        "<input class='inp' data-newkey type='text' placeholder='clé unique'></div>";
      const fields = rootObject
        ? Object.entries(curVal || {}).map(([k, v]) => controlHtml(k, v)).join("")
        : "<div class='field'><div class='field-h'><span class='lbl'>Valeur</span></div>" +
          "<textarea class='inp' data-type='" + (detectType(curVal) === "number" ? "number" : detectType(curVal) === "json" ? "json" : "string") +
          "' rows='5'>" + esc(detectType(curVal) === "json" ? JSON.stringify(curVal, null, 2) : String(curVal ?? "")) + "</textarea></div>";
      card.innerHTML =
        "<div class='card-h'><h4 class='card-title'>" + esc(title) + "</h4></div>" +
        "<div class='card-fields'>" + keyRow + fields + "</div>" +
        (rootObject ? "<div class='addfield'><input class='inp' data-addk placeholder='nom du champ'>" +
          "<button class='btn ghost sm' data-a='addf'>＋ champ</button></div>" : "") +
        "<div class='msg' data-msg></div>" +
        "<div class='card-f'><button class='btn ghost sm' data-a='cancel'>Annuler</button>" +
        "<button class='btn primary sm' data-a='save'>Enregistrer</button></div>";
      wire();
    }

    function wire() {
      card.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => b.closest(".field").remove());
      const addf = card.querySelector("[data-a=addf]");
      if (addf) addf.onclick = () => {
        const k = (card.querySelector("[data-addk]").value || "").trim();
        if (!k) return;
        if (/[.#$\[\]\/]/.test(k)) return msg("Nom de champ invalide (pas de . # $ [ ] /).");
        card.querySelector(".card-fields").insertAdjacentHTML("beforeend", controlHtml(k, ""));
        wire();
      };
      card.querySelector("[data-a=cancel]").onclick = () => (key ? view() : card.remove());
      card.querySelector("[data-a=save]").onclick = doSave;
    }
    const msg = (m, ok) => { const e = card.querySelector("[data-msg]"); if (e) { e.textContent = m; e.className = "msg " + (ok ? "ok" : "err"); } };

    async function doSave() {
      let val; try { val = readFields(card, rootObject); } catch (e) { return msg(e.message); }
      let k = key;
      if (!k) { const nk = (card.querySelector("[data-newkey]").value || "").trim();
        if (nk && /[.#$\[\]\/]/.test(nk)) return msg("Identifiant invalide."); k = nk || null; }
      const btn = card.querySelector("[data-a=save]"); btn.disabled = true;
      try {
        if (k) await api("content", { action: "set", node, key: k, value: val });
        else await api("content", { action: "add", node, value: val });
        onChanged && onChanged();
      } catch (e) { msg(e.message); btn.disabled = false; }
    }
    async function doDelete() {
      if (!confirm("Supprimer « " + title + " » ?")) return;
      if (!confirm("⚠️ Confirmation finale — une copie part à la corbeille (30 jours).")) return;
      try { await api("content", { action: "delete", node, key }); onChanged && onChanged(); }
      catch (e) { alert(e.message); }
    }

    opt.startEdit ? enterEdit() : view();
    return card;
  }

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
        onChanged: loadItems
      })));
    } catch (e) { grid.innerHTML = "<div class='empty'>" + esc(e.message) + "</div>"; }
  }
  $("btnAdd").onclick = () => {
    const c = recordCard({ node: curNode, key: null, title: "Nouvel élément", onChanged: loadItems, startEdit: true });
    $("itemList").prepend(c); c.scrollIntoView({ behavior: "smooth", block: "center" });
  };
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
      node: "det_produits", key: p.key, title: p.name,
      subtitle: "<span class='pill'>" + fmtF(p.price) + "</span> <span class='muted'>" + esc(p.seller) + "</span>" +
        (p.active ? "" : " <span class='tag danger'>inactif</span>"),
      onChanged: loadMarket
    })));
  }
  $("btnAddProduct").onclick = () => {
    const c = recordCard({ node: "det_produits", key: null, title: "Nouveau produit", onChanged: loadMarket, startEdit: true });
    $("prodList").prepend(c); c.scrollIntoView({ behavior: "smooth", block: "center" });
  };

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
