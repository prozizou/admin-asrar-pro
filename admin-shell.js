// Shared workspace interactions. Business data and permission checks stay in
// the existing modules and authenticated server endpoints.
(function () {
  "use strict";
  const PAGES = {
    dashboard: ["Vue d'ensemble", "VOTRE ACTIVITÉ EN UN REGARD", "Gardez le cap sur l'essentiel de votre activité.", "Créer un contenu", "create", "overview"],
    content: ["Contenus", "VOTRE BIBLIOTHÈQUE", "Créez, organisez et partagez vos publications.", "Créer un contenu", "create", "content"],
    users: ["Utilisateurs", "VOTRE COMMUNAUTÉ", "Gérez les abonnements, les formations et les accès.", "Accorder un accès", "grant", "users"],
    market: ["Marché", "VOTRE ESPACE COMMERCIAL", "Accompagnez vos vendeurs et organisez vos produits.", "Ajouter un vendeur", "shop", "market"],
    fonts: ["Polices Al-Qalam", "VOTRE COLLECTION", "Enrichissez les polices disponibles dans l'application.", "Ajouter une police", "font", "fonts"],
    referral: ["Parrainage", "DÉVELOPPER LA COMMUNAUTÉ", "Suivez les invitations et récompensez vos ambassadeurs.", "Voir les parrains", "sponsors", "referral"],
    analytics: ["Statistiques", "COMPRENDRE VOTRE ACTIVITÉ", "Explorez la fréquentation et les contenus qui intéressent vos utilisateurs.", "Actualiser", "analytics", "analytics"]
  };
  const primary = $("pagePrimaryAction");
  function updateHeading(target) {
    const page = PAGES[target] || PAGES.dashboard;
    $("pageHeading").textContent = page[0];
    $("pageEyebrow").textContent = page[1];
    $("pageDescription").textContent = page[2];
    primary.innerHTML = ic(page[4] === "analytics" ? "refresh" : page[4] === "sponsors" ? "users" : "add") + esc(page[3]);
    primary.dataset.action = page[4];
    $("moreNav").classList.toggle("active", ["market", "fonts", "referral"].includes(target));
  }
  document.addEventListener("admin:tabchange", (event) => updateHeading(event.detail.target));
  updateHeading(document.body.dataset.activeTab || "dashboard");
  $("todayDate").textContent = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  $("viewSite").href = SITE_URL;
  applyIcons();
  const onlineStatus = () => { $("connectionState").hidden = navigator.onLine; };
  window.addEventListener("online", onlineStatus);
  window.addEventListener("offline", onlineStatus);
  onlineStatus();
  window.addEventListener("hashchange", () => {
    if (!$("app").hidden) showTab(location.hash.slice(1));
  });

  const actions = {
    create: () => {
      $("bigcard").innerHTML = `<div class="bighead"><h3>Créer un contenu</h3><button class="btn text" id="closeCreate">Fermer</button></div><p class="muted">Quel contenu souhaitez-vous partager ?</p><div class="create-options"><button class="create-option" data-create="secret">${ic("sparkle")}<span>Secret<small>Une image, un titre et votre contenu détaillé</small></span></button><button class="create-option" data-create="document">${ic("content")}<span>Document<small>Un livre ou un PDF dans la bibliothèque</small></span></button><button class="create-option" data-create="formation">${ic("users")}<span>Formation<small>Une nouvelle session pour votre communauté</small></span></button></div>`;
      $("big").hidden = false;
      $("closeCreate").onclick = closeBig;
      const creators = { secret: openSecretCreator, document: openDocumentCreator, formation: openFormationCreator };
      $("bigcard").querySelectorAll("[data-create]").forEach((button) => {
        button.onclick = () => creators[button.dataset.create]();
      });
    },
    grant: () => openGrantAccessModal(),
    shop: () => openShopCreator(),
    font: () => $("btnOpenAddFont").click(),
    sponsors: () => { showTab("referral"); $("refSeg").querySelector('[data-refsub="sponsors"]').click(); },
    analytics: () => loadAnalytics()
  };
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !actions[button.dataset.action] || $("app").hidden) return;
    button.disabled = true;
    try { await actions[button.dataset.action](); }
    catch (error) { showToast(error.message, "err"); }
    finally { button.disabled = false; }
  });

  // Focus trapping is shared by the drawer and the existing editor/confirmations.
  const visibleControls = (root) => [...root.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')]
    .filter((el) => !el.disabled && !el.closest("[hidden]") && el.getClientRects().length);
  function trapFocus(event, root) {
    if (event.key !== "Tab") return;
    const items = visibleControls(root);
    const first = items[0], last = items[items.length - 1];
    if (!first) { event.preventDefault(); root.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }
  const drawer = $("appSidebar"), toggle = $("navToggle"), more = $("moreNav");
  const smallScreen = matchMedia("(max-width: 820px)");
  let drawerTrigger = null;
  function setDrawer(open, trigger) {
    open = open && smallScreen.matches;
    if (open) drawerTrigger = trigger || document.activeElement;
    const wasOpen = drawer.classList.contains("open");
    drawer.classList.toggle("open", open);
    toggle.classList.toggle("open", open);
    [toggle, more].forEach((el) => el.setAttribute("aria-expanded", String(open)));
    $("navScrim").hidden = !open;
    $("mainContent").inert = open;
    document.querySelector(".topbar").inert = open;
    document.querySelector(".bottom-nav").inert = open;
    if (open) {
      drawer.setAttribute("role", "dialog");
      drawer.setAttribute("aria-modal", "true");
      drawer.querySelector('[aria-current="page"]').focus();
    } else {
      drawer.removeAttribute("role");
      drawer.removeAttribute("aria-modal");
      if (wasOpen && drawerTrigger && drawerTrigger.isConnected) drawerTrigger.focus();
    }
    syncOverlays();
  }
  toggle.onclick = () => setDrawer(true, toggle);
  more.onclick = () => setDrawer(true, more);
  $("navScrim").onclick = () => setDrawer(false);
  $("closeNav").onclick = () => setDrawer(false);
  drawer.addEventListener("click", (event) => { if (event.target.closest("a, button")) setDrawer(false); });
  smallScreen.addEventListener("change", () => setDrawer(false));
  window.__closeNav = () => setDrawer(false);
  document.addEventListener("keydown", (event) => {
    if (drawer.classList.contains("open")) {
      if (event.key === "Escape") { event.preventDefault(); setDrawer(false); }
      else trapFocus(event, drawer);
      return;
    }
    const confirm = $("modalHost");
    const active = confirm && !confirm.hidden ? confirm : !$("big").hidden ? $("big") : null;
    if (active) trapFocus(event, active);
  });

  let editorOpen = false, confirmationOpen = false, editorReturn = null, confirmationReturn = null;
  function syncOverlays() {
    const editor = $("big"), confirm = $("modalHost");
    const nextEditor = !editor.hidden, nextConfirm = !!confirm && !confirm.hidden;
    if (nextEditor && (!editorOpen || !editor.querySelector("#editorTitle"))) {
      if (!editorOpen) editorReturn = document.activeElement;
      const title = editor.querySelector("h3");
      if (title) { title.id = "editorTitle"; editor.setAttribute("aria-labelledby", "editorTitle"); }
      const input = editor.querySelector('input:not([type="file"]):not([disabled]), textarea, select');
      (input || visibleControls(editor)[0] || editor).focus({ preventScroll: true });
      editor.scrollTop = 0;
      applyIcons(editor);
    }
    if (!nextEditor && editorOpen && editorReturn?.isConnected) editorReturn.focus({ preventScroll: true });
    if (nextConfirm && !confirmationOpen) confirmationReturn = editorOpen ? editor.querySelector(":focus") || editor : document.activeElement;
    if (!nextConfirm && confirmationOpen && confirmationReturn?.isConnected) confirmationReturn.focus({ preventScroll: true });
    editorOpen = nextEditor;
    confirmationOpen = nextConfirm;
    $("app").inert = nextEditor || nextConfirm;
    editor.inert = nextConfirm;
    document.body.classList.toggle("has-overlay", nextEditor || nextConfirm || drawer.classList.contains("open"));
  }
  new MutationObserver(syncOverlays).observe(document.body, { attributes: true, attributeFilter: ["hidden"], childList: true, subtree: true });

  const palette = $("commandPalette"), query = $("commandInput"), results = $("commandResults");
  const commands = Object.entries(PAGES).map(([tab, page]) => ({ label: page[0], icon: page[5], type: "Section", run: () => showTab(tab) })).concat([
    { label: "Créer un contenu", icon: "add", type: "Action", run: actions.create },
    { label: "Accorder un accès", icon: "users", type: "Action", run: actions.grant },
    { label: "Ajouter un vendeur", icon: "market", type: "Action", run: actions.shop }
  ]);
  const normalize = (text) => text.toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  function renderCommands() {
    const found = commands.filter((command) => normalize(command.label).includes(normalize(query.value.trim())));
    results.innerHTML = found.map((command, i) => `<button class="command-result" data-command="${i}">${ic(command.icon)}<span>${esc(command.label)}</span><small>${esc(command.type)}</small></button>`).join("") || '<p class="empty" role="status">Aucune section ou action ne correspond.</p>';
    results.querySelectorAll("button").forEach((button, i) => {
      button.onclick = async () => {
        palette.close();
        try { await found[i].run(); } catch (error) { showToast(error.message, "err"); }
      };
    });
  }
  const openSearch = () => {
    if ($("app").hidden || !$("big").hidden || ($("modalHost") && !$("modalHost").hidden)) return;
    setDrawer(false);
    query.value = "";
    renderCommands();
    palette.showModal();
    query.focus();
  };
  $("openSearch").onclick = openSearch;
  $("closeSearch").onclick = () => palette.close();
  query.oninput = renderCommands;
  palette.addEventListener("click", (event) => {
    const box = palette.getBoundingClientRect();
    if (event.target === palette && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) palette.close();
  });
  palette.addEventListener("keydown", (event) => {
    const items = [...results.querySelectorAll("button")];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
    if (event.key === "Enter" && event.target === query) { event.preventDefault(); items[0].click(); }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (palette.open) palette.close(); else openSearch();
    }
  });

  // All persistent searches retain a visible placeholder and a programmatic label.
  document.querySelectorAll('input[placeholder]').forEach((input) => {
    if (!input.closest("label") && !input.hasAttribute("aria-label") && !input.hasAttribute("aria-labelledby")) input.setAttribute("aria-label", input.placeholder);
  });
})();
