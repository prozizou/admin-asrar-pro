// admin-fonts.js — Gestion des polices Al-Qalam (upload Cloudinary + fiche Firebase).
// Liste compacte + modale d'ajout/modification (même gabarit #big/#bigcard que
// les autres onglets) — le formulaire ne monopolise plus l'écran principal.

(function () {
  "use strict";

  // Mêmes paliers que les abonnements (cf. LEVEL_LABELS, admin-users.js) —
  // « palier » et « prix » sont la même notion ici : le montant minimum
  // d'abonnement pour débloquer la police dans Al-Qalam.
  const FONT_LEVELS = [
    { level: 0, label: "Gratuit — accessible à tous" },
    { level: 15000, label: "Premium · 3 mois — 15 000 FCFA" },
    { level: 25000, label: "Premium · 6 mois — 25 000 FCFA" },
    { level: 45000, label: "Premium · 1 an — 45 000 FCFA" }
  ];
  const fontAccessShort = (n) => Number(n) ? "Premium · " + Number(n).toLocaleString("fr-FR") + " FCFA" : "Gratuit — accessible à tous";
  const MAX_FONT_BYTES = 5 * 1024 * 1024; // 5 Mo — largement suffisant pour un fichier de police (TTF/OTF/WOFF2)
  const monogram = (name) => (String(name || "?").trim().slice(0, 2) || "?").toUpperCase();
  const fmtBytes = (n) => {
    n = Number(n) || 0;
    if (n < 1024) return n + " o";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " Ko";
    return (n / (1024 * 1024)).toFixed(1) + " Mo";
  };

  let FONTS = [];

  window.loadFonts = async function () {
    const list = $("fontsList");
    if (!list) return;
    list.innerHTML = "<div class='empty'>Chargement des polices…</div>";
    try {
      const d = await api("fonts", { action: "list" });
      FONTS = d.fonts || [];
      renderFonts();
    } catch (e) {
      list.innerHTML = `<div class='empty' style='color:var(--danger)'>Erreur : ${esc(e.message)}</div>`;
    }
  };

  function renderFonts() {
    const list = $("fontsList");
    if (!list) return;
    const q = ($("fontSearch") ? $("fontSearch").value : "").trim().toLowerCase();
    const rows = q ? FONTS.filter((f) => (f.name || "").toLowerCase().includes(q)) : FONTS;

    if ($("fontCount")) $("fontCount").textContent = FONTS.length ? "(" + FONTS.length + ")" : "";
    if (!FONTS.length) { list.innerHTML = "<div class='empty'>Aucune police pour le moment.</div>"; return; }
    if (!rows.length) { list.innerHTML = "<div class='empty'>Aucune police ne correspond à la recherche.</div>"; return; }

    // Injecte une @font-face par police pour l'aperçu réel dans la carte
    // (chargée directement depuis Cloudinary — pas de fichier local requis).
    let styleTxt = "";
    rows.forEach((f) => { if (f.family && f.url) styleTxt += `@font-face { font-family: '${f.family}'; src: url('${f.url}'); font-display: swap; }\n`; });
    let styleEl = document.getElementById("font-faces-style");
    if (!styleEl) { styleEl = document.createElement("style"); styleEl.id = "font-faces-style"; document.head.appendChild(styleEl); }
    styleEl.textContent = styleTxt;

    list.innerHTML = rows.map((f) => {
      const active = f.enabled !== false;
      const fam = f.family ? `'${esc(f.family)}', 'Alkalami', serif` : "'Alkalami', serif";
      return `
      <div class="font-card" data-font="${esc(f.id)}">
        <div class="font-card-top">
          <div class="font-avatar" style="font-family:${fam}">${esc(monogram(f.name))}</div>
          <div class="font-card-name">
            <b>${esc(f.name)}</b>
            <span class="access-status ${active ? "on" : "off"}">${active ? "Active" : "Inactive"}</span>
          </div>
        </div>
        <div class="font-card-sample" style="font-family:${fam}" dir="rtl">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>
        <div class="font-card-access">Accès minimum : <b>${esc(fontAccessShort(f.level))}</b></div>
        <div class="font-card-acts">
          <button class="btn text" data-font-edit="${esc(f.id)}">Modifier</button>
          <button class="btn text" data-font-toggle="${esc(f.id)}">${active ? "Désactiver" : "Activer"}</button>
          <div class="kebab" style="margin-left:auto">
            <button class="kebab-btn" title="Plus d'actions">${ic("more") || "⋮"}</button>
            <div class="kebab-menu" hidden>
              <button data-font-tech="${esc(f.id)}">Informations techniques</button>
              <button class="danger-text" data-font-del="${esc(f.id)}">Supprimer</button>
            </div>
          </div>
        </div>
        <div class="font-tech" id="font-tech-${esc(f.id)}" hidden>
          <div class="font-tech-row"><span>Nom CSS</span><b>${esc(f.family || "—")}</b></div>
          <div class="font-tech-row"><span>Fichier source</span>
            <span class="font-tech-acts">
              <button class="btn text" data-font-copy="${esc(f.id)}">Copier le lien</button>
              <button class="btn text" data-font-open="${esc(f.id)}">Ouvrir ↗</button>
            </span>
          </div>
        </div>
      </div>`;
    }).join("");

    list.querySelectorAll("[data-font-edit]").forEach((b) => b.onclick = () =>
      openFontModal(FONTS.find((f) => f.id === b.getAttribute("data-font-edit"))));
    list.querySelectorAll("[data-font-toggle]").forEach((b) => b.onclick = () => toggleFont(b.getAttribute("data-font-toggle")));
    list.querySelectorAll("[data-font-del]").forEach((b) => b.onclick = () => {
      const f = FONTS.find((x) => x.id === b.getAttribute("data-font-del"));
      deleteFont(b.getAttribute("data-font-del"), f ? f.name : "");
    });
    list.querySelectorAll("[data-font-tech]").forEach((b) => b.onclick = () => {
      const panel = $("font-tech-" + b.getAttribute("data-font-tech"));
      if (panel) panel.hidden = !panel.hidden;
    });
    list.querySelectorAll("[data-font-copy]").forEach((b) => b.onclick = async () => {
      const f = FONTS.find((x) => x.id === b.getAttribute("data-font-copy"));
      if (!f) return;
      try { await navigator.clipboard.writeText(f.url); showToast("Lien copié."); }
      catch { showToast("Impossible de copier le lien.", "err"); }
    });
    list.querySelectorAll("[data-font-open]").forEach((b) => b.onclick = () => {
      const f = FONTS.find((x) => x.id === b.getAttribute("data-font-open"));
      if (f) window.open(f.url, "_blank", "noopener");
    });
  }

  const fontSearchEl = $("fontSearch");
  if (fontSearchEl) fontSearchEl.oninput = () => renderFonts();

  async function toggleFont(id) {
    const f = FONTS.find((x) => x.id === id);
    if (!f) return;
    const currentlyEnabled = f.enabled !== false;
    try {
      await api("fonts", { action: "save", font: { id, name: f.name, family: f.family, url: f.url, publicId: f.publicId, level: f.level, enabled: !currentlyEnabled } });
      showToast(!currentlyEnabled ? "Police activée." : "Police désactivée.");
      loadFonts();
    } catch (e) { showToast(e.message, "err"); }
  }

  async function deleteFont(id, name) {
    if (!(await uiConfirm({ title: "Supprimer la police", danger: true, icon: "trash", confirmText: "Supprimer",
      message: `Supprimer la police « ${name} » ?\nUne copie part dans la corbeille.` }))) return;
    try {
      await api("fonts", { action: "delete", id });
      showToast("Police supprimée.");
      loadFonts();
    } catch (e) { showToast(e.message, "err"); }
  }

  // ── Modale d'ajout / modification ──────────────────────────────────────
  let modalFile = null;      // fichier choisi (ajout, ou remplacement en modification)
  let modalPreviewUrl = null;
  let modalPreviewFamily = null;

  function clearModalPreview() {
    if (modalPreviewUrl) { URL.revokeObjectURL(modalPreviewUrl); modalPreviewUrl = null; }
    const st = document.getElementById("font-modal-preview-style");
    if (st) st.remove();
    modalPreviewFamily = null;
  }

  function accessOptionsHtml(selected) {
    const opts = FONT_LEVELS.slice();
    // Valeur héritée qui ne correspond à aucun palier standard (fiche créée
    // avant l'introduction des paliers fixes) — on l'ajoute telle quelle
    // plutôt que de la remplacer silencieusement au premier enregistrement.
    if (selected != null && !opts.some((o) => o.level === Number(selected))) {
      opts.push({ level: Number(selected), label: fontAccessShort(selected) + " (valeur actuelle)" });
    }
    return opts.map((o) => `<option value="${o.level}" ${Number(selected) === o.level ? "selected" : ""}>${esc(o.label)}</option>`).join("");
  }

  window.openFontModal = function (existing) {
    modalFile = null;
    clearModalPreview();
    const isEdit = !!existing;

    $("bigcard").innerHTML = `
      <div class="bighead"><h3>${isEdit ? "Modifier la police" : "Ajouter une police"}</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button></div>

      <label class="field-lg"><span>Nom</span>
        <input type="text" id="fmName" placeholder="ex. Amiri, Aref Ruqaa…" autocomplete="off" value="${isEdit ? esc(existing.name) : ""}"></label>

      <label class="field-lg"><span>Fichier${isEdit ? " (laisser vide pour conserver l'actuel)" : ""}</span></label>
      <div id="fmUploadZone"></div>

      <label class="field-lg"><span>Aperçu</span>
        <input type="text" id="fmPreviewText" value="بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ" dir="rtl" placeholder="Texte d'essai…"></label>
      <div class="font-card-sample" id="fmPreviewSample" dir="rtl" style="${isEdit && existing.family ? `font-family:'${existing.family}', 'Alkalami', serif` : ""}">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>

      <label class="field-lg" style="margin-top:14px"><span>Accès minimum</span>
        <select id="fmLevel">${accessOptionsHtml(isEdit ? existing.level : 45000)}</select></label>

      <label class="switch-row" style="margin:16px 0 6px">
        <span class="switch"><input type="checkbox" id="fmEnabled" ${!isEdit || existing.enabled !== false ? "checked" : ""}><span></span></span>
        <span>Disponible dans Al-Qalam</span>
      </label>

      <p id="fmMsg" class="msg"></p>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px">
        <button id="fmCancel" class="btn text">Annuler</button>
        <button id="btnSaveFont" class="btn primary" data-icon="check">${isEdit ? "Enregistrer" : "Ajouter la police"}</button>
      </div>`;
    $("big").hidden = false;

    renderUploadZone();

    const closeModal = () => { $("big").hidden = true; clearModalPreview(); };
    $("btnCancelBig").onclick = closeModal;
    $("fmCancel").onclick = closeModal;

    const previewText = $("fmPreviewText");
    if (previewText) previewText.oninput = () => {
      const sample = $("fmPreviewSample");
      if (sample) sample.textContent = previewText.value || " ";
    };

    $("btnSaveFont").onclick = async () => {
      const btn = $("btnSaveFont");
      const name = ($("fmName").value || "").trim();
      const level = parseInt($("fmLevel").value, 10);
      const enabled = $("fmEnabled").checked;
      const msg = $("fmMsg");

      if (!name) { showToast("Indiquez un nom de police.", "err"); return; }
      if (!isEdit && !modalFile) { showToast("Choisissez un fichier de police.", "err"); return; }

      btn.disabled = true;
      try {
        let url = isEdit ? existing.url : "", publicId = isEdit ? existing.publicId : "", family = isEdit ? existing.family : undefined;
        if (modalFile) {
          if (msg) msg.textContent = "Téléversement du fichier…";
          const up = await uploadToCloudinary(modalFile, "alqalam_fonts", modalFile.name, "raw");
          url = up.url; publicId = up.id;
          family = undefined; // laisse le serveur régénérer un nom CSS pour le nouveau fichier
        }
        if (msg) msg.textContent = "Enregistrement de la fiche…";
        await api("fonts", {
          action: "save",
          font: { id: isEdit ? existing.id : undefined, name, url, publicId, family, level: isNaN(level) ? 45000 : level, enabled }
        });
        showToast(isEdit ? "Police mise à jour." : "Police ajoutée à Al-Qalam.");
        closeModal();
        loadFonts();
      } catch (e) {
        showToast(e.message, "err");
        if (msg) msg.textContent = "";
      } finally { btn.disabled = false; }
    };
  };

  // Zone d'import personnalisée — remplace l'input[type=file] natif par une
  // zone cliquable, puis une « puce » fichier une fois la sélection faite.
  function renderUploadZone() {
    const zone = $("fmUploadZone");
    if (!zone) return;
    zone.innerHTML = `
      <div class="upload-drop" id="fmDropzone">
        ${ic("upload")}
        <b>Sélectionner une police</b>
        <span>TTF · OTF · WOFF · WOFF2 — maximum 5 Mo</span>
      </div>
      <input type="file" id="fmFileInput" accept=".ttf,.otf,.woff,.woff2" hidden>`;
    const openPicker = () => $("fmFileInput").click();
    $("fmDropzone").onclick = openPicker;

    $("fmFileInput").onchange = () => {
      const file = $("fmFileInput").files[0];
      if (!file) return;
      if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) { showToast("Format non supporté (.ttf, .otf, .woff, .woff2).", "err"); return; }
      if (file.size > MAX_FONT_BYTES) { showToast("Fichier trop volumineux (5 Mo maximum).", "err"); return; }
      modalFile = file;
      showFileChip(file.name, fmtBytes(file.size));
      applyModalPreview(file);
    };
  }

  function showFileChip(name, size) {
    const zone = $("fmUploadZone");
    if (!zone) return;
    zone.innerHTML = `
      <div class="upload-chip">
        <div class="font-avatar">${esc(monogram(name))}</div>
        <div class="upload-chip-meta"><b>${esc(name)}</b><span>${esc(size)}</span></div>
        <button type="button" class="upload-chip-rm" id="fmFileRemove" title="Retirer">${ic("close") || "×"}</button>
      </div>`;
    $("fmFileRemove").onclick = () => {
      modalFile = null;
      clearModalPreview();
      const sample = $("fmPreviewSample");
      if (sample) sample.style.fontFamily = "";
      renderUploadZone();
    };
  }

  function applyModalPreview(file) {
    clearModalPreview();
    modalPreviewUrl = URL.createObjectURL(file);
    modalPreviewFamily = "AlqalamFontPreview_" + Date.now().toString(36);
    const style = document.createElement("style");
    style.id = "font-modal-preview-style";
    style.textContent = `@font-face { font-family: '${modalPreviewFamily}'; src: url('${modalPreviewUrl}'); }`;
    document.head.appendChild(style);
    const sample = $("fmPreviewSample");
    if (sample) sample.style.fontFamily = `'${modalPreviewFamily}', 'Alkalami', serif`;
  }

  const btnOpenAdd = $("btnOpenAddFont");
  if (btnOpenAdd) btnOpenAdd.onclick = () => openFontModal(null);
})();
