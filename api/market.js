// api/market.js — Gestion du MARCHÉ (boutiques & produits) — admins seulement.
// Firestore : `sellers`/`products` = mêmes collections que asrar-main
// (docs/FIRESTORE_SCHEMA.md). `products_blocked`/`trash`/`vendor_notifications`
// sont ct-uniquement admin (asrar-main ne les lit jamais) : products_blocked
// est le pendant Firestore de det_produits_bloques (produit déplacé hors de
// `products`, donc invisible du Marché, sans être supprimé) ; trash existe
// déjà côté asrar-main ; vendor_notifications remplace l'ancien notifications/
// {uid} RTDB (déjà mort côté client avant la migration — aucun code d'asrar-main
// ne le lisait — mais on le garde fonctionnel pour ce panneau).
const crypto = require('crypto');
const { app, verifyAdmin, audit, bearer } = require("./_lib/fb");

const LIVE = "products";
const BLOCKED = "products_blocked";

const shopName = (s) => (s && s.shop && s.shop.name) || (s && s.vendeur) || (s && s.name) || "Boutique";
const isActive = (s) => !!(s && s.shopActive &&
  (s.expiresAt === "lifetime" || (typeof s.expiresAt === "number" && s.expiresAt > Date.now())));
const isExpired = (s) => !!(s && typeof s.expiresAt === "number" && s.expiresAt <= Date.now());

