// api/market.js — Gestion du MARCHÉ (boutiques & produits) — admins seulement.
const crypto = require('crypto');
const { app, verifyAdmin, audit, emailToKey, bearer } = require("./_lib/fb");

const LIVE = "det_produits";
const BLOCKED = "det_produits_bloques";
const SHOPS_NODE = "profile_clients";

const shopName = (s) => (s && s.profile_name) || (s && s.shop && s.shop.name) || (s && s.vendeur) || (s && s.name) || "Boutique";
// L'abonnement d'une boutique n'est PAS dans profile_clients : il vit dans
// purchased_user/{cléEmail} (même source que l'onglet Utilisateurs/accès).
const shopRef = (id, s) => ({ email: emailOf(s), uids: [id, s && s.uid].filter(Boolean) });
const emailOf = (s) => String((s && s.email) || "").trim().toLowerCase();
const subRef = (db, email) => db.ref("purchased_user/" + emailToKey(email));
const isActive = (s) => !!(s &&
  (s.expiresAt === "lifetime" || (typeof s.expiresAt === "number" && s.expiresAt > Date.now())));
const isExpired = (s) => !!(s && typeof s.expiresAt === "number" && s.expiresAt <= Date.now());

// Un produit (det_produits) appartient à une boutique si son e-mail vendeur
// correspond, ou à défaut si son uid vendeur correspond (un vendeur peut avoir
// plusieurs uid Firebase ; la clé de la fiche profile_clients n'en est pas un).
const ownsProduct = (p, shop) => !!p && (
  (shop.email && String(p.email || "").trim().toLowerCase() === shop.email) ||
  (p.uid && shop.uids.includes(p.uid)));

