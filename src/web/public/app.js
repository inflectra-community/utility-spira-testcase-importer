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
    // `bundleLabel` is set for sub-bundles of a multi-project export; show the
    // friendly "Export › Project" label but keep selecting by the real name.
    const label = f.bundleLabel || f.name;
    div.innerHTML = `<span>${escapeHtml(label)}</span> ${tag}`;
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
// The program/product names aren't asked for: the importer is already bound to
// one Spira product, and the server reads the real names from it.
async function generateProvisioner(endpoint, resultId, body) {
  const resultEl = $(resultId);
  resultEl.innerHTML = '<div class="status warn">Generating…</div>';
  const r = await api.post(endpoint, body || {});
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
      '<table><thead><tr><th>Property</th><th>Type</th><th>Values added</th><th>Sample</th></tr></thead><tbody>' +
      r.missingValues.map((m) =>
        `<tr><td>${escapeHtml(m.property)}</td><td>${escapeHtml(m.type || 'list')}</td><td>${m.added}</td><td>${escapeHtml(m.sample.join(', '))}</td></tr>`).join('') +
      '</tbody></table>';
  }
  // Guidance: the list-vs-text type is inferred from the values seen, which can
  // be wrong on small samples. Prompt the user to review before provisioning.
  if (r.newFields && r.newFields.length) {
    html += '<div class="status warn" style="margin-top:12px;">' +
      '<strong>Before you run SpiraProvisioner, review the field types above.</strong><br>' +
      'Each type (<em>list</em> vs <em>text</em>) is a best guess based on the values found in this source. ' +
      'A column with only a few distinct values here may actually be a drop-down (list) in your process, ' +
      'and vice-versa. The downloaded file is plain JSON — edit a field\'s <code>"type"</code> ' +
      '(and add a <code>"values"</code> array for lists) if the guess is off.' +
      '</div>';
  }
  if (r.unprovisionable && r.unprovisionable.length) {
    html += `<p class="muted" style="margin-top:10px;">Not provisionable here (add manually in Spira): ${escapeHtml(r.unprovisionable.join(', '))}</p>`;
  }
  resultEl.innerHTML = html;
}

$('provGenerate').addEventListener('click', () =>
  generateProvisioner('/api/excel/provisioner', 'provResult'));

// Collects the fields whose "Multi-select" box is ticked.
function tickedMultiSelect() {
  return [...document.querySelectorAll('.zMulti')].filter((cb) => cb.checked).map((cb) => cb.dataset.field);
}

$('zProvGenerate').addEventListener('click', () =>
  generateProvisioner('/api/zephyr/provisioner', 'zProvResult', { multiSelect: tickedMultiSelect() }));

$('zProvApply').addEventListener('click', async () => {
  if (!confirm('This will add the listed values and fields directly to this Spira product\'s template. Continue?')) return;
  const resultEl = $('zProvResult');
  resultEl.innerHTML = '<div class="status warn">Applying to Spira…</div>';
  const r = await api.post('/api/zephyr/provision-apply', { multiSelect: tickedMultiSelect() });
  if (!r.ok) { resultEl.innerHTML = `<div class="status err">${escapeHtml(r.error || 'Failed.')}</div>`; return; }
  if (r.empty) { resultEl.innerHTML = `<div class="status ok">${escapeHtml(r.message)}</div>`; return; }

  const res = r.result;
  let html = `<div class="status ok">Applied to Spira: added <strong>${res.totals.valuesAdded}</strong> list value(s) ` +
    `and created <strong>${res.totals.propertiesCreated}</strong> field(s). Re-parse to pick up the changes.</div>`;
  if (res.valuesAdded.length) {
    html += '<h3 style="font-size:14px;color:var(--teal);margin:12px 0 6px;">Values added</h3>' +
      '<table><thead><tr><th>Property</th><th>Values</th></tr></thead><tbody>' +
      res.valuesAdded.map((v) =>
        `<tr><td>${escapeHtml(v.property)}</td><td>${escapeHtml(v.values.join(', '))}</td></tr>`).join('') +
      '</tbody></table>';
  }
  if (res.propertiesCreated.length) {
    html += '<h3 style="font-size:14px;color:var(--teal);margin:12px 0 6px;">Fields created</h3>' +
      '<table><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody>' +
      res.propertiesCreated.map((p) =>
        `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.type)}</td></tr>`).join('') +
      '</tbody></table>';
  }
  if (res.warnings && res.warnings.length) {
    html += '<div class="status warn" style="margin-top:10px;">' +
      res.warnings.map(escapeHtml).join('<br>') + '</div>';
  }
  resultEl.innerHTML = html;
});

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

