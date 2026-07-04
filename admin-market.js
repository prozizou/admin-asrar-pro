// admin-market.js — Gestion du marché (boutiques, produits)

(function () {
  "use strict";

  let SHOPS = [], PRODUCTS = [], prodShown = 0;
  const fmtF = (n) => (Number(n) || 0).toLocaleString("fr-FR") + " F";
  const shopExp = (v) => v === "lifetime" ? "À vie" : (typeof v === "number" ? new Date(v).toLocaleDateString("fr-FR") : "—");

  window.loadMarket = async function () {
    const shopList = $("shopList");
    if (shopList) shopList.innerHTML = "<div class='empty'>Chargement des boutiques…</div>";
    const prodGrid = $("prodGrid");
    if (prodGrid) prodGrid.innerHTML = "";
    try {
      const d = await api("market", { action: "list" });
      SHOPS = d.shops || []; PRODUCTS = d.products || [];
      const shopCount = $("shopCount");
      if (shopCount) shopCount.textContent = "(" + (d.totalShops || 0) + ")";
      const prodCount = $("prodCount");
      if (prodCount) prodCount.textContent = "(" + (d.totalProducts || 0) + ")";
      renderShops(); renderProductsReset();
    } catch (e) {
      if (shopList) shopList.innerHTML = "<div class='empty'>" + esc(e.message) + "</div>";
    }
  };

  // ── DÉCLARATION DES FONCTIONS (AVANT les attachements d'événements) ──
  window.renderShops = function () {
    const q = ($("shopSearch").value || "").toLowerCase().trim();
    const rows = SHOPS.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q));
    const shopList = $("shopList");
    if (!shopList) return;
    shopList.innerHTML = rows.map((s) => {
      const state = s.active ? `<span class="badge gold">Active</span>`
                  : (s.expired ? `<span class="badge expired">Expirée</span>` : `<span class="badge expired">Inactive</span>`);
      return `<div class="row">
        <div>
          <b>${esc(s.name)}</b> ${state}
          <div class="muted">${esc(s.email || "e-mail inconnu")} · expire : ${shopExp(s.expiresAt)}
            · ${s.products} produit(s)${s.blockedProducts ? " · " + s.blockedProducts + " bloqué(s)" : ""}</div>
        </div>
        <div class="acts">
          <button class="btn text" data-shop-extend="${esc(s.uid)}">Prolonger</button>
          <button class="btn text" data-shop-rename="${esc(s.uid)}">Renommer</button>
          <button class="btn text" data-shop-notify="${esc(s.uid)}">Notifier</button>
          ${s.blockedProducts ? `<button class="btn text success-text" data-shop-restore="${esc(s.uid)}">Restaurer</button>` : ``}
          <button class="btn text danger-text" data-shop-revoke="${esc(s.uid)}">Révoquer</button>
          <button class="btn text danger-text" data-shop-delete="${esc(s.uid)}">Supprimer</button>
        </div>
      </div>`;
    }).join("") || "<div class='empty'>Aucune boutique.</div>";
    wireShopActions();
  };

  window.wireShopActions = function () {
    const act = async (uid, payload, okMsg, confirmMsg) => {
      if (confirmMsg && !confirm(confirmMsg)) return;
      try { await api("market", Object.assign({ uid }, payload)); showToast(okMsg); loadMarket(); }
      catch (e) { showToast(e.message, "err"); }
    };
    const askDate = (label) => {
      const v = prompt(label + "\nFormat : AAAA-MM-JJ (ou « vie » pour un accès à vie) :", "");
      if (v == null) return undefined;
      if (v.trim().toLowerCase() === "vie") return "lifetime";
      const ms = new Date(v.trim() + "T23:59:59").getTime();
      if (!(ms > Date.now())) { showToast("Date invalide ou passée.", "err"); return undefined; }
      return ms;
    };
    document.querySelectorAll("[data-shop-extend]").forEach((b) => b.onclick = () => {
      const exp = askDate("Nouvelle date d'expiration de la boutique :");
      if (exp === undefined) return;
      act(b.getAttribute("data-shop-extend"), { action: "shop_restore", expiresAt: exp }, "Boutique prolongée / réactivée.");
    });
    document.querySelectorAll("[data-shop-rename]").forEach((b) => b.onclick = () => {
      const name = prompt("Nouveau nom de la boutique :", "");
      if (!name || !name.trim()) return;
      act(b.getAttribute("data-shop-rename"), { action: "shop_update", name: name.trim() }, "Boutique renommée.");
    });
    document.querySelectorAll("[data-shop-notify]").forEach((b) => b.onclick = () => {
      const message = prompt("Message à envoyer au vendeur :", "");
      if (!message || !message.trim()) return;
      act(b.getAttribute("data-shop-notify"), { action: "shop_notify", message: message.trim() }, "Notification envoyée.");
    });
    document.querySelectorAll("[data-shop-restore]").forEach((b) => b.onclick = () =>
      act(b.getAttribute("data-shop-restore"), { action: "shop_restore" }, "Produits rétablis en vente."));
    document.querySelectorAll("[data-shop-revoke]").forEach((b) => b.onclick = () =>
      act(b.getAttribute("data-shop-revoke"), { action: "shop_revoke" }, "Boutique révoquée : produits bloqués.",
          "Révoquer cette boutique ? Tous ses produits seront retirés de la vente (réversible)."));
    document.querySelectorAll("[data-shop-delete]").forEach((b) => b.onclick = () =>
      act(b.getAttribute("data-shop-delete"), { action: "shop_delete", withProducts: true }, "Boutique supprimée (corbeille).",
          "Supprimer définitivement cette boutique ET ses produits ? (copie en corbeille)"));
  };

  window.renderProductsReset = function () { prodShown = 0; const pg = $("prodGrid"); if (pg) pg.innerHTML = ""; renderProductsMore(); };
  window.filteredProducts = function () {
    const q = ($("prodSearch").value || "").toLowerCase().trim();
    return PRODUCTS.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.vendeur || "").toLowerCase().includes(q));
  };
  window.renderProductsMore = function () {
    const list = filteredProducts();
    const next = list.slice(prodShown, prodShown + 50);
    const pg = $("prodGrid");
    if (!pg) return;
    pg.insertAdjacentHTML("beforeend", next.map((p) => `
      <div class="card ${p.blocked ? "blocked" : ""}">
        <div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="">` : `<div class="noimg">Aucun Média</div>`}</div>
        <div class="card-body">
          <div class="card-title">${esc(p.name)} ${p.blocked ? `<span class="badge expired">bloqué</span>` : ""}</div>
          <p class="muted">${fmtF(p.price)} · ${esc(p.vendeur || "—")}</p>
          <div class="acts" style="margin-top:8px">
            ${p.blocked
              ? `<button class="btn text success-text" data-prod-unblock="${esc(p.key)}">Débloquer</button>`
              : `<button class="btn text" data-prod-block="${esc(p.key)}">Bloquer</button>`}
            <button class="btn text danger-text" data-prod-del="${esc(p.key)}" data-blk="${p.blocked ? 1 : 0}">Supprimer</button>
          </div>
        </div>
      </div>`).join(""));
    prodShown += next.length;
    const moreBtn = $("btnMoreProds");
    if (moreBtn) {
      moreBtn.hidden = prodShown >= list.length;
      moreBtn.textContent = "Afficher 50 de plus (" + (list.length - prodShown) + " restants)";
    }
    wireProductActions();
  };

  window.wireProductActions = function () {
    const run = async (payload, msg, confirmMsg) => {
      if (confirmMsg && !confirm(confirmMsg)) return;
      try { await api("market", payload); showToast(msg); loadMarket(); } catch (e) { showToast(e.message, "err"); }
    };
    document.querySelectorAll("[data-prod-block]").forEach((b) => b.onclick = () =>
      run({ action: "product_block", key: b.getAttribute("data-prod-block") }, "Produit bloqué."));
    document.querySelectorAll("[data-prod-unblock]").forEach((b) => b.onclick = () =>
      run({ action: "product_unblock", key: b.getAttribute("data-prod-unblock") }, "Produit remis en vente."));
    document.querySelectorAll("[data-prod-del]").forEach((b) => b.onclick = () =>
      run({ action: "product_delete", key: b.getAttribute("data-prod-del"), blocked: b.getAttribute("data-blk") === "1" },
          "Produit supprimé (corbeille).", "Supprimer ce produit ? (copie en corbeille)"));
  };

  // ── ATTACHEMENT DES ÉVÉNEMENTS (après déclaration des fonctions) ──
  const shopSearch = $("shopSearch");
  if (shopSearch) shopSearch.oninput = renderShops;

  const prodSearch = $("prodSearch");
  if (prodSearch) prodSearch.oninput = renderProductsReset;

  const moreProds = $("btnMoreProds");
  if (moreProds) moreProds.onclick = renderProductsMore;

  const blockExpired = $("btnBlockExpired");
  if (blockExpired) {
    blockExpired.onclick = async () => {
      if (!confirm("Bloquer TOUTES les boutiques dont l'abonnement est expiré ?\nLeurs produits seront retirés de la vente.")) return;
      try {
        const r = await api("market", { action: "block_expired" });
        showToast(r.shopsBlocked + " boutique(s) bloquée(s), " + r.productsBlocked + " produit(s) retiré(s).");
        loadMarket();
      } catch (e) { showToast(e.message, "err"); }
    };
  }

  // ── Créateur de boutique ──
  window.openShopCreator = async function () {
    $("bigcard").innerHTML = `
      <div class="bighead">
        <h3>Créer une nouvelle boutique</h3>
        <button id="btnCancelBig" class="btn text">Fermer</button>
      </div>
      <label class="field-lg"><span>Nom de la boutique</span><input type="text" id="shopName"></label>
      <label class="field-lg"><span>Email du vendeur</span><input type="email" id="shopEmail"></label>
      <label class="field-lg"><span>Logo (optionnel)</span>
        <input type="file" id="shopLogo" accept="image/*">
        <div id="shopLogoPreview" class="frame" style="width:120px;height:120px;margin-top:8px">
          <div class="noimg">Aucun logo</div>
        </div>
      </label>
      <label class="field-lg"><span>Expiration</span>
        <input type="date" id="shopExpiry">
        <label class="chk-lbl" style="margin-top:4px"><input type="checkbox" id="shopLifetime"> À vie</label>
      </label>
      <label class="field-lg"><span>Métadonnées (JSON)</span>
        <textarea id="shopMeta" rows="4" placeholder='{ "adresse": "...", "telephone": "..." }'></textarea>
      </label>
      <div style="display:flex; justify-content:flex-end; margin-top:25px;">
        <button id="btnSaveShop" class="btn primary">Créer la boutique</button>
      </div>
    `;
    $("big").hidden = false;

    let logoUrl = '';
    $("btnCancelBig").onclick = closeBig;

    $("shopLogo").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const preview = $("shopLogoPreview");
      preview.innerHTML = `<img src="${URL.createObjectURL(file)}" style="width:100%;height:100%;object-fit:cover">`;
      try {
        const sign = await api("cloudinary-sign", { folder: "shop_logos" });
        const fd = new FormData();
        fd.append("file", file);
        fd.append("api_key", sign.apiKey);
        fd.append("timestamp", sign.timestamp);
        fd.append("signature", sign.signature);
        fd.append("folder", sign.folder);
        const cRes = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/image/upload`, { method: "POST", body: fd });
        const cData = await cRes.json();
        if (!cRes.ok) throw new Error(cData.error?.message || "Upload échoué");
        logoUrl = cData.secure_url;
        showToast("Logo uploadé avec succès.");
      } catch (err) {
        showToast(err.message, "err");
      }
    };

    $("shopLifetime").onchange = () => {
      $("shopExpiry").disabled = $("shopLifetime").checked;
    };

    $("btnSaveShop").onclick = async () => {
      const name = $("shopName").value.trim();
      const email = $("shopEmail").value.trim();
      if (!name || !email) return showToast("Nom et email requis.", "err");
      let expiresAt;
      if ($("shopLifetime").checked) {
        expiresAt = "lifetime";
      } else {
        const dateVal = $("shopExpiry").value;
        if (!dateVal) return showToast("Date d'expiration requise.", "err");
        const ms = new Date(dateVal + "T23:59:59").getTime();
        if (!(ms > Date.now())) return showToast("La date doit être dans le futur.", "err");
        expiresAt = ms;
      }
      let meta = {};
      try {
        const metaStr = $("shopMeta").value.trim();
        if (metaStr) meta = JSON.parse(metaStr);
      } catch (e) {
        return showToast("JSON des métadonnées invalide : " + e.message, "err");
      }
      try {
        await api("market", {
          action: "shop_create",
          name,
          email,
          expiresAt,
          logoUrl,
          meta
        });
        $("big").hidden = true;
        showToast("Boutique créée avec succès.");
        loadMarket();
      } catch (e) {
        showToast(e.message, "err");
      }
    };
  };

})();