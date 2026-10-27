'use strict';

const $ = (id) => document.getElementById(id);
const api = {
  async get(url) { const r = await fetch(url); return r.json(); },
  async post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return r.json();
  },
};

let selectedFile = null;

// ── Tabs ──────────────────────────────────────────────────────────────────
document.querySelectorAll('nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $('tab-settings').classList.toggle('hidden', btn.dataset.tab !== 'settings');
    $('tab-import').classList.toggle('hidden', btn.dataset.tab !== 'import');
    if (btn.dataset.tab === 'import') refreshFiles();
  });
});

function setStatus(el, kind, msg) {
  el.innerHTML = `<div class="status ${kind}">${msg}</div>`;
}

// ── Settings ────────────────────────────────────────────────────────────────
async function loadSettings() {
  const { settings } = await api.get('/api/settings');
  $('spiraUrl').value = settings.spira.baseUrl || '';
  $('spiraUser').value = settings.spira.username || '';
  $('spiraProject').value = settings.spira.projectId || '';
  $('spiraKey').value = settings.spira.apiKey || '';
  $('rootFolder').value = settings.import.rootFolder || '';
  $('llmProvider').value = settings.llm.provider || 'bedrock';
  $('llmModel').value = settings.llm.model || '';
  $('llmRegion').value = settings.llm.region || '';
  $('llmKey').value = settings.llm.apiKey || '';
}

function gatherSettings() {
  return {
    spira: {
      baseUrl: $('spiraUrl').value.trim(),
      username: $('spiraUser').value.trim(),
      apiKey: $('spiraKey').value.trim(),
      projectId: Number($('spiraProject').value) || 0,
    },
    llm: {
      provider: $('llmProvider').value,
      model: $('llmModel').value.trim(),
      region: $('llmRegion').value.trim() || undefined,
      apiKey: $('llmKey').value.trim() || undefined,
    },
    import: { rootFolder: $('rootFolder').value.trim() || undefined },
  };
}

$('saveSettings').addEventListener('click', async () => {
  await api.post('/api/settings', gatherSettings());
  setStatus($('settingsStatus'), 'ok', 'Settings saved.');
});

$('testConn').addEventListener('click', async () => {
  setStatus($('settingsStatus'), 'warn', 'Testing connection…');
  await api.post('/api/settings', gatherSettings());
  const r = await api.post('/api/test-connection');
  if (r.ok) {
    setStatus($('settingsStatus'), 'ok',
      `Connected to project ${r.project.id} (template ${r.project.templateId}). ` +
      `${r.counts.customProperties} custom properties, ${r.counts.priorities} priorities, ${r.counts.statuses} statuses.`);
  } else {
    setStatus($('settingsStatus'), 'err', r.error || 'Connection failed.');
  }
});

// ── Files ─────────────────────────────────────────────────────────────────
async function refreshFiles() {
  const { files } = await api.get('/api/files');
  const list = $('fileList');
  list.innerHTML = '';
  if (!files.length) {
    list.innerHTML = '<p class="muted">No sources in input/ yet.</p>';
    return;
  }
  files.forEach((f) => {
    const div = document.createElement('div');
    div.className = 'file-item';
    const tag = f.isZephyrBundle ? '<span class="badge">Zephyr</span>'
      : f.isDirectory ? '<span class="muted">folder</span>' : '<span class="muted">file</span>';
    div.innerHTML = `<span>${f.name}</span> ${tag}`;
    if (f.isZephyrBundle) {
      div.addEventListener('click', () => {
        document.querySelectorAll('.file-item').forEach((i) => i.classList.remove('selected'));
        div.classList.add('selected');
        selectedFile = f.name;
        $('parseBtn').disabled = false;
      });
    } else {
      div.style.opacity = '0.6';
      div.title = 'Only Zephyr bundles are supported in the web UI so far';
    }
    list.appendChild(div);
  });
}

$('uploadBtn').addEventListener('click', async () => {
  const input = $('fileInput');
  if (!input.files.length) { setStatus($('parseStatus'), 'warn', 'Pick a file first.'); return; }
  const fd = new FormData();
  fd.append('file', input.files[0]);
  setStatus($('parseStatus'), 'warn', 'Uploading…');
  const r = await fetch('/api/upload', { method: 'POST', body: fd }).then((x) => x.json());
  if (r.ok) { setStatus($('parseStatus'), 'ok', `Uploaded ${r.name}.`); refreshFiles(); }
  else setStatus($('parseStatus'), 'err', r.error || 'Upload failed.');
});

