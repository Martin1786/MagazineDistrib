const AREAS = ['Waltham Chase', 'Shedfield', 'Shirrell Heath', 'Wickham', 'Extras'];
const DEFAULT_SHEET = 'https://docs.google.com/spreadsheets/d/1XVUCnDLmZxF_S9SxugCNf88Tln-amZaL7c11SEnEUQI/edit?usp=sharing';
const DB_NAME = 'magazine-distribution-pwa';
const DB_VERSION = 1;
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
    for (const row of seed.rows) {
      const [id, parish, route, distributor, initials, numberOfMags, collectedFromChurch] = row;
      tx.objectStore('records').put({ id, issueMonth: seed.issueMonth, parish, route, distributor, initials, numberOfMags, collectedFromChurch, updatedBy: '', updatedDate: '', dirty: false });
    }
    tx.objectStore('meta').put({ key: 'seeded', value: true });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }
  await reload();
}

async function reload() {
  records = (await getAll('records')).sort((a, b) => AREAS.indexOf(a.parish) - AREAS.indexOf(b.parish) || a.route.localeCompare(b.route));
  render();
}

function render() {
  $('issueLabel').textContent = `${monthLabel(records[0]?.issueMonth || '2026-10')} · ${admin ? 'Admin mode' : 'Read only'}`;
  $('modeLabel').textContent = admin ? 'Admin' : 'Viewer';
  $('modeIcon').textContent = admin ? '✎' : '◉';
  $('addButton').classList.toggle('hidden', !admin);
  $('parishTabs').innerHTML = AREAS.map((area) => `<button class="tab ${area === selectedArea ? 'active' : ''}" data-area="${escapeHtml(area)}">${escapeHtml(area)}</button>`).join('');
  $('parishTabs').querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => { selectedArea = button.dataset.area; render(); }));
  const filtered = records.filter((record) => record.parish === selectedArea);
  $('parishTitle').textContent = selectedArea;
  $('routeCount').textContent = `${filtered.length} ${filtered.length === 1 ? 'route' : 'routes'}`;
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
}

