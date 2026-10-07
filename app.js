const AREAS = ['Waltham Chase', 'Shedfield', 'Shirrell Heath', 'Wickham', 'Extras'];
const DEFAULT_SHEET = 'https://docs.google.com/spreadsheets/d/1XVUCnDLmZxF_S9SxugCNf88Tln-amZaL7c11SEnEUQI/edit?usp=sharing';
const DEFAULT_API = ''; // paste your Apps Script /exec URL here, or enter it in Settings
const DB_NAME = 'magazine-distribution-pwa';
const DB_VERSION = 1;
const AREA_COLORS = { 'Waltham Chase': '#176b55', 'Shedfield': '#2563a8', 'Shirrell Heath': '#c2610c', 'Wickham': '#7b3fa0', 'Extras': '#b0396b' };
let db;
let records = [];
let selectedArea = AREAS[0];
let admin = localStorage.getItem('mag-admin-mode') === 'true';
let editId = null;
let toastTimer;

const $ = (id) => document.getElementById(id);
const byId = new Map();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('records', { keyPath: 'id' });
      database.createObjectStore('outbox', { keyPath: 'id' });
      database.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(store, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function getAll(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function initialize() {
  db = await openDatabase();
  const existing = await getAll('records');
  if (!existing.length) {
    const response = await fetch('assets/magazine-distribution-seed.json');
    const seed = await response.json();
    const tx = db.transaction(['records', 'meta'], 'readwrite');
    for (const [order, row] of seed.rows.entries()) {
      const [id, parish, route, distributor, initials, numberOfMags, collectedFromChurch] = row;
      tx.objectStore('records').put({ id, issueMonth: seed.issueMonth, parish, route, distributor, initials, numberOfMags, collectedFromChurch, sortOrder: order + 1, updatedBy: '', updatedDate: '', dirty: false });
    }
    tx.objectStore('meta').put({ key: 'seeded', value: true });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }
  await reload();
}

async function reload() {
  records = (await getAll('records')).sort((a, b) => AREAS.indexOf(a.parish) - AREAS.indexOf(b.parish) || (a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9) || a.route.localeCompare(b.route));
  render();
}

function render() {
  $('issueLabel').textContent = `${monthLabel(records[0]?.issueMonth || '2026-10')} · ${admin ? 'Admin mode' : 'Read only'}`;
  $('modeLabel').textContent = admin ? 'Admin' : 'Viewer';
  $('modeIcon').textContent = admin ? '✎' : '◉';
  $('addButton').classList.toggle('hidden', !admin);
  $('newIssueButton').classList.toggle('hidden', !admin);
  const totalMags = records.reduce((n, r) => n + (Number(r.numberOfMags) || 0), 0);
  $('totals').innerHTML = `<div><strong>${totalMags.toLocaleString('en-GB')}</strong><span>Total magazines</span></div><div><strong>${records.length}</strong><span>Total routes</span></div>`;
  $('parishTabs').innerHTML = AREAS.map((area) => `<button class="tab ${area === selectedArea ? 'active' : ''}" style="--tab:${AREA_COLORS[area] || '#176b55'}" data-area="${escapeHtml(area)}">${escapeHtml(area)}</button>`).join('');
  $('parishTabs').querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => { selectedArea = button.dataset.area; render(); }));
  const filtered = records.filter((record) => record.parish === selectedArea);
  $('parishTitle').textContent = selectedArea;
  const areaMags = filtered.reduce((n, r) => n + (Number(r.numberOfMags) || 0), 0);
  $('routeCount').textContent = `${filtered.length} ${filtered.length === 1 ? 'route' : 'routes'} · ${areaMags.toLocaleString('en-GB')} magazines`;
  $('routeList').innerHTML = filtered.length ? `<div class="table-header"><span>Route</span><span>Distributor</span><span>Initials</span><span>Mags</span><span>Collected from church</span><span>Updated</span><span></span></div>${filtered.map(routeCard).join('')}` : '<div class="empty-state">No routes in this area yet.</div>';
  $('routeList').querySelectorAll('[data-collected]').forEach((input) => input.addEventListener('change', () => toggleCollected(input.dataset.collected, input.checked)));
  $('routeList').querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => openEditor(button.dataset.edit)));
  $('routeList').querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', () => deleteRecord(button.dataset.delete)));
}

