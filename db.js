// db.js – IndexedDB (offline-first) + Sync-Queue + Supabase-Auth. API siehe DEV.md.
import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const DB_NAME = 'kurcoach';
const DB_VERSION = 1;
const TABELLEN = ['profil', 'mahlzeiten', 'messungen', 'uebungen', 'trainings', 'saetze', 'tageswerte', 'termine', 'checklisten_status'];
const MIT_DATUM = new Set(['mahlzeiten', 'messungen', 'trainings', 'tageswerte', 'termine', 'checklisten_status']);
const CONFLICT = {
  profil: 'user_id', tageswerte: 'user_id,datum', checklisten_status: 'user_id,datum,punkt_id',
};
const BATCH = 200;
const PULL_LIMIT = 1000;
const MAX_VERSUCHE = 5;
const DEBOUNCE_MS = 800;
const BACKOFF_MIN = 5000;
const BACKOFF_MAX = 5 * 60 * 1000;

const demo = !(SUPABASE_URL && SUPABASE_ANON_KEY);
let sb = null;
let idb = null;
let dbPromise = null;
let initP = null;
let _session = null;

const changeCbs = new Set();
const statusCbs = new Set();
const authCbs = new Set();
const status = { online: true, offen: 0, letzterSync: null, fehler: null, angemeldet: demo };

// ---------------------------------------------------------------- Helfer
const jetzt = () => new Date().toISOString();
const ts = (s) => { const t = Date.parse(s); return Number.isNaN(t) ? 0 : t; };
const istTabelle = (t) => TABELLEN.includes(t);
function pruefeTabelle(t) { if (!istTabelle(t)) throw new Error(`Unbekannte Tabelle: ${t}`); }

function keyVon(table, row) {
  switch (table) {
    case 'profil': return 'me';
    case 'tageswerte': return row.datum;
    case 'checklisten_status': return `${row.datum}|${row.punkt_id}`;
    default: return row.id;
  }
}

function ohneMeta(row) {
  const o = { ...row };
  delete o._key; delete o.server_at;
  return o;
}

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function txDone(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('IndexedDB-Transaktion abgebrochen'));
  });
}

function oeffneDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const t of TABELLEN) {
        if (!d.objectStoreNames.contains(t)) {
          const s = d.createObjectStore(t, { keyPath: '_key' });
          if (MIT_DATUM.has(t)) s.createIndex('datum', 'datum');
        }
      }
      if (!d.objectStoreNames.contains('queue')) {
        const q = d.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        q.createIndex('tk', ['table', 'key']);
      }
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      if (!d.objectStoreNames.contains('tot')) d.createObjectStore('tot', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('IndexedDB blockiert'));
  });
}

async function bereit() {
  if (!dbPromise) dbPromise = oeffneDb().then((d) => { idb = d; }, (e) => { dbPromise = null; throw e; });
  await dbPromise;
}

// Schreibzugriffe lokal strikt nacheinander
let serialKette = Promise.resolve();
function serial(fn) {
  const p = serialKette.then(fn, fn);
  serialKette = p.catch(() => {});
  return p;
}

async function idbGet(store, key) {
  await bereit();
  return req(idb.transaction(store).objectStore(store).get(key));
}
async function idbAll(store) {
  await bereit();
  return req(idb.transaction(store).objectStore(store).getAll());
}

function meldeChange(table) {
  for (const cb of [...changeCbs]) { try { cb({ table }); } catch (e) { console.error(e); } }
}
function meldeStatus() {
  const s = syncStatus();
  for (const cb of [...statusCbs]) { try { cb(s); } catch (e) { console.error(e); } }
}
async function zaehleOffen() {
  try { await bereit(); status.offen = await req(idb.transaction('queue').objectStore('queue').count()); } catch { /* ignorieren */ }
  meldeStatus();
}

// ---------------------------------------------------------------- Lokal schreiben + Queue
const sendend = new Set(); // Queue-IDs, die gerade gesendet werden