async function toggleCollected(id, value) {
  const record = records.find((item) => item.id === id);
  if (!record) return;
  record.collectedFromChurch = value;
  record.updatedBy = 'Admin';
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
  const record = { id: previous?.id || `local-${crypto.randomUUID()}`, issueMonth: previous?.issueMonth || new Date().toISOString().slice(0, 7), parish: $('recordParish').value, route: $('recordRoute').value.trim(), distributor: $('recordDistributor').value.trim(), initials: $('recordInitials').value.trim(), numberOfMags: Number($('recordCount').value), collectedFromChurch: $('recordCollected').checked, updatedBy: 'Admin', updatedDate: now };
  await saveRecord(record);
  selectedArea = record.parish;
  $('recordDialog').close();
  render();
  showToast('Saved on this device.');
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

async function refreshSheet() {
  const link = localStorage.getItem('mag-sheet-link') || DEFAULT_SHEET;
  if (!navigator.onLine) { setStatus('Offline · saved list available'); showToast('You are offline. Your saved list is available.'); return; }
  $('refreshButton').classList.add('spinning');
  setStatus('Refreshing sheet…');
  try {
    const response = await fetch(sheetCsvUrl(link), { cache: 'no-store', mode: 'cors' });
    if (!response.ok) throw new Error(`Sheet returned ${response.status}`);
    const rows = parseCsv(await response.text());
    const aliases = rows.map((row) => row.map(normalize));
    const headerIndex = aliases.findIndex((headers) => findColumn(headers, ['parish', 'parisharea']) >= 0 && findColumn(headers, ['route', 'distributionroute']) >= 0 && findColumn(headers, ['numberofmags', 'numberofmagazines', 'magazines', 'count']) >= 0);
    if (headerIndex < 0) throw new Error('Required Parish, Route and Number of mags headers were not found.');
    const headers = aliases[headerIndex];
    const col = (names) => findColumn(headers, names);
    const c = { parish: col(['parish','parisharea']), route: col(['route','distributionroute']), distributor: col(['distributor']), initials: col(['initials']), count: col(['numberofmags','numberofmagazines','magazines','count']), collected: col(['collectedfromchurch','collected']), updatedBy: col(['updatedby']), updatedDate: col(['updateddate','updatedat']), id: col(['id','recordid']), issue: col(['issuemonth','issue']) };
    const remote = rows.slice(headerIndex + 1).map((row) => {
      const at = (index) => index < 0 ? '' : row[index] || '';
      const parish = at(c.parish), route = at(c.route), count = Number(String(at(c.count)).replaceAll(',', ''));
      if (!parish || !route || !Number.isFinite(count)) return null;
      const distributor = at(c.distributor), initials = at(c.initials);
      const key = [parish, route, distributor, initials].join('|').toLowerCase();
      return { id: at(c.id) || `sheet-${hash(key)}`, parish, route, distributor, initials, numberOfMags: count, collectedFromChurch: toBool(at(c.collected)), updatedBy: at(c.updatedBy), updatedDate: at(c.updatedDate), issueMonth: at(c.issue) || new Date().toISOString().slice(0,7), dirty: false };
    }).filter(Boolean);
    if (!remote.length) throw new Error('No usable data rows found in the sheet.');
    const outbox = await getAll('outbox');
    const dirtyIds = new Set(outbox.map((item) => item.id));
    const deletedKeys = new Set(outbox.filter((item) => item.operation === 'delete' && item.payload).map((item) => naturalKey(item.payload)));
    const local = await getAll('records');
    const byKey = new Map(local.map((item) => [naturalKey(item), item]));
    const remoteKeys = new Set(remote.map(naturalKey));
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    for (const item of local) if (!item.dirty && !dirtyIds.has(item.id)) store.delete(item.id);
    for (const item of remote) {
      if (deletedKeys.has(naturalKey(item))) continue;
      const old = byKey.get(naturalKey(item));
      if (old && (old.dirty || dirtyIds.has(old.id))) continue;
      item.id = old?.id || item.id;
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

function hash(value) { let hash = 2166136261; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return (hash >>> 0).toString(16); }
function naturalKey(item) { return [item.parish, item.route, item.distributor || '', item.initials || ''].map((v) => String(v).trim().toLowerCase().replace(/[^a-z0-9]/g, '')).join('|'); }
function setStatus(text) { $('syncStatus').textContent = text; }

async function openSettings() {
  $('sheetLink').value = localStorage.getItem('mag-sheet-link') || DEFAULT_SHEET;
  $('settingsDialog').showModal();
}

function bindEvents() {
  $('refreshButton').addEventListener('click', refreshSheet);
  $('settingsButton').addEventListener('click', openSettings);
  $('addButton').addEventListener('click', () => openEditor());
  $('modeButton').addEventListener('click', () => {
    admin = !admin;
    localStorage.setItem('mag-admin-mode', String(admin));
    render();
    showToast(admin ? 'Admin preview enabled on this device.' : 'Viewer mode enabled.');
  });
  $('recordForm').addEventListener('submit', submitRecord);
  $('settingsForm').addEventListener('submit', (event) => {
    if (event.submitter?.value !== 'save') return;
    event.preventDefault();
    localStorage.setItem('mag-sheet-link', $('sheetLink').value.trim());
    $('settingsDialog').close();
    refreshSheet();
  });
  $('builtInButton').addEventListener('click', (event) => {
    event.preventDefault();
    localStorage.removeItem('mag-sheet-link');
    $('settingsDialog').close();
    setStatus('Built-in data · offline ready');
    showToast('Using the built-in October 2026 list.');
  });
  window.addEventListener('online', refreshSheet);
}

async function start() {
  bindEvents();
  try {
    await initialize();
    const dirty = await getAll('outbox');
    setStatus(dirty.length ? `${dirty.length} local edit${dirty.length === 1 ? '' : 's'} pending sync` : 'Built-in data · offline ready');
    if (navigator.onLine) refreshSheet();
  } catch (error) {
    setStatus('Could not open saved data');
    $('routeList').innerHTML = `<div class="empty-state">The local list could not be opened.<br>${escapeHtml(error.message)}</div>`;
  }
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
start();