// ── Parse ─────────────────────────────────────────────────────────────────
$('parseBtn').addEventListener('click', async () => {
  if (!selectedFile) return;
  setStatus($('parseStatus'), 'warn', 'Parsing and validating…');
  const r = await api.post('/api/parse', { name: selectedFile });
  if (!r.ok) { setStatus($('parseStatus'), 'err', r.error || 'Parse failed.'); return; }
  setStatus($('parseStatus'), 'ok', 'Parsed successfully.');
  renderPlan(r.plan);
});

function renderPlan(plan) {
  $('planCard').classList.remove('hidden');
  const vKind = plan.validationErrors > 0 ? 'err' : 'ok';
  $('planSummary').innerHTML =
    `<div class="status ${vKind}">` +
    `${plan.testCaseCount} test cases, ${plan.stepCount} steps, ${plan.inlineImages} inline images. ` +
    `Validation: ${plan.validationErrors} errors, ${plan.validationWarnings} warnings.` +
    (plan.warnings.length ? `<br><span class="muted">${plan.warnings.length} resolution warning(s)</span>` : '') +
    `</div>`;

  if (plan.testSet) {
    const items = plan.testSet.members.map((k) => `<li>${k}</li>`).join('');
    $('planTestSet').innerHTML =
      `<div class="card" style="margin-top:12px;background:#eef5f6;">` +
      `<strong>Test Set:</strong> ${plan.testSet.name}<br>` +
      `<span class="muted">Folder: ${plan.testSet.folder}</span>` +
      `<ol class="member-order">${items}</ol></div>`;
  } else {
    $('planTestSet').innerHTML = '';
  }

  const tbody = $('planTable').querySelector('tbody');
  tbody.innerHTML = plan.testCases.map((tc) =>
    `<tr><td>${tc.key}</td><td>${tc.name}</td><td>${tc.folder}</td><td>${tc.steps}</td></tr>`).join('');
}

// ── Import (SSE) ────────────────────────────────────────────────────────────
function runImport(dryRun) {
  $('progressCard').classList.remove('hidden');
  $('progressBar').style.width = '0';
  $('log').textContent = '';
  $('resultSummary').innerHTML = '';
  $('importBtn').disabled = true;
  $('dryRunBtn').disabled = true;

  const logLine = (s) => { const l = $('log'); l.textContent += s + '\n'; l.scrollTop = l.scrollHeight; };
  const es = new EventSource(`/api/import?dryRun=${dryRun}`);

  es.addEventListener('phase', (e) => logLine('» ' + JSON.parse(e.data).message));
  es.addEventListener('progress', (e) => {
    const d = JSON.parse(e.data);
    $('progressBar').style.width = `${Math.round((d.current / d.total) * 100)}%`;
    $('progressText').textContent = `[${d.current}/${d.total}] ${d.item}`;
    logLine(`  ${d.current}/${d.total}  ${d.item}`);
  });
  es.addEventListener('complete', (e) => {
    const d = JSON.parse(e.data);
    $('progressBar').style.width = '100%';
    let html = `<div class="status ${d.failureCount ? 'warn' : 'ok'}">` +
      `${d.dryRun ? 'DRY RUN — ' : ''}${d.successCount}/${d.totalAttempted} test cases, ` +
      `${d.foldersCreated} folders, ${(d.durationMs / 1000).toFixed(1)}s.`;
    if (d.testSet) {
      html += `<br>Test Set "${d.testSet.name}": ${d.testSet.membersAdded} members` +
        (d.testSet.ordered ? ' (ordered)' : '') +
        (d.testSet.membersSkipped ? `, ${d.testSet.membersSkipped} skipped` : '') +
        (d.testSet.error ? ` — ERROR: ${d.testSet.error}` : '');
    }
    if (d.attachments) html += `<br>Attachments: ${d.attachments.uploaded} uploaded, ${d.attachments.skipped} skipped, ${d.attachments.failed} failed`;
    html += '</div>';
    if (d.failures && d.failures.length) {
      html += '<table><thead><tr><th>Row</th><th>Name</th><th>Error</th></tr></thead><tbody>' +
        d.failures.map((f) => `<tr><td>${f.sourceRowIndex}</td><td>${f.testCaseName}</td><td>${f.error}</td></tr>`).join('') +
        '</tbody></table>';
    }
    $('resultSummary').innerHTML = html;
    logLine('✓ done');
    es.close();
    $('importBtn').disabled = false;
    $('dryRunBtn').disabled = false;
  });
  es.addEventListener('error', (e) => {
    let msg = 'Stream error';
    try { msg = JSON.parse(e.data).message; } catch {}
    $('resultSummary').innerHTML = `<div class="status err">${msg}</div>`;
    es.close();
    $('importBtn').disabled = false;
    $('dryRunBtn').disabled = false;
  });
}

$('dryRunBtn').addEventListener('click', () => runImport(true));
$('importBtn').addEventListener('click', () => runImport(false));

loadSettings();
