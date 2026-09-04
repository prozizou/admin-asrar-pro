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

  // Bascule du loader neutre (état par défaut, pendant la restauration
  // asynchrone d'une éventuelle session) vers le VRAI formulaire de
  // connexion. N'est appelée que quand on est CERTAIN qu'il n'y a personne
  // à restaurer (ou que la vérification admin a explicitement échoué) —
  // jamais pendant le court instant où Firebase relit la session persistée,
  // ce qui évite l'impression d'une reconnexion à chaque rafraîchissement.
  function revealLoginForm() {
    const loader = $("authLoaderBox"), form = $("loginBox");
    if (loader) loader.hidden = true;
    if (form) form.hidden = false;
  }

  // Persistance LOCAL (IndexedDB) → survit à un rafraîchissement/fermeture
  // d'onglet. Repli SESSION (sessionStorage) si le navigateur bloque
  // IndexedDB (navigation privée, certains navigateurs in-app) : la session
  // tient au moins tant que l'onglet reste ouvert, au lieu d'échouer
  // silencieusement et de forcer une reconnexion Google à CHAQUE
  // rafraîchissement. Un avertissement visible explique pourquoi si même
  // SESSION échoue (stockage entièrement bloqué).
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() =>
    auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
  ).catch(() => {
    revealLoginForm();
    const msg = $("loginMsg");
    if (msg) {
      msg.className = "msg err";
      msg.textContent = "Votre navigateur bloque le stockage local (navigation privée ?) — vous devrez vous reconnecter à chaque visite.";
    }
  });

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


  // URL du site (asrar-main — pour construire les liens partageables /s), injectée
  // par /api/config. asrar-main n'a plus de "hub" séparé : c'est une app Next.js
  // unifiée qui sert elle-même /s (voir next.config.mjs → api/share). HUB_URL reste
  // lu en repli (ancien nom) pour compatibilité avec un déploiement déjà configuré.
  window.SITE_URL = String(window.SITE_URL || window.HUB_URL || "https://www.asrarpro.com").replace(/\/+$/, "");

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

  // ── Icônes SVG (jeu cohérent, trait 1.7, style Lucide) ───────────────────
  // Remplace les emojis : rendu identique sur tous les OS/navigateurs.
  const ICON_PATHS = {
    overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    content: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z"/>',
    market: '<path d="M3 9 4.5 4h15L21 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M3 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 3 0"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6.1"/><path d="M17 15.2A5.5 5.5 0 0 1 20.5 20"/>',
    fonts: '<path d="M5 18 10 5h1.5L16.5 18"/><path d="M6.8 13.5h7"/><path d="M18 10.5v7.5"/><path d="M18 11.2a2.4 2.4 0 1 0 0 4.8"/>',
    referral: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8"/><path d="M12 8v12"/><path d="M12 8S10.5 3.5 8 4.5 8.5 8 12 8Z"/><path d="M12 8s1.5-4.5 4-3.5S15.5 8 12 8Z"/>',
    analytics: '<path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="5"/><rect x="12" y="8" width="3" height="8"/><rect x="17" y="13" width="3" height="3"/>',
    visits: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
    audit: '<path d="M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M8 11h8"/><path d="M8 15h5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1-2.7H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    select: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8.5 12.2l2.3 2.3 4.7-4.9"/>',
    share: '<circle cx="6" cy="12" r="2.4"/><circle cx="17.5" cy="6" r="2.4"/><circle cx="17.5" cy="18" r="2.4"/><path d="M8.1 10.9l7.3-3.7"/><path d="M8.1 13.1l7.3 3.7"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-13.7-4.7L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 13.7 4.7L20 16"/><path d="M20 20v-4h-4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M10 11v6M14 11v6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    block: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
    restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    warning: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    check: '<path d="M5 12.5 10 17.5 20 6.5"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8"/><path d="M12 8v12"/><path d="M12 8S10.5 3.5 8 4.5 8.5 8 12 8Z"/><path d="M12 8s1.5-4.5 4-3.5S15.5 8 12 8Z"/>',
    revenue: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9c-.5-1-1.5-1.5-2.7-1.5-1.5 0-2.6.8-2.6 2 0 2.8 5.6 1.4 5.6 4.2 0 1.3-1.2 2.1-2.8 2.1-1.3 0-2.4-.6-2.9-1.6"/><path d="M12 6v1.5M12 16.5V18"/>',
    trend: '<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    open: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    upload: '<path d="M12 16V4"/><path d="M6.5 9.5 12 4l5.5 5.5"/><path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2"/>',
    download: '<path d="M12 4v12"/><path d="M6.5 10.5 12 16l5.5-5.5"/><path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2"/>'
  };
  // ic("name" | "name:currentColor") → chaîne SVG. Aliases fréquents inclus.
  const ICON_ALIAS = { add: "plus", reload: "refresh", "new": "sparkle", danger: "warning" };
  window.ic = function (name, cls) {
    const n = ICON_ALIAS[name] || name;
    const p = ICON_PATHS[n];
    if (!p) return "";
    return `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  };
  // Injecte une icône dans tout élément [data-icon] (avant son texte).
  window.applyIcons = function (root) {
    (root || document).querySelectorAll("[data-icon]:not([data-iconized])").forEach((el) => {
      const svg = ic(el.getAttribute("data-icon"));
      if (svg) { el.insertAdjacentHTML("afterbegin", svg); el.setAttribute("data-iconized", "1"); }
    });
  };

  // ── Menus ⋮ génériques (.kebab) ────────────────────────────────────────
  // Un seul ouvert à la fois ; se ferme au clic ailleurs (y compris sur un
  // autre kebab). Délégué sur document : fonctionne pour tout .kebab-menu
  // présent au moment du clic, même reconstruit entre-temps (listes re-rendues).
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".kebab-btn");
    const openMenu = btn ? btn.nextElementSibling : null;
    document.querySelectorAll(".kebab-menu:not([hidden])").forEach((m) => { if (m !== openMenu) m.hidden = true; });
    if (openMenu) openMenu.hidden = !openMenu.hidden;
  });

  // ── Modale (confirmation / saisie) — remplace confirm()/prompt() natifs ──
  // uiConfirm(opts) → Promise<boolean> ; uiPrompt(opts) → Promise<string|null>.
  let MODAL_HOST = null;
  const buildModalHost = () => {
    MODAL_HOST = document.createElement("div");
    MODAL_HOST.id = "modalHost";
    MODAL_HOST.className = "modal-host";
    MODAL_HOST.hidden = true;
    document.body.appendChild(MODAL_HOST);
  };
  const openModal = ({ title, message, icon = "warning", danger = false, confirmText = "Confirmer", cancelText = "Annuler", input = null }) => {
    if (!MODAL_HOST) buildModalHost();
    return new Promise((resolve) => {
      const hasInput = input !== null;
      MODAL_HOST.innerHTML = `
        <div class="modal-scrim"></div>
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
          <div class="modal-ic ${danger ? "danger" : ""}">${ic(icon)}</div>
          <h3 id="modalTitle" class="modal-title">${esc(title || "Confirmation")}</h3>
          ${message ? `<p class="modal-msg">${esc(message).replace(/\n/g, "<br>")}</p>` : ""}
          ${hasInput ? `<input id="modalInput" class="modal-input" type="${esc(input.type || "text")}" placeholder="${esc(input.placeholder || "")}" value="${esc(input.value || "")}">` : ""}
          <div class="modal-actions">
            <button class="btn text" id="modalCancel">${esc(cancelText)}</button>
            <button class="btn ${danger ? "danger" : "primary"}" id="modalOk">${esc(confirmText)}</button>
          </div>
        </div>`;
      MODAL_HOST.hidden = false;
      requestAnimationFrame(() => MODAL_HOST.classList.add("show"));
      const inputEl = hasInput ? $("modalInput") : null;
      if (inputEl) { inputEl.focus(); inputEl.select(); }
      else $("modalOk").focus();

      const done = (val) => {
        MODAL_HOST.classList.remove("show");
        setTimeout(() => { MODAL_HOST.hidden = true; MODAL_HOST.innerHTML = ""; }, 200);
        document.removeEventListener("keydown", onKey);
        resolve(val);
      };
      const ok = () => done(hasInput ? (inputEl.value ?? "") : true);
      const cancel = () => done(hasInput ? null : false);
      const onKey = (e) => {
        if (e.key === "Escape") cancel();
        if (e.key === "Enter" && (hasInput || document.activeElement !== $("modalCancel"))) { e.preventDefault(); ok(); }
      };
      $("modalOk").onclick = ok;
      $("modalCancel").onclick = cancel;
      MODAL_HOST.querySelector(".modal-scrim").onclick = cancel;
      document.addEventListener("keydown", onKey);
    });
  };
  // API pratique : accepte une chaîne (message) ou un objet d'options.
  window.uiConfirm = (opts) => openModal(typeof opts === "string" ? { message: opts } : (opts || {}));
  window.uiPrompt = (opts) => {
    const o = typeof opts === "string" ? { message: opts } : (opts || {});
    return openModal({
      icon: "edit", confirmText: "Valider", ...o,
      input: { type: o.inputType || "text", placeholder: o.placeholder || "", value: o.default || "" }
    });
  };

  // ── Skeletons (états de chargement) ──────────────────────────────────────
  // skeleton("cards"|"list"|"rows"|"kpis", n) → HTML de substituts animés.
  window.skeleton = function (kind = "list", n = 6) {
    const line = (w) => `<span class="sk-line" style="width:${w}"></span>`;
    if (kind === "kpis")
      return `<div class="kpis">${Array.from({ length: n }, () => `<div class="kpi sk"><span class="sk-line" style="width:60%;height:26px"></span>${line("80%")}</div>`).join("")}</div>`;
    if (kind === "cards")
      return `<div class="grid">${Array.from({ length: n }, () => `<div class="card sk"><div class="sk-thumb"></div><div class="card-body">${line("85%")}${line("55%")}</div></div>`).join("")}</div>`;
    // list / rows
    return Array.from({ length: n }, () => `<div class="row sk">${line("40%")}${line("70%")}</div>`).join("");
  };

  // ── Graphique de barres réutilisable (Dashboard, Analytique, Parrainage) ──
  // Colonnes à largeur flexible (jamais de scrollbar horizontale), valeur
  // toujours visible au-dessus de chaque barre, axe Y discret min/0, dates
  // françaises, étiquettes allégées au-delà de 8 colonnes. Voir .rc-* (admin.css).
  const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  window.frDate = function (bucket) {
    const parts = String(bucket || "").split("-");
    const d = Number(parts[2]), m = Number(parts[1]);
    if (!d || !m) return bucket;
    return d + " " + (MONTHS_FR[m - 1] || "");
  };
  // Regroupe une série quotidienne triée en paquets de 7 jours (le plus ancien
  // paquet peut être incomplet) — évite des dizaines de barres minuscules sur
  // 30/90 j. sumKeys : champs numériques à additionner par paquet.
  window.chunkWeekly = function (rows, sumKeys) {
    const out = [];
    const rem = rows.length % 7;
    let i = 0;
    if (rem) { out.push(rows.slice(0, rem)); i = rem; }
    for (; i < rows.length; i += 7) out.push(rows.slice(i, i + 7));
    return out.map((chunk) => {
      const merged = { bucket: chunk[0].bucket };
      (sumKeys || []).forEach((k) => { merged[k] = chunk.reduce((s, r) => s + (Number(r[k]) || 0), 0); });
      return merged;
    });
  };
  // rows : [{bucket, ...champs numériques}]. opts.series : 1 entrée (série
  // unique) ou 2 (ex. total + uniques, avec cls:"uniq" sur la seconde pour la
  // couleur bleue). opts.valueKey (défaut series[0].key) pilote la hauteur/
  // l'étiquette imprimée ; opts.tooltip(row) personnalise l'infobulle ;
  // opts.xLabel(row) personnalise l'étiquette d'axe (défaut : frDate(bucket) —
  // utile pour un bucket mensuel « YYYY-MM » que frDate ne sait pas lire).
  window.barChartHtml = function (rows, opts) {
    opts = opts || {};
    const series = opts.series || [];
    if (!rows.length || !series.length) return `<div class="empty">${esc(opts.emptyText || "Aucune donnée sur cette période.")}</div>`;
    const valueKey = opts.valueKey || series[0].key;
    const xLabel = opts.xLabel || ((r) => frDate(r.bucket));
    const nf = new Intl.NumberFormat("fr-FR");
    const fmt = (n) => nf.format(Math.round(Number(n) || 0));
    const max = Math.max(1, ...rows.map((r) => Math.max(...series.map((s) => Number(r[s.key]) || 0))));
    const labelEvery = rows.length > 8 ? Math.ceil(rows.length / 6) : 1;
    const legend = series.length > 1
      ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}</div>`
      : "";
    const bars = `<div class="rc-chart">
      <span class="rc-axis-max">${fmt(max)}</span><span class="rc-axis-zero">0</span>
      <div class="rc-bars">
        ${rows.map((r, idx) => {
          const showLabel = idx % labelEvery === 0 || idx === rows.length - 1;
          const tip = opts.tooltip ? opts.tooltip(r) : (xLabel(r) + " · " + fmt(r[valueKey]));
          return `<div class="rc-col" title="${esc(tip)}">
            <span class="rc-val">${fmt(r[valueKey])}</span>
            <div class="rc-bar-track">${series.map((s) => {
              const h = Math.max(2, Math.round((Number(r[s.key]) || 0) / max * 100));
              return `<div class="rc-bar${s.cls ? " " + s.cls : ""}" style="height:${h}%"></div>`;
            }).join("")}</div>
            <span class="rc-x">${showLabel ? esc(xLabel(r)) : ""}</span>
          </div>`;
        }).join("")}
      </div>
    </div>`;
    return legend + bars;
  };

  // Appel API centralisé.
  // Le jeton part dans l'en-tête « Authorization: Bearer » (standard, ne traîne
  // pas dans les logs de corps de requête). On le laisse aussi dans le corps par
  // compatibilité ascendante (le serveur privilégie l'en-tête, retombe sur le corps).
  window.api = async (endpoint, payload = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (USER_TOKEN) {
      headers["Authorization"] = "Bearer " + USER_TOKEN;
      payload.idToken = USER_TOKEN;
    }
    const res = await fetch("/api/" + endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      // .status exposé pour distinguer un vrai refus serveur (401/403) d'une
      // erreur métier quelconque — utilisé par verifyAdminOrSignOut() ci-dessous.
      const err = new Error(data.error || "Une erreur inconnue est survenue côté serveur.");
      err.status = res.status;
      throw err;
    }
    return data;
  };

  // Confirme côté serveur que le compte Google connecté est bien administrateur
  // (super-admin prozizou298@gmail.com, ou admins/{clé}===true — cf. _lib/fb.js
  // → verifyAdmin) AVANT d'exposer le panneau : n'importe quel compte Google peut
  // ouvrir une session Firebase, ce n'est que cette vérification qui filtre.
  // Une erreur RÉSEAU (hors-ligne, timeout — pas de statut HTTP) ne déconnecte
  // PAS : seul un refus explicite du serveur (401/403) le fait.
  async function verifyAdminOrSignOut() {
    try {
      await api("stats", { action: "overview" });
      return true;
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        revealLoginForm();
        $("loginMsg").className = "msg err";
        $("loginMsg").textContent = "Accès administrateur refusé pour ce compte Google.";
        await auth.signOut();
        return false;
      }
      return true; // erreur réseau : chaque appel API revérifie de toute façon.
    }
  }

  // Observateur d'authentification. Au premier appel (chargement de page),
  // Firebase relit la session persistée AVANT de savoir s'il y a quelqu'un —
  // le loader neutre (#authLoaderBox, visible par défaut dans le HTML) reste
  // affiché pendant ce court instant. Le bouton Google n'apparaît que dans
  // la branche `else` (personne à restaurer) ou sur un refus explicite.
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      try {
        USER_TOKEN = await user.getIdToken();
      } catch (err) {
        USER_TOKEN = null;
      }
      const loaderText = $("authLoaderText");
      if (loaderText) loaderText.textContent = "Vérification des privilèges administrateur…";
      // Session déjà ouverte → on laisse passer sans redemander la connexion
      // Google, juste la vérification admin ci-dessus.
      if (!(await verifyAdminOrSignOut())) return; // signOut() redéclenche ce handler avec user=null.
      $("login").hidden = true;
      $("app").hidden = false;
      initDashboard();
    } else {
      USER_TOKEN = null;
      $("app").hidden = true;
      $("login").hidden = false;
      revealLoginForm();
    }
  });

  // Le jeton Firebase expire au bout d'~1h : le SDK le rafraîchit tout seul en
  // interne, mais rien ne pousse la nouvelle valeur ailleurs. Sans ce second
  // écouteur, USER_TOKEN reste figé sur le jeton initial et toute session admin
  // restée ouverte plus d'une heure se met à échouer sur chaque appel (« Session
  // invalide ») jusqu'à un rechargement manuel de la page.
  auth.onIdTokenChanged(async (user) => {
    if (!user) { USER_TOKEN = null; return; }
    try { USER_TOKEN = await user.getIdToken(); }
    catch (err) { /* hors-ligne, etc. — le serveur revalide de toute façon à chaque appel */ }
  });

  // Bouton de connexion Google (popup, avec repli redirection si la popup est
  // bloquée — même logique que components/AuthProvider.js côté asrar-main).
  const googleProvider = new firebase.auth.GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: "select_account" });

  const POPUP_FALLBACK_CODES = [
    "auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"
  ];
  $("btnGoogleLogin").onclick = async () => {
    const msg = $("loginMsg");
    msg.className = "msg info";
    msg.textContent = "Connexion à Google en cours…";
    try {
      await auth.signInWithPopup(googleProvider);
      msg.textContent = "";
    } catch (err) {
      if (err && err.code === "auth/popup-closed-by-user") { msg.textContent = ""; return; }
      if (err && POPUP_FALLBACK_CODES.includes(err.code)) {
        msg.textContent = "Ouverture de Google…";
        try { await auth.signInWithRedirect(googleProvider); }
        catch (err2) { msg.className = "msg err"; msg.textContent = "Connexion Google impossible : " + err2.message; }
        return;
      }
      msg.className = "msg err";
      msg.textContent = "Connexion Google impossible : " + (err && err.message || "erreur inconnue");
    }
  };
  // Reprend après un repli signInWithRedirect (retour de Google sur cette page).
  auth.getRedirectResult().catch((err) => {
    if (err && err.code && err.code !== "auth/no-auth-event") {
      $("loginMsg").className = "msg err";
      $("loginMsg").textContent = "Connexion Google impossible : " + err.message;
    }
  });

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
      if (btn) btn.innerHTML = ic(t === "light" ? "sun" : "moon");
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

  // Menu mobile (hamburger)
  (function initNavToggle() {
    const toggle = $("navToggle");
    const nav = $("mainNav");
    const scrim = $("navScrim");
    if (!toggle || !nav) return;
    const setOpen = (open) => {
      nav.classList.toggle("open", open);
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (scrim) scrim.hidden = !open;
    };
    toggle.onclick = () => setOpen(!nav.classList.contains("open"));
    if (scrim) scrim.onclick = () => setOpen(false);
    // Fermer après un choix ou en repassant en grand écran.
    nav.addEventListener("click", (e) => { if (e.target.closest("button")) setOpen(false); });
    window.matchMedia("(max-width: 1100px)").addEventListener("change", (e) => { if (!e.matches) setOpen(false); });
    window.__closeNav = () => setOpen(false);
  })();

  // Navigation par onglets
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-tab");
      showTab(target);
    };
  });

  // Titre affiché dans l'en-tête (à côté du logo) — reprend le libellé du bouton nav.
  const TAB_TITLES = {
    dashboard: "Vue d'ensemble", content: "Contenus", market: "Marché", users: "Utilisateurs",
    fonts: "Polices", referral: "Parrainage", analytics: "Analytique"
  };

  // Affiche un onglet et charge SES données à la demande (lazy) — une seule fois.
  const TAB_LOADED = {};
  window.showTab = function (target, force) {
    document.querySelectorAll("[data-tab]").forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-tab") === target));
    const pt = $("pageTitle");
    if (pt) pt.textContent = TAB_TITLES[target] || "";

    $("tab-dashboard").hidden = target !== "dashboard";
    $("tab-content").hidden = target !== "content";
    $("tab-market").hidden = target !== "market";
    $("tab-users").hidden = target !== "users";
    $("tab-fonts").hidden = target !== "fonts";
    $("tab-referral").hidden = target !== "referral";
    $("tab-analytics").hidden = target !== "analytics";

    // Onglets rechargés à chaque visite (données volatiles).
    if (target === "dashboard") return loadDashboard();
    if (target === "market") return loadMarket();

    // Onglets chargés une seule fois (sauf rechargement explicite via leur bouton ↻).
    if (!force && TAB_LOADED[target]) return;
    TAB_LOADED[target] = true;
    if (target === "content") loadNodesMenu();
    if (target === "users") { loadAccess(); loadFormationMinutes(); }
    if (target === "fonts") loadFonts();
    if (target === "referral") loadReferral();
    if (target === "analytics") loadAnalytics();
  };

  // ── LIENS PARTAGEABLES DU SITE (/s) ──────────────────────────────────
  // Conjugué avec pages/api/share.js d'asrar-main (rewrite /s → api/share,
  // next.config.mjs) : /s?k=<type>&c=<cat>&i=<clé>
  // Permet à l'administration de poster elle-même un secret / livre / produit
  // sur WhatsApp, Facebook ou TikTok (avec vignette Open Graph).
  window.shareKindOf = function (node) {
    if (/^db_sirr_/.test(node)) return { kind: "secret", cat: node.replace("db_sirr_", "") };
    if (node === "almaqtab") return { kind: "book" };
    if (node === "det_produits") return { kind: "product" };
    return null;
  };
  window.hubShareLink = function (node, key) {
    const m = shareKindOf(node);
    if (!m || !key) return null;
    let u = SITE_URL + "/s?k=" + encodeURIComponent(m.kind);
    if (m.cat) u += "&c=" + encodeURIComponent(m.cat);
    return u + "&i=" + encodeURIComponent(key);
  };
  // Copie + partage natif si disponible (mobile).
  window.copyShareLink = async function (node, key, title) {
    const url = hubShareLink(node, key);
    if (!url) { showToast("Cet élément n'a pas de lien partageable.", "err"); return; }
    try {
      if (navigator.share) { await navigator.share({ title: title || "ASRAR PRO", text: title || "", url }); return; }
      await navigator.clipboard.writeText(url);
      showToast("Lien copié : " + url);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      await uiPrompt({ title: "Copiez le lien", icon: "share", default: url, confirmText: "OK", cancelText: "Fermer" });
    }
  };

  // ── Helpers partagés (upload Cloudinary, couverture PDF locale, id hex) ──
  // resourceType : "image" (défaut) ou "raw" (polices, PDF…).
  window.uploadToCloudinary = async function (fileOrBlob, folder, filename, resourceType) {
    const sign = await api("cloudinary-sign", { folder });
    const fd = new FormData();
    if (filename) fd.append("file", fileOrBlob, filename); else fd.append("file", fileOrBlob);
    fd.append("api_key", sign.apiKey);
    fd.append("timestamp", sign.timestamp);
    fd.append("signature", sign.signature);
    fd.append("folder", sign.folder);
    const rt = resourceType === "raw" ? "raw" : "image";
    const cRes = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/${rt}/upload`, { method: "POST", body: fd });
    const cData = await cRes.json();
    if (!cRes.ok) throw new Error(cData.error?.message || "L'envoi du média a échoué.");
    return { url: cData.secure_url, id: cData.public_id };
  };

  // Charge pdf.js (cdnjs) à la demande — utilisé pour extraire la couverture EN LOCAL.
  // Intégrité vérifiée (SRI) : une compromission du CDN ne peut pas faire exécuter
  // du code arbitraire dans ce panneau admin à pleins pouvoirs — le hash doit
  // correspondre exactement, sinon le navigateur refuse de charger le script.
  const PDFJS_VERSION = "3.11.174";
  const PDFJS_SRI = {
    lib:    "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e",
    worker: "sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2"
  };
  let PDFLIB = null;
  window.loadPdfJs = function () {
    if (PDFLIB) return Promise.resolve(PDFLIB);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
      s.integrity = PDFJS_SRI.lib;
      s.crossOrigin = "anonymous";
      s.onload = () => {
        PDFLIB = window.pdfjsLib;
        // Le worker est chargé par pdf.js lui-même (pas par ce <script>) : pas de
        // moyen natif d'y attacher un SRI, mais il vient de la même version pinnée
        // du même CDN que la lib déjà vérifiée ci-dessus.
        PDFLIB.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
        resolve(PDFLIB);
      };
      s.onerror = () => reject(new Error("Lecteur PDF indisponible (connexion internet requise, ou intégrité du script invalide)."));
      document.head.appendChild(s);
    });
  };
  // Rend la 1re page d'un PDF LOCAL en JPEG → Blob (la couverture cover.png/jpg).
  window.pdfCoverBlob = async function (file, scale = 1.6) {
    const lib = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  };

  window.randHex16 = function () {
    const a = new Uint8Array(8); crypto.getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  // ── Initialisation du tableau de bord ──
  let BOOTED = false;
  window.initDashboard = function () {
    // Icônes SVG dans toute l'interface + modale prête.
    applyIcons();
    // Boutons spécifiques (attachés une seule fois).
    if (!BOOTED) {
      BOOTED = true;
      const btnShop = $("btnAddShop");
      if (btnShop) btnShop.onclick = openShopCreator;
    }
    // Ouvre sur la Vue d'ensemble ; chaque onglet charge SES données à la demande.
    showTab("dashboard", true);
  };

})();
