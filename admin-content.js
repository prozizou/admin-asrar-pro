// admin-content.js — Gestion des bibliothèques, grille, sélection multiple, éditeur et document Almaqtab.

(function () {
  "use strict";

  // ── Chargement des nœuds (bibliothèques) ──
  window.loadNodesMenu = async function () {
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
  };

  window.selectNode = function (node, title) {
    CURRENT_NODE = node;
    $("currentNodeTitle").textContent = title;
    $("contentActions").style.display = "flex";
    exitSelectMode();
    $("tab-content").classList.add("show-grid");
    $("btnBackNodes").hidden = false;

    const btnDoc = $("btnAddDocument");
    if (btnDoc) {
      btnDoc.hidden = (node !== 'almaqtab');
      btnDoc.onclick = openDocumentCreator;
    }
    const btnForm = $("btnAddFormation");
    if (btnForm) {
      btnForm.hidden = (node !== 'formations');
      btnForm.onclick = openFormationCreator;
    }

    loadGrid();
  };
  $("btnBackNodes").onclick = () => $("tab-content").classList.remove("show-grid");

  // ── Grille paginée ──
  const PAGE = 50;
  let ITEMS = [], shown = 0, selectMode = false;
  const selected = new Set();

  window.loadGrid = async function () {
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
  };

  window.cardHtml = (k, v) => {
    const img = cardImg(v), desc = cardDesc(v);
    // Lien partageable (/s du hub) si le nœud correspond à un type partageable.
    const shareable = !!shareKindOf(CURRENT_NODE);
    return `<div class="card clickable ${selected.has(k) ? "sel" : ""}" data-key="${esc(k)}">
      ${selectMode ? `<label class="card-check"><input type="checkbox" data-chk ${selected.has(k) ? "checked" : ""}></label>` : ""}
      ${shareable ? `<button class="card-share" data-share="${esc(k)}" title="Copier le lien partageable">${ic("share")}</button>` : ""}
      <div class="thumb">${img ? `<img src="${esc(img)}" alt="">` : `<div class="noimg">Aucun Média</div>`}</div>
      <div class="card-body">
        <div class="card-title">${esc(cardTitle(v, k))}</div>
        <p class="muted">${esc(desc).slice(0, 95)}${desc.length > 95 ? "…" : ""}</p>
      </div>
    </div>`;
  };

  window.renderMore = function () {
    const next = ITEMS.slice(shown, shown + PAGE);
    $("cardsGrid").insertAdjacentHTML("beforeend", next.map(([k, v]) => cardHtml(k, v)).join(""));
    shown += next.length;
    $("btnMoreItems").hidden = shown >= ITEMS.length;
    $("btnMoreItems").textContent = "Afficher 50 de plus (" + (ITEMS.length - shown) + " restants)";
    wireCards();
  };
  $("btnMoreItems").onclick = renderMore;

  window.rerender = function () {
    const count = Math.max(shown, PAGE);
    $("cardsGrid").innerHTML = "";
    const slice = ITEMS.slice(0, count);
    $("cardsGrid").innerHTML = slice.map(([k, v]) => cardHtml(k, v)).join("");
    shown = slice.length;
    $("btnMoreItems").hidden = shown >= ITEMS.length;
    $("btnMoreItems").textContent = "Afficher 50 de plus (" + (ITEMS.length - shown) + " restants)";
    wireCards();
  };

  window.wireCards = function () {
    document.querySelectorAll("#cardsGrid .card").forEach((c) => {
      const k = c.getAttribute("data-key");
      c.onclick = (e) => {
        if (selectMode) { if (!e.target.closest("[data-chk]")) toggleSel(k, c); }
        else openEditor(k);
      };
      const chk = c.querySelector("[data-chk]");
      if (chk) chk.onchange = () => toggleSel(k, c, chk.checked);
      const sh = c.querySelector("[data-share]");
      if (sh) sh.onclick = (e) => {
        e.stopPropagation(); // ne pas ouvrir l'éditeur
        const item = (ITEMS.find(([ik]) => ik === k) || [])[1];
        copyShareLink(CURRENT_NODE, k, cardTitle(item, k));
      };
    });
  };

  window.toggleSel = function (k, card, force) {
    const on = force != null ? force : !selected.has(k);
    if (on) selected.add(k); else selected.delete(k);
    card.classList.toggle("sel", on);
    const chk = card.querySelector("[data-chk]"); if (chk) chk.checked = on;
    updateBulk();
  };

  window.updateBulk = function () { const el = $("bulkCount"); if (el) el.textContent = selected.size + " sélectionné(s)"; };

  window.enterSelectMode = function () { selectMode = true; $("bulkBar").hidden = false; $("btnSelectMode").innerHTML = ic("close") + "Quitter"; rerender(); };
  window.exitSelectMode = function () { selectMode = false; selected.clear(); $("bulkBar").hidden = true; $("btnSelectMode").innerHTML = ic("select") + "Sélection"; if (ITEMS.length) rerender(); updateBulk(); };
  $("btnSelectMode").onclick = () => selectMode ? exitSelectMode() : enterSelectMode();

  window.fillBulkTarget = function () {
    $("bulkTarget").innerHTML = "<option value=''>Déplacer vers…</option>" +
      Object.entries(NODES_CACHE).filter(([k]) => k !== CURRENT_NODE)
        .map(([k, n]) => `<option value="${esc(k)}">${esc(n.label)}</option>`).join("");
  };

  $("bulkSelectAll").onclick = () => {
    const vis = ITEMS.slice(0, shown).map(([k]) => k);
    const allOn = vis.length && vis.every((k) => selected.has(k));
    vis.forEach((k) => allOn ? selected.delete(k) : selected.add(k));
    rerender(); updateBulk();
  };
  $("bulkCancel").onclick = exitSelectMode;
  $("bulkDelete").onclick = async () => {
    if (!selected.size) return showToast("Aucun élément sélectionné.", "err");
    if (!(await uiConfirm({ title: "Supprimer la sélection", danger: true, icon: "trash", confirmText: "Supprimer",
      message: "Supprimer " + selected.size + " élément(s) ?\nUne copie part dans la corbeille (récupérable)." }))) return;
    try { const r = await api("content", { action: "bulk_delete", node: CURRENT_NODE, keys: [...selected] });
      showToast(r.count + " élément(s) supprimé(s)."); exitSelectMode(); loadGrid(); }
    catch (e) { showToast(e.message, "err"); }
  };
  $("bulkMove").onclick = async () => {
    const target = $("bulkTarget").value;
    if (!target) return showToast("Choisissez d'abord un nœud cible.", "err");
    if (!selected.size) return showToast("Aucun élément sélectionné.", "err");
    if (!(await uiConfirm({ title: "Déplacer la sélection", icon: "content", confirmText: "Déplacer",
      message: "Déplacer " + selected.size + " élément(s) vers « " + (NODES_CACHE[target] || {}).label + " » ?" }))) return;
    try { const r = await api("content", { action: "move", node: CURRENT_NODE, targetNode: target, keys: [...selected] });
      showToast(r.count + " élément(s) déplacé(s)."); exitSelectMode(); loadGrid(); }
    catch (e) { showToast(e.message, "err"); }
  };

  // ── Éditeur principal ──
  window.openEditor = async function (key = null) {
    let original = null;
    let item = { title: "", faida: "", content: "", image: "", imageId: "" };
    if (key) {
      try {
        const d = await api("content", { action: "get", node: CURRENT_NODE, key });
        original = d.value;
      } catch (e) { return showToast(e.message, "err"); }
      if (!isObj(original)) return openPrimitiveEditor(key, original);
      item = original;
    }

    const extra = Object.entries(item).filter(([k]) => !CORE_FIELDS.includes(k) && k !== "createdAt");

    $("bigcard").innerHTML = `
      <div class="bighead">
        <h3>${key ? "Édition du document" : "Nouvel enregistrement"}</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button>
      </div>
      ${item.pdfUrl ? `<p class="muted">📄 PDF : <a href="${esc(item.pdfUrl)}" target="_blank">Télécharger</a></p>` : ''}
      <div class="bigimg">
        <div class="frame" id="previewImg">${(item.image || item.img) ? `<img src="${esc(item.image || item.img)}" alt="Aperçu">` : `<div class="noimg">Aucun média associé</div>`}</div>
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

    $("btnAddField").onclick = async () => {
      const name = ((await uiPrompt({ title: "Nouveau champ", placeholder: "ex. auteur, prix, lien" })) || "").trim();
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

        const out = {};
        const title = $("editTitle").value.trim();
        if (!title) throw new Error("Le champ « Titre » ne peut rester vide.");
        out.title = title;
        const faida = $("editFaida").value.trim();
        const content = $("editContent").value.trim();
        if (faida) out.faida = faida;
        if (content) out.content = content;
        if (item.image) { out.image = item.image; if (item.imageId) out.imageId = item.imageId; }

        document.querySelectorAll("#xfields .xfield[data-simple]").forEach((f) => {
          const k = f.getAttribute("data-fkey");
          const el = f.querySelector("[data-ftype]");
          if (k && el && !CORE_FIELDS.includes(k)) out[k] = coerceField(el);
        });
        for (const f of document.querySelectorAll("#xfields .xfield[data-complex]")) {
          const k = f.getAttribute("data-fkey");
          const ta = f.querySelector("[data-json]");
          if (!k || CORE_FIELDS.includes(k) || !ta) continue;
          try { out[k] = JSON.parse(ta.value); }
          catch (parseErr) { throw new Error("JSON invalide dans le champ « " + k + " » : " + parseErr.message); }
        }

        if (!key) out.createdAt = Date.now();
        else if (isObj(original) && original.createdAt != null) out.createdAt = original.createdAt;

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
        if (!(await uiConfirm({ title: "Envoyer à la corbeille", danger: true, icon: "trash", confirmText: "Supprimer",
          message: "Cette entrée sera archivée dans la corbeille (récupérable). Continuer ?" }))) return;
        try {
          await api("content", { action: "delete", node: CURRENT_NODE, key });
          $("big").hidden = true;
          showToast("Entrée archivée dans la corbeille.");
          loadGrid();
        } catch (e) { showToast(e.message, "err"); }
      };
    }
  };

  window.openPrimitiveEditor = function (key, val) {
    const wasNumber = typeof val === "number";
    $("bigcard").innerHTML = `
      <div class="bighead">
        <h3>Édition — valeur simple</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button>
      </div>
      <p class="muted" style="margin-bottom:10px">Cette fiche est une valeur ${wasNumber ? "numérique" : "texte"} brute (pas un objet). Elle sera réenregistrée telle quelle.</p>
      <label class="field-lg"><span>Valeur</span><textarea id="editRaw" rows="8">${esc(String(val ?? ""))}</textarea></label>
      <div style="display:flex; justify-content:space-between; margin-top:25px; gap:15px;">
        <button id="btnDeleteBig" class="btn danger">Supprimer</button>
        <button id="btnSaveBig" class="btn primary">Enregistrer</button>
      </div>`;
    $("big").hidden = false;
    $("btnCancelBig").onclick = closeBig;
    $("btnSaveBig").onclick = async () => {
      const btn = $("btnSaveBig"); btn.disabled = true; btn.textContent = "Enregistrement…";
      try {
        const raw = $("editRaw").value;
        const value = (wasNumber && raw.trim() !== "" && !isNaN(Number(raw))) ? Number(raw) : raw;
        await api("content", { action: "set", node: CURRENT_NODE, key, value });
        $("big").hidden = true; showToast("Valeur enregistrée."); loadGrid();
      } catch (e) { showToast(e.message, "err"); btn.disabled = false; btn.textContent = "Enregistrer"; }
    };
    $("btnDeleteBig").onclick = async () => {
      if (!(await uiConfirm({ title: "Envoyer à la corbeille", danger: true, icon: "trash", confirmText: "Supprimer",
        message: "Cette entrée sera archivée dans la corbeille (récupérable). Continuer ?" }))) return;
      try {
        await api("content", { action: "delete", node: CURRENT_NODE, key });
        $("big").hidden = true; showToast("Entrée archivée dans la corbeille."); loadGrid();
      } catch (e) { showToast(e.message, "err"); }
    };
  };

  window.closeBig = function () { $("big").hidden = true; };
  $("big").addEventListener("click", (e) => { if (e.target === $("big")) closeBig(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("big").hidden) closeBig(); });

  $("btnAddItem").onclick = () => openEditor(null);

  // ── Créateur de SECRET (choix parmi les 5 db_sirr) — schéma faida/sirr/img/key ──
  const SECRET_NODES = {
    db_sirr_deblocage: "Sirr — Déblocage",
    db_sirr_domptage:  "Sirr — Domptage",
    db_sirr_ilham:     "Sirr — Ilham",
    db_sirr_protection:"Sirr — Protection",
    db_sirr_ouverture: "Sirr — Ouverture"
  };
  window.openSecretCreator = function () {
    const opts = Object.entries(SECRET_NODES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
    $("bigcard").innerHTML = `
      <div class="bighead"><h3>Nouveau secret</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button></div>
      <label class="field-lg"><span>Destination</span>
        <select id="secNode" class="bulk-select" style="width:100%">${opts}</select></label>
      <div class="bigimg">
        <div class="frame" id="previewImg"><div class="noimg">Aucun média associé</div></div>
        <input type="file" id="fileField" accept="image/*" style="display:none">
        <button id="btnUpload" class="btn text">✨ Choisir une image</button>
      </div>
      <label class="field-lg"><span>Faïda (titre / résumé court)</span><input type="text" id="secFaida"></label>
      <label class="field-lg"><span>Sirr (contenu détaillé)</span><textarea id="secSirr" rows="9"></textarea></label>
      <div style="display:flex; justify-content:flex-end; margin-top:20px;"><button id="btnSaveBig" class="btn primary">Créer</button></div>`;
    $("big").hidden = false;
    let localFile = null;
    $("btnCancelBig").onclick = closeBig;
    $("btnUpload").onclick = () => $("fileField").click();
    $("fileField").onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      localFile = f;
      $("previewImg").innerHTML = `<img src="${URL.createObjectURL(f)}" alt="Aperçu local">`;
    };
    $("btnSaveBig").onclick = async () => {
      const btn = $("btnSaveBig"); btn.disabled = true; btn.textContent = "Création…";
      try {
        const node = $("secNode").value;
        const faida = $("secFaida").value.trim();
        const sirr = $("secSirr").value.trim();
        if (!faida) throw new Error("La faïda ne peut être vide.");
        const rec = { faida, sirr, createdAt: Date.now() };
        if (localFile) { const up = await uploadToCloudinary(localFile, node); rec.img = up.url; rec.imageId = up.id; }
        const added = await api("content", { action: "add", node, value: rec });
        rec.key = added.key; // clé auto-référencée comme le reste de l'app
        await api("content", { action: "set", node, key: added.key, value: rec });
        $("big").hidden = true;
        showToast("Secret créé dans « " + SECRET_NODES[node] + " ».");
        if (CURRENT_NODE === node) loadGrid();
      } catch (e) { showToast(e.message, "err"); btn.disabled = false; btn.textContent = "Créer"; }
    };
  };
  if ($("btnNewSecret")) $("btnNewSecret").onclick = openSecretCreator;

  // ── Créateur de document Almaqtab : couverture extraite EN LOCAL du PDF ──
  // Flux : on choisit le PDF → l'app en extrait la couverture (page 1) et l'envoie
  // sur Cloudinary. Le lien Google Drive est collé à la main (stocké dans pdfUrl).
  window.openDocumentCreator = async function () {
    $("bigcard").innerHTML = `
      <div class="bighead">
        <h3>Ajouter un document (Almaqtab)</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button>
      </div>
      <div class="bigimg">
        <div class="frame" id="previewImg"><div class="noimg">📔 Couverture (extraite du PDF)</div></div>
        <input type="file" id="pdfField" accept="application/pdf" style="display:none">
        <button id="btnPickPdf" class="btn text">📔 Choisir le PDF (couverture locale)</button>
        <p id="pdfStatus" class="muted" style="margin-top:6px"></p>
      </div>
      <label class="field-lg"><span>Lien Google Drive du PDF</span>
        <input type="url" id="docDriveUrl" placeholder="https://drive.google.com/file/d/…"></label>
      <label class="field-lg"><span>Titre</span><input type="text" id="docTitle"></label>
      <label class="field-lg"><span>Faïda (résumé)</span><textarea id="docFaida" rows="3"></textarea></label>
      <label class="field-lg"><span>Contenu</span><textarea id="docContent" rows="7"></textarea></label>
      <div style="display:flex; justify-content:flex-end; margin-top:20px;">
        <button id="btnSaveDocument" class="btn primary">Enregistrer</button>
      </div>`;
    $("big").hidden = false;
    let coverBlob = null, lastObjURL = null;

    $("btnCancelBig").onclick = closeBig;
    $("btnPickPdf").onclick = () => $("pdfField").click();
    $("pdfField").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      // Titre = nom du PDF sans « .pdf » → pré-remplissage + copie presse-papiers.
      const titleNoExt = f.name.replace(/\.pdf$/i, "").trim();
      if (!$("docTitle").value.trim()) $("docTitle").value = titleNoExt;
      try { await navigator.clipboard.writeText(titleNoExt); showToast("Titre copié : " + titleNoExt); }
      catch (_) { /* presse-papiers indisponible : on ignore silencieusement */ }
      $("pdfStatus").textContent = "Extraction de la couverture (page 1)…";
      try {
        coverBlob = await pdfCoverBlob(f);
        if (lastObjURL) URL.revokeObjectURL(lastObjURL);
        lastObjURL = URL.createObjectURL(coverBlob);
        $("previewImg").innerHTML = `<img src="${lastObjURL}" alt="Couverture">`;
        $("pdfStatus").textContent = "Couverture prête. Elle sera envoyée sur Cloudinary à l'enregistrement.";
      } catch (err) { coverBlob = null; $("pdfStatus").textContent = "Échec : " + err.message; }
    };

    $("btnSaveDocument").onclick = async () => {
      const btn = $("btnSaveDocument"); btn.disabled = true; btn.textContent = "Enregistrement…";
      try {
        const title = $("docTitle").value.trim();
        const faida = $("docFaida").value.trim();
        const content = $("docContent").value.trim();
        const lien = $("docDriveUrl").value.trim();
        if (!title) throw new Error("Le titre est requis.");
        if (!coverBlob) throw new Error("Choisissez d'abord le PDF pour générer la couverture.");
        if (!/^https?:\/\//i.test(lien)) throw new Error("Lien Google Drive invalide (doit commencer par http).");
        const up = await uploadToCloudinary(coverBlob, "almaqtab", "cover.jpg");
        const doc = { title, faida, content, image: up.url, imageId: up.id, pdfUrl: lien, createdAt: Date.now() };
        const added = await api("content", { action: "add", node: "almaqtab", value: doc });
        doc.key = added.key;
        await api("content", { action: "set", node: "almaqtab", key: added.key, value: doc });
        // Nettoyage local : on libère le fichier choisi pour ne pas le ré-uploader.
        coverBlob = null;
        if (lastObjURL) { URL.revokeObjectURL(lastObjURL); lastObjURL = null; }
        const pf = $("pdfField"); if (pf) pf.value = "";
        $("big").hidden = true;
        showToast("Document ajouté à Almaqtab.");
        if (CURRENT_NODE === "almaqtab") loadGrid();
      } catch (e) { showToast(e.message, "err"); btn.disabled = false; btn.textContent = "Enregistrer"; }
    };
  };

  // ── Créateur de FORMATION MYSTIQUE — schéma dédié (titre/description/
  // attentes/duree/prix/img/meetLink), distinct des CORE_FIELDS de l'éditeur
  // générique (title/faida/content/image) : voir le commentaire sur
  // NODES.formations dans api/content.js. Lien Google Meet SIMPLE (collé à
  // la main, créé au préalable sur meet.google.com) — pas d'intégration
  // Google Calendar API. Si laissé vide, l'app ouvre meet.google.com/new au
  // moment de rejoindre (repli côté app/formation/page.tsx, asrar-main).
  window.openFormationCreator = function () {
    $("bigcard").innerHTML = `
      <div class="bighead"><h3>Nouvelle formation</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button></div>
      <div class="bigimg">
        <div class="frame" id="previewImg"><div class="noimg">Logo / affiche de la formation</div></div>
        <input type="file" id="fileField" accept="image/*" style="display:none">
        <button id="btnUpload" class="btn text">✨ Choisir une image</button>
      </div>
      <label class="field-lg"><span>Titre</span><input type="text" id="fmTitre"></label>
      <label class="field-lg"><span>Lien Google Meet</span>
        <input type="url" id="fmMeetLink" placeholder="https://meet.google.com/xxx-xxxx-xxx"></label>
      <p class="muted" style="margin:-6px 0 4px">Créez le lien à l'avance sur meet.google.com, puis collez-le ici. Laissé vide, l'app ouvrira un nouveau Meet à la volée.</p>
      <label class="field-lg"><span>Description</span><textarea id="fmDescription" rows="5"></textarea></label>
      <label class="field-lg"><span>Ce que ça apporte (attentes)</span><textarea id="fmAttentes" rows="4"></textarea></label>
      <label class="field-lg"><span>Durée</span><input type="text" id="fmDuree" placeholder="ex. 4 semaines"></label>
      <label class="field-lg"><span>Prix (FCFA, 0 si non affiché)</span><input type="text" inputmode="decimal" id="fmPrix" placeholder="15000"></label>
      <div style="display:flex; justify-content:flex-end; margin-top:20px;"><button id="btnSaveBig" class="btn primary">Créer</button></div>`;
    $("big").hidden = false;
    let localFile = null;
    $("btnCancelBig").onclick = closeBig;
    $("btnUpload").onclick = () => $("fileField").click();
    $("fileField").onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      localFile = f;
      $("previewImg").innerHTML = `<img src="${URL.createObjectURL(f)}" alt="Aperçu local">`;
    };
    $("btnSaveBig").onclick = async () => {
      const btn = $("btnSaveBig"); btn.disabled = true; btn.textContent = "Création…";
      try {
        const titre = $("fmTitre").value.trim();
        if (!titre) throw new Error("Le titre ne peut être vide.");
        const meetLink = $("fmMeetLink").value.trim();
        if (meetLink && !/^https?:\/\//i.test(meetLink)) throw new Error("Lien Meet invalide (doit commencer par http:// ou https://).");
        const prixNum = Number(($("fmPrix").value || "").replace(/[^\d.]/g, ""));
        const rec = {
          titre,
          description: $("fmDescription").value.trim(),
          attentes: $("fmAttentes").value.trim(),
          duree: $("fmDuree").value.trim(),
          prix: isNaN(prixNum) ? 0 : prixNum,
          meetLink,
          createdAt: Date.now()
        };
        if (localFile) { const up = await uploadToCloudinary(localFile, "formations"); rec.img = up.url; rec.imageId = up.id; }
        const added = await api("content", { action: "add", node: "formations", value: rec });
        rec.key = added.key; // clé auto-référencée comme le reste de l'app
        await api("content", { action: "set", node: "formations", key: added.key, value: rec });
        $("big").hidden = true;
        showToast("Formation créée.");
        if (CURRENT_NODE === "formations") loadGrid();
      } catch (e) { showToast(e.message, "err"); btn.disabled = false; btn.textContent = "Créer"; }
    };
  };

})();