// Schreibt Zeile lokal und reiht Payload ein (Koaleszenz) – atomar in einer Transaktion.
function schreibe(table, key, row, payload) {
  return serial(async () => {
    await bereit();
    const stores = demo ? [table] : [table, 'queue'];
    const tx = idb.transaction(stores, 'readwrite');
    tx.objectStore(table).put({ ...row, _key: key });
    if (!demo) {
      const q = tx.objectStore('queue');
      const r = q.index('tk').getAll([table, key]);
      r.onsuccess = () => {
        const frei = r.result.filter((e) => !sendend.has(e.id));
        const e = frei[frei.length - 1];
        if (e) {
          e.payload = table === 'tageswerte' ? Object.assign(e.payload, payload) : payload;
          e.versuche = 0; e.fehler = null;
          q.put(e);
        } else {
          q.add({ table, key, payload, versuche: 0, fehler: null });
        }
      };
    }
    await txDone(tx);
  }).then(() => {
    meldeChange(table);
    if (!demo) { zaehleOffen(); planeFlush(); }
  });
}

async function holeRoh(table, key) {
  return idbGet(table, key);
}

export async function put(table, row) {
  pruefeTabelle(table);
  const neu = { ...ohneMeta(row), updated_at: jetzt(), geloescht: false };
  const key = keyVon(table, neu);
  if (key == null || key === 'undefined|undefined') throw new Error(`Schlüssel für ${table} fehlt`);
  await schreibe(table, key, neu, { ...neu });
  return neu;
}

export async function patch(table, key, felder) {
  pruefeTabelle(table);
  const alt = await holeRoh(table, key);
  const f = ohneMeta(felder || {});
  const neu = { ...(alt ? ohneMeta(alt) : {}), ...f, updated_at: jetzt(), geloescht: false };
  if (table === 'tageswerte') neu.datum = key;
  else if (table === 'checklisten_status') {
    const [d, ...p] = String(key).split('|');
    neu.datum = neu.datum || d; neu.punkt_id = neu.punkt_id || p.join('|');
  } else if (table !== 'profil') neu.id = neu.id || key;
  let payload;
  if (table === 'tageswerte') payload = { ...f, datum: key, updated_at: neu.updated_at, geloescht: false };
  else payload = { ...neu };
  await schreibe(table, key, neu, payload);
  return neu;
}

export async function remove(table, key) {
  pruefeTabelle(table);
  const alt = await holeRoh(table, key);
  if (!alt) return;
  const neu = { ...ohneMeta(alt), geloescht: true, updated_at: jetzt() };
  const payload = table === 'tageswerte'
    ? { datum: key, geloescht: true, updated_at: neu.updated_at }
    : { ...neu };
  await schreibe(table, key, neu, payload);
}

function sichtbar(row) {
  if (!row || row.geloescht) return undefined;
  const o = { ...row }; delete o._key;
  return o;
}

export async function get(table, key) {
  pruefeTabelle(table);
  return sichtbar(await idbGet(table, key));
}

export async function all(table, filterFn) {
  pruefeTabelle(table);
  const rows = (await idbAll(table)).map(sichtbar).filter(Boolean);
  return filterFn ? rows.filter(filterFn) : rows;
}

export async function byDatum(table, datum) {
  pruefeTabelle(table);
  await bereit();
  const s = idb.transaction(table).objectStore(table);
  if (!s.indexNames.contains('datum')) return (await all(table)).filter((r) => r.datum === datum);
  const rows = await req(s.index('datum').getAll(datum));
  return rows.map(sichtbar).filter((r) => r && r.datum === datum);
}