// Déplace tous les produits d'un vendeur d'une collection à l'autre (batch
// Firestore = atomique, comme l'update multi-chemins RTDB d'origine) — limité
// à 400 docs (800 opérations) par lot, largement au-dessus de tout catalogue
// vendeur réel, pour rester sous la limite de 500 opérations/batch Firestore.
async function moveProducts(firestore, uid, fromCol, toCol) {
  const snap = await firestore.collection(fromCol).where("uid", "==", uid).get();
  let n = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = firestore.batch();
    for (const d of docs.slice(i, i + 400)) {
      batch.set(firestore.collection(toCol).doc(d.id), d.data());
      batch.delete(d.ref);
      n++;
    }
    await batch.commit();
  }
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

  const firestore = app().firestore();

  try {
    if (action === "list") {
      const [sellersSnap, liveSnap, blockedSnap] = await Promise.all([
        firestore.collection("sellers").get(),
        firestore.collection(LIVE).get(),
        firestore.collection(BLOCKED).get()
      ]);

      const liveCount = {}, blockedCount = {};
      const products = [];
      liveSnap.forEach((doc) => {
        const p = doc.data() || {};
        liveCount[p.uid] = (liveCount[p.uid] || 0) + 1;
        products.push({ key: doc.id, name: p.produit || "Produit", price: p.Prix || 0,
          devise: p.devise || "FCFA", image: p.Image || "", uid: p.uid || "", vendeur: p.vendeur || "", blocked: false });
      });
      blockedSnap.forEach((doc) => {
        const p = doc.data() || {};
        blockedCount[p.uid] = (blockedCount[p.uid] || 0) + 1;
        products.push({ key: doc.id, name: p.produit || "Produit", price: p.Prix || 0,
          devise: p.devise || "FCFA", image: p.Image || "", uid: p.uid || "", vendeur: p.vendeur || "", blocked: true });
      });

      const shops = [];
      sellersSnap.forEach((doc) => {
        const s = doc.data() || {};
        shops.push({
          uid: doc.id, name: shopName(s), email: s.email || "",
          expiresAt: s.expiresAt ?? null, active: isActive(s), expired: isExpired(s),
          products: liveCount[doc.id] || 0, blockedProducts: blockedCount[doc.id] || 0
        });
      });
      shops.sort((a, b) => (a.expired - b.expired) || a.name.localeCompare(b.name));

      return res.json({ shops, products, totalShops: shops.length, totalProducts: products.length });
    }

    // ── Opérations sur un PRODUIT (par clé) ──
    if (action === "product_delete") {
      const key = String(body.key || "");
      const from = body.blocked ? BLOCKED : LIVE;
      if (!key) return res.status(400).json({ error: "Clé produit requise" });
      const ref = firestore.collection(from).doc(key);
      const snap = await ref.get();
      if (snap.exists) {
        await firestore.collection("trash").add({ node: from, key, value: snap.data(), by: who.email, at: Date.now() });
        await ref.delete();
      }
      await audit(who, "product_delete", from + "/" + key);
      return res.json({ ok: true });
    }
    if (action === "product_get") {
      const key = String(body.key || "");
      if (!key) return res.status(400).json({ error: "Clé produit requise" });
      const from = body.blocked ? BLOCKED : LIVE;
      const snap = await firestore.collection(from).doc(key).get();
      if (!snap.exists) return res.status(404).json({ error: "Produit introuvable" });
      return res.json({ key, value: snap.data() });
    }
    if (action === "product_update") {
      const key = String(body.key || "");
      if (!key) return res.status(400).json({ error: "Clé produit requise" });
      const from = body.blocked ? BLOCKED : LIVE;
      const ref = firestore.collection(from).doc(key);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Produit introuvable" });
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
      await ref.update(upd);
      await audit(who, "product_update", from + "/" + key);
      return res.json({ ok: true });
    }
    if (action === "product_block" || action === "product_unblock") {
      const key = String(body.key || "");
      if (!key) return res.status(400).json({ error: "Clé produit requise" });
      const from = action === "product_block" ? LIVE : BLOCKED;
      const to = action === "product_block" ? BLOCKED : LIVE;
      const fromRef = firestore.collection(from).doc(key);
      const snap = await fromRef.get();
      if (!snap.exists) return res.status(404).json({ error: "Produit introuvable" });
      const batch = firestore.batch();
      batch.set(firestore.collection(to).doc(key), snap.data());
      batch.delete(fromRef);
      await batch.commit();
      await audit(who, action, key);
      return res.json({ ok: true });
    }

    if (!uid && action !== "shop_create") return res.status(400).json({ error: "uid de la boutique requis" });
    const sref = uid ? firestore.collection("sellers").doc(uid) : null;

    // ── Nouvelle action : création de boutique ──
    if (action === "shop_create") {
      const { name, email, expiresAt, logoUrl, meta } = body;
      if (!name || !email) return res.status(400).json({ error: "Nom et email requis" });
      const newUid = `shop_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const shopData = {
        shop: {
          name: name.trim().slice(0, 120),
          logo: logoUrl || '',
          meta: meta || {}
        },
        email: email.trim().toLowerCase(),
        shopActive: true,
        expiresAt: expiresAt === 'lifetime' ? 'lifetime' : (typeof expiresAt === 'number' ? expiresAt : Date.now() + 30 * 864e5),
        createdBy: who.email,
        createdAt: Date.now()
      };
      await firestore.collection("sellers").doc(newUid).set(shopData);
      await audit(who, 'shop_create', newUid, `Boutique ${name} créée`);
      return res.json({ ok: true, uid: newUid });
    }

    if (action === "shop_update") {
      const upd = {};
      if (typeof body.name === "string" && body.name.trim()) upd["shop.name"] = body.name.trim().slice(0, 120);
      if (body.expiresAt === "lifetime" || typeof body.expiresAt === "number") upd["expiresAt"] = body.expiresAt;
      if (typeof body.active === "boolean") upd["shopActive"] = body.active;
      if (!Object.keys(upd).length) return res.status(400).json({ error: "Rien à modifier" });
      upd["updatedBy"] = who.email; upd["updatedAt"] = Date.now();
      await sref.update(upd);
      await audit(who, "shop_update", uid, JSON.stringify(body).slice(0, 120));
      return res.json({ ok: true });
    }

    if (action === "shop_notify") {
      const message = String(body.message || "").trim().slice(0, 500);
      if (!message) return res.status(400).json({ error: "Message vide" });
      await firestore.collection("vendor_notifications").add({ uid, message, by: who.email, at: Date.now(), read: false });
      await audit(who, "shop_notify", uid, message.slice(0, 80));
      return res.json({ ok: true });
    }

    if (action === "shop_revoke") {
      await sref.update({ shopActive: false, expiresAt: Date.now() - 1, updatedBy: who.email, updatedAt: Date.now() });
      const n = await moveProducts(firestore, uid, LIVE, BLOCKED);
      await audit(who, "shop_revoke", uid, n + " produit(s) bloqué(s)");
      return res.json({ ok: true, blocked: n });
    }

    if (action === "shop_restore") {
      const upd = { shopActive: true, updatedBy: who.email, updatedAt: Date.now() };
      if (body.expiresAt === "lifetime" || typeof body.expiresAt === "number") upd.expiresAt = body.expiresAt;
      await sref.update(upd);
      const n = await moveProducts(firestore, uid, BLOCKED, LIVE);
      await audit(who, "shop_restore", uid, n + " produit(s) rétabli(s)");
      return res.json({ ok: true, restored: n });
    }

    if (action === "shop_delete") {
      const s = await sref.get();
      if (s.exists) {
        await firestore.collection("trash").add({ node: "sellers", key: uid, value: s.data(), by: who.email, at: Date.now() });
        await sref.delete();
      }
      const [liveSnap, blockedSnap] = await Promise.all([
        firestore.collection(LIVE).where("uid", "==", uid).get(),
        firestore.collection(BLOCKED).where("uid", "==", uid).get()
      ]);
      const docs = [...liveSnap.docs, ...blockedSnap.docs];
      for (let i = 0; i < docs.length; i += 400) {
        const batch = firestore.batch();
        for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
        await batch.commit();
      }
      await audit(who, "shop_delete", uid);
      return res.json({ ok: true });
    }

    if (action === "block_expired") {
      const sellersSnap = await firestore.collection("sellers").get();
      const targets = [];
      sellersSnap.forEach((doc) => { const s = doc.data(); if (s && s.shopActive && isExpired(s)) targets.push(doc.id); });
      let shopsBlocked = 0, productsBlocked = 0;
      for (const id of targets) {
        await firestore.collection("sellers").doc(id).update({ shopActive: false, updatedBy: who.email, updatedAt: Date.now() });
        productsBlocked += await moveProducts(firestore, id, LIVE, BLOCKED);
        shopsBlocked++;
      }
      await audit(who, "block_expired", null, shopsBlocked + " boutique(s), " + productsBlocked + " produit(s)");
      return res.json({ ok: true, shopsBlocked, productsBlocked });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};
