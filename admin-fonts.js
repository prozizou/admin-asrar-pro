// admin-fonts.js — Gestion des polices Al-Qalam (upload Cloudinary + fiche Firebase).

(function () {
  "use strict";

  const fmtLevel = (n) => (Number(n) || 0).toLocaleString("fr-FR") + " FCFA";

  window.loadFonts = async function () {
    const list = $("fontsList");
    if (!list) return;
    list.innerHTML = "<div class='empty'>Chargement des polices…</div>";
    try {
      const d = await api("fonts", { action: "list" });
      const fonts = d.fonts || [];
      if ($("fontCount")) $("fontCount").textContent = fonts.length ? `(${fonts.length})` : "";
      if (!fonts.length) { list.innerHTML = "<div class='empty'>Aucune police pour le moment.</div>"; return; }

      list.innerHTML = fonts.map((f) => `
        <div class="row">
          <div class="audit-meta">
            <span class="audit-action">${esc(f.name)}</span>
            <span class="audit-target">${f.enabled === false ? "⏸ inactive" : "● active"} · ${esc(fmtLevel(f.level))}</span>
          </div>
          <div class="audit-details muted">
            Famille CSS : <b>${esc(f.family || "—")}</b><br>
            <a href="${esc(f.url)}" target="_blank" rel="noopener" style="word-break:break-all">${esc(f.url)}</a>
          </div>
          <div class="acts">
            <button class="btn text" data-font-toggle="${esc(f.id)}" data-enabled="${f.enabled === false ? "0" : "1"}">
              ${f.enabled === false ? "Activer" : "Désactiver"}
            </button>
            <button class="btn danger" data-font-del="${esc(f.id)}" data-name="${esc(f.name)}">Supprimer</button>
          </div>
        </div>`).join("");

      list.querySelectorAll("[data-font-del]").forEach((b) => {
        b.onclick = () => deleteFont(b.getAttribute("data-font-del"), b.getAttribute("data-name"));
      });
      list.querySelectorAll("[data-font-toggle]").forEach((b) => {
        b.onclick = () => toggleFont(b.getAttribute("data-font-toggle"), b.getAttribute("data-enabled") === "1", fonts);
      });
    } catch (e) {
      list.innerHTML = `<div class='empty' style='color:var(--danger)'>Erreur : ${esc(e.message)}</div>`;
    }
  };

  async function toggleFont(id, currentlyEnabled, fonts) {
    const f = (fonts || []).find((x) => x.id === id);
    if (!f) return;
    try {
      await api("fonts", { action: "save", font: { id, name: f.name, family: f.family, url: f.url, publicId: f.publicId, level: f.level, enabled: !currentlyEnabled } });
      showToast(!currentlyEnabled ? "Police activée." : "Police désactivée.");
      loadFonts();
    } catch (e) { showToast(e.message, "err"); }
  }

  async function deleteFont(id, name) {
    if (!confirm(`Supprimer la police « ${name} » ?\nUne copie part dans la corbeille (trash/).`)) return;
    try {
      await api("fonts", { action: "delete", id });
      showToast("Police supprimée.");
      loadFonts();
    } catch (e) { showToast(e.message, "err"); }
  }

  // ── Aperçu local de la police (avant tout upload) ──
  let previewUrl = null;      // ObjectURL du fichier en cours d'aperçu
  let previewFamily = null;   // @font-face injectée pour l'aperçu

  function clearPreview() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    const st = document.getElementById("font-preview-style");
    if (st) st.remove();
    const wrap = $("fontPreviewWrap");
    if (wrap) wrap.hidden = true;
  }

  const fileInput = $("fontFile");
  if (fileInput) {
    fileInput.onchange = () => {
      clearPreview();
      const file = fileInput.files[0];
      if (!file) return;
      if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) return;

      previewUrl = URL.createObjectURL(file);
      previewFamily = "AlqalamFontPreview_" + Date.now().toString(36);
      const style = document.createElement("style");
      style.id = "font-preview-style";
      style.textContent =
        `@font-face { font-family: '${previewFamily}'; src: url('${previewUrl}'); }`;
      document.head.appendChild(style);

      const sample = $("fontPreviewSample");
      if (sample) sample.style.fontFamily = `'${previewFamily}', 'Alkalami', serif`;
      const wrap = $("fontPreviewWrap");
      if (wrap) wrap.hidden = false;
    };
  }

  const previewText = $("fontPreviewText");
  if (previewText) {
    previewText.oninput = () => {
      const sample = $("fontPreviewSample");
      if (sample) sample.textContent = previewText.value || " ";
    };
  }

  // ── Ajout d'une police ──
  const btnAdd = $("btnAddFont");
  if (btnAdd) {
    btnAdd.onclick = async () => {
      const name = ($("fontName").value || "").trim();
      const file = $("fontFile").files[0];
      const level = parseInt($("fontLevel").value, 10);
      const enabled = $("fontEnabled").checked;
      const msg = $("fontMsg");

      if (!name) { showToast("Indiquez un nom de police.", "err"); return; }
      if (!file) { showToast("Choisissez un fichier de police.", "err"); return; }
      const okExt = /\.(ttf|otf|woff2?|)$/i.test(file.name);
      if (!okExt) { showToast("Format non supporté (.ttf, .otf, .woff, .woff2).", "err"); return; }

      btnAdd.disabled = true;
      if (msg) msg.textContent = "Téléversement du fichier…";
      try {
        // Upload RAW (police) vers Cloudinary via la signature admin existante.
        const up = await uploadToCloudinary(file, "alqalam_fonts", file.name, "raw");
        if (msg) msg.textContent = "Enregistrement de la fiche…";
        await api("fonts", {
          action: "save",
          font: { name, url: up.url, publicId: up.id, level: isNaN(level) ? 45000 : level, enabled }
        });
        showToast("Police ajoutée à Al-Qalam.");
        $("fontName").value = "";
        $("fontFile").value = "";
        $("fontLevel").value = "45000";
        $("fontEnabled").checked = true;
        clearPreview();
        if (msg) msg.textContent = "";
        loadFonts();
      } catch (e) {
        showToast(e.message, "err");
        if (msg) msg.textContent = "";
      } finally {
        btnAdd.disabled = false;
      }
    };
  }
})();
