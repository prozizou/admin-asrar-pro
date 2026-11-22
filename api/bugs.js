// api/bugs.js — Bugs, lenteurs et signalements remontés par l'application
// (Admin SDK, admins seulement). Données écrites par asrar-main
// (pages/api/client-error.js → server/bugReports.js) :
//   bug_reports/groups/{empreinte}       un bug regroupé
//   bug_reports/events/{empreinte}/{id}  ses dernières occurrences (20 max)
//   bug_reports/daily/{AAAA-MM-JJ}       { _n, error, lag, user }
//
// Actions :
//   list                     → { groups, daily (30 j), totals }
//   events   { id }          → { group, events } (plus récentes d'abord)
//   resolve  { id }          → marque le bug « résolu » (rouvert s'il revient)
//   reopen   { id }
//   delete   { id }          → supprime le bug et ses occurrences
//   purge_resolved           → supprime tous les bugs résolus
const { app, verifyAdmin, bearer, audit } = require("./_lib/fb");

const DAY_MS = 864e5;
const LIST_MAX = 300;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const num = (v) => Math.max(0, Number(v) || 0);
const validId = (id) => typeof id === "string" && /^[elu]_[A-Za-z0-9_-]{1,40}$/.test(id);
const KINDS = ["error", "lag", "user"];

function summary(id, g) {
  return {
    id,
    kind: KINDS.includes(g.kind) ? g.kind : "error",
    message: String(g.message || ""),
    label: String(g.label || ""),
    detail: String(g.detail || ""),
    page: String(g.lastPage || g.page || "/"),
    count: num(g.count),
    firstAt: num(g.firstAt),
    lastAt: num(g.lastAt),
    status: g.status === "resolved" ? "resolved" : "open",
    regressed: g.regressed === true,
    resolvedAt: num(g.resolvedAt) || null,
    lastVersion: String(g.lastVersion || ""),
    reporter: String(g.reporter || ""),
    platforms: g.platforms || {},
    avgMs: g.sumMs && g.count ? Math.round(num(g.sumMs) / num(g.count)) : 0,
    maxMs: num(g.maxMs),
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
  const body = typeof req.body === "object" && req.body ? req.body
             : (() => { try { return JSON.parse(req.body || "{}"); } catch { return {}; } })();
  const { idToken, action, id } = body;

  let who;
  try { who = await verifyAdmin(bearer(req) || idToken); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const db = app().database();

  try {
    if (action === "list") {
      const now = Date.now();
      const [groupsSnap, dailySnap] = await Promise.all([
        db.ref("bug_reports/groups").orderByChild("lastAt").limitToLast(LIST_MAX).once("value"),
        db.ref("bug_reports/daily").orderByKey().startAt(isoDay(now - 29 * DAY_MS)).once("value"),
      ]);
      const groups = Object.entries(groupsSnap.val() || {})
        .map(([key, g]) => summary(key, g || {}))
        .sort((a, b) => b.lastAt - a.lastAt);
      const days = dailySnap.val() || {};
      const daily = [];
      for (let i = 29; i >= 0; i--) {
        const bucket = isoDay(now - i * DAY_MS);
        const d = days[bucket] || {};
        daily.push({ bucket, error: num(d.error), lag: num(d.lag), user: num(d.user) });
      }
      const last7 = daily.slice(-7);
      const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
      const open = groups.filter((g) => g.status === "open");
      const totals = {
        open: open.length,
        openErrors: open.filter((g) => g.kind === "error").length,
        regressed: open.filter((g) => g.regressed).length,
        errors7: sum(last7, "error"),
        lags7: sum(last7, "lag"),
        reports7: sum(last7, "user"),
      };
      return res.status(200).json({ groups, daily, totals });
    }

    if (action === "purge_resolved") {
      const snap = await db.ref("bug_reports/groups").orderByChild("status").equalTo("resolved").once("value");
      const ids = Object.keys(snap.val() || {});
      if (ids.length) {
        const update = {};
        for (const key of ids) { update["groups/" + key] = null; update["events/" + key] = null; }
        await db.ref("bug_reports").update(update);
      }
      await audit(who, "bug_purge_resolved", null, ids.length + " bug(s)");
      return res.status(200).json({ ok: true, removed: ids.length });
    }

    if (!validId(id)) return res.status(400).json({ error: "Identifiant de bug invalide." });
    const groupRef = db.ref("bug_reports/groups/" + id);

    if (action === "events") {
      const [g, ev] = await Promise.all([
        groupRef.once("value"),
        db.ref("bug_reports/events/" + id).orderByKey().limitToLast(20).once("value"),
      ]);
      if (!g.val()) return res.status(404).json({ error: "Ce bug n'existe plus." });
      const events = Object.entries(ev.val() || {})
        .map(([key, e]) => ({ id: key, ...(e || {}) }))
        .sort((a, b) => num(b.at) - num(a.at));
      return res.status(200).json({ group: { ...summary(id, g.val()), stack: String(g.val().stack || ""), versions: g.val().versions || {} }, events });
    }

    if (action === "resolve" || action === "reopen") {
      const g = await groupRef.once("value");
      if (!g.val()) return res.status(404).json({ error: "Ce bug n'existe plus." });
      await groupRef.update(action === "resolve"
        ? { status: "resolved", resolvedAt: Date.now(), regressed: null, resolvedBy: who.email }
        : { status: "open", resolvedAt: null, resolvedBy: null });
      await audit(who, "bug_" + action, id, String(g.val().message || "").slice(0, 120));
      return res.status(200).json({ ok: true });
    }

    if (action === "delete") {
      await db.ref("bug_reports").update({ ["groups/" + id]: null, ["events/" + id]: null });
      await audit(who, "bug_delete", id);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Action inconnue." });
  } catch (e) {
    console.error("bugs:", e);
    return res.status(500).json({ error: e.message || "Erreur serveur" });
  }
};
