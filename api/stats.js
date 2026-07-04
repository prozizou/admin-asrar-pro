// api/stats.js — Réglages et Logs d'audits (Admin SDK, admins seulement).
const { app, verifyAdmin, audit } = require("./_lib/fb");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action } = body;

  let who;
  try { who = await verifyAdmin(idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const db = app().database();

  try {
    if (action === "audit") {
      const snap = await db.ref("audit_log").limitToLast(100).once("value");
      const rows = [];
      snap.forEach((c) => rows.push(c.val()));
      rows.reverse();
      return res.json({ rows });
    }

    if (action === "config_get") {
      const snap = await db.ref("config").once("value");
      return res.json({ config: snap.val() || {} });
    }

    if (action === "config_set") {
      const c = body.config || {};
      await db.ref("config").update({
        maintenance: !!c.maintenance,
        announcement: String(c.announcement || "").slice(0, 300),
        updatedBy: who.email, updatedAt: Date.now()
      });
      await audit(who, "config_set", null, JSON.stringify(c).slice(0, 200));
      return res.json({ ok: true });
    }

    // ── ANALYTIQUE & VISITES ─────────────────────────────────────────────
    // Sources : analytics/visits/{date}/{uid}={email,last,n}  (agrégé/jour)
    //           activity_feed/{push}={at,email,page,type,uid} (journal d'events)
    //           profile_clients/{id}={profile_name,img,number,follow, <id>:true/false}
    if (action === "analytics") {
      const [visitsSnap, feedSnap, profSnap] = await Promise.all([
        db.ref("analytics/visits").once("value"),
        db.ref("activity_feed").limitToLast(5000).once("value"),
        db.ref("profile_clients").once("value")
      ]);

      const visits = visitsSnap.val() || {};

      // Regroupe les visites par intervalle avec comptage d'uniques EXACT (union d'uids).
      const bucketize = (keyFn) => {
        const map = {};
        for (const [date, users] of Object.entries(visits)) {
          const b = keyFn(date);
          if (!map[b]) map[b] = { uids: new Set(), total: 0 };
          for (const [uid, u] of Object.entries(users || {})) {
            map[b].uids.add(uid);
            map[b].total += (u && typeof u.n === "number") ? u.n : 0;
          }
        }
        return Object.entries(map)
          .map(([bucket, v]) => ({ bucket, unique: v.uids.size, total: v.total }))
          .sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
      };
      const isoWeek = (dateStr) => {
        const d = new Date(dateStr + "T00:00:00Z");
        const day = (d.getUTCDay() + 6) % 7;
        d.setUTCDate(d.getUTCDate() - day + 3);
        const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
        const week = 1 + Math.round(((d - firstThu) / 864e5 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
        return d.getUTCFullYear() + "-S" + String(week).padStart(2, "0");
      };
      const daily = bucketize((d) => d);
      const weekly = bucketize(isoWeek);
      const monthly = bucketize((d) => d.slice(0, 7));

      // Uniques + visites cumulées sur toute la période.
      const allUids = new Set();
      let totalVisits = 0;
      for (const users of Object.values(visits)) {
        for (const [uid, u] of Object.entries(users || {})) {
          allUids.add(uid);
          totalVisits += (u && typeof u.n === "number") ? u.n : 0;
        }
      }

      // Journal d'activité : top pages, types, flux récent.
      const feed = feedSnap.val() || {};
      const pageCount = {}, typeCount = {};
      let recent = [];
      for (const e of Object.values(feed)) {
        if (!e || typeof e !== "object") continue;
        const p = e.page || "?", t = e.type || "?";
        pageCount[p] = (pageCount[p] || 0) + 1;
        typeCount[t] = (typeCount[t] || 0) + 1;
        recent.push({ at: e.at || 0, email: e.email || "", page: p, type: t });
      }
      recent.sort((a, b) => b.at - a.at);
      recent = recent.slice(0, 60);
      const topPages = Object.entries(pageCount).map(([page, count]) => ({ page, count }))
        .sort((a, b) => b.count - a.count).slice(0, 15);
      const types = Object.entries(typeCount).map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);

      // Boutiques (profile_clients) + total des « aimes » (true).
      const prof = profSnap.val() || {};
      const RESERVED = new Set(["ID", "key", "img", "number", "follow", "profile_name"]);
      const boutiques = Object.entries(prof).map(([id, pc]) => {
        let likes = 0;
        if (pc && typeof pc === "object") {
          for (const [fk, fv] of Object.entries(pc)) {
            if (RESERVED.has(fk)) continue;
            if (fv === true || fv === "true") likes++;
          }
        }
        return {
          id,
          name: (pc && pc.profile_name) || id,
          img: (pc && pc.img) || "",
          number: (pc && pc.number) || "",
          follow: pc && pc.follow != null ? (Number(pc.follow) || 0) : 0,
          likes
        };
      }).sort((a, b) => b.likes - a.likes || b.follow - a.follow);

      return res.json({
        daily, weekly, monthly, topPages, types, recent, boutiques,
        totals: {
          uniqueAllTime: allUids.size,
          totalVisits,
          days: daily.length,
          events: Object.keys(feed).length,
          boutiques: boutiques.length,
          likesTotal: boutiques.reduce((s, b) => s + b.likes, 0)
        }
      });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};

