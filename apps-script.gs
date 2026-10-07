const SHEET_NAME = 'Sheet1'; // change to your tab name
const FIELDS = {
  id: ['id','recordid'],
  issueMonth: ['issuemonth','issue'],
  parish: ['parish','parisharea'],
  route: ['route','distributionroute'],
  distributor: ['distributor'],
  initials: ['initials'],
  numberOfMags: ['numberofmags','numberofmagazines','magazines','count'],
  collectedFromChurch: ['collectedfromchurch','collected'],
  sortOrder: ['sortorder','order'],
  updatedBy: ['updatedby'],
  updatedDate: ['updateddate','updatedat']
};
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sheet_ = () => SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function columns_(sh) {
  const headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(norm);
  const map = {};
  for (const [field, aliases] of Object.entries(FIELDS)) {
    let i = headers.findIndex(h => aliases.includes(h));
    if (i < 0) { sh.getRange(1, headers.length + 1).setValue(field); headers.push(norm(field)); i = headers.length - 1; }
    map[field] = i + 1;
  }
  return map;
}

function readAll_() {
  const sh = sheet_(), cols = columns_(sh), last = sh.getLastRow();
  if (last < 2) return [];
  const idRange = sh.getRange(2, cols.id, last - 1, 1);
  const ids = idRange.getValues();
  const parishes = sh.getRange(2, cols.parish, last - 1, 1).getValues();
  let changed = false;
  ids.forEach((r, i) => { if (!r[0] && parishes[i][0]) { r[0] = Utilities.getUuid(); changed = true; } });
  if (changed) idRange.setValues(ids);
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  return data.filter(r => r[cols.parish - 1] && r[cols.route - 1]).map(row => {
    const o = {}; for (const f in cols) o[f] = row[cols[f] - 1]; return o;
  });
}

function doGet() { return json_({ ok: true, rows: readAll_() }); }

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const token = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  if (!token || body.token !== token) return json_({ ok: false, error: 'Wrong admin code' });
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(), cols = columns_(sh);
    readAll_();
    for (const ch of body.changes || []) {
      const rec = ch.record;
      const last = sh.getLastRow();
      const n = Math.max(last - 1, 0);
      const ids = n ? sh.getRange(2, cols.id, n, 1).getValues().map(r => r[0]) : [];
      let idx = ids.indexOf(rec.id);
      if (idx < 0 && n) { // fall back to parish + route (e.g. built-in rows not yet in the sheet)
        const p = sh.getRange(2, cols.parish, n, 1).getValues(), r = sh.getRange(2, cols.route, n, 1).getValues();
        idx = p.findIndex((x, i) => norm(x[0]) === norm(rec.parish) && norm(r[i][0]) === norm(rec.route));
      }
      if (ch.operation === 'delete') { if (idx >= 0) sh.deleteRow(idx + 2); continue; }
      const row = idx >= 0 ? idx + 2 : last + 1;
      for (const f in cols) {
        if (!(f in rec)) continue;
        const cell = sh.getRange(row, cols[f]);
        if (f === 'issueMonth' || f === 'updatedDate') cell.setNumberFormat('@');
        cell.setValue(rec[f] ?? '');
      }
    }
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}