function routeCard(record) {
  const who = record.distributor || 'No distributor';
  const initials = record.initials || '—';
  const collected = record.collectedFromChurch ? 'checked' : '';
  const updated = record.updatedDate ? `Updated by ${escapeHtml(record.updatedBy || '—')} · ${formatDate(record.updatedDate)}` : 'Not updated yet';
  return `<article class="route-card"><div class="route-name">${escapeHtml(record.route)}</div><div class="person-row">${escapeHtml(who)}</div><div class="initials">${escapeHtml(initials)}</div><div class="mags">${Number(record.numberOfMags) || 0}</div><label class="collection"><input type="checkbox" data-collected="${escapeHtml(record.id)}" ${collected} ${admin ? '' : 'disabled'}><span>Collected from church</span></label><span class="updated">${updated}</span>${admin ? `<span class="row-actions"><button aria-label="Edit route" title="Edit" data-edit="${escapeHtml(record.id)}">✎</button><button aria-label="Delete route" title="Delete" data-delete="${escapeHtml(record.id)}">⌫</button></span>` : '<span></span>'}</article>`;
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function monthLabel(value) { const date = new Date(`${value}-01T00:00:00`); return Number.isNaN(date.valueOf()) ? 'Magazine list' : new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(date); }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date); }
function showToast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3400); }

async function saveRecord(record) {
  record.dirty = true;
  await transaction('records', 'readwrite', (store) => store.put(record));
  await transaction('outbox', 'readwrite', (store) => store.put({ id: record.id, operation: 'upsert', payload: record, changedAt: new Date().toISOString() }));
  await reload();
  scheduleSync();
}

async function toggleCollected(id, value) {
  const record = records.find((item) => item.id === id);
  if (!record) return;
  record.collectedFromChurch = value;
  record.updatedBy = adminName();
  record.updatedDate = new Date().toISOString();
  await saveRecord(record);
}

async function deleteRecord(id) {
  const record = records.find((item) => item.id === id);
  if (!record || !confirm(`Delete this route?\n\n${record.route}`)) return;
  await transaction('records', 'readwrite', (store) => store.delete(id));
  await transaction('outbox', 'readwrite', (store) => store.put({ id, operation: 'delete', payload: record, changedAt: new Date().toISOString() }));
  await reload();
  showToast('Route removed from this device.');
  scheduleSync();
}

function openEditor(id = null) {
  editId = id;
  const record = id ? records.find((item) => item.id === id) : null;
  $('recordDialogTitle').textContent = record ? 'Edit route' : 'Add route';
  $('recordParish').innerHTML = AREAS.map((area) => `<option>${escapeHtml(area)}</option>`).join('');
  $('recordParish').value = record?.parish || selectedArea;
  $('recordRoute').value = record?.route || '';
  $('recordDistributor').value = record?.distributor || '';
  $('recordInitials').value = record?.initials || '';
  $('recordCount').value = record?.numberOfMags ?? '';
  $('recordCollected').checked = record?.collectedFromChurch ?? false;
  $('recordDialog').showModal();
}

async function submitRecord(event) {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  if (!$('recordForm').reportValidity()) return;
  const previous = editId ? records.find((item) => item.id === editId) : null;
  const now = new Date().toISOString();
  const record = { id: previous?.id || `local-${crypto.randomUUID()}`, issueMonth: previous?.issueMonth || new Date().toISOString().slice(0, 7), parish: $('recordParish').value, route: $('recordRoute').value.trim(), distributor: $('recordDistributor').value.trim(), initials: $('recordInitials').value.trim(), numberOfMags: Number($('recordCount').value), collectedFromChurch: $('recordCollected').checked, sortOrder: previous?.sortOrder ?? nextSortOrder(), updatedBy: adminName(), updatedDate: now };
  await saveRecord(record);
  selectedArea = record.parish;
  $('recordDialog').close();
  render();
  showToast('Saved on this device.');
}