// Renders the full source→Spira property correspondence. Open by default: this
// is the "what maps to what" overview. An arrow shows each source field and the
// Spira property it lands on; unresolved rows are flagged.
function renderSourceMapping(rows) {
  const el = $('planSourceMapping');
  if (!el) return;
  if (!rows.length) { el.innerHTML = ''; return; }

  const body = '<table class="map-table"><thead><tr><th>Source field</th><th></th><th>Spira property</th><th>Notes</th></tr></thead><tbody>' +
    rows.map((r) => {
      const cls = r.resolved ? '' : 'map-warn';
      return `<tr><td><code>${escapeHtml(r.source)}</code></td>` +
        `<td class="muted">→</td>` +
        `<td class="${cls}">${escapeHtml(r.target)}</td>` +
        `<td class="muted">${escapeHtml(r.note || '')}</td></tr>`;
    }).join('') +
    '</tbody></table>';

  const unresolved = rows.filter((r) => !r.resolved).length;
  el.innerHTML =
    `<details class="boxout" open>` +
    `<summary>Source fields → Spira properties` +
    `<span class="sum-meta">${rows.length} field(s)${unresolved ? ` · ${unresolved} unmapped` : ''}</span></summary>` +
    `<div class="boxout-body">${body}</div></details>`;
}

// Renders the field-mapping summary as a collapsed boxout. Each row is a source
// field and how it lines up with the Spira template (resolves, needs values,
// new field, or a manual fix like components). Empty → nothing shown.
function renderFieldMapping(rows) {
  const el = $('planFieldMapping');
  if (!rows.length) { el.innerHTML = ''; return; }

  const label = {
    'needs-values': 'needs values',
    'new-field': 'new field',
    'manual': 'manual fix',
    'ok': 'resolves',
  };
  const body = '<table class="map-table"><thead><tr><th>Field</th><th>Status</th><th>Detail</th></tr></thead><tbody>' +
    rows.map((r) => {
      const cls = r.status === 'needs-values' || r.status === 'manual' ? 'map-warn' : '';
      const vals = r.values && r.values.length
        ? `<br><span class="muted">${escapeHtml(r.values.slice(0, 12).join(', '))}${r.values.length > 12 ? ` …(+${r.values.length - 12})` : ''}</span>`
        : '';
      return `<tr><td>${escapeHtml(r.field)}</td>` +
        `<td class="${cls}">${label[r.status] || r.status}</td>` +
        `<td>${escapeHtml(r.detail)}${vals}</td></tr>`;
    }).join('') +
    '</tbody></table>';

  const needsAttention = rows.filter((r) => r.status !== 'ok').length;
  el.innerHTML =
    `<details class="boxout">` +
    `<summary>Field mapping<span class="sum-meta">${needsAttention ? needsAttention + ' need attention' : 'all resolve'}</span></summary>` +
    `<div class="boxout-body">${body}` +
    `<p class="muted" style="margin-top:6px;">Priorities, statuses and steps that resolve cleanly aren't listed here — only fields needing a template change.</p>` +
    `</div></details>`;
}

