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
let selectedFormat = null; // 'zephyr' | 'excel'
let selectedSheet = null;  // chosen worksheet name (Excel, multi-sheet)

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
    const isExcel = !f.isDirectory && /\.xlsx?$/i.test(f.name);
    const selectable = f.isZephyrBundle || isExcel;
    const div = document.createElement('div');
    div.className = 'file-item';
    const tag = f.isZephyrBundle ? '<span class="badge">Zephyr</span>'
      : isExcel ? '<span class="badge" style="background:#0d5563;color:#fff;">Excel</span>'
      : f.isDirectory ? '<span class="muted">folder</span>' : '<span class="muted">file</span>';
    div.innerHTML = `<span>${f.name}</span> ${tag}`;
    if (selectable) {
      div.addEventListener('click', () => {
        document.querySelectorAll('.file-item').forEach((i) => i.classList.remove('selected'));
        div.classList.add('selected');
        selectedFile = f.name;
        selectedFormat = f.isZephyrBundle ? 'zephyr' : 'excel';
        $('parseBtn').disabled = false;
      });
    } else {
      div.style.opacity = '0.6';
      div.title = 'Select a Zephyr bundle folder or an .xlsx file';
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
function hideFrom(...ids) { ids.forEach((id) => $(id).classList.add('hidden')); }

async function doParse(sheet) {
  setStatus($('parseStatus'), 'warn', sheet ? `Parsing "${sheet}"…` : 'Parsing…');
  hideFrom('sheetCard', 'mappingCard', 'planCard', 'progressCard');
  const r = await api.post('/api/parse', { name: selectedFile, sheet });
  if (!r.ok) { setStatus($('parseStatus'), 'err', r.error || 'Parse failed.'); return; }

  if (r.format === 'excel' && r.needsSheetSelection) {
    setStatus($('parseStatus'), 'ok', 'Workbook has multiple sheets.');
    renderSheetChoices(r.sheets);
    return;
  }
  if (r.format === 'excel') {
    selectedSheet = r.sheet;
    setStatus($('parseStatus'), 'ok', `Parsed worksheet "${r.sheet}".`);
    renderMapping(r.mapping, {
      llmFailed: r.llmFailed,
      llmError: r.llmError,
      resolved: r.resolvedColumnCount,
      unresolved: r.unresolvedColumnCount,
      hasUnresolved: r.hasUnresolved,
    });
    return;
  }
  // Zephyr
  setStatus($('parseStatus'), 'ok', 'Parsed successfully.');
  renderPlan(r.plan, { hasGaps: r.hasGaps });
}

$('parseBtn').addEventListener('click', () => { if (selectedFile) doParse(); });

function renderSheetChoices(sheets) {
  $('sheetCard').classList.remove('hidden');
  const list = $('sheetList');
  list.innerHTML = '';
  sheets.forEach((sh) => {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `<span>${sh.name}</span> <span class="muted">${sh.rowCount} rows, ${sh.columns} columns</span>`;
    div.addEventListener('click', () => doParse(sh.name));
    list.appendChild(div);
  });
}

// ── Excel mapping review ─────────────────────────────────────────────────────
function renderMapping(mapping, info) {
  info = info || {};
  $('mappingCard').classList.remove('hidden');
  $('mappingConfidence').textContent = `${Math.round(mapping.confidence * 100)}% confidence`;

  // Status reflects actual state: warn if the LLM failed, otherwise neutral/ok.
  if (info.llmFailed) {
    setStatus($('mappingStatus'), 'warn',
      'The AI mapping step was unavailable, so this mapping is from the built-in rules only. ' +
      'Review it carefully.' + (info.llmError ? `<br><span class="muted">Reason: ${escapeHtml(info.llmError)}</span>` : ''));
  } else {
    const bits = [];
    if (typeof info.resolved === 'number') bits.push(`${info.resolved} columns matched automatically`);
    if (typeof info.unresolved === 'number' && info.unresolved > 0) bits.push(`${info.unresolved} needed the AI`);
    setStatus($('mappingStatus'), 'ok', bits.length ? bits.join(', ') + '.' : 'Mapping ready for review.');
  }

  const tbody = $('mappingTable').querySelector('tbody');
  tbody.innerHTML = mapping.fieldMappings.map((fm) => {
    const ignored = fm.transformType === 'ignore';
    return `<tr${ignored ? ' style="opacity:.55"' : ''}>` +
      `<td>${escapeHtml(fm.sourceColumn)}</td>` +
      `<td>${ignored ? '<em>ignored</em>' : escapeHtml(fm.targetField)}</td>` +
      `<td>${fm.transformType}</td></tr>`;
  }).join('');

  const vs = mapping.valueSuggestions || [];
  const box = $('valueSuggestions');
  if (vs.length === 0) {
    box.innerHTML = '';
  } else {
    box.innerHTML = '<h3 style="font-size:14px;color:var(--teal);margin:16px 0 6px;">Value mappings</h3>' +
      '<table><thead><tr><th>Field</th><th>Source value</th><th>Maps to</th></tr></thead><tbody>' +
      vs.map((v, i) => {
        const opts = ['<option value="SKIP">(skip — leave blank)</option>']
          .concat((v.options || []).map((o) =>
            `<option value="${escapeAttr(o)}"${o === v.suggestedTarget ? ' selected' : ''}>${escapeHtml(o)}</option>`));
        return `<tr><td>${escapeHtml(v.field)}</td><td>${escapeHtml(v.sourceValue)}</td>` +
          `<td><select data-field="${escapeAttr(v.field)}" data-src="${escapeAttr(v.sourceValue)}">${opts.join('')}</select></td></tr>`;
      }).join('') + '</tbody></table>';
  }

  $('mappingNotes').innerHTML = (mapping.notes || []).map((n) => `• ${escapeHtml(n)}`).join('<br>') +
    (mapping.unmappedSourceColumns && mapping.unmappedSourceColumns.length
      ? `<br><span style="color:var(--warn)">Unmapped: ${escapeHtml(mapping.unmappedSourceColumns.join(', '))}</span>` : '');

  // Show the "export template changes" action only when there are unresolved columns.
  const provBtn = $('provisionerBtn');
  if (info.hasUnresolved) provBtn.classList.remove('hidden');
  else provBtn.classList.add('hidden');
  $('provisionerBox').classList.add('hidden');
  $('provResult').innerHTML = '';
}

function collectValueEdits() {
  return [...document.querySelectorAll('#valueSuggestions select')].map((sel) => ({
    field: sel.dataset.field,
    sourceValue: sel.dataset.src,
    target: sel.value,
  }));
}

$('acceptMappingBtn').addEventListener('click', async () => {
  setStatus($('mappingStatus'), 'warn', 'Applying mapping, transforming and validating…');
  const r = await api.post('/api/excel/accept', { valueEdits: collectValueEdits() });
  if (!r.ok) { setStatus($('mappingStatus'), 'err', r.error || 'Failed.'); return; }
  setStatus($('mappingStatus'), 'ok', 'Mapping accepted.');
  renderPlan(r.plan);
});

$('feedbackBtn').addEventListener('click', () => $('feedbackBox').classList.toggle('hidden'));

$('feedbackSubmit').addEventListener('click', async () => {
  const feedback = $('feedbackText').value.trim();
  if (!feedback) return;
  setStatus($('mappingStatus'), 'warn', 'Regenerating mapping with your feedback…');
  const r = await api.post('/api/excel/feedback', { feedback });
  if (!r.ok) { setStatus($('mappingStatus'), 'err', r.error || 'Failed.'); return; }
  $('feedbackText').value = '';
  $('feedbackBox').classList.add('hidden');
  renderMapping(r.mapping, { regenerated: true });
  setStatus($('mappingStatus'), 'ok', 'Mapping regenerated from your feedback.');
});

// ── SpiraProvisioner export ──────────────────────────────────────────────────
$('provisionerBtn').addEventListener('click', () => $('provisionerBox').classList.toggle('hidden'));

// Shared provisioner generate+download+summary, used by both Excel and Zephyr.
async function generateProvisioner(endpoint, programId, productId, resultId) {
  const resultEl = $(resultId);
  resultEl.innerHTML = '<div class="status warn">Generating…</div>';
  const r = await api.post(endpoint, {
    programName: $(programId).value.trim(),
    productName: $(productId).value.trim(),
  });
  if (!r.ok) { resultEl.innerHTML = `<div class="status err">${escapeHtml(r.error || 'Failed.')}</div>`; return; }
  if (r.empty) { resultEl.innerHTML = `<div class="status ok">${escapeHtml(r.message)}</div>`; return; }

  // Download the structure file.
  const blob = new Blob([JSON.stringify(r.config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = r.filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);

  let html = `<div class="status ok">Downloaded <strong>${escapeHtml(r.filename)}</strong>. Run SpiraProvisioner with it, then re-run this import.</div>`;
  if (r.newFields && r.newFields.length) {
    html += '<h3 style="font-size:14px;color:var(--teal);margin:12px 0 6px;">New custom properties</h3>' +
      '<table><thead><tr><th>Name</th><th>Type</th><th>Variability</th><th>Unique values</th></tr></thead><tbody>' +
      r.newFields.map((f) =>
        `<tr><td>${escapeHtml(f.name)}</td><td>${f.type}</td><td>${f.variability}%</td><td>${f.uniqueValues}</td></tr>`).join('') +
      '</tbody></table>';
  }
  if (r.missingValues && r.missingValues.length) {
    html += '<h3 style="font-size:14px;color:var(--teal);margin:12px 0 6px;">List values to add</h3>' +
      '<table><thead><tr><th>Property</th><th>Values added</th><th>Sample</th></tr></thead><tbody>' +
      r.missingValues.map((m) =>
        `<tr><td>${escapeHtml(m.property)}</td><td>${m.added}</td><td>${escapeHtml(m.sample.join(', '))}</td></tr>`).join('') +
      '</tbody></table>';
  }
  if (r.unprovisionable && r.unprovisionable.length) {
    html += `<p class="muted" style="margin-top:10px;">Not provisionable here (add manually in Spira): ${escapeHtml(r.unprovisionable.join(', '))}</p>`;
  }
  resultEl.innerHTML = html;
}

$('provGenerate').addEventListener('click', () =>
  generateProvisioner('/api/excel/provisioner', 'provProgram', 'provProduct', 'provResult'));

$('zProvGenerate').addEventListener('click', () =>
  generateProvisioner('/api/zephyr/provisioner', 'zProvProgram', 'zProvProduct', 'zProvResult'));

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

function renderPlan(plan, opts) {
  opts = opts || {};
  $('planCard').classList.remove('hidden');

  // Zephyr provisioner section — only when the bundle references template gaps.
  const zp = $('zephyrProvisioner');
  if (opts.hasGaps) { zp.classList.remove('hidden'); }
  else { zp.classList.add('hidden'); $('zProvResult').innerHTML = ''; }

  const vKind = plan.validationErrors > 0 ? 'err' : 'ok';
  const extras = [];
  if (typeof plan.inlineImages === 'number') extras.push(`${plan.inlineImages} inline images`);
  if (typeof plan.transformErrors === 'number' && plan.transformErrors > 0) extras.push(`${plan.transformErrors} transform errors`);
  $('planSummary').innerHTML =
    `<div class="status ${vKind}">` +
    `${plan.testCaseCount} test cases, ${plan.stepCount} steps${extras.length ? ', ' + extras.join(', ') : ''}. ` +
    `Validation: ${plan.validationErrors} errors, ${plan.validationWarnings} warnings.` +
    (plan.warnings && plan.warnings.length ? `<br><span class="muted">${plan.warnings.length} resolution warning(s)</span>` : '') +
    `</div>`;

  if (plan.testSet) {
    const items = plan.testSet.members.map((k) => `<li>${escapeHtml(k)}</li>`).join('');
    $('planTestSet').innerHTML =
      `<div class="card" style="margin-top:12px;background:#eef5f6;">` +
      `<strong>Test Set:</strong> ${escapeHtml(plan.testSet.name)}<br>` +
      `<span class="muted">Folder: ${escapeHtml(plan.testSet.folder)}</span>` +
      `<ol class="member-order">${items}</ol></div>`;
  } else {
    $('planTestSet').innerHTML = '';
  }

  // Header differs: Zephyr has a Key column, Excel does not.
  const hasKey = plan.testCases.some((tc) => tc.key !== undefined);
  const thead = $('planTable').querySelector('thead');
  thead.innerHTML = hasKey
    ? '<tr><th>Key</th><th>Name</th><th>Folder</th><th>Steps</th></tr>'
    : '<tr><th>Name</th><th>Folder</th><th>Steps</th></tr>';
  const tbody = $('planTable').querySelector('tbody');
  tbody.innerHTML = plan.testCases.map((tc) =>
    hasKey
      ? `<tr><td>${escapeHtml(tc.key || '')}</td><td>${escapeHtml(tc.name)}</td><td>${escapeHtml(tc.folder)}</td><td>${tc.steps}</td></tr>`
      : `<tr><td>${escapeHtml(tc.name)}</td><td>${escapeHtml(tc.folder)}</td><td>${tc.steps}</td></tr>`
  ).join('');
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
        d.failures.map((f) => `<tr><td>${f.sourceRowIndex}</td><td>${escapeHtml(f.testCaseName)}</td><td>${escapeHtml(f.error)}</td></tr>`).join('') +
        '</tbody></table>';
    }
    // Post-run action bar.
    // After a DRY RUN the next step is the real import (primary, left); secondary
    // actions sit to the right. After a REAL import there's no import left to do.
    lastResult = { source: selectedFile, sheet: selectedSheet, finishedAt: new Date().toISOString(), result: d };
    const leftAction = d.dryRun
      ? '<button class="primary" id="proceedImportBtn">Import to Spira</button>'
      : '';
    const rightActions =
      '<button class="ghost" id="newImportBtn">Start new import</button>' +
      (d.dryRun ? '' : '<button class="ghost" id="saveReportBtn" style="margin-left:8px;">Download report</button>');
    html += `<div style="margin-top:14px;display:flex;align-items:center;">` +
      `<div>${leftAction}</div>` +
      `<div style="margin-left:auto;">${rightActions}</div>` +
      `</div>`;
    $('resultSummary').innerHTML = html;
    logLine('✓ done');
    es.close();
    $('importBtn').disabled = false;
    $('dryRunBtn').disabled = false;

    const proceedBtn = $('proceedImportBtn');
    if (proceedBtn) proceedBtn.addEventListener('click', () => runImport(false));
    const newBtn = $('newImportBtn');
    if (newBtn) newBtn.addEventListener('click', resetImport);
    const saveBtn = $('saveReportBtn');
    if (saveBtn) saveBtn.addEventListener('click', downloadReport);
  });
  es.addEventListener('error', (e) => {
    let msg = 'Stream error';
    try { msg = JSON.parse(e.data).message; } catch {}
    $('resultSummary').innerHTML = `<div class="status err">${escapeHtml(msg)}</div>`;
    es.close();
    $('importBtn').disabled = false;
    $('dryRunBtn').disabled = false;
  });
}