function printArea() {
  const rows = records.filter((r) => r.parish === selectedArea);
  const mags = rows.reduce((n, r) => n + (Number(r.numberOfMags) || 0), 0);
  const printed = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const body = rows.map((r) => `<tr><td>${escapeHtml(r.route)}</td><td>${escapeHtml(r.distributor || '')}</td><td>${escapeHtml(r.initials || '')}</td><td class="num">${Number(r.numberOfMags) || 0}</td><td class="box">${r.collectedFromChurch ? '☑' : '☐'}</td><td class="box">☐</td><td></td></tr>`).join('');
  $('printSheet').innerHTML = `<h1>${escapeHtml(selectedArea)}</h1><p class="print-meta">Magazine distribution log · ${monthLabel(rows[0]?.issueMonth || records[0]?.issueMonth)} · ${rows.length} ${rows.length === 1 ? 'route' : 'routes'} · ${mags} magazines · Printed ${printed}</p><table><thead><tr><th>Route</th><th>Distributor</th><th>Initials</th><th>Mags</th><th>Collected from church</th><th>Delivered</th><th>Notes</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="3">Total</td><td class="num">${mags}</td><td colspan="3"></td></tr></tfoot></table>`;
  window.print();
}

function sheetCsvUrl(link) {
  const parsed = new URL(link);
  const match = parsed.pathname.match(/\/spreadsheets\/d\/([\w-]+)/);
  if (!match) return link;
  const gid = parsed.searchParams.get('gid') || new URLSearchParams(parsed.hash.slice(1)).get('gid') || '0';
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function findColumn(headers, aliases) { return headers.findIndex((header) => aliases.includes(normalize(header))); }
function toBool(value) { return ['true', 'yes', 'y', '1', 'x', 'checked', '✓', '✔'].includes(String(value || '').trim().toLowerCase()); }

const apiUrl = () => (localStorage.getItem('mag-api-url') || DEFAULT_API || '').trim();
const adminName = () => localStorage.getItem('mag-admin-name') || 'Admin';
const nextSortOrder = () => Math.max(0, ...records.map((r) => Number(r.sortOrder) || 0)) + 1;
const setPref = (key, value) => value ? localStorage.setItem(key, value) : localStorage.removeItem(key);
let syncTimer, syncing = false;

async function fetchCsvRows() {
  const link = localStorage.getItem('mag-sheet-link') || DEFAULT_SHEET;
  const response = await fetch(sheetCsvUrl(link), { cache: 'no-store', mode: 'cors' });
  if (!response.ok) throw new Error(`Sheet returned ${response.status}`);
  const rows = parseCsv(await response.text());
  const aliases = rows.map((row) => row.map(normalize));
  const headerIndex = aliases.findIndex((headers) => findColumn(headers, ['parish', 'parisharea']) >= 0 && findColumn(headers, ['route', 'distributionroute']) >= 0 && findColumn(headers, ['numberofmags', 'numberofmagazines', 'magazines', 'count']) >= 0);
  if (headerIndex < 0) throw new Error('Required Parish, Route and Number of mags headers were not found.');
  const headers = aliases[headerIndex];
  const col = (names) => findColumn(headers, names);
  const c = { parish: col(['parish','parisharea']), route: col(['route','distributionroute']), distributor: col(['distributor']), initials: col(['initials']), count: col(['numberofmags','numberofmagazines','magazines','count']), collected: col(['collectedfromchurch','collected']), updatedBy: col(['updatedby']), updatedDate: col(['updateddate','updatedat']), id: col(['id','recordid']), issue: col(['issuemonth','issue']), order: col(['sortorder','order']) };
  return rows.slice(headerIndex + 1).map((row, i) => {
    const at = (index) => index < 0 ? '' : row[index] || '';
    const parish = at(c.parish), route = at(c.route), count = Number(String(at(c.count)).replaceAll(',', ''));
    if (!parish || !route || !Number.isFinite(count)) return null;
    const distributor = at(c.distributor), initials = at(c.initials);
    const key = [parish, route, distributor, initials].join('|').toLowerCase();
    return { id: at(c.id) || `sheet-${hash(key)}`, parish, route, distributor, initials, numberOfMags: count, collectedFromChurch: toBool(at(c.collected)), sortOrder: Number(at(c.order)) || i + 1, updatedBy: at(c.updatedBy), updatedDate: at(c.updatedDate), issueMonth: at(c.issue) || new Date().toISOString().slice(0,7), dirty: false };
  }).filter(Boolean);
}

async function fetchRemote() {
  if (!apiUrl()) return fetchCsvRows();
  const res = await fetch(apiUrl(), { cache: 'no-store' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Script error');
  return data.rows.map((r, i) => ({
    id: String(r.id), parish: String(r.parish).trim(), route: String(r.route).trim(),
    distributor: String(r.distributor || '').trim(), initials: String(r.initials || '').trim(),
    numberOfMags: Number(r.numberOfMags) || 0,
    collectedFromChurch: r.collectedFromChurch === true || toBool(r.collectedFromChurch),
    sortOrder: Number(r.sortOrder) || i + 1,
    issueMonth: String(r.issueMonth || '').slice(0, 7) || new Date().toISOString().slice(0, 7),
    updatedBy: String(r.updatedBy || ''), updatedDate: String(r.updatedDate || ''), dirty: false
  }));
}

async function refreshSheet() {
  if (!navigator.onLine) { setStatus('Offline · saved list available'); showToast('You are offline. Your saved list is available.'); return; }
  $('refreshButton').classList.add('spinning');
  setStatus('Refreshing sheet…');
  try {
    const remote = await fetchRemote();
    if (!remote.length) throw new Error('No usable data rows found in the sheet.');
    const outbox = await getAll('outbox');
    const local = await getAll('records');
    const dirtyIds = new Set(outbox.map((item) => item.id));
    const dirtyKeys = new Set(local.filter((r) => r.dirty || dirtyIds.has(r.id)).map(naturalKey));
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    for (const item of local) if (!item.dirty && !dirtyIds.has(item.id)) store.delete(item.id);
    for (const item of remote) {
      if (dirtyIds.has(item.id) || dirtyKeys.has(naturalKey(item))) continue; // keep unsynced local edits and deletions
      store.put(item);
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    await reload();
    setStatus(`Sheet refreshed · ${remote.length} rows${outbox.length ? ` · ${outbox.length} local edits pending` : ''}`);
    showToast(`Imported ${remote.length} rows from the sheet.`);
  } catch (error) {
    setStatus('Sheet unavailable · saved list kept');
    showToast(`Could not refresh. Check sheet access and headers. ${error.message}`);
  } finally { $('refreshButton').classList.remove('spinning'); }
}

async function pushOutbox() {
  const outbox = await getAll('outbox');
  if (!outbox.length) return;
  const token = localStorage.getItem('mag-admin-token');
  if (!token) throw new Error('Enter the admin code in settings to sync your edits.');
  setStatus(`Sending ${outbox.length} edit${outbox.length === 1 ? '' : 's'}…`);
  const res = await fetch(apiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids a CORS preflight
    body: JSON.stringify({ token, changes: outbox.map((o) => ({ operation: o.operation, record: o.payload })) })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Sync rejected');
  // clear only what was sent; keep anything edited again while the request ran
  const tx = db.transaction(['outbox', 'records'], 'readwrite');
  for (const item of outbox) {
    const req = tx.objectStore('outbox').get(item.id);
    req.onsuccess = () => {
      if (req.result?.changedAt !== item.changedAt) return;
      tx.objectStore('outbox').delete(item.id);
      if (item.operation === 'upsert') {
        const r = tx.objectStore('records').get(item.id);
        r.onsuccess = () => { if (r.result) { r.result.dirty = false; tx.objectStore('records').put(r.result); } };
      }
    };
  }
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}

async function syncNow() {
  if (syncing) return;
  syncing = true;
  try {
    if (apiUrl() && navigator.onLine) {
      try { await pushOutbox(); } catch (e) { setStatus('Sync failed · edits kept on device'); showToast(e.message); return; }
    }
    await refreshSheet();
  } finally { syncing = false; }
}

function scheduleSync() {
  if (!apiUrl() || !navigator.onLine) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1500);
}

async function newIssue() {
  const d = new Date(); d.setMonth(d.getMonth() + 1);
  const month = prompt('Start a new issue. Month (YYYY-MM):', d.toISOString().slice(0, 7));
  if (!month) return;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month.trim())) { showToast('Please use the format YYYY-MM, e.g. 2026-11.'); return; }
  if (!confirm(`Set every route to ${month.trim()} and untick all "Collected from church" boxes?`)) return;
  const now = new Date().toISOString();
  const tx = db.transaction(['records', 'outbox'], 'readwrite');
  for (const r of records) {
    Object.assign(r, { issueMonth: month.trim(), collectedFromChurch: false, updatedBy: adminName(), updatedDate: now, dirty: true });
    tx.objectStore('records').put(r);
    tx.objectStore('outbox').put({ id: r.id, operation: 'upsert', payload: r, changedAt: now });
  }
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  await reload();
  showToast('New issue started.');
  scheduleSync();
}

function hash(value) { let hash = 2166136261; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return (hash >>> 0).toString(16); }
function naturalKey(item) { return [item.parish, item.route, item.distributor || '', item.initials || ''].map((v) => String(v).trim().toLowerCase().replace(/[^a-z0-9]/g, '')).join('|'); }
function setStatus(text) { $('syncStatus').textContent = text; }

async function openSettings() {
  $('sheetLink').value = localStorage.getItem('mag-sheet-link') || DEFAULT_SHEET;
  $('apiUrl').value = localStorage.getItem('mag-api-url') || DEFAULT_API;
  $('adminToken').value = localStorage.getItem('mag-admin-token') || '';
  $('adminName').value = localStorage.getItem('mag-admin-name') || '';
  $('settingsDialog').showModal();
}

function bindEvents() {
  $('refreshButton').addEventListener('click', syncNow);
  $('newIssueButton').addEventListener('click', newIssue);
  $('printButton').addEventListener('click', printArea);
  $('settingsButton').addEventListener('click', openSettings);
  $('addButton').addEventListener('click', () => openEditor());
  $('modeButton').addEventListener('click', () => {
    if (!admin) {
      if (apiUrl() && !localStorage.getItem('mag-admin-token')) {
        const code = prompt('Enter the admin code:');
        if (!code) return;
        localStorage.setItem('mag-admin-token', code.trim());
      }
      if (!localStorage.getItem('mag-admin-name')) {
        const name = prompt('Your name (shown as "Updated by"):');
        if (name) localStorage.setItem('mag-admin-name', name.trim());
      }
    }
    admin = !admin;
    localStorage.setItem('mag-admin-mode', String(admin));
    render();
    showToast(admin ? 'Admin preview enabled on this device.' : 'Viewer mode enabled.');
  });
  $('recordForm').addEventListener('submit', submitRecord);
  $('settingsForm').addEventListener('submit', (event) => {
    if (event.submitter?.value !== 'save') return;
    event.preventDefault();
    setPref('mag-sheet-link', $('sheetLink').value.trim());
    setPref('mag-api-url', $('apiUrl').value.trim());
    setPref('mag-admin-token', $('adminToken').value.trim());
    setPref('mag-admin-name', $('adminName').value.trim());
    $('settingsDialog').close();
    syncNow();
  });
  $('builtInButton').addEventListener('click', (event) => {
    event.preventDefault();
    localStorage.removeItem('mag-sheet-link');
    $('settingsDialog').close();
    setStatus('Built-in data · offline ready');
    showToast('Using the built-in October 2026 list.');
  });
  window.addEventListener('online', syncNow);
}

async function start() {
  bindEvents();
  try {
    await initialize();
    const dirty = await getAll('outbox');
    setStatus(dirty.length ? `${dirty.length} local edit${dirty.length === 1 ? '' : 's'} pending sync` : 'Built-in data · offline ready');
    if (navigator.onLine) syncNow();
  } catch (error) {
    setStatus('Could not open saved data');
    $('routeList').innerHTML = `<div class="empty-state">The local list could not be opened.<br>${escapeHtml(error.message)}</div>`;
  }
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
start();
