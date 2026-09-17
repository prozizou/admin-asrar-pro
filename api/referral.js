// api/referral.js — Pilotage du PARRAINAGE du hub (Admin SDK, admins seulement).
// Firestore — mêmes collections que asrar-main (pages/api/referral.js,
// pages/api/share.js) :
//   referrals/{uid}            = { code, email, points, clicks, invited, rewards,
//                                   lastAt?, lastClickAt?, blocked? }
//   referral_codes/{code}      = { uid }
//   referred/{uidFilleul}      = { by, at, credited, reason? } — PAS d'e-mail
//                                 (asrar-main ne l'écrit plus) : toujours résolu
//                                 via Auth ci-dessous (action="children").
//   config (doc "referral")    = { enabled, pointsPerInvite, pointsForReward,
//                                   rewardDays, maxAccountAgeDays } — ⚠️ CE DOC
//                                 N'EST PLUS LU par asrar-main : les paramètres
//                                 du programme y sont désormais CODÉS EN DUR
//                                 (pages/api/referral.js, POINTS_PER_INVITE=10,
//                                 POINTS_FOR_REWARD=1000, REWARD_DAYS=90,
//                                 MAX_ACCOUNT_AGE_MS=7 j). settings_get/
//                                 settings_set restent fonctionnels (lecture/
//                                 écriture de ce doc) mais SANS AUCUN EFFET sur
//                                 le programme réel tant qu'asrar-main n'est pas
//                                 remis à jour pour relire ce doc — à traiter
//                                 séparément.
//
// Actions :
//   overview      → KPIs + classement des parrains + alertes de fraude
//   children      → filleuls d'un parrain (avec e-mail résolu via Auth)
//   adjust        → ajouter / retirer des points (motif obligatoire, audité)
//   block/unblock → suspendre un parrain (fraude) — le hub cesse de le créditer
//   reset_code    → régénérer son code (l'ancien lien cesse de fonctionner)
//   settings_get / settings_set → paramètres du programme (lus par le hub)

const { app, verifyAdmin, audit, bearer } = require("./_lib/fb");