let lastResult = null;

function downloadReport() {
  if (!lastResult) return;
  const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = lastResult.finishedAt.replace(/[:.]/g, '-');
  a.href = url;
  a.download = `import-report-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Resets the Import tab to a clean state for a fresh import. */
function resetImport() {
  selectedFile = null;
  selectedFormat = null;
  selectedSheet = null;
  lastResult = null;
  document.querySelectorAll('.file-item').forEach((i) => i.classList.remove('selected'));
  $('parseBtn').disabled = true;
  $('fileInput').value = '';
  $('parseStatus').innerHTML = '';
  $('mappingStatus').innerHTML = '';
  $('valueSuggestions').innerHTML = '';
  $('mappingNotes').innerHTML = '';
  $('feedbackText').value = '';
  $('feedbackBox').classList.add('hidden');
  $('zProvResult').innerHTML = '';
  $('zProvProgram').value = '';
  $('zProvProduct').value = '';
  $('resultSummary').innerHTML = '';
  $('log').textContent = '';
  $('progressBar').style.width = '0';
  $('progressText').textContent = '';
  hideFrom('sheetCard', 'mappingCard', 'planCard', 'progressCard');
  refreshFiles();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('dryRunBtn').addEventListener('click', () => runImport(true));
$('importBtn').addEventListener('click', () => runImport(false));

loadSettings();
