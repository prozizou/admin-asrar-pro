// admin-core.js — Initialisation, auth, API, variables globales, etc.

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

  // Utilitaires DOM et sécurité
  window.$ = (id) => document.getElementById(id);
  window.esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  window.when = (t) => t ? new Date(t).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";

  // Utilitaires pour les cartes
  window.isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  window.cardTitle = (v, k) => isObj(v)
    ? (v.title || v.titre || v.nom || v.name || v.label || v.profile_name || v.verset || v.sourate || v.faida || k)
    : String(v ?? k);
  window.cardDesc = (v) => isObj(v)
    ? String(v.sirr || v.content || v.description || v.faida || v.texte || v.details || v.benefit || "")
    : String(v ?? "");
  window.cardImg = (v) => isObj(v) ? String(v.image || v.img || v.url || v.imageUrl || "") : "";

  // Champs « cœur » et utilitaires d'édition
  window.CORE_FIELDS = ["title", "faida", "content", "image", "imageId"];
  window.isComplex = (v) => v !== null && typeof v === "object";
  window.coerceField = (el) => {
    const t = el.getAttribute("data-ftype");
    if (t === "bool") return el.checked;
    if (t === "number") { const n = Number(el.value); return el.value.trim() === "" ? "" : (isNaN(n) ? el.value : n); }
    return el.value;
  };
  window.simpleFieldHtml = (key, val) => {
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
    return `<div class="xfield" data-simple data-fkey="${esc(key)}">
      <div class="xfield-h"><span>${esc(key)}</span>
      <button type="button" class="btn text danger-text xf-rm">✕ retirer</button></div>${ctrl}</div>`;
  };
  window.complexFieldHtml = (key, val) => {
    const json = esc(JSON.stringify(val, null, 2));
    return `<div class="xfield" data-complex data-fkey="${esc(key)}">
      <div class="xfield-h"><span>${esc(key)} <em class="muted">(objet — JSON, structure préservée)</em></span>
      <button type="button" class="btn text danger-text xf-rm">✕ retirer</button></div>
      <textarea rows="6" data-json spellcheck="false" style="font-family:monospace;font-size:.82rem;line-height:1.4">${json}</textarea></div>`;
  };
  window.extraFieldHtml = (key, val) => isComplex(val) ? complexFieldHtml(key, val) : simpleFieldHtml(key, val);

  // Variables globales
  window.USER_TOKEN = null;
  window.CURRENT_NODE = null;
  window.NODES_CACHE = {};

  // Système de toasts
  window.showToast = (msg, type = "ok") => {
    const container = $("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type === "err" ? "danger" : "success"}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-10px)";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  };

  // Appel API centralisé
  window.api = async (endpoint, payload = {}) => {
    if (USER_TOKEN) payload.idToken = USER_TOKEN;
    const res = await fetch("/api/" + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Une erreur inconnue est survenue côté serveur.");
    return data;
  };

  // Observateur d'authentification
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

  // Formulaire de connexion
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

  // Détection mobile
  const mqMobile = window.matchMedia("(max-width: 820px)");
  const applyDevice = () => document.body.classList.toggle("is-mobile", mqMobile.matches);
  applyDevice();
  if (mqMobile.addEventListener) mqMobile.addEventListener("change", applyDevice);
  else window.addEventListener("resize", applyDevice);

  // Thème clair/sombre
  (function initTheme() {
    const btn = $("themeToggle");
    const apply = (t) => {
      document.body.classList.toggle("light", t === "light");
      if (btn) btn.textContent = t === "light" ? "☀️" : "🌙";
    };
    let theme = "dark";
    try { theme = localStorage.getItem("adm_theme") || "dark"; } catch (e) {}
    apply(theme);
    if (btn) btn.onclick = () => {
      theme = document.body.classList.contains("light") ? "dark" : "light";
      apply(theme);
      try { localStorage.setItem("adm_theme", theme); } catch (e) {}
    };
  })();

  // Navigation par onglets
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-tab");

      $("tab-content").hidden = target !== "content";
      $("tab-market").hidden = target !== "market";
      $("tab-users").hidden = target !== "users";
      $("tab-analytics").hidden = target !== "analytics";
      $("tab-visits").hidden = target !== "visits";
      $("tab-audit").hidden = target !== "audit";
      $("tab-settings").hidden = target !== "settings";

      if (target === "market") loadMarket();
      if (target === "users") { loadUsers(); loadAccess(); }
      if (target === "analytics") loadAnalytics();
      if (target === "visits") loadVisits();
      if (target === "audit") loadAudit();
    };
  });

  // ── Initialisation du tableau de bord ──
  window.initDashboard = function () {
    loadNodesMenu();
    loadAudit();
    loadConfig();
    loadUsers();
    loadAccess();
    // Attacher les boutons spécifiques
    const btnShop = $("btnAddShop");
    if (btnShop) btnShop.onclick = openShopCreator;
  };

})();