// Valeurs par défaut — DOIVENT rester alignées avec api/referral.js du hub.
const DEFAULTS = {
  enabled: true,
  pointsPerInvite: 10,
  pointsForReward: 1000,
  rewardDays: 90,
  maxAccountAgeDays: 7
};
const BOUNDS = {
  pointsPerInvite:   [1, 1000],
  pointsForReward:   [10, 1000000],
  rewardDays:        [1, 3650],
  maxAccountAgeDays: [1, 365]
};

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DAY_MS = 864e5;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action, uid } = body;

  let who;
  try { who = await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const a = app();
  const firestore = a.firestore();
  // {[id]: data} — même forme que l'ancien snap.val() RTDB, pour ne pas
  // changer le reste de la logique (Object.entries/Object.values ci-dessous).
  const toMap = (snap) => { const m = {}; snap.forEach((d) => { m[d.id] = d.data(); }); return m; };

  try {
    // ── Vue d'ensemble ─────────────────────────────────────────
    if (action === "overview") {
      const [refSnap, kidsSnap, cfgSnap] = await Promise.all([
        firestore.collection("referrals").get(),
        firestore.collection("referred").get(),
        firestore.collection("config").doc("referral").get()
      ]);
      const refs = toMap(refSnap);
      const kids = toMap(kidsSnap);
      const settings = withDefaults(cfgSnap.exists ? cfgSnap.data() : null);

      // Filleuls récents par parrain (détection des rafales).
      const now = Date.now();
      const last24 = {}, last7d = {};
      let credited = 0, pending = 0;
      for (const k of Object.values(kids)) {
        if (!k || typeof k !== "object") continue;
        if (k.credited) credited++; else pending++;
        if (now - (k.at || 0) < DAY_MS)     last24[k.by] = (last24[k.by] || 0) + 1;
        if (now - (k.at || 0) < 7 * DAY_MS) last7d[k.by] = (last7d[k.by] || 0) + 1;
      }

      const sponsors = Object.entries(refs).map(([id, v]) => {
        v = v || {};
        const clicks = v.clicks || 0, invited = v.invited || 0;
        return {
          uid: id,
          email: v.email || "",
          code: v.code || "",
          points: v.points || 0,
          clicks, invited,
          rewards: v.rewards || 0,
          blocked: !!v.blocked,
          createdAt: v.createdAt || null,
          lastAt: v.lastAt || v.lastClickAt || null,
          invited24h: last24[id] || 0,
          invited7d: last7d[id] || 0,
          // Taux de transformation clic → inscription (indicateur de fraude s'il est
          // proche de 100 % avec beaucoup de filleuls : liens jamais « ratés »).
          conv: clicks ? Math.round((invited / clicks) * 100) : null,
          // Points « en attente » avant la prochaine récompense.
          toReward: Math.max(0, settings.pointsForReward - (v.points || 0))
        };
      });

      sponsors.sort((x, y) => y.points - x.points || y.invited - x.invited);

      // Alertes : rafale d'inscriptions ou conversion anormale sur un volume réel.
      const alerts = sponsors.filter((s) =>
        s.invited24h >= 10 || (s.invited >= 10 && s.conv !== null && s.conv >= 90)
      ).map((s) => ({
        uid: s.uid, email: s.email, invited24h: s.invited24h, invited: s.invited,
        clicks: s.clicks, conv: s.conv,
        why: s.invited24h >= 10 ? "Rafale : " + s.invited24h + " filleuls en 24 h"
                                : "Conversion " + s.conv + " % sur " + s.invited + " filleuls"
      }));

      const totals = {
        sponsors: sponsors.length,
        active: sponsors.filter((s) => s.invited > 0).length,
        blocked: sponsors.filter((s) => s.blocked).length,
        points: sponsors.reduce((n, s) => n + s.points, 0),
        clicks: sponsors.reduce((n, s) => n + s.clicks, 0),
        invited: credited,
        pending,
        rewards: sponsors.reduce((n, s) => n + s.rewards, 0)
      };
      totals.conv = totals.clicks ? Math.round((totals.invited / totals.clicks) * 100) : 0;
      // Coût implicite : chaque récompense = 3 mois offerts (valeur du plan sub_3m).
      totals.offered = totals.rewards * settings.rewardDays;

      // ── Périodes (7/30/90 j, Tout) + comparaison à la fenêtre précédente ──
      // Seules deux métriques ont un vrai horodatage d'événement exploitable :
      // Parrains (referrals/{uid}.createdAt) et Filleuls (referred/{uid}.at).
      // Clics/points/récompenses sont des compteurs cumulatifs sans journal
      // d'événements — impossible de les découper par période honnêtement,
      // donc pas de delta fabriqué pour eux (Conversion % et Récompenses
      // restent affichés en cumul total uniquement côté client).
      const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
      const sponsorTimes = Object.values(refs).map((v) => v && v.createdAt).filter((t) => typeof t === "number");
      const kidTimes = Object.values(kids).map((v) => v && v.at).filter((t) => typeof t === "number");
      const countWindow = (times, from, to) => times.filter((t) => t >= from && t < to).length;

      const WINDOWS = [7, 30, 90];
      const periods = { all: { sponsors: sponsorTimes.length, invited: kidTimes.length, deltaSponsors: null, deltaInvited: null } };
      for (const w of WINDOWS) {
        const curFrom = now - w * DAY_MS, prevFrom = now - 2 * w * DAY_MS;
        const curSponsors = countWindow(sponsorTimes, curFrom, now), prevSponsors = countWindow(sponsorTimes, prevFrom, curFrom);
        const curInvited = countWindow(kidTimes, curFrom, now), prevInvited = countWindow(kidTimes, prevFrom, curFrom);
        periods["d" + w] = {
          sponsors: curSponsors, invited: curInvited,
          deltaSponsors: pct(curSponsors, prevSponsors),
          deltaInvited: pct(curInvited, prevInvited)
        };
      }

      // Série quotidienne des filleuls crédités (90 j) — graphique « Performance ».
      const dstr = (ms) => new Date(ms).toISOString().slice(0, 10);
      const dayCount = {};
      for (const t of kidTimes) { if (t >= now - 90 * DAY_MS) { const d = dstr(t); dayCount[d] = (dayCount[d] || 0) + 1; } }
      const daily = [];
      for (let i = 89; i >= 0; i--) { const d = dstr(now - i * DAY_MS); daily.push({ bucket: d, invited: dayCount[d] || 0 }); }

      return res.json({ totals, periods, daily, sponsors: sponsors.slice(0, 200), alerts, settings });
    }

    // ── Filleuls d'un parrain ──────────────────────────────────
    if (action === "children") {
      if (!uid) return res.status(400).json({ error: "uid requis" });
      const snap = await firestore.collection("referred").where("by", "==", uid).get();
      const rows = [];
      snap.forEach((doc) => { const v = doc.data() || {}; rows.push({ uid: doc.id, at: v.at || 0, credited: !!v.credited, reason: v.reason || "", email: v.email || "" }); });
      rows.sort((x, y) => y.at - x.at);

      // Résout les e-mails manquants (asrar-main n'écrit plus d'e-mail sur
      // `referred` du tout, cf. en-tête — donc systématique ici) — 40 max, appel unitaire.
      await Promise.all(rows.slice(0, 40).filter((r) => !r.email).map(async (r) => {
        try { const u = await a.auth().getUser(r.uid); r.email = u.email || ""; r.created = u.metadata.creationTime; }
        catch (e) { r.email = "(compte supprimé)"; }
      }));

      return res.json({ rows, total: rows.length });
    }

    // ── Ajustement manuel des points ───────────────────────────
    if (action === "adjust") {
      if (!uid) return res.status(400).json({ error: "uid requis" });
      const delta = Number(body.delta);
      const reason = String(body.reason || "").trim().slice(0, 200);
      if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: "Valeur invalide." });
      if (!reason) return res.status(400).json({ error: "Motif obligatoire (tracé dans l'audit)." });

      const ref = firestore.collection("referrals").doc(uid);
      let newPoints = 0;
      await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = snap.exists ? (Number(snap.data().points) || 0) : 0;
        newPoints = Math.max(0, cur + delta);
        tx.set(ref, { points: newPoints, adjustedBy: who.email }, { merge: true });
      });
      await audit(who, "referral_adjust", uid, (delta > 0 ? "+" : "") + delta + " pts — " + reason);
      return res.json({ ok: true, points: newPoints });
    }

    // ── Suspension d'un parrain ────────────────────────────────
    if (action === "block" || action === "unblock") {
      if (!uid) return res.status(400).json({ error: "uid requis" });
      const on = action === "block";
      await firestore.collection("referrals").doc(uid).set(
        on ? { blocked: true, blockedBy: who.email, blockedAt: Date.now() }
           : { blocked: null, blockedBy: null, blockedAt: null },
        { merge: true });
      await audit(who, action === "block" ? "referral_block" : "referral_unblock", uid, String(body.reason || "").slice(0, 200));
      return res.json({ ok: true });
    }

    // ── Régénération du code ───────────────────────────────────
    if (action === "reset_code") {
      if (!uid) return res.status(400).json({ error: "uid requis" });
      const refDoc = await firestore.collection("referrals").doc(uid).get();
      const old = refDoc.exists ? (refDoc.data().code || null) : null;
      let code = null;
      for (let i = 0; i < 10 && !code; i++) {
        const c = randomCode(6);
        const codeRef = firestore.collection("referral_codes").doc(c);
        let committed = false;
        await firestore.runTransaction(async (tx) => {
          const snap = await tx.get(codeRef);
          if (snap.exists) return;
          tx.set(codeRef, { uid });
          committed = true;
        });
        if (committed) code = c;
      }
      if (!code) return res.status(500).json({ error: "Génération impossible, réessayez." });
      if (old) await firestore.collection("referral_codes").doc(old).delete();
      await firestore.collection("referrals").doc(uid).set({ code }, { merge: true });
      await audit(who, "referral_reset_code", uid, (old || "—") + " → " + code);
      return res.json({ ok: true, code });
    }

    // ── Paramètres du programme (⚠️ plus lus par asrar-main, voir en-tête) ──
    if (action === "settings_get") {
      const snap = await firestore.collection("config").doc("referral").get();
      return res.json({ settings: withDefaults(snap.exists ? snap.data() : null), defaults: DEFAULTS });
    }

    if (action === "settings_set") {
      const s = body.settings || {};
      const out = { enabled: !!s.enabled, updatedBy: who.email, updatedAt: Date.now() };
      for (const k of Object.keys(BOUNDS)) {
        const n = Math.round(Number(s[k]));
        if (!Number.isFinite(n) || n < BOUNDS[k][0] || n > BOUNDS[k][1]) {
          return res.status(400).json({ error: k + " doit être entre " + BOUNDS[k][0] + " et " + BOUNDS[k][1] + "." });
        }
        out[k] = n;
      }
      await firestore.collection("config").doc("referral").set(out, { merge: true });
      await audit(who, "referral_settings", null, JSON.stringify(out).slice(0, 200));
      return res.json({ ok: true, settings: withDefaults(out) });
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur : " + e.message });
  }
};

function withDefaults(v) {
  const s = Object.assign({}, DEFAULTS, v || {});
  s.enabled = v && v.enabled !== undefined ? !!v.enabled : DEFAULTS.enabled;
  for (const k of Object.keys(BOUNDS)) {
    const n = Number(s[k]);
    s[k] = (Number.isFinite(n) && n >= BOUNDS[k][0] && n <= BOUNDS[k][1]) ? Math.round(n) : DEFAULTS[k];
  }
  return s;
}
function randomCode(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
