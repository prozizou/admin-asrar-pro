// Aucun contenu privé ni message libre : positions de fichiers et contexte
// technique nettoyés par le serveur de l'application.
(function () {
  'use strict';
  let incidents = [], limited = false, loading = false;
  const devices = { android_app: 'Application Android', android_web: 'Site Android', ios: 'iPhone / iPad', desktop: 'Ordinateur', server: 'Serveur' };
  const isSlow = item => item.kind === 'freeze' || item.kind === 'slow_api';
  const date = at => at ? new Date(at).toLocaleString('fr-FR') : '—';
  const duration = ms => (Number(ms || 0) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' s';
  window.loadDiagnostics = async function () {
    if (loading) return;
    loading = true;
    $('diagnosticsNotice').textContent = 'Chargement des incidents…';
    try {
      const data = await api('diagnostics', { action: 'list' });
      incidents = data.items || []; limited = data.limited;
      render();
    } catch (error) { $('diagnosticsNotice').textContent = error.message; }
    finally { loading = false; }
  };
  function render() {
    const status = $('diagnosticsStatus').value, type = $('diagnosticsType').value;
    const search = $('diagnosticsSearch').value.trim().toLowerCase();
    const filtered = incidents.filter(item => (!status || item.status === status) && (!type || (type === 'slow' ? isSlow(item) : !isSlow(item))) &&
      (!search || [item.title, item.page, item.endpoint, item.version, devices[item.platform], item.name].join(' ').toLowerCase().includes(search)));
    $('diagnosticsNotice').textContent = 'Dernière actualisation : ' + date(Date.now()) + '. ' + (limited ? 'Limite de 500 groupes atteinte : affichage partiel des jours les plus récents. ' : '') + 'Regroupement par jour, version et appareil. Conservation : 30 jours. Collecte limitée ; les compteurs représentent les remontées reçues.';
    $('diagnosticsSummary').textContent = incidents.filter(item => item.status === 'open').length + ' groupes ouverts · ' + incidents.reduce((n, item) => n + item.count, 0) + ' remontées reçues · ' + incidents.filter(isSlow).length + ' groupe(s) de lenteurs';
    $('diagnosticsList').innerHTML = filtered.length ? filtered.map(item => `
      <details class="block diagnostic-card">
        <summary><strong>${esc(item.title)} · ${esc(item.name)}</strong><span class="access-sub">${esc(item.page)}${item.endpoint ? ' → ' + esc(item.endpoint) : ''} · ${item.count} remontée(s) · ${item.status === 'resolved' ? 'Résolu' : 'À traiter'}</span></summary>
        <dl class="diagnostic-meta"><dt>Dernière remontée</dt><dd>${esc(date(item.lastAt))}</dd><dt>Première remontée</dt><dd>${esc(date(item.firstAt))}</dd><dt>Version / appareil</dt><dd>${esc(item.version)} · ${esc(devices[item.platform] || 'Inconnu')}</dd><dt>Durée maximale / HTTP</dt><dd>${item.maxDurationMs ? esc(duration(item.maxDurationMs)) : '—'} · ${item.statusCode || '—'}</dd><dt>Connexion au dernier incident</dt><dd>${typeof item.online !== 'boolean' ? 'Inconnue' : item.online ? 'En ligne' : 'Hors ligne'}</dd><dt>Dernier compte concerné (UID)</dt><dd>${esc(item.lastUid || 'Anonyme')}</dd>${item.resolvedAt ? '<dt>Résolution</dt><dd>' + esc(date(item.resolvedAt)) + '</dd>' : ''}</dl>
        <p class="muted">Positions techniques des fichiers (les messages et contenus saisis ne sont pas collectés).</p>
        <pre class="diagnostic-stack">${esc(item.stack || 'Aucune position de fichier disponible.')}</pre>
        <button type="button" class="btn" data-diagnostic="${esc(item.id)}">${item.status === 'resolved' ? 'Rouvrir' : 'Marquer comme résolu'}</button>
      </details>`).join('') : '<div class="empty">Aucun incident pour ces filtres.</div>';
    $('diagnosticsList').querySelectorAll('[data-diagnostic]').forEach(button => {
      button.onclick = async () => {
        const item = incidents.find(row => row.id === button.dataset.diagnostic);
        button.disabled = true;
        try {
          await api('diagnostics', { action: 'status', id: item.id, expectedCount: item.count, status: item.status === 'resolved' ? 'open' : 'resolved' });
          await loadDiagnostics();
        } catch (error) { showToast(error.message, 'err'); button.disabled = false; }
      };
    });
  }
  ['diagnosticsStatus', 'diagnosticsType'].forEach(id => $(id).addEventListener('change', render));
  $('diagnosticsSearch').addEventListener('input', render);
  $('btnReloadDiagnostics').onclick = () => loadDiagnostics();
})();