export function neueId(prefix) {
  const z = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${prefix}-${Date.now().toString(36)}-${z}`;
}

export function onChange(cb) { changeCbs.add(cb); return () => changeCbs.delete(cb); }

// ---------------------------------------------------------------- Status
export function istOnlineModus() { return !demo; }

export function syncStatus() {
  return {
    online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    offen: status.offen,
    letzterSync: status.letzterSync,
    fehler: status.fehler,
    angemeldet: demo ? true : !!_session,
  };
}
export function onSyncStatus(cb) { statusCbs.add(cb); return () => statusCbs.delete(cb); }

// ---------------------------------------------------------------- Auth
function deutscheFehler(err, kontext) {
  const msg = String((err && err.message) || err || '');
  const st = err && err.status;
  if (st === 429 || /rate limit|too many|security purposes|over_email_send_rate/i.test(msg) || (err && err.code === 'over_email_send_rate_limit')) {
    return 'Zu viele Mails – bitte kurz warten';
  }
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed|network request/i.test(msg)) {
    return 'Keine Verbindung zum Server';
  }
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(msg)) return 'Ungültige E-Mail-Adresse';
  if (/expired|invalid|token/i.test(msg) && kontext === 'code') return 'Code ungültig oder abgelaufen';
  if (/jwt|not authenticated|unauthorized/i.test(msg) || st === 401) return 'Nicht angemeldet – bitte neu anmelden';
  if (kontext === 'rpc') return `Serverfehler: ${msg}`;
  return msg || 'Unbekannter Fehler';
}

export async function session() {
  if (demo) return { demo: true };
  await init();
  try {
    const { data } = await sb.auth.getSession();
    _session = data ? data.session : null;
  } catch { /* offline: gecachte Session behalten */ }
  return _session || null;
}

export function onAuth(cb) { authCbs.add(cb); return () => authCbs.delete(cb); }

export async function loginLink(email) {
  if (demo) return;
  await init();
  try {
    const { error } = await sb.auth.signInWithOtp({
      email: String(email || '').trim(),
      options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true },
    });
    if (error) throw error;
  } catch (e) { throw new Error(deutscheFehler(e, 'link')); }
}

/**
 * Anmeldung mit E-Mail + Passwort (braucht keine angepasste Mail-Vorlage).
 * neu=true: Konto anlegen. Ist in Supabase "Confirm email" aktiv, kommt erst eine Bestätigungsmail
 * -> Rückgabe {bestaetigen:true}; nach dem Klick auf den Link normal anmelden.
 */
export async function loginPasswort(email, passwort, neu = false) {
  if (demo) return {};
  await init();
  const e = String(email || '').trim();
  let r;
  try {
    r = neu
      ? await sb.auth.signUp({ email: e, password: passwort, options: { emailRedirectTo: location.origin + location.pathname } })
      : await sb.auth.signInWithPassword({ email: e, password: passwort });
    if (r.error) throw r.error;
  } catch (x) {
    const m = String(x?.message || x);
    if (/invalid login credentials/i.test(m)) throw new Error('E-Mail oder Passwort falsch.');
    if (/email not confirmed/i.test(m)) throw new Error('Bitte zuerst den Bestätigungslink in der Mail antippen, dann hier anmelden.');
    if (/already registered/i.test(m)) throw new Error('Für diese E-Mail gibt es schon ein Konto – bitte „Anmelden“ wählen.');
    if (/password should be at least/i.test(m)) throw new Error('Das Passwort muss mindestens 6 Zeichen haben.');
    throw new Error(deutscheFehler(x, 'passwort'));
  }
  if (!r.data?.session) return { bestaetigen: true };
  _session = r.data.session;
  meldeStatus();
  sync().catch(() => {});
  return {};
}

export async function loginCode(email, code) {
  if (demo) return;
  await init();
  let data;
  try {
    const r = await sb.auth.verifyOtp({ email: String(email || '').trim(), token: String(code || '').replace(/\s+/g, ''), type: 'email' });
    if (r.error) throw r.error;
    data = r.data;
  } catch (e) { throw new Error(deutscheFehler(e, 'code')); }
  if (data && data.session) _session = data.session;
  meldeStatus();
  sync().catch(() => {});
}

export async function logout() {
  if (demo) return;
  await init();
  try { await sb.auth.signOut(); } catch { /* lokal trotzdem abmelden */ }
  _session = null;
  status.fehler = null;
  meldeStatus();
}

export async function rpc(name, args) {
  if (demo) throw new Error('Nicht verfügbar im Demo-Modus');
  await init();
  let res;
  try { res = await sb.rpc(name, args || {}); } catch (e) { throw new Error(deutscheFehler(e, 'rpc')); }
  if (res.error) throw new Error(deutscheFehler(res.error, 'rpc'));
  return res.data;
}

// ---------------------------------------------------------------- Flush
function fehlerArt(err) {
  if (!err) return 'ok';
  const st = err.status;
  const msg = String(err.message || err);
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed|fetch/i.test(msg) || st === 0 || st >= 500) return 'netz';
  if (st === undefined && !err.code && !err.details && !err.hint) return 'netz';
  if (st === 401 || /jwt|PGRST30[0-9]/i.test(msg) || /^PGRST30/.test(err.code || '')) return 'auth';
  return 'abgelehnt';
}

let flushTimer = null;
let backoff = BACKOFF_MIN;
let retryTimer = null;

function planeFlush() {
  if (demo) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { sync().catch(() => {}); }, DEBOUNCE_MS);
}
function planeRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { sync().catch(() => {}); }, backoff);
  backoff = Math.min(backoff * 2, BACKOFF_MAX);
}

async function loescheQueue(ids) {
  if (!ids.length) return;
  await bereit();
  const tx = idb.transaction('queue', 'readwrite');
  for (const id of ids) tx.objectStore('queue').delete(id);
  await txDone(tx);
}

async function versucheErhoehen(eintrag, fehlertext) {
  await bereit();
  const tot = eintrag.versuche + 1 >= MAX_VERSUCHE;
  const tx = idb.transaction(['queue', 'tot'], 'readwrite');
  if (tot) {
    tx.objectStore('queue').delete(eintrag.id);
    tx.objectStore('tot').add({ table: eintrag.table, key: eintrag.key, payload: eintrag.payload, fehler: fehlertext, at: jetzt() });
  } else {
    tx.objectStore('queue').put({ ...eintrag, versuche: eintrag.versuche + 1, fehler: fehlertext });
  }
  await txDone(tx);
  eintrag.versuche += 1;
  return tot;
}

function zeilenFuerServer(eintraege) {
  return eintraege.map((e) => {
    const p = { ...e.payload };
    delete p.server_at; delete p._key;
    p.user_id = _session.user.id;
    return p;
  });
}

// Sendet eine Liste Einträge einer Tabelle. Rückgabe: {gesendet, abbruch:'netz'|'auth'|null, fehler}
async function sendeGruppe(table, eintraege) {
  let gesendet = 0;
  let letzterFehler = null;
  // Zeilen mit gleicher Spaltenmenge zusammen senden (Patch-Semantik bei tageswerte)
  const gruppen = new Map();
  for (const e of eintraege) {
    // tageswerte: einzeln in Queue-Reihenfolge (Patches desselben Tages dürfen sich nicht überholen)
    const sig = table === 'tageswerte' ? `e${e.id}` : '*';
    if (!gruppen.has(sig)) gruppen.set(sig, []);
    gruppen.get(sig).push(e);
  }
  for (const liste of gruppen.values()) {
    for (let i = 0; i < liste.length; i += BATCH) {
      const teil = liste.slice(i, i + BATCH);
      const r = await sendeTeil(table, teil);
      gesendet += r.gesendet;
      if (r.fehler) letzterFehler = r.fehler;
      if (r.abbruch) return { gesendet, abbruch: r.abbruch, fehler: r.fehler };
    }
  }
  return { gesendet, abbruch: null, fehler: letzterFehler };
}

async function sendeTeil(table, teil) {
  teil.forEach((e) => sendend.add(e.id));
  try {
    let error = null;
    try {
      const res = await sb.from(table).upsert(zeilenFuerServer(teil), { onConflict: CONFLICT[table] || 'id' });
      error = res.error;
    } catch (e) { error = e; }
    if (!error) {
      await loescheQueue(teil.map((e) => e.id));
      return { gesendet: teil.length, abbruch: null, fehler: null };
    }
    const art = fehlerArt(error);
    const text = String(error.message || error);
    if (art === 'netz') return { gesendet: 0, abbruch: 'netz', fehler: text };
    if (art === 'auth') {
      try { await sb.auth.refreshSession(); } catch { /* ignorieren */ }
      return { gesendet: 0, abbruch: 'auth', fehler: 'Anmeldung abgelaufen – bitte neu anmelden' };
    }
    // Abgelehnt: bei Batch einzeln erneut versuchen, um die schlechte Zeile zu isolieren
    if (teil.length > 1) {
      let g = 0; let f = text;
      for (const e of teil) {
        const r = await sendeTeilEinzeln(table, e);
        g += r.gesendet;
        if (r.fehler) f = r.fehler;
        if (r.abbruch) return { gesendet: g, abbruch: r.abbruch, fehler: f };
      }
      return { gesendet: g, abbruch: null, fehler: f };
    }
    await versucheErhoehen(teil[0], text);
    return { gesendet: 0, abbruch: null, fehler: text };
  } finally {
    teil.forEach((e) => sendend.delete(e.id));
  }
}

async function sendeTeilEinzeln(table, e) {
  let error = null;
  try {
    const res = await sb.from(table).upsert(zeilenFuerServer([e]), { onConflict: CONFLICT[table] || 'id' });
    error = res.error;
  } catch (x) { error = x; }
  if (!error) { await loescheQueue([e.id]); return { gesendet: 1, abbruch: null, fehler: null }; }
  const art = fehlerArt(error);
  const text = String(error.message || error);
  if (art === 'netz') return { gesendet: 0, abbruch: 'netz', fehler: text };
  if (art === 'auth') return { gesendet: 0, abbruch: 'auth', fehler: 'Anmeldung abgelaufen – bitte neu anmelden' };
  await versucheErhoehen(e, text);
  return { gesendet: 0, abbruch: null, fehler: text };
}

async function flush() {
  const queue = (await idbAll('queue')).sort((a, b) => a.id - b.id);
  if (!queue.length) return { gesendet: 0, abbruch: null, fehler: null };
  const nachTabelle = new Map();
  for (const e of queue) {
    if (!nachTabelle.has(e.table)) nachTabelle.set(e.table, []);
    nachTabelle.get(e.table).push(e);
  }
  let gesendet = 0; let fehler = null;
  for (const [table, liste] of nachTabelle) {
    if (!istTabelle(table)) continue;
    const r = await sendeGruppe(table, liste);
    gesendet += r.gesendet;
    if (r.fehler) fehler = r.fehler;
    if (r.abbruch) return { gesendet, abbruch: r.abbruch, fehler };
  }
  return { gesendet, abbruch: null, fehler };
}

// ---------------------------------------------------------------- Pull
async function wendeRemoteAn(table, rows) {
  if (!rows.length) return;
  await serial(async () => {
    await bereit();
    const queue = table === 'tageswerte' ? (await idbAll('queue')).filter((e) => e.table === table).sort((a, b) => a.id - b.id) : [];
    const tx = idb.transaction(table, 'readwrite');
    const s = tx.objectStore(table);
    await Promise.all(rows.map((remote) => new Promise((res, rej) => {
      const key = keyVon(table, remote);
      if (key == null) return res();
      const r = s.get(key);
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const lokal = r.result;
        if (table === 'tageswerte') {
          const neu = { ...remote, _key: key };
          for (const e of queue) if (e.key === key) Object.assign(neu, e.payload);
          s.put(neu);
        } else if (!lokal || ts(remote.updated_at) >= ts(lokal.updated_at)) {
          s.put({ ...remote, _key: key });
        }
        res();
      };
    })));
    await txDone(tx);
  });
  meldeChange(table);
}

async function pull() {
  let geholt = 0;
  for (const table of TABELLEN) {
    for (;;) {
      const last = (await idbGet('meta', table)) || '1970-01-01T00:00:00Z';
      const { data, error } = await sb.from(table).select('*').gt('server_at', last).order('server_at', { ascending: true }).limit(PULL_LIMIT);
      if (error) throw error;
      const rows = data || [];
      if (!rows.length) break;
      await wendeRemoteAn(table, rows);
      let max = last;
      for (const r of rows) if (r.server_at && ts(r.server_at) > ts(max)) max = r.server_at;
      await bereit();
      const tx = idb.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(max, table);
      await txDone(tx);
      geholt += rows.length;
      if (rows.length < PULL_LIMIT || max === last) break;
    }
  }
  return geholt;
}

// ---------------------------------------------------------------- Sync (Mutex)
let laufend = null;
let nochmal = false;

export function sync() {
  if (demo) return Promise.resolve({ gesendet: 0, geholt: 0, fehler: null });
  if (laufend) { nochmal = true; return laufend; }
  laufend = (async () => {
    const erg = { gesendet: 0, geholt: 0, fehler: null };
    try {
      await init();
      if (!sb || typeof navigator !== 'undefined' && navigator.onLine === false) {
        erg.fehler = 'Offline';
        return erg;
      }
      if (!_session) { await session(); }
      if (!_session) { erg.fehler = null; return erg; }
      const f = await flush();
      erg.gesendet = f.gesendet;
      if (f.fehler) { erg.fehler = f.fehler; status.fehler = f.fehler; }
      if (f.abbruch) {
        if (f.abbruch === 'netz') planeRetry();
        return erg;
      }
      erg.geholt = await pull();
      if (!f.fehler) status.fehler = null;
      status.letzterSync = jetzt();
      backoff = BACKOFF_MIN;
      clearTimeout(retryTimer);
    } catch (e) {
      const art = fehlerArt(e);
      erg.fehler = art === 'netz' ? 'Keine Verbindung zum Server' : String((e && e.message) || e);
      status.fehler = erg.fehler;
      if (art === 'netz') planeRetry();
      else if (art === 'auth') { try { await sb.auth.refreshSession(); } catch { /* ignorieren */ } }
    } finally {
      await zaehleOffen();
      laufend = null;
      if (nochmal) { nochmal = false; planeFlush(); }
    }
    return erg;
  })();
  return laufend;
}

// ---------------------------------------------------------------- Export / Import / Leeren
export async function exportAlles() {
  const tabellen = {};
  for (const t of TABELLEN) tabellen[t] = (await idbAll(t)).map((r) => { const o = { ...r }; delete o._key; return o; });
  return { version: 1, exportiert_at: jetzt(), tabellen };
}

export async function importBackup(obj) {
  const tabellen = obj && obj.tabellen;
  if (!tabellen || typeof tabellen !== 'object') throw new Error('Ungültiges Backup');
  let n = 0;
  for (const t of TABELLEN) {
    const rows = Array.isArray(tabellen[t]) ? tabellen[t] : [];
    for (const r of rows) {
      const row = ohneMeta(r);
      const key = keyVon(t, row);
      if (key == null) continue;
      const lokal = await holeRoh(t, key);
      if (lokal && ts(lokal.updated_at) >= ts(row.updated_at)) continue;
      if (!row.updated_at) row.updated_at = jetzt();
      await schreibe(t, key, row, { ...row });
      n += 1;
    }
  }
  return n;
}

export async function lokalLeeren() {
  await bereit();
  const namen = [...TABELLEN, 'queue', 'meta', 'tot'];
  await serial(async () => {
    const tx = idb.transaction(namen, 'readwrite');
    for (const n of namen) tx.objectStore(n).clear();
    await txDone(tx);
  });
  status.offen = 0;
  for (const t of TABELLEN) meldeChange(t);
  meldeStatus();
}

// ---------------------------------------------------------------- Init
let sweepGestartet = false;

export function init() {
  if (initP) return initP;
  initP = (async () => {
    await bereit();
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* egal */ }
    if (!demo) {
      sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
      });
      sb.auth.onAuthStateChange((event, s) => {
        _session = s || null;
        meldeStatus();
        for (const cb of [...authCbs]) { try { cb(_session); } catch (e) { console.error(e); } }
        if (_session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
          setTimeout(() => { sync().catch(() => {}); }, 0);
        }
      });
      try { const { data } = await sb.auth.getSession(); _session = data ? data.session : null; } catch { /* offline */ }
    }
    status.angemeldet = demo ? true : !!_session;
    await zaehleOffen();
    if (!sweepGestartet && typeof window !== 'undefined') {
      sweepGestartet = true;
      if (!demo) {
        const ausloeser = () => { sync().catch(() => {}); };
        window.addEventListener('online', () => { backoff = BACKOFF_MIN; meldeStatus(); ausloeser(); });
        window.addEventListener('offline', meldeStatus);
        window.addEventListener('focus', ausloeser);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ausloeser(); });
        setInterval(() => { if (document.visibilityState === 'visible') ausloeser(); }, 60000);
      }
    }
    if (!demo) sync().catch(() => {});
  })();
  initP.catch(() => { initP = null; });
  return initP;
}