function renderPlan(plan, opts) {
  opts = opts || {};
  $('planCard').classList.remove('hidden');

  // Zephyr provisioner section — only when the bundle references template gaps.
  const zp = $('zephyrProvisioner');
  if (opts.hasGaps) { zp.classList.remove('hidden'); }
  else { zp.classList.add('hidden'); $('zProvResult').innerHTML = ''; }

  // Per-field list-vs-multi-select choice for the export. Defaults come from the
  // data (comma-separated values) or from the template (already multi-select).
  const fields = plan.provisionerFields || [];
  $('zProvFields').innerHTML = fields.length
    ? '<table><thead><tr><th>Field</th><th>Values to add</th><th>Multi-select</th></tr></thead><tbody>' +
      fields.map((f) =>
        `<tr><td>${escapeHtml(f.name)}${f.kind === 'new' ? ' <span class="muted">(new)</span>' : ''}</td>` +
        `<td>${f.valueCount}</td>` +
        `<td><input type="checkbox" class="zMulti" data-field="${escapeAttr(f.name)}"${f.multiValued ? ' checked' : ''} ` +
        `aria-label="Make ${escapeAttr(f.name)} a multi-select list" /></td></tr>`).join('') +
      '</tbody></table>' +
      '<p class="muted" style="margin-top:6px;">Tick <em>Multi-select</em> for fields where a test case can have several values ' +
      '(pre-ticked when this source has comma-separated values).</p>'
    : '';

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

  // Missing components can't be auto-provisioned — the admin must add them to
  // the Spira Components field manually. Call this out prominently.
  if (plan.missingComponents && plan.missingComponents.length) {
    $('planSummary').innerHTML +=
      `<div class="status warn" style="margin-top:8px;">` +
      `<strong>${plan.missingComponents.length} component(s) aren't in this product's Components list:</strong> ` +
      `${plan.missingComponents.map(escapeHtml).join(', ')}.<br>` +
      `<span class="muted">Components can't be provisioned via the structure file — add them under ` +
      `Administration → Components in Spira, then re-parse so they resolve.</span></div>`;
  }

  // Source → Spira property correspondence for the whole bundle.
  renderSourceMapping(plan.sourceMapping || []);

  // Field mapping: how source fields line up with the Spira template. Shown as a
  // collapsible boxout (collapsed) so the detail is there without crowding the plan.
  renderFieldMapping(plan.fieldMapping || []);

  // A bundle may define several test sets (one per Zephyr cycle). Fall back to
  // the single `testSet` for older server responses. Each is a collapsible
  // boxout, collapsed by default so a long member list doesn't dominate the plan.
  const testSets = plan.testSets || (plan.testSet ? [plan.testSet] : []);
  if (testSets.length) {
    const heading = testSets.length > 1
      ? `<p class="muted" style="margin:12px 0 4px;">${testSets.length} test sets will be created:</p>`
      : '';
    $('planTestSet').innerHTML = heading + testSets.map((ts) => {
      const items = ts.members.map((k) => `<li>${escapeHtml(k)}</li>`).join('');
      const skipNote = ts.skipped
        ? ` <span class="map-warn">${ts.skipped} from other projects skipped</span>`
        : '';
      return `<details class="boxout">` +
        `<summary>Test Set: ${escapeHtml(ts.name)}` +
        `<span class="sum-meta">${ts.members.length} member(s)${skipNote ? ' · ' + skipNote : ''}</span></summary>` +
        `<div class="boxout-body">` +
        `<span class="muted">Folder: ${escapeHtml(ts.folder)}</span>` +
        `<ol class="member-order">${items}</ol></div></details>`;
    }).join('');
  } else {
    $('planTestSet').innerHTML = '';
  }

  // Test case table count shown on the (collapsed-by-default) boxout summary.
  if ($('planTableCount')) $('planTableCount').textContent = `${plan.testCases.length} case(s)`;
  if ($('planTableBox')) $('planTableBox').open = false;

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
    const doneSets = d.testSets || (d.testSet ? [d.testSet] : []);
    for (const ts of doneSets) {
      html += `<br>Test Set "${escapeHtml(ts.name)}": ${ts.membersAdded} members` +
        (ts.ordered ? ' (ordered)' : '') +
        (ts.membersSkipped ? `, ${ts.membersSkipped} skipped` : '') +
        (ts.error ? ` — ERROR: ${escapeHtml(ts.error)}` : '');
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
  $('zProvFields').innerHTML = '';
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
