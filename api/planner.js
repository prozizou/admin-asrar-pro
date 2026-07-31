// api/planner.js — Planificateur de contenu Facebook (secrets/documents/produits →
// textes-variantes préparés à l'avance pour les groupes cibles). Zéro automatisation :
// le panneau organise et suit, l'admin publie lui-même sur Facebook puis clique « Publié ».
const crypto = require("crypto");
const { app, verifyAdmin, audit, bearer } = require("./_lib/fb");

const ROOT = "planner";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const newId = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

function assertDate(d) {
  if (!DATE_RE.test(String(d || ""))) { const e = new Error("Date invalide (AAAA-MM-JJ attendu)"); e.statusCode = 400; throw e; }
  return d;
}

// Sélectionne la variante la moins récemment utilisée par ce groupe (LRU) —
// c'est ce qui évite le contenu identique répété d'un groupe à l'autre / d'un jour à l'autre.
function pickVariant(item, rotation, excludeId) {
  const variants = Object.entries(item.variants || {});
  if (!variants.length) return null;
  const pool = (excludeId && variants.length > 1) ? variants.filter(([id]) => id !== excludeId) : variants;
  pool.sort((a, b) => (rotation[a[0]] || 0) - (rotation[b[0]] || 0));
  return pool[0][0];
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action } = body;

  let who;
  try { who = await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const db = app().database();

  try {
    // ── Chargement initial (groupes, contenus, réglages) ──
    if (action === "bootstrap") {
      const [gSnap, iSnap, sSnap] = await Promise.all([
        db.ref(`${ROOT}/groups`).once("value"),
        db.ref(`${ROOT}/items`).once("value"),
        db.ref(`${ROOT}/settings`).once("value")
      ]);
      const groups = Object.entries(gSnap.val() || {})
        .map(([gid, g]) => ({ gid, ...g }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
      const items = Object.entries(iSnap.val() || {})
        .map(([iid, it]) => ({ iid, ...it, variants: Object.entries(it.variants || {}).map(([vid, v]) => ({ vid, ...v })) }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return res.json({ groups, items, settings: sSnap.val() || {} });
    }

    // ── Planning d'un jour donné ──
    if (action === "schedule_day") {
      const date = assertDate(body.date);
      const snap = await db.ref(`${ROOT}/schedule/${date}`).once("value");
      return res.json({ date, entries: snap.val() || {} });
    }

    // ── Groupes cibles ──
    if (action === "group_save") {
      const name = String(body.name || "").trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: "Nom du groupe requis" });
      const gid = body.gid && String(body.gid) || newId("grp");
      const data = {
        name, active: body.active !== false, order: Number.isFinite(body.order) ? body.order : Date.now(),
        notes: String(body.notes || "").slice(0, 300),
        updatedBy: who.email, updatedAt: Date.now()
      };
      if (!body.gid) { data.createdBy = who.email; data.createdAt = Date.now(); }
      await db.ref(`${ROOT}/groups/${gid}`).update(data);
      await audit(who, "planner_group_save", gid, name);
      return res.json({ ok: true, gid });
    }
    if (action === "group_delete") {
      const gid = String(body.gid || "");
      if (!gid) return res.status(400).json({ error: "gid requis" });
      await db.ref(`${ROOT}/groups/${gid}`).remove();
      await audit(who, "planner_group_delete", gid);
      return res.json({ ok: true });
    }

    // ── Contenus (secrets / documents / produits) + variantes de texte ──
    if (action === "item_save") {
      const title = String(body.title || "").trim().slice(0, 160);
      if (!title) return res.status(400).json({ error: "Titre requis" });
      const iid = body.iid && String(body.iid) || newId("itm");
      const variants = {};
      (Array.isArray(body.variants) ? body.variants : []).forEach((v) => {
        const text = String((v && v.text) || "").trim().slice(0, 2000);
        if (!text) return;
        const vid = (v && v.vid) || newId("var");
        variants[vid] = { text, createdAt: (v && v.createdAt) || Date.now() };
      });
      if (!Object.keys(variants).length) return res.status(400).json({ error: "Au moins une variante de texte est requise" });
      const data = {
        title, category: String(body.category || "autre").slice(0, 40),
        note: String(body.note || "").slice(0, 300),
        image: String(body.image || ""), imageId: String(body.imageId || ""),
        archived: !!body.archived, variants,
        updatedBy: who.email, updatedAt: Date.now()
      };
      if (!body.iid) { data.createdBy = who.email; data.createdAt = Date.now(); }
      await db.ref(`${ROOT}/items/${iid}`).update(data);
      await audit(who, "planner_item_save", iid, title);
      return res.json({ ok: true, iid });
    }
    if (action === "item_delete") {
      const iid = String(body.iid || "");
      if (!iid) return res.status(400).json({ error: "iid requis" });
      await db.ref(`${ROOT}/items/${iid}`).remove();
      await db.ref(`${ROOT}/rotation/${iid}`).remove();
      await audit(who, "planner_item_delete", iid);
      return res.json({ ok: true });
    }

    // ── Affectation d'une variante à un groupe, pour un jour donné ──
    if (action === "assign") {
      const date = assertDate(body.date);
      const gid = String(body.gid || "");
      const iid = String(body.itemId || "");
      if (!gid || !iid) return res.status(400).json({ error: "gid et itemId requis" });
      const [itemSnap, rotSnap, curSnap] = await Promise.all([
        db.ref(`${ROOT}/items/${iid}`).once("value"),
        db.ref(`${ROOT}/rotation/${iid}/${gid}`).once("value"),
        db.ref(`${ROOT}/schedule/${date}/${gid}`).once("value")
      ]);
      const item = itemSnap.val();
      if (!item) return res.status(404).json({ error: "Contenu introuvable" });
      const rotation = rotSnap.val() || {};
      const current = curSnap.val();
      let variantId = body.variantId ? String(body.variantId) : null;
      if (!variantId) {
        const excludeId = body.regenerate && current ? current.variantId : null;
        variantId = pickVariant(item, rotation, excludeId);
      }
      if (!variantId || !item.variants || !item.variants[variantId]) return res.status(400).json({ error: "Variante introuvable" });
      const text = item.variants[variantId].text;
      const entry = {
        itemId: iid, itemTitle: item.title, variantId, text,
        status: "pending", assignedAt: Date.now(), assignedBy: who.email,
        publishedAt: null, publishedBy: null
      };
      await Promise.all([
        db.ref(`${ROOT}/schedule/${date}/${gid}`).set(entry),
        db.ref(`${ROOT}/rotation/${iid}/${gid}/${variantId}`).set(Date.now())
      ]);
      await audit(who, "planner_assign", `${date}/${gid}`, item.title);
      return res.json({ ok: true, entry });
    }

    if (action === "publish" || action === "unpublish") {
      const date = assertDate(body.date);
      const gid = String(body.gid || "");
      if (!gid) return res.status(400).json({ error: "gid requis" });
      const ref = db.ref(`${ROOT}/schedule/${date}/${gid}`);
      const snap = await ref.once("value");
      if (!snap.exists()) return res.status(404).json({ error: "Aucune affectation pour ce groupe ce jour-là" });
      if (action === "publish") await ref.update({ status: "published", publishedAt: Date.now(), publishedBy: who.email });
      else await ref.update({ status: "pending", publishedAt: null, publishedBy: null });
      await audit(who, "planner_" + action, `${date}/${gid}`);
      return res.json({ ok: true });
    }

    if (action === "unassign") {
      const date = assertDate(body.date);
      const gid = String(body.gid || "");
      if (!gid) return res.status(400).json({ error: "gid requis" });
      await db.ref(`${ROOT}/schedule/${date}/${gid}`).remove();
      await audit(who, "planner_unassign", `${date}/${gid}`);
      return res.json({ ok: true });
    }

    // ── Génération en masse : un contenu → plusieurs groupes × plusieurs jours ──
    if (action === "bulk_assign") {
      const iid = String(body.itemId || "");
      const groupIds = Array.isArray(body.groupIds) ? body.groupIds.map(String) : [];
      const dates = Array.isArray(body.dates) ? body.dates.filter((d) => DATE_RE.test(d)) : [];
      if (!iid || !groupIds.length || !dates.length) return res.status(400).json({ error: "itemId, groupIds et dates requis" });
      if (dates.length > 90 || groupIds.length > 60) return res.status(400).json({ error: "Plage trop large (max 90 jours, 60 groupes)" });
      const [itemSnap, rotSnap] = await Promise.all([
        db.ref(`${ROOT}/items/${iid}`).once("value"),
        db.ref(`${ROOT}/rotation/${iid}`).once("value")
      ]);
      const item = itemSnap.val();
      if (!item) return res.status(404).json({ error: "Contenu introuvable" });
      const rotation = rotSnap.val() || {};
      const updates = {};
      let created = 0, skipped = 0;
      for (const date of dates.sort()) {
        for (const gid of groupIds) {
          if (!body.overwrite) {
            const existing = await db.ref(`${ROOT}/schedule/${date}/${gid}`).once("value");
            if (existing.exists()) { skipped++; continue; }
          }
          const gRot = rotation[gid] || {};
          const variantId = pickVariant(item, gRot);
          if (!variantId) continue;
          gRot[variantId] = Date.now() + created; // évite deux choix identiques dans la même rafale
          rotation[gid] = gRot;
          updates[`${ROOT}/schedule/${date}/${gid}`] = {
            itemId: iid, itemTitle: item.title, variantId, text: item.variants[variantId].text,
            status: "pending", assignedAt: Date.now(), assignedBy: who.email,
            publishedAt: null, publishedBy: null
          };
          updates[`${ROOT}/rotation/${iid}/${gid}/${variantId}`] = gRot[variantId];
          created++;
        }
      }
      if (Object.keys(updates).length) await db.ref().update(updates);
      await audit(who, "planner_bulk_assign", iid, `${created} affectation(s), ${skipped} ignorée(s)`);
      return res.json({ ok: true, created, skipped });
    }

    // ── Historique : quel groupe a reçu quelle variante, et quand ──
    if (action === "history") {
      const today = new Date();
      const to = DATE_RE.test(body.to) ? body.to : today.toISOString().slice(0, 10);
      const from = DATE_RE.test(body.from) ? body.from
        : new Date(today.getTime() - 30 * 864e5).toISOString().slice(0, 10);
      const fromMs = new Date(from + "T00:00:00").getTime();
      const toMs = new Date(to + "T00:00:00").getTime();
      if (!(fromMs <= toMs) || (toMs - fromMs) > 366 * 864e5) return res.status(400).json({ error: "Plage de dates invalide (max 1 an)" });
      const dates = [];
      for (let t = fromMs; t <= toMs; t += 864e5) dates.push(new Date(t).toISOString().slice(0, 10));
      const snaps = await Promise.all(dates.map((d) => db.ref(`${ROOT}/schedule/${d}`).once("value")));
      const rows = [];
      snaps.forEach((snap, idx) => {
        const day = snap.val();
        if (!day) return;
        Object.entries(day).forEach(([gid, entry]) => {
          if (body.itemId && entry.itemId !== body.itemId) return;
          if (body.gid && gid !== body.gid) return;
          rows.push({ date: dates[idx], gid, ...entry });
        });
      });
      rows.sort((a, b) => b.date.localeCompare(a.date));
      return res.json({ rows });
    }

    if (action === "settings_save") {
      const reminderTime = /^\d{2}:\d{2}$/.test(body.reminderTime) ? body.reminderTime : null;
      await db.ref(`${ROOT}/settings`).update({ reminderTime, updatedBy: who.email, updatedAt: Date.now() });
      await audit(who, "planner_settings_save", null, reminderTime || "désactivé");
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : "Erreur serveur : " + e.message });
  }
};
