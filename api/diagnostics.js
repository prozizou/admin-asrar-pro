// Diagnostics techniques de l'application : lecture/mutation Admin SDK seulement.
const { app, verifyAdmin, bearer, audit } = require('./_lib/fb');
const DAY = 86400000;
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ error: 'Requête invalide' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Requête invalide' });
  let who;
  try { who = await verifyAdmin(bearer(req) || body.idToken); }
  catch (error) { return res.status(error.statusCode || 401).json({ error: error.message }); }
  try {
    const db = app().database();
    if (body.action === 'list') {
      const cutoff = new Date(Date.now() - 29 * DAY).toISOString().slice(0, 10).replace(/-/g, '');
      const snap = await db.ref('app_diagnostics').orderByKey().startAt(cutoff).limitToLast(500).once('value');
      const items = Object.entries(snap.val() || {}).map(([id, value]) => ({ ...value, id })).sort((a, b) => b.lastAt - a.lastAt);
      return res.status(200).json({ items, limited: items.length === 500, retentionDays: 30 });
    }
    if (body.action === 'delete') {
      if (!/^\d{8}_[a-f0-9]{32}$/.test(body.id) || !Number.isSafeInteger(body.expectedCount) || body.expectedCount < 1 || !Number.isSafeInteger(body.expectedLastAt) || body.expectedLastAt < 1) {
        return res.status(400).json({ error: 'Incident ou version invalide' });
      }
      const result = await db.ref('app_diagnostics/' + body.id).transaction(current => {
        if (!current || current.count !== body.expectedCount || current.lastAt !== body.expectedLastAt) return;
        return null;
      });
      if (!result.committed) return res.status(409).json({ error: 'L’incident a changé ou a déjà été supprimé. Actualisez avant de recommencer.' });
      await audit(who, 'diagnostic:delete', body.id);
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'status') {
      if (!/^\d{8}_[a-f0-9]{32}$/.test(body.id) || !['open', 'resolved'].includes(body.status) || !Number.isSafeInteger(body.expectedCount)) {
        return res.status(400).json({ error: 'Incident ou statut invalide' });
      }
      const result = await db.ref('app_diagnostics/' + body.id).transaction(current => {
        if (!current || current.count !== body.expectedCount) return;
        return { ...current, status: body.status, resolvedAt: body.status === 'resolved' ? Date.now() : null, resolvedBy: body.status === 'resolved' ? who.uid : null };
      });
      if (!result.committed) return res.status(409).json({ error: 'L’incident a changé. Actualisez la liste avant de recommencer.' });
      await audit(who, 'diagnostic:' + body.status, body.id);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Action inconnue' });
  } catch {
    return res.status(503).json({ error: 'Les diagnostics sont temporairement indisponibles.' });
  }
};