async function moveProducts(db, shop, fromNode, toNode) {
  const snap = await db.ref(fromNode).once("value");
  const updates = {};
  let n = 0;
  snap.forEach((c) => {
    const p = c.val();
    if (ownsProduct(p, shop)) {
      updates[fromNode + "/" + c.key] = null;
      updates[toNode + "/" + c.key] = p;
      n++;
    }
  });
  if (n) await db.ref().update(updates);
  return n;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action, uid } = body;

  let who;
  try { who = await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const db = app().database();

  try {
    if (action === "list") {
      const [sellersSnap, purchSnap, liveSnap, blockedSnap] = await Promise.all([
        db.ref(SHOPS_NODE).once("value"),
        db.ref("purchased_user").once("value"),
        db.ref(LIVE).once("value"),
        db.ref(BLOCKED).once("value")
      ]);
      const sellers = sellersSnap.val() || {};
      const purch = purchSnap.val() || {};

      const livePs = [], blockedPs = [];
      const products = [];
      liveSnap.forEach((c) => {
        const p = c.val() || {};
        livePs.push(p);
        products.push({ key: c.key, name: p.produit || "Produit", price: p.Prix || 0,
          devise: p.devise || "FCFA", image: p.Image || "", uid: p.uid || "", vendeur: p.vendeur || "", blocked: false });
      });
      blockedSnap.forEach((c) => {
        const p = c.val() || {};
        blockedPs.push(p);
        products.push({ key: c.key, name: p.produit || "Produit", price: p.Prix || 0,
          devise: p.devise || "FCFA", image: p.Image || "", uid: p.uid || "", vendeur: p.vendeur || "", blocked: true });
      });

      const shops = Object.entries(sellers).filter(([, s]) => s && typeof s === "object").map(([id, s]) => {
        const em = emailOf(s);
        const sub = em ? (purch[emailToKey(em)] || null) : null;
        const shop = shopRef(id, s);
        return {
          uid: id, name: shopName(s), email: s.email || "",
          expiresAt: sub ? (sub.expiresAt ?? null) : null, active: isActive(sub), expired: isExpired(sub),
          products: livePs.filter((p) => ownsProduct(p, shop)).length,
          blockedProducts: blockedPs.filter((p) => ownsProduct(p, shop)).length
        };
      });
      shops.sort((a, b) => (a.expired - b.expired) || a.name.localeCompare(b.name));

      return res.json({ shops, products, totalShops: shops.length, totalProducts: products.length });
    }

    // ── Opérations sur un PRODUIT (par clé) ──
    if (action === "product_delete") {
      const key = String(body.key || "");
      const from = body.blocked ? BLOCKED : LIVE;
      if (!key) return res.status(400).json({ error: "Clé produit requise" });
      const snap = await db.ref(from + "/" + key).once("value");
      if (snap.exists()) {
        await db.ref("trash").push({ node: from, key, value: snap.val(), by: who.email, at: Date.now() });
        await db.ref(from + "/" + key).remove();
      }
      await audit(who, "product_delete", from + "/" + key);
      return res.json({ ok: true });
    }
    if (action === "product_get") {
      const key = String(body.key || "");
      if (!key) return res.status(400).json({ error: "Clé produit requise" });
      const from = body.blocked ? BLOCKED : LIVE;
      const snap = await db.ref(from + "/" + key).once("value");
      if (!snap.exists()) return res.status(404).json({ error: "Produit introuvable" });
      return res.json({ key, value: snap.val() });
    }
    if (action === "product_update") {
      const key = String(body.key || "");
      if (!key) return res.status(400).json({ error: "Clé produit requise" });
      const from = body.blocked ? BLOCKED : LIVE;
      const snap = await db.ref(from + "/" + key).once("value");
      if (!snap.exists()) return res.status(404).json({ error: "Produit introuvable" });
      const upd = {};
      if (typeof body.produit === "string" && body.produit.trim()) upd.produit = body.produit.trim().slice(0, 160);
      if (body.Prix !== undefined && body.Prix !== "" && !Number.isNaN(Number(body.Prix))) upd.Prix = Number(body.Prix);
      if (typeof body.description === "string") upd.description = body.description.trim().slice(0, 2000);
      if (typeof body.Image === "string" && body.Image.trim()) {
        if (!/^https?:\/\//.test(body.Image.trim())) return res.status(400).json({ error: "Image : lien invalide (doit commencer par http:// ou https://)" });
        upd.Image = body.Image.trim();
      }
      if (!Object.keys(upd).length) return res.status(400).json({ error: "Rien à modifier" });
      upd.updatedBy = who.email; upd.updatedAt = Date.now();
      await db.ref(from + "/" + key).update(upd);
      await audit(who, "product_update", from + "/" + key);
      return res.json({ ok: true });
    }
    if (action === "product_block" || action === "product_unblock") {
      const key = String(body.key || "");
      if (!key) return res.status(400).json({ error: "Clé produit requise" });
      const from = action === "product_block" ? LIVE : BLOCKED;
      const to = action === "product_block" ? BLOCKED : LIVE;
      const snap = await db.ref(from + "/" + key).once("value");
      if (!snap.exists()) return res.status(404).json({ error: "Produit introuvable" });
      await db.ref().update({ [from + "/" + key]: null, [to + "/" + key]: snap.val() });
      await audit(who, action, key);
      return res.json({ ok: true });
    }

    if (!uid && action !== "shop_create") return res.status(400).json({ error: "uid de la boutique requis" });
    const sref = uid ? db.ref(SHOPS_NODE + "/" + uid) : null;
    // Boutique ciblée : fiche profile_clients + e-mail (→ abonnement) + uid produits.
    let shopVal = null, shopEmail = "", shop = null;
    if (uid && action !== "shop_create") {
      shopVal = (await sref.once("value")).val();
      shopEmail = emailOf(shopVal);
      shop = shopRef(uid, shopVal);
    }
    const needEmail = () => shopEmail ? null : res.status(400).json({ error: "Cette boutique n'a pas d'e-mail : abonnement impossible." });

    // ── Nouvelle action : création de boutique ──
    if (action === "shop_create") {
      const { name, email, expiresAt, logoUrl, meta } = body;
      if (!name || !email) return res.status(400).json({ error: "Nom et email requis" });
      const newUid = `shop_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const shopData = {
        profile_name: name.trim().slice(0, 120),
        img: logoUrl || '',
        meta: meta || {},
        email: email.trim().toLowerCase(),
        createdBy: who.email,
        createdAt: Date.now()
      };
      await db.ref(`${SHOPS_NODE}/${newUid}`).set(shopData);
      const exp = expiresAt === 'lifetime' ? 'lifetime' : (typeof expiresAt === 'number' ? expiresAt : Date.now() + 30 * 864e5);
      const pref = subRef(db, shopData.email);
      const cur = (await pref.once("value")).val() || {};
      await pref.update({
        token: cur.token || crypto.randomBytes(16).toString("hex"),
        productId: cur.productId || "admin_grant", amount: cur.amount ?? 0,
        label: "Boutique (admin)", grantedBy: who.email, at: Date.now(), expiresAt: exp
      });
      await audit(who, 'shop_create', newUid, `Boutique ${name} créée`);
      return res.json({ ok: true, uid: newUid });
    }

    if (action === "shop_update") {
      const upd = {};
      if (typeof body.name === "string" && body.name.trim()) upd["profile_name"] = body.name.trim().slice(0, 120);
      const hasExp = body.expiresAt === "lifetime" || typeof body.expiresAt === "number";
      if (!Object.keys(upd).length && !hasExp) return res.status(400).json({ error: "Rien à modifier" });
      if (hasExp) {
        if (needEmail()) return;
        await subRef(db, shopEmail).update({ expiresAt: body.expiresAt, grantedBy: who.email, at: Date.now() });
      }
      if (Object.keys(upd).length) { upd["updatedBy"] = who.email; upd["updatedAt"] = Date.now(); await sref.update(upd); }
      await audit(who, "shop_update", uid, JSON.stringify(body).slice(0, 120));
      return res.json({ ok: true });
    }

    if (action === "shop_notify") {
      const message = String(body.message || "").trim().slice(0, 500);
      if (!message) return res.status(400).json({ error: "Message vide" });
      await db.ref("notifications/" + uid).push({ message, by: who.email, at: Date.now(), read: false });
      await audit(who, "shop_notify", uid, message.slice(0, 80));
      return res.json({ ok: true });
    }

    if (action === "shop_revoke") {
      if (needEmail()) return;
      await subRef(db, shopEmail).update({ expiresAt: Date.now() - 1, grantedBy: who.email, at: Date.now() });
      const n = await moveProducts(db, shop, LIVE, BLOCKED);
      await audit(who, "shop_revoke", uid, n + " produit(s) bloqué(s)");
      return res.json({ ok: true, blocked: n });
    }

    if (action === "shop_restore") {
      if (needEmail()) return;
      const exp = (body.expiresAt === "lifetime" || typeof body.expiresAt === "number")
        ? body.expiresAt : Date.now() + 30 * 864e5;
      const pref = subRef(db, shopEmail);
      const cur = (await pref.once("value")).val() || {};
      await pref.update({
        token: cur.token || crypto.randomBytes(16).toString("hex"),
        productId: cur.productId || "admin_grant", amount: cur.amount ?? 0,
        grantedBy: who.email, at: Date.now(), expiresAt: exp
      });
      const n = await moveProducts(db, shop, BLOCKED, LIVE);
      await audit(who, "shop_restore", uid, n + " produit(s) rétabli(s)");
      return res.json({ ok: true, restored: n });
    }

    if (action === "shop_delete") {
      const [s, liveN, blockedN] = await Promise.all([
        sref.once("value"),
        db.ref(LIVE).once("value"),
        db.ref(BLOCKED).once("value")
      ]);
      const updates = {};
      if (s.exists()) {
        await db.ref("trash").push({ node: SHOPS_NODE, key: uid, value: s.val(), by: who.email, at: Date.now() });
        updates[SHOPS_NODE + "/" + uid] = null;
      }
      [ [LIVE, liveN], [BLOCKED, blockedN] ].forEach(([nodeName, snap]) => {
        snap.forEach((c) => { const p = c.val(); if (ownsProduct(p, shop)) updates[nodeName + "/" + c.key] = null; });
      });
      await db.ref().update(updates);
      await audit(who, "shop_delete", uid);
      return res.json({ ok: true });
    }

    if (action === "block_expired") {
      const [sellersSnap, purchSnap] = await Promise.all([
        db.ref(SHOPS_NODE).once("value"), db.ref("purchased_user").once("value")
      ]);
      const purch = purchSnap.val() || {};
      let shopsBlocked = 0, productsBlocked = 0;
      for (const [id, s] of Object.entries(sellersSnap.val() || {})) {
        const em = emailOf(s);
        if (!em || !isExpired(purch[emailToKey(em)])) continue;
        const n = await moveProducts(db, shopRef(id, s), LIVE, BLOCKED);
        if (n) { productsBlocked += n; shopsBlocked++; }
      }
      await audit(who, "block_expired", null, shopsBlocked + " boutique(s), " + productsBlocked + " produit(s)");
      return res.json({ ok: true, shopsBlocked, productsBlocked });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};
