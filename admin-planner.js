// admin-planner.js — Planificateur de contenu Facebook.
// Prépare textes + variantes à l'avance pour les groupes cibles, les organise par
// jour, et laisse l'admin publier lui-même (aucun appel réseau vers Facebook ici).

(function () {
  "use strict";

  const CATS = { secret: "Secret", document: "Document", produit: "Produit", autre: "Autre" };
  let PLN_GROUPS = [], PLN_ITEMS = [], PLN_SETTINGS = {}, PLN_ENTRIES = {};

  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const addDays = (dateStr, n) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  };
  const itemById = (iid) => PLN_ITEMS.find((i) => i.iid === iid);
  const groupById = (gid) => PLN_GROUPS.find((g) => g.gid === gid);

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Texte copié — collez-le dans le groupe Facebook.");
    } catch (e) {
      await uiPrompt({ title: "Copiez le texte", icon: "copy", default: text, confirmText: "OK", cancelText: "Fermer" });
    }
  }

  // ── Chargement initial ──
  window.loadPlanner = async function () {
    const dateInput = $("plnDate");
    if (dateInput && !dateInput.value) dateInput.value = todayStr();
    try {
      const d = await api("planner", { action: "bootstrap" });
      PLN_GROUPS = d.groups || []; PLN_ITEMS = d.items || []; PLN_SETTINGS = d.settings || {};
      $("plnGroupCount").textContent = "(" + PLN_GROUPS.length + ")";
      $("plnItemCount").textContent = "(" + PLN_ITEMS.length + ")";
      $("plnReminderTime").value = PLN_SETTINGS.reminderTime || "";
      renderGroups();
      renderItems();
      fillHistorySelects();
      await loadScheduleDay(dateInput.value);
      if (!$("plnHistFrom").value) { $("plnHistFrom").value = addDays(todayStr(), -30); $("plnHistTo").value = todayStr(); }
      loadHistory();
    } catch (e) {
      showToast(e.message, "err");
    }
  };

  // ── Checklist du jour ──
  async function loadScheduleDay(date) {
    const box = $("plnChecklist");
    box.innerHTML = skeleton("list", 4);
    try {
      const d = await api("planner", { action: "schedule_day", date });
      PLN_ENTRIES = d.entries || {};
      renderChecklist(date);
      checkReminder(date);
    } catch (e) {
      box.innerHTML = "<div class='empty'>" + esc(e.message) + "</div>";
    }
  }

  function renderChecklist(date) {
    const groups = PLN_GROUPS.filter((g) => g.active !== false);
    let published = 0, pending = 0, unassigned = 0;
    const itemOptions = PLN_ITEMS.filter((i) => !i.archived)
      .map((i) => `<option value="${esc(i.iid)}">${esc(i.title)} (${esc(CATS[i.category] || i.category)})</option>`).join("");

    const groupLink = (g) => g.url
      ? `<a href="${esc(g.url)}" target="_blank" rel="noopener" class="pln-gl" title="Ouvrir le groupe Facebook">${ic("open")}</a>` : "";

    const rows = groups.map((g) => {
      const entry = PLN_ENTRIES[g.gid];
      if (!entry) {
        unassigned++;
        return `<div class="row">
          <div><b>${esc(g.name)}</b> ${groupLink(g)} <span class="badge expired">Non assigné</span></div>
          <div class="acts">
            <select class="pln-pick" data-grp="${esc(g.gid)}"><option value="">Assigner un contenu…</option>${itemOptions}</select>
          </div>
        </div>`;
      }
      if (entry.status === "published") published++; else pending++;
      const badge = entry.status === "published"
        ? `<span class="badge ok">Publié</span>` : `<span class="badge gold">À publier</span>`;
      return `<div class="row">
        <div style="flex:1;min-width:220px">
          <b>${esc(g.name)}</b> ${groupLink(g)} ${badge} <span class="muted">· ${esc(entry.itemTitle || "")}</span>
          <div class="pln-text">${esc(entry.text)}</div>
          ${entry.publishedAt ? `<div class="muted">Publié le ${esc(when(entry.publishedAt))} par ${esc(entry.publishedBy || "")}</div>` : ""}
        </div>
        <div class="acts">
          <button class="btn text" data-pln-copy="${esc(g.gid)}">${ic(g.url ? "open" : "copy")}${g.url ? "Copier &amp; ouvrir le groupe" : "Copier"}</button>
          ${entry.status === "published"
            ? `<button class="btn text" data-pln-unpublish="${esc(g.gid)}">↺ Repasser à faire</button>`
            : `<button class="btn text success-text" data-pln-publish="${esc(g.gid)}" data-icon="check">Publié</button>`}
          <button class="btn text" data-pln-regen="${esc(g.gid)}">Changer</button>
          <button class="btn text danger-text" data-pln-unassign="${esc(g.gid)}">Retirer</button>
        </div>
      </div>`;
    }).join("");

    $("plnChecklist").innerHTML = rows || "<div class='empty'>Aucun groupe actif. Ajoutez vos groupes cibles ci-dessous.</div>";
    applyIcons($("plnChecklist"));
    $("plnKpis").innerHTML =
      `<div class="kpi"><div class="kpi-val">${groups.length}</div><div class="kpi-lbl">Groupes actifs</div></div>` +
      `<div class="kpi"><div class="kpi-val">${published}</div><div class="kpi-lbl">Publiés</div></div>` +
      `<div class="kpi"><div class="kpi-val">${pending}</div><div class="kpi-lbl">À publier</div></div>` +
      `<div class="kpi"><div class="kpi-val">${unassigned}</div><div class="kpi-lbl">Non assignés</div></div>`;

    wireChecklistActions(date);
  }

  function wireChecklistActions(date) {
    document.querySelectorAll(".pln-pick").forEach((sel) => {
      sel.onchange = async () => {
        const itemId = sel.value;
        if (!itemId) return;
        try { await api("planner", { action: "assign", date, gid: sel.dataset.grp, itemId }); loadScheduleDay(date); }
        catch (e) { showToast(e.message, "err"); }
      };
    });
    document.querySelectorAll("[data-pln-copy]").forEach((b) => b.onclick = async () => {
      const gid = b.getAttribute("data-pln-copy");
      const entry = PLN_ENTRIES[gid];
      if (!entry) return;
      await copyText(entry.text);
      const g = groupById(gid);
      // Redirige vers le groupe Facebook — le texte est déjà dans le presse-papiers,
      // il ne reste qu'à le coller dans le champ de publication du groupe.
      if (g && g.url) window.open(g.url, "_blank", "noopener");
    });
    document.querySelectorAll("[data-pln-publish]").forEach((b) => b.onclick = async () => {
      try { await api("planner", { action: "publish", date, gid: b.getAttribute("data-pln-publish") }); loadScheduleDay(date); }
      catch (e) { showToast(e.message, "err"); }
    });
    document.querySelectorAll("[data-pln-unpublish]").forEach((b) => b.onclick = async () => {
      try { await api("planner", { action: "unpublish", date, gid: b.getAttribute("data-pln-unpublish") }); loadScheduleDay(date); }
      catch (e) { showToast(e.message, "err"); }
    });
    document.querySelectorAll("[data-pln-regen]").forEach((b) => b.onclick = async () => {
      const gid = b.getAttribute("data-pln-regen");
      const entry = PLN_ENTRIES[gid];
      if (!entry) return;
      const item = itemById(entry.itemId);
      if (item && item.variants.length <= 1) return showToast("Une seule variante existe pour ce contenu — éditez-le pour en ajouter.", "err");
      try { await api("planner", { action: "assign", date, gid, itemId: entry.itemId, regenerate: true }); loadScheduleDay(date); showToast("Nouvelle variante affectée."); }
      catch (e) { showToast(e.message, "err"); }
    });
    document.querySelectorAll("[data-pln-unassign]").forEach((b) => b.onclick = async () => {
      const gid = b.getAttribute("data-pln-unassign");
      if (!(await uiConfirm({ title: "Retirer l'affectation", icon: "trash", confirmText: "Retirer", message: "Retirer le contenu prévu pour ce groupe ce jour-là ?" }))) return;
      try { await api("planner", { action: "unassign", date, gid }); loadScheduleDay(date); }
      catch (e) { showToast(e.message, "err"); }
    });
  }

  // ── Rappel (best-effort, client seulement — tant que l'onglet est ouvert) ──
  function checkReminder(date) {
    const bar = $("plnReminderBar");
    if (!bar) return;
    const time = PLN_SETTINGS.reminderTime;
    if (!time || date !== todayStr()) { bar.hidden = true; return; }
    const now = new Date();
    const nowHM = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    const remaining = Object.values(PLN_ENTRIES).filter((e) => e.status !== "published").length
      + PLN_GROUPS.filter((g) => g.active !== false && !PLN_ENTRIES[g.gid]).length;
    if (nowHM < time || remaining === 0) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.textContent = `⏰ Rappel ${time} — il reste ${remaining} groupe(s) à publier aujourd'hui.`;
    try {
      const key = "pln_notified_" + date;
      if (window.Notification && Notification.permission === "granted" && !sessionStorage.getItem(key)) {
        new Notification("Planificateur ASRAR PRO", { body: `${remaining} groupe(s) à publier aujourd'hui.` });
        sessionStorage.setItem(key, "1");
      }
    } catch (e) { /* notification best-effort seulement */ }
  }

  // ── Groupes cibles ──
  function renderGroups() {
    $("plnGroupsList").innerHTML = PLN_GROUPS.map((g) => `
      <div class="row">
        <div><b>${esc(g.name)}</b> ${g.active !== false ? `<span class="badge gold">Actif</span>` : `<span class="badge expired">Inactif</span>`}
          ${g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener" class="pln-gl" title="Ouvrir le groupe Facebook">${ic("open")}</a>` : `<span class="badge expired">Sans lien</span>`}
          ${g.notes ? `<div class="muted">${esc(g.notes)}</div>` : ""}</div>
        <div class="acts">
          <button class="btn text" data-grp-toggle="${esc(g.gid)}">${g.active !== false ? "Désactiver" : "Activer"}</button>
          <button class="btn text" data-grp-edit="${esc(g.gid)}" data-icon="edit">Éditer</button>
          <button class="btn text danger-text" data-grp-del="${esc(g.gid)}">Supprimer</button>
        </div>
      </div>`).join("") || "<div class='empty'>Aucun groupe. Ajoutez vos 10 groupes cibles, avec leur lien Facebook.</div>";
    applyIcons($("plnGroupsList"));

    document.querySelectorAll("[data-grp-toggle]").forEach((b) => b.onclick = async () => {
      const gid = b.getAttribute("data-grp-toggle");
      const g = groupById(gid);
      try { await api("planner", { action: "group_save", gid, name: g.name, url: g.url, notes: g.notes, order: g.order, active: !(g.active !== false) }); loadPlanner(); }
      catch (e) { showToast(e.message, "err"); }
    });
    document.querySelectorAll("[data-grp-edit]").forEach((b) => b.onclick = () => openGroupEditor(groupById(b.getAttribute("data-grp-edit"))));
    document.querySelectorAll("[data-grp-del]").forEach((b) => b.onclick = async () => {
      const gid = b.getAttribute("data-grp-del");
      if (!(await uiConfirm({ title: "Supprimer le groupe", danger: true, icon: "trash", confirmText: "Supprimer", message: "Supprimer ce groupe cible ? L'historique des jours passés est conservé." }))) return;
      try { await api("planner", { action: "group_delete", gid }); loadPlanner(); }
      catch (e) { showToast(e.message, "err"); }
    });
  }

  function openGroupEditor(group) {
    const name = group ? group.name : "";
    const url = group ? (group.url || "") : "";
    const notes = group ? (group.notes || "") : "";
    const active = !group || group.active !== false;
    $("bigcard").innerHTML = `
      <div class="bighead">
        <h3>${group ? "Éditer le groupe" : "Nouveau groupe Facebook"}</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button>
      </div>
      <label class="field-lg"><span>Nom du groupe</span><input type="text" id="plnGrpName" value="${esc(name)}"></label>
      <label class="field-lg"><span>Lien du groupe Facebook</span>
        <input type="url" id="plnGrpUrl" placeholder="https://www.facebook.com/groups/…" value="${esc(url)}"></label>
      <p class="muted" style="margin-top:-4px">Sert à vous rediriger directement vers le groupe au moment de coller le texte.</p>
      <label class="field-lg"><span>Notes (optionnel)</span><input type="text" id="plnGrpNotes" value="${esc(notes)}"></label>
      <label class="chk-lbl"><input type="checkbox" id="plnGrpActive" ${active ? "checked" : ""}> Groupe actif (apparaît dans la checklist quotidienne)</label>
      <div style="display:flex; justify-content:flex-end; margin-top:25px;">
        <button id="btnSaveGroup" class="btn primary">${group ? "Enregistrer" : "Ajouter le groupe"}</button>
      </div>`;
    $("big").hidden = false;
    $("btnCancelBig").onclick = closeBig;
    $("btnSaveGroup").onclick = async () => {
      const nameVal = $("plnGrpName").value.trim();
      const urlVal = $("plnGrpUrl").value.trim();
      if (!nameVal) return showToast("Nom du groupe requis.", "err");
      if (!urlVal) return showToast("Le lien du groupe Facebook est requis.", "err");
      if (!/^https:\/\//i.test(urlVal)) return showToast("Le lien doit commencer par https://", "err");
      try {
        await api("planner", {
          action: "group_save", gid: group ? group.gid : undefined,
          name: nameVal, url: urlVal, notes: $("plnGrpNotes").value.trim(),
          order: group ? group.order : undefined, active: $("plnGrpActive").checked
        });
        $("big").hidden = true;
        showToast(group ? "Groupe mis à jour." : "Groupe ajouté.");
        loadPlanner();
      } catch (e) { showToast(e.message, "err"); }
    };
  }

  const btnAddGroup = $("plnAddGroup");
  if (btnAddGroup) btnAddGroup.onclick = () => openGroupEditor(null);

  // ── Contenus & variantes ──
  function renderItems() {
    $("plnItemsGrid").innerHTML = PLN_ITEMS.map((it) => `
      <div class="card ${it.archived ? "blocked" : ""}">
        <div class="thumb">${it.image ? `<img src="${esc(it.image)}" alt="">` : `<div class="noimg">Aucun média</div>`}</div>
        <div class="card-body pln-item">
          <div class="row-head">
            <span class="card-title">${esc(it.title)}</span>
            <span class="badge gold">${esc(CATS[it.category] || it.category || "Autre")}</span>
          </div>
          <p class="muted">${it.variants.length} variante(s)${it.note ? " · " + esc(it.note) : ""}</p>
          <div class="acts">
            <button class="btn text" data-item-edit="${esc(it.iid)}" data-icon="edit">Éditer</button>
            <button class="btn text" data-item-plan="${esc(it.iid)}" data-icon="calendar">Générer un planning</button>
            <button class="btn text danger-text" data-item-del="${esc(it.iid)}">Supprimer</button>
          </div>
        </div>
      </div>`).join("") || "<div class='empty'>Aucun contenu. Créez votre premier secret / document / produit à promouvoir.</div>";
    applyIcons($("plnItemsGrid"));

    document.querySelectorAll("[data-item-edit]").forEach((b) => b.onclick = () => openItemEditor(itemById(b.getAttribute("data-item-edit"))));
    document.querySelectorAll("[data-item-plan]").forEach((b) => b.onclick = () => openBulkPlanner(itemById(b.getAttribute("data-item-plan"))));
    document.querySelectorAll("[data-item-del]").forEach((b) => b.onclick = async () => {
      const iid = b.getAttribute("data-item-del");
      if (!(await uiConfirm({ title: "Supprimer le contenu", danger: true, icon: "trash", confirmText: "Supprimer", message: "Supprimer ce contenu et ses variantes ? Les affectations déjà planifiées restent visibles dans l'historique." }))) return;
      try { await api("planner", { action: "item_delete", iid }); showToast("Contenu supprimé."); loadPlanner(); }
      catch (e) { showToast(e.message, "err"); }
    });
  }

  const btnAddItem = $("plnAddItem");
  if (btnAddItem) btnAddItem.onclick = () => openItemEditor(null);

  function variantRowHtml(v) {
    return `<div class="pln-variant-row" data-vid="${esc((v && v.vid) || "")}">
      <textarea rows="3" placeholder="Texte de la variante…">${esc((v && v.text) || "")}</textarea>
      <button type="button" class="btn text danger-text pln-var-rm">✕</button>
    </div>`;
  }

  function openItemEditor(item) {
    const variants = (item && item.variants && item.variants.length) ? item.variants : [null, null];
    $("bigcard").innerHTML = `
      <div class="bighead">
        <h3>${item ? "Éditer le contenu" : "Nouveau contenu"}</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button>
      </div>
      <label class="field-lg"><span>Titre</span><input type="text" id="plnItTitle" value="${esc(item ? item.title : "")}"></label>
      <label class="field-lg"><span>Catégorie</span>
        <select id="plnItCat">
          ${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${item && item.category === k ? "selected" : ""}>${v}</option>`).join("")}
        </select></label>
      <label class="field-lg"><span>Note interne (optionnel)</span><input type="text" id="plnItNote" value="${esc(item ? item.note || "" : "")}"></label>
      <div class="bigimg">
        <div class="frame" id="plnItImgPreview">
          ${item && item.image ? `<img src="${esc(item.image)}" alt="Aperçu">` : `<div class="noimg">Aucun visuel</div>`}
        </div>
        <input type="file" id="plnItImage" accept="image/*" style="display:none">
        <button type="button" id="btnPlnUpload" class="btn text">✨ Choisir un visuel (optionnel)</button>
      </div>
      <div class="field-lg">
        <span>Variantes de texte (rotation automatique par groupe)</span>
        <div id="plnVarList">${variants.map(variantRowHtml).join("")}</div>
        <button type="button" id="plnAddVariant" class="btn text" data-icon="add" style="margin-top:8px">Ajouter une variante</button>
      </div>
      <div style="display:flex; justify-content:flex-end; margin-top:25px;">
        <button id="btnSaveItem" class="btn primary">${item ? "Enregistrer" : "Créer le contenu"}</button>
      </div>`;
    $("big").hidden = false;
    applyIcons($("bigcard"));

    let imageUrl = item ? (item.image || "") : "", imageId = item ? (item.imageId || "") : "";
    $("btnCancelBig").onclick = closeBig;
    $("plnAddVariant").onclick = () => $("plnVarList").insertAdjacentHTML("beforeend", variantRowHtml(null));
    $("plnVarList").addEventListener("click", (e) => {
      const rm = e.target.closest(".pln-var-rm");
      if (!rm) return;
      const rows = $("plnVarList").querySelectorAll(".pln-variant-row");
      if (rows.length > 1) rm.closest(".pln-variant-row").remove();
      else showToast("Il faut au moins une variante.", "err");
    });
    $("btnPlnUpload").onclick = () => $("plnItImage").click();
    $("plnItImage").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      $("plnItImgPreview").innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Aperçu">`;
      try {
        const up = await uploadToCloudinary(file, "planner_items");
        imageUrl = up.url; imageId = up.id;
        showToast("Visuel envoyé.");
      } catch (err) { showToast(err.message, "err"); }
    };

    $("btnSaveItem").onclick = async () => {
      const title = $("plnItTitle").value.trim();
      if (!title) return showToast("Titre requis.", "err");
      const variantsOut = Array.from($("plnVarList").querySelectorAll(".pln-variant-row")).map((row) => ({
        vid: row.getAttribute("data-vid") || undefined,
        text: row.querySelector("textarea").value.trim()
      })).filter((v) => v.text);
      if (!variantsOut.length) return showToast("Au moins une variante de texte est requise.", "err");
      try {
        await api("planner", {
          action: "item_save", iid: item ? item.iid : undefined,
          title, category: $("plnItCat").value, note: $("plnItNote").value.trim(),
          image: imageUrl, imageId, variants: variantsOut, archived: item ? item.archived : false
        });
        $("big").hidden = true;
        showToast(item ? "Contenu mis à jour." : "Contenu créé.");
        loadPlanner();
      } catch (e) { showToast(e.message, "err"); }
    };
  }

  // ── Générer un planning (bulk_assign) ──
  function openBulkPlanner(preselectItem) {
    const activeGroups = PLN_GROUPS.filter((g) => g.active !== false);
    $("bigcard").innerHTML = `
      <div class="bighead">
        <h3>Générer un planning</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button>
      </div>
      <label class="field-lg"><span>Contenu à promouvoir</span>
        <select id="plnBulkItem">${PLN_ITEMS.filter((i) => !i.archived).map((i) =>
          `<option value="${esc(i.iid)}" ${preselectItem && preselectItem.iid === i.iid ? "selected" : ""}>${esc(i.title)}</option>`).join("")}</select></label>
      <label class="field-lg"><span>Du</span><input type="date" id="plnBulkFrom" value="${esc(todayStr())}"></label>
      <label class="field-lg"><span>Au</span><input type="date" id="plnBulkTo" value="${esc(addDays(todayStr(), 6))}"></label>
      <div class="field-lg">
        <span>Groupes ciblés</span>
        <div id="plnBulkGroups" style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto">
          ${activeGroups.map((g) => `<label class="chk-lbl"><input type="checkbox" value="${esc(g.gid)}" checked> ${esc(g.name)}</label>`).join("") || "<span class='muted'>Aucun groupe actif.</span>"}
        </div>
      </div>
      <label class="chk-lbl" style="margin-top:8px"><input type="checkbox" id="plnBulkOverwrite"> Remplacer les jours déjà planifiés</label>
      <p class="muted" style="margin-top:8px">Chaque groupe reçoit la variante la moins récemment utilisée pour lui — pas de texte identique répété.</p>
      <div style="display:flex; justify-content:flex-end; margin-top:25px;">
        <button id="btnRunBulk" class="btn primary">Générer</button>
      </div>`;
    $("big").hidden = false;
    $("btnCancelBig").onclick = closeBig;
    $("btnRunBulk").onclick = async () => {
      const itemId = $("plnBulkItem").value;
      const from = $("plnBulkFrom").value, to = $("plnBulkTo").value;
      const groupIds = Array.from($("plnBulkGroups").querySelectorAll("input:checked")).map((c) => c.value);
      if (!itemId || !from || !to || !groupIds.length) return showToast("Contenu, dates et au moins un groupe requis.", "err");
      const dates = [];
      for (let d = from; d <= to && dates.length <= 90; d = addDays(d, 1)) dates.push(d);
      try {
        const r = await api("planner", { action: "bulk_assign", itemId, groupIds, dates, overwrite: $("plnBulkOverwrite").checked });
        $("big").hidden = true;
        showToast(`${r.created} affectation(s) créée(s)${r.skipped ? ", " + r.skipped + " déjà planifiée(s) ignorée(s)" : ""}.`);
        loadScheduleDay($("plnDate").value);
        loadHistory();
      } catch (e) { showToast(e.message, "err"); }
    };
  }

  const btnGenerate = $("plnGenerate");
  if (btnGenerate) btnGenerate.onclick = () => openBulkPlanner(null);

  // ── Historique ──
  function fillHistorySelects() {
    const itemSel = $("plnHistItem"), grpSel = $("plnHistGroup");
    itemSel.innerHTML = `<option value="">Tous les contenus</option>` + PLN_ITEMS.map((i) => `<option value="${esc(i.iid)}">${esc(i.title)}</option>`).join("");
    grpSel.innerHTML = `<option value="">Tous les groupes</option>` + PLN_GROUPS.map((g) => `<option value="${esc(g.gid)}">${esc(g.name)}</option>`).join("");
  }

  window.loadHistory = async function () {
    const body = $("plnHistBody");
    body.innerHTML = `<tr><td colspan="5" class="empty">Chargement…</td></tr>`;
    try {
      const d = await api("planner", {
        action: "history", itemId: $("plnHistItem").value || undefined, gid: $("plnHistGroup").value || undefined,
        from: $("plnHistFrom").value, to: $("plnHistTo").value
      });
      body.innerHTML = (d.rows || []).map((r) => `
        <tr>
          <td>${esc(r.date)}</td>
          <td>${esc((groupById(r.gid) || {}).name || r.gid)}</td>
          <td>${esc(r.itemTitle || "")}</td>
          <td>${esc((r.text || "").slice(0, 60))}${(r.text || "").length > 60 ? "…" : ""}</td>
          <td>${r.status === "published" ? `<span class="badge ok">Publié</span>` : `<span class="badge gold">À publier</span>`}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="empty">Aucune affectation sur cette période.</td></tr>`;
    } catch (e) {
      body.innerHTML = `<tr><td colspan="5" class="empty">${esc(e.message)}</td></tr>`;
    }
  };
  const histLoad = $("plnHistLoad");
  if (histLoad) histLoad.onclick = loadHistory;

  // ── Navigation par jour + réglage du rappel ──
  const dateInput = $("plnDate");
  if (dateInput) dateInput.onchange = () => loadScheduleDay(dateInput.value);
  const prevDay = $("plnPrevDay");
  if (prevDay) prevDay.onclick = () => { dateInput.value = addDays(dateInput.value || todayStr(), -1); loadScheduleDay(dateInput.value); };
  const nextDay = $("plnNextDay");
  if (nextDay) nextDay.onclick = () => { dateInput.value = addDays(dateInput.value || todayStr(), 1); loadScheduleDay(dateInput.value); };
  const todayBtn = $("plnToday");
  if (todayBtn) todayBtn.onclick = () => { dateInput.value = todayStr(); loadScheduleDay(dateInput.value); };

  const saveReminder = $("plnSaveReminder");
  if (saveReminder) saveReminder.onclick = async () => {
    const reminderTime = $("plnReminderTime").value;
    try {
      await api("planner", { action: "settings_save", reminderTime: reminderTime || null });
      PLN_SETTINGS.reminderTime = reminderTime || null;
      showToast(reminderTime ? "Rappel réglé sur " + reminderTime + "." : "Rappel désactivé.");
      if (reminderTime && window.Notification && Notification.permission === "default") Notification.requestPermission();
      checkReminder(dateInput.value);
    } catch (e) { showToast(e.message, "err"); }
  };

})();
