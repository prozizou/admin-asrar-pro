// admin-stats.js — Statistiques, visites, analytique

(function () {
  "use strict";

  const nf = new Intl.NumberFormat("fr-FR");
  const fmt = (n) => nf.format(Math.round(Number(n) || 0));
  const fmtPct = (n) => nf.format(Math.abs(n)) + " %";

  const kpi = (val, lbl) => `<div class="kpi"><div class="kpi-val">${esc(val)}</div><div class="kpi-lbl">${esc(lbl)}</div></div>`;
  const hbars = (items, labelFn, subFn) => {
    if (!items || !items.length) return "<div class='empty'>Aucune donnée.</div>";
    const m = Math.max(1, ...items.map((i) => i.count));
    return items.map((i) => `<div class="hbar">
      <div class="hbar-lbl">${esc(labelFn(i))}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round(i.count / m * 100)}%"></div></div>
      <div class="hbar-n">${fmt(i.count)}${subFn ? " · " + esc(subFn(i)) : ""}</div></div>`).join("");
  };
  // Horodatage relatif court (« il y a 2 min ») — pour remplacer un gros
  // bouton « Actualiser » par une mention discrète + une icône.
  const relTime = (ms) => {
    if (!ms) return "";
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 10) return "à l'instant";
    if (s < 60) return "il y a " + s + " s";
    const m = Math.round(s / 60);
    if (m < 60) return "il y a " + m + " min";
    const h = Math.round(m / 60);
    if (h < 24) return "il y a " + h + " h";
    return "il y a " + Math.round(h / 24) + " j";
  };
  // Carte KPI compacte réutilisant le composant .stat du dashboard (icône,
  // valeur, libellé, puce de tendance) — même design system, pas un second
  // gabarit de carte pour cet onglet.
  const statTile = ({ icon, val, label, deltaPct, tone, span }) => `
    <div class="stat${span ? " span2" : ""}">
      <div class="stat-top">
        <span class="stat-ic ${tone || ""}">${ic(icon)}</span>
        ${deltaPct != null ? `<span class="stat-delta ${deltaPct > 0 ? "up" : deltaPct < 0 ? "down" : ""}">${ic("trend")}${deltaPct > 0 ? "+" : ""}${fmtPct(deltaPct)}</span>` : ""}
      </div>
      <div class="stat-val">${fmt(val)}</div>
      <div class="stat-lbl">${esc(label)}</div>
    </div>`;

  // ── Analytics ──
  let ANA = null, ANA_AT = 0, ANA_PERIOD = "d30", PAGES_EXPANDED = false;

  window.loadAnalytics = async function () {
    if ($("anaPages")) $("anaPages").innerHTML = "<div class='empty'>Chargement…</div>";
    try { ANA = await api("stats", { action: "analytics" }); ANA_AT = Date.now(); renderAnalytics(); }
    catch (e) { if ($("anaPages")) $("anaPages").innerHTML = "<div class='empty'>" + esc(e.message) + "</div>"; }
  };

  window.renderAnalytics = function () {
    if (!ANA) return;
    const per = (ANA.periods && ANA.periods[ANA_PERIOD]) || {};
    const t = ANA.totals || {};

    if ($("anaKpis")) $("anaKpis").innerHTML =
      statTile({ icon: "visits", val: per.unique ?? 0, label: "Visiteurs uniques", deltaPct: per.deltaUnique, tone: "gold" }) +
      statTile({ icon: "analytics", val: per.total ?? 0, label: "Visites totales", deltaPct: per.deltaTotal }) +
      statTile({ icon: "sparkle", val: per.interactions ?? 0, label: "Interactions" }) +
      statTile({ icon: "market", val: t.boutiques ?? 0, label: "Boutiques" }) +
      statTile({ icon: "gift", val: t.avisTotal ?? 0, label: "Avis boutiques", tone: "gold", span: true });

    renderAnaChart();
    renderAnaPages();
    renderAnaBoutiques();

    const upd = $("anaUpdated");
    if (upd) upd.textContent = ANA_AT ? "Mis à jour " + relTime(ANA_AT) : "";
  };

  // Sélecteur de période — change seulement l'affichage, aucune requête :
  // les 4 fenêtres (7/30/90 j, Tout) sont déjà dans la même réponse.
  const periodSeg = $("anaPeriodSeg");
  if (periodSeg) periodSeg.querySelectorAll("[data-period]").forEach((b) => b.onclick = () => {
    ANA_PERIOD = b.getAttribute("data-period");
    periodSeg.querySelectorAll("[data-period]").forEach((x) => x.classList.toggle("active", x === b));
    renderAnalytics();
  });

  // Graphique « Évolution du trafic » — 7 j → quotidien (déjà lisible) ;
  // 30/90 j → regroupé par semaine (window.chunkWeekly) au lieu d'aligner
  // 30-90 barres minuscules dans un conteneur qui débordait horizontalement
  // (scrollbar disgracieuse, barres quasi invisibles sur mobile) ; Tout →
  // résolution mensuelle (l'historique quotidien complet n'est pas renvoyé
  // par le serveur, borné à 90 j — inutile ici). Rendu via window.barChartHtml,
  // partagé avec Parrainage et le Dashboard (composant .rc-*, admin.css).
  function renderAnaChart() {
    const el = $("anaChart");
    if (!el || !ANA) return;
    const nDays = { d7: 7, d30: 30, d90: 90 }[ANA_PERIOD];
    let rows, xLabel;
    if (nDays) {
      const daily = (ANA.daily || []).slice(-nDays).map((r) => ({ bucket: r.bucket, total: r.total, unique: r.unique }));
      rows = nDays <= 7 ? daily : chunkWeekly(daily, ["total", "unique"]);
    } else {
      rows = (ANA.monthly || []).map((r) => ({ bucket: r.bucket, total: r.total, unique: r.unique }));
      // Bucket mensuel « YYYY-MM » (pas de jour) : frDate ne sait lire que
      // YYYY-MM-DD, d'où cet étiquetage dédié (« Juil. 2024 »).
      const MONTHS_FR_LONG = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
      xLabel = (r) => { const m = Number(String(r.bucket).slice(5, 7)); return (MONTHS_FR_LONG[m - 1] || r.bucket) + " " + r.bucket.slice(0, 4); };
    }
    el.innerHTML = barChartHtml(rows, {
      series: [
        { key: "total", color: "linear-gradient(180deg,var(--gold-2),var(--gold))", label: "Visites" },
        { key: "unique", cls: "uniq", color: "linear-gradient(180deg,#6fc3e0,#2d7ea8)", label: "Visiteurs uniques" }
      ],
      valueKey: "total",
      xLabel,
      tooltip: (r) => (xLabel ? xLabel(r) : frDate(r.bucket)) + " · " + fmt(r.total) + " visites · " + fmt(r.unique) + " uniques"
    });
  }

  // Pages populaires — normalisées côté serveur (accueil.html/accueil fusionnés,
  // « ? » → Page inconnue). Top 5 par défaut + bascule vers la liste complète.
  function renderAnaPages() {
    const el = $("anaPages");
    if (!el || !ANA) return;
    const all = ANA.topPages || [];
    const total = (ANA.totals && ANA.totals.pagesTotal) || all.reduce((s, i) => s + i.count, 0) || 1;
    const shown = PAGES_EXPANDED ? all : all.slice(0, 5);
    const pct = (i) => fmtPct(Math.round(i.count / total * 1000) / 10);
    el.innerHTML = hbars(shown, (i) => i.page, pct);
    const toggle = $("anaPagesToggle");
    if (toggle) {
      toggle.hidden = all.length <= 5;
      toggle.textContent = PAGES_EXPANDED ? "← Voir moins" : "Voir toutes les pages (" + all.length + ") →";
    }
  }
  const pagesToggleEl = $("anaPagesToggle");
  if (pagesToggleEl) pagesToggleEl.onclick = () => { PAGES_EXPANDED = !PAGES_EXPANDED; renderAnaPages(); };

  // Boutiques (profile_clients) — plus de nom de collection dans l'UI, métriques
  // en français, ligne cliquable → détail (produits, vues) dans une modale.
  function renderAnaBoutiques() {
    const el = $("anaBoutiques");
    if (!el || !ANA) return;
    const rows = ANA.boutiques || [];
    el.innerHTML = rows.map((b, idx) => `
      <div class="bq-row" data-bq="${idx}">
        ${b.img ? `<img src="${esc(b.img)}" alt="">` : `<div class="frame" style="width:48px;height:48px;flex:0 0 48px"><div class="noimg" style="font-size:.55rem">—</div></div>`}
        <div class="bq-meta">
          <div class="bq-name">${esc(b.name)}</div>
          <div class="bq-sub">${esc(b.number || "—")}</div>
          <div class="bq-stats">
            <span><b>${fmt(b.follow)}</b> abonnés</span>
            <span><b>${b.ratingsCount ? b.rating.toFixed(1) : "—"}</b> ★ ${b.ratingsCount ? "(" + fmt(b.ratingsCount) + ")" : ""}</span>
            <span><b>${fmt(b.views)}</b> visites</span>
            <span><b>${fmt(b.products)}</b> produits</span>
          </div>
        </div>
        <span class="bq-chevron">${ic("open")}</span>
      </div>`).join("") || "<div class='empty'>Aucune boutique.</div>";

    el.querySelectorAll("[data-bq]").forEach((row) => row.onclick = () => openBoutiqueDetail(rows[Number(row.getAttribute("data-bq"))]));
  }

  window.openBoutiqueDetail = function (b) {
    if (!b) return;
    $("bigcard").innerHTML = `
      <div class="bighead"><h3>${esc(b.name)}</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button></div>
      <div class="bigimg">
        <div class="frame" id="previewImg">${b.img ? `<img src="${esc(b.img)}" alt="">` : `<div class="noimg">Aucun logo</div>`}</div>
      </div>
      <div class="kpis" style="margin-bottom:18px">
        ${kpi(fmt(b.follow), "Abonnés")}${kpi(b.ratingsCount ? b.rating.toFixed(1) : "—", "Note")}${kpi(fmt(b.comments), "Avis")}${kpi(fmt(b.views), "Visites produits")}${kpi(fmt(b.products), "Produits")}
      </div>
      <p class="muted" style="margin-bottom:10px">${esc(b.number || "Aucun numéro renseigné")}</p>
      <h3 style="margin-bottom:10px">Produits</h3>
      <div class="list" id="bqProductList">
        ${(b.productList || []).map((p) => `
          <div class="row" data-prow="${esc(p.key)}">
            <div><b>${esc(p.name)}</b> <span class="muted">· ${fmt(p.price)} FCFA</span></div>
            <div style="display:flex; align-items:center; gap:10px">
              <span class="muted">${fmt(p.views)} visite(s)</span>
              <button class="btn text" data-prod-edit="${esc(p.key)}">Modifier</button>
              <button class="btn text danger-text" data-prod-del="${esc(p.key)}">Supprimer</button>
            </div>
          </div>`).join("") || "<div class='empty'>Aucun produit rattaché à cette boutique.</div>"}
      </div>`;
    $("big").hidden = false;
    $("btnCancelBig").onclick = () => { $("big").hidden = true; };

    $("bqProductList").querySelectorAll("[data-prod-del]").forEach((btn) => btn.onclick = async () => {
      const key = btn.getAttribute("data-prod-del");
      if (!(await uiConfirm({ title: "Supprimer le produit", danger: true, icon: "trash", confirmText: "Supprimer",
        message: "Supprimer ce produit ? Cette action est irréversible." }))) return;
      try {
        await api("market", { action: "product_delete", key });
        showToast("Produit supprimé.");
        const row = btn.closest("[data-prow]"); if (row) row.remove();
        ANA = null;
      } catch (e) { showToast(e.message, "err"); }
    });

    $("bqProductList").querySelectorAll("[data-prod-edit]").forEach((btn) => btn.onclick = async () => {
      const key = btn.getAttribute("data-prod-edit");
      const row = btn.closest("[data-prow]");
      if (!row) return;
      row.innerHTML = "<div class='empty'>Chargement…</div>";
      try {
        const r = await api("market", { action: "product_get", key });
        const p = r.value || {};
        row.innerHTML = `
          <div style="width:100%; display:flex; flex-direction:column; gap:8px">
            <label class="field-lg"><span>Nom du produit</span><input type="text" id="peName" value="${esc(p.produit || "")}"></label>
            <label class="field-lg"><span>Prix (FCFA)</span><input type="number" id="pePrix" value="${esc(p.Prix ?? 0)}"></label>
            <label class="field-lg"><span>Image (URL)</span><input type="text" id="peImage" value="${esc(p.Image || "")}"></label>
            <label class="field-lg"><span>Description</span><textarea id="peDesc" rows="3">${esc(p.description || "")}</textarea></label>
            <div style="display:flex; justify-content:flex-end; gap:8px">
              <button class="btn text" id="peCancel">Annuler</button>
              <button class="btn primary" id="peSave">Enregistrer</button>
            </div>
          </div>`;
        $("peCancel").onclick = () => openBoutiqueDetail(b);
        $("peSave").onclick = async () => {
          const saveBtn = $("peSave"); saveBtn.disabled = true; saveBtn.textContent = "Enregistrement…";
          try {
            await api("market", {
              action: "product_update", key,
              produit: $("peName").value, Prix: $("pePrix").value,
              Image: $("peImage").value, description: $("peDesc").value
            });
            showToast("Produit mis à jour.");
            ANA = null;
            openBoutiqueDetail(b);
          } catch (e) { showToast(e.message, "err"); saveBtn.disabled = false; saveBtn.textContent = "Enregistrer"; }
        };
      } catch (e) { showToast(e.message, "err"); openBoutiqueDetail(b); }
    });
  };

  if ($("btnReloadAnalytics")) $("btnReloadAnalytics").onclick = loadAnalytics;

  // ── Créateur de BOUTIQUE → profile_clients (img sur Cloudinary) ──
  window.openBoutiqueCreator = function () {
    $("bigcard").innerHTML = `
      <div class="bighead"><h3>Nouvelle boutique (profil)</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button></div>
      <div class="bigimg">
        <div class="frame" id="previewImg"><div class="noimg">Logo de la boutique</div></div>
        <input type="file" id="fileField" accept="image/*" style="display:none">
        <button id="btnUpload" class="btn text">✨ Choisir un logo</button>
      </div>
      <label class="field-lg"><span>Nom de la boutique</span><input type="text" id="bqName"></label>
      <label class="field-lg"><span>E-mail du propriétaire (pour gérer ses produits plus tard)</span>
        <input type="email" id="bqEmail" placeholder="proprietaire@gmail.com" autocomplete="off"></label>
      <label class="field-lg"><span>Numéro (WhatsApp / téléphone)</span><input type="text" id="bqNumber" placeholder="+221…"></label>
      <div style="display:flex; justify-content:flex-end; margin-top:20px;"><button id="btnSaveBig" class="btn primary">Créer la boutique</button></div>`;
    $("big").hidden = false;
    let localFile = null;
    $("btnCancelBig").onclick = closeBig;
    $("btnUpload").onclick = () => $("fileField").click();
    $("fileField").onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      localFile = f;
      $("previewImg").innerHTML = `<img src="${URL.createObjectURL(f)}" alt="Logo">`;
    };
    $("btnSaveBig").onclick = async () => {
      const btn = $("btnSaveBig"); btn.disabled = true; btn.textContent = "Création…";
      try {
        const name = $("bqName").value.trim();
        const email = ($("bqEmail").value || "").trim().toLowerCase();
        const number = $("bqNumber").value.trim();
        if (!name) throw new Error("Le nom de la boutique est requis.");
        if (!email) throw new Error("L'e-mail du propriétaire est requis.");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail du propriétaire invalide.");
        const id = randHex16();
        const value = { ID: id, key: id, profile_name: name, email, number, follow: "0", createdAt: Date.now() };
        if (localFile) { const up = await uploadToCloudinary(localFile, "profile_clients"); value.img = up.url; value.imageId = up.id; }
        await api("content", { action: "set", node: "profile_clients", key: id, value });
        $("big").hidden = true;
        showToast("Boutique « " + name + " » créée.");
        ANA = null;                       // invalide le cache stats
        if (!$("tab-analytics").hidden) loadAnalytics();
        if (typeof CURRENT_NODE !== "undefined" && CURRENT_NODE === "profile_clients" && typeof loadGrid === "function") loadGrid();
      } catch (e) { showToast(e.message, "err"); btn.disabled = false; btn.textContent = "Créer la boutique"; }
    };
  };
  if ($("btnAddBoutique")) $("btnAddBoutique").onclick = openBoutiqueCreator;

})();
