// Backend: Nerd-Infos (Sync, Health-Empfang, Berechnung, Belege, Kurzbefehl, Daten). Erreichbar nur über Einstellungen.
import * as db from '../db.js';
import * as calc from '../calc.js';
import { icon } from './icons.js';
import { h, zf, zf1, toast, kopiere, fehlerText, APP_VERSION, minZuHhmm, pad2 } from './util.js';
import { bestaetigen } from './sheet.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { slotStarts, ladeEvidenz, ladeTag } from './daten.js';

export const keinAutoRender = true;

const dez = (n) => String(n).replace('.', ',');
const dt = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d : null; };
const uhr = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const kurzDatum = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : '–');
const datumZeit = (d) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}. ${uhr(d)}`;
const heuteZeit = (d) => (calc.isoDatum(d) === calc.isoDatum() ? uhr(d) : datumZeit(d));

function relativ(iso) {
  const d = dt(iso);
  if (!d) return 'noch nie';
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} min`;
  if (min < 1440) return `vor ${Math.round(min / 60)} h`;
  return `vor ${Math.round(min / 1440)} d`;
}

/** Zugeklappter Abschnitt: Titel links, knapper Status rechts. Liefert { el, inhalt, status(text) } */
function sektion(titel, status, ...inhalt) {
  const st = h('span', { class: 'sek-status' }, status || '');
  const box = h('div', { class: 'sek-inhalt' }, ...inhalt);
  const el = h('details', { class: 'sek' },
    h('summary', null, h('span', { class: 'sek-titel' }, titel), st), box);
  return { el, inhalt: box, status: (t) => { st.textContent = t; } };
}

function tabelle(kopf, zeilen, leer = 'Keine Einträge.') {
  if (!zeilen.length) return h('p', { class: 'muted' }, leer);
  return h('div', { class: 'tab-scroll' }, h('table', { class: 'tab' },
    h('thead', null, h('tr', null, kopf.map((k) => h('th', null, k)))),
    h('tbody', null, zeilen.map((z) => h('tr', null, z.map((c) => h('td', null, c)))))));
}

function kv(zeilen) {
  return h('div', { class: 'tab-scroll' }, h('table', { class: 'tab kv' }, h('tbody', null, zeilen.map(([k, v]) =>
    h('tr', null, h('th', null, k), h('td', null, v == null ? '–' : v))))));
}

const quellenListe = (q) => h('ul', { class: 'quellen' }, (q || []).map((x) => h('li', null, x)));
const num = (n, f = zf) => (n == null ? '–' : f(n));
const mitEinheit = (n, e) => (n == null ? '–' : `${zf(n)} ${e}`);

// ---------------------------------------------------------------- a) Sync
function syncSektion() {
  const werte = h('div', null);
  const sek = sektion('Sync', '');
  const zeichne = (s) => {
    werte.replaceChildren(kv([
      ['Online', s.online ? 'ja' : 'nein'],
      ['Offene Einträge', String(s.offen ?? 0)],
      ['Letzter Sync', s.letzterSync ? `${datumZeit(new Date(s.letzterSync))} (${relativ(s.letzterSync)})` : 'noch nie'],
      ['Letzter Fehler', s.fehler || 'keiner'],
    ]));
    sek.status(s.fehler ? 'Fehler' : s.offen ? `${s.offen} offen` : relativ(s.letzterSync));
  };
  zeichne(db.syncStatus());
  let war = false;
  const unsub = db.onSyncStatus((s) => {
    if (sek.el.isConnected) war = true;
    else if (war) { unsub(); return; }
    zeichne(s);
  });
  const syncen = async () => {
    try {
      const r = await db.sync();
      toast(r?.fehler ? `Sync-Fehler: ${r.fehler}` : `Synchronisiert (${r?.gesendet ?? 0} gesendet, ${r?.geholt ?? 0} geholt)`);
    } catch (e) { toast('Sync fehlgeschlagen: ' + fehlerText(e)); }
  };
  sek.inhalt.append(werte,
    h('button', { type: 'button', class: 'btn', onclick: syncen }, h('span', { html: icon('sync', 20) }), ' Jetzt synchronisieren'));
  return sek.el;
}

// ---------------------------------------------------------------- b) Health-Empfang
async function healthSektion() {
  const sek = sektion('Health-Empfang', '…');
  const kopf = h('p', { class: 'muted' }, db.istOnlineModus() ? 'Zuletzt empfangen: wird geladen …' : 'Nur mit Anmeldung (Demo-Modus).');
  const tab = h('div', null);
  sek.inhalt.append(kopf, tab);
  if (db.istOnlineModus()) {
    try {
      const r = await db.rpc('ingest_status');
      const wert = Array.isArray(r) ? r[0] : r;
      const t = wert && typeof wert === 'object' ? (Object.values(wert)[0] ?? null) : wert;
      const d = dt(t);
      kopf.textContent = d ? `Zuletzt empfangen: ${datumZeit(d)}` : 'Zuletzt empfangen: noch nie';
      sek.status(d ? relativ(t) : 'noch nie');
    } catch (e) { kopf.textContent = 'Zuletzt empfangen: nicht abrufbar (' + fehlerText(e) + ')'; sek.status('nicht abrufbar'); }
  } else sek.status('–');
  const ab = calc.addTage(calc.isoDatum(), -13);
  const tw = (await db.all('tageswerte', (t) => t.datum >= ab)).sort((a, b) => b.datum.localeCompare(a.datum));
  tab.append(tabelle(
    ['Datum', 'Schritte', 'Aktiv kcal', 'Ruhepuls', 'HRV', 'Schlaf h', 'Energie', 'Aktualisiert'],
    tw.map((t) => [kurzDatum(t.datum), num(t.schritte), num(t.aktive_kcal), num(t.ruhepuls),
      t.hrv_ms != null ? zf(Math.round(t.hrv_ms)) : '–',
      t.schlaf_min != null ? zf1(t.schlaf_min / 60) : '–', num(t.energie_1_5),
      dt(t.updated_at) ? heuteZeit(dt(t.updated_at)) : '–']),
    'Keine Tageswerte in den letzten 14 Tagen.'));
  return sek.el;
}

// ---------------------------------------------------------------- c) Waage / Messungen
async function waageSektion() {
  const m = (await db.all('messungen')).sort((a, b) => `${b.datum} ${b.zeit || ''}`.localeCompare(`${a.datum} ${a.zeit || ''}`)).slice(0, 20);
  const neu = m.find((x) => x.gewicht != null);
  const sek = sektion('Waage / Messungen', neu ? `${zf1(neu.gewicht)} kg` : 'keine');
  sek.inhalt.append(tabelle(
    ['Datum', 'Gewicht', 'KFA', 'Bedingung', 'Quelle'],
    m.map((x) => [`${kurzDatum(x.datum)}${x.zeit ? ' ' + x.zeit.slice(0, 5) : ''}`,
      x.gewicht != null ? `${zf1(x.gewicht)} kg` : '–', x.kfa != null ? `${zf1(x.kfa)} %` : '–', x.bedingung || '–', x.quelle || '–'])));
  return sek.el;
}

// ---------------------------------------------------------------- d) Berechnung heute
function berechnungSektion(d) {
  const z = d.ziele, gu = z.grundumsatz || {}, um = z.umsatz || {}, r = d.readiness || {};
  const M = calc.ZIEL_MODI[z.modus];
  const plan = d.messung ? calc.proteinPlan(d.messung, d.profil) : null;
  const n = plan ? plan.mahlzeiten.filter((x) => x.g === plan.portion).length : 0;
  const ueber = (z.defizit ?? 0) < 0;
  const ampel = { gruen: 'grün', gelb: 'gelb', rot: 'rot', kalibrierung: 'Kalibrierung' }[r.ampel] || 'keine Daten';
  const sek = sektion('Berechnung heute', z.kcal != null ? `${zf(z.kcal)} kcal` : 'offen', kv([
    ['Grundumsatz Mifflin', mitEinheit(gu.mifflin, 'kcal')],
    ['Grundumsatz Katch', mitEinheit(gu.katch, 'kcal')],
    ['Grundumsatz verwendet', mitEinheit(gu.wert, 'kcal')],
    ['Umsatz', um.wert != null ? `${zf(um.wert)} kcal (${um.quelle === 'watch' ? 'Watch' : 'Schätzung'})` : '–'],
    ['Modus', `${M.name}, ${dez(M.rate)} %/Woche`],
    [ueber ? 'Überschuss' : 'Defizit', z.defizit != null ? `${zf(Math.abs(z.defizit))} kcal` : '–'],
    ['Kalorienziel', mitEinheit(z.kcal, 'kcal')],
    ['Protein', z.makros ? `${zf(z.makros.protein)} g` : '–'],
    ['Fett', z.makros ? `${zf(z.makros.fett)} g` : '–'],
    ['Kohlenhydrate', z.makros ? `${zf(z.makros.kh)} g` : '–'],
    ['Protein-Plan', plan ? `${n} × ~${plan.portion} g + ${calc.EVIDENZ.proteinVorSchlafG[1]} g vor dem Schlafen` : '–'],
    ['Schritteziel', zf(z.schritte)],
    ['Readiness', `${ampel}, ${r.punkte ?? 0} Punkte`],
    ['Gründe', r.gruende?.length ? r.gruende.join('; ') : 'keine'],
  ]));
  return sek.el;
}

// ---------------------------------------------------------------- e) Ziele & Belege
function belegeSektion(d, ev) {
  const z = d.ziele, m = d.messung;
  let werte;
  if (!m || z.kcal == null || !z.makros) {
    werte = h('p', { class: 'hinweis' }, 'Erst Gewicht eintragen, dann berechnet die App deine Ziele.');
  } else {
    const rate = z.rate ?? calc.EVIDENZ.abnahmeProzentWoche;
    const kgWoche = Math.abs(m.gewicht * rate / 100);
    werte = h('p', { class: 'muted klein-text' }, `${dez(Math.abs(rate))} % pro Woche ≈ ${dez(kgWoche.toFixed(2))} kg/Woche ${rate < 0 ? 'Zunahme' : 'Abnahme'}`);
  }
  const belege = (ev?.ziele || []).map((t) => h('details', { class: 'beleg' },
    h('summary', null, t.titel),
    h('p', null, h('strong', null, 'Regel: '), t.regel),
    h('p', null, h('strong', null, 'Warum: '), t.warum),
    quellenListe(t.quellen)));
  return sektion('Ziele & Belege', calc.ZIEL_MODI[z.modus].name, werte, ...belege).el;
}

// ---------------------------------------------------------------- f) Supplements
function supplementSektion(ev) {
  if (!ev) return sektion('Supplements & Einnahme', '–', h('p', { class: 'muted' }, 'Daten nicht verfügbar.')).el;
  const badgeKlasse = { 'hast du': 'ok', empfohlen: 'akzent' };
  return sektion('Supplements & Einnahme', `${(ev.supplements || []).length}`,
    ...(ev.supplements || []).map((s) => h('div', { class: 'supp' },
      h('div', { class: 'supp-kopf' }, h('strong', null, s.name), h('span', { class: 'badge ' + (badgeKlasse[s.status] || '') }, s.status)),
      h('p', null, s.dosis), s.zeit ? h('p', { class: 'muted' }, s.zeit) : null,
      h('p', { class: 'muted klein-text' }, s.warum), quellenListe(s.quellen))),
    ev.nicht_noetig ? h('p', null, h('strong', null, 'Nicht nötig: '), ev.nicht_noetig) : null,
    ev.hinweis ? h('p', { class: 'hinweis' }, ev.hinweis) : null).el;
}

// ---------------------------------------------------------------- g) Apple Watch / Kurzbefehl
function kopierZeile(label, wert) {
  return h('div', { class: 'kb-zeile' },
    h('span', { class: 'muted klein-text' }, label),
    h('div', { class: 'url-zeile' }, h('code', null, wert),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${label} kopieren`, html: icon('copy'),
        onclick: async () => toast((await kopiere(wert)) ? 'Kopiert' : 'Kopieren nicht möglich') })));
}

function watchSektion() {
  if (!db.istOnlineModus()) return null;
  const tokenBox = h('div', null);
  const anleitung = h('div', null, h('p', { class: 'muted' }, 'Anleitung folgt'));
  const erzeugen = async () => {
    if (!(await bestaetigen('Kurzbefehl-Token erzeugen', 'Ein bereits vorhandener Token wird ungültig. Der Kurzbefehl muss danach den neuen Token bekommen.', 'Erzeugen'))) return;
    try {
      const r = await db.rpc('create_ingest_token');
      const token = typeof r === 'string' ? r : (Array.isArray(r) ? Object.values(r[0] ?? {})[0] ?? r[0] : Object.values(r ?? {})[0]);
      tokenBox.replaceChildren(
        h('p', { class: 'hinweis' }, 'Nur jetzt sichtbar – in den Kurzbefehl einfügen.'),
        kopierZeile('Token', String(token)));
    } catch (e) { toast('Token nicht erzeugt: ' + fehlerText(e)); }
  };
  const basis = `${SUPABASE_URL}/rest/v1/rpc/ingest_health`;
  const body = '{"p_token":"…","p_datum":"JJJJ-MM-TT","p_werte":{"schritte":1234}}';
  fetch('./data/kurzbefehl.json').then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j?.schritte?.length) return;
    anleitung.replaceChildren(h('ol', { class: 'kb-schritte' }, j.schritte.map((x) =>
      h('li', null, h('strong', null, x.titel), x.text ? h('p', null, x.text) : null))));
  }).catch(() => {});
  return sektion('Apple Watch / Kurzbefehl', 'Token',
    h('button', { type: 'button', class: 'btn', onclick: erzeugen }, 'Kurzbefehl-Token erzeugen'),
    tokenBox,
    kopierZeile('URL', basis),
    kopierZeile('Header apikey', SUPABASE_ANON_KEY),
    kopierZeile('Header Content-Type', 'application/json'),
    kopierZeile('Beispiel-Body', body),
    h('details', { class: 'beleg' }, h('summary', null, 'Schritt-für-Schritt-Anleitung'), anleitung)).el;
}

// ---------------------------------------------------------------- h) Slot-Zeiten
async function einstellungenSpeichern(teil) {
  const p = (await db.get('profil', 'me')) || {};
  await db.put('profil', { ...p, einstellungen: { ...(p.einstellungen || {}), ...teil } });
}

function zeitenSektion(profil) {
  const starts = slotStarts(profil?.einstellungen);
  const inputs = {};
  const basis = location.origin + location.pathname;
  const zeilen = calc.SLOTS.map((s) => {
    const inp = h('input', { type: 'time', value: minZuHhmm(starts[s]), 'aria-label': `Startzeit ${calc.SLOT_NAMEN[s]}` });
    inputs[s] = inp;
    const url = `${basis}?slot=${s}`;
    return h('li', { class: 'slot-zeile' },
      h('div', { class: 'slot-kopf' }, h('strong', null, calc.SLOT_NAMEN[s]), inp),
      h('div', { class: 'url-zeile' }, h('code', null, url),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Kurzbefehl-URL ${calc.SLOT_NAMEN[s]} kopieren`, html: icon('copy'),
          onclick: async () => toast((await kopiere(url)) ? 'URL kopiert' : 'Kopieren nicht möglich') })));
  });
  const speichern = async () => {
    const z = {};
    for (const s of calc.SLOTS) if (/^\d{2}:\d{2}$/.test(inputs[s].value)) z[s] = inputs[s].value;
    await einstellungenSpeichern({ slot_zeiten: z });
    toast('Zeiten gespeichert');
  };
  return sektion('Checklisten-Zeiten & Kurzbefehl-URLs', '',
    h('p', { class: 'muted' }, 'Die Zeiten steuern die Anzeige. Die Kurzbefehl-Automation selbst stellst du in der Kurzbefehle-App ein und trägst dort die URL ein.'),
    h('ul', { class: 'slot-liste' }, zeilen),
    h('button', { type: 'button', class: 'btn primaer', onclick: speichern }, 'Zeiten speichern')).el;
}

// ---------------------------------------------------------------- i) Daten
function datenSektion() {
  const dateiName = () => `kur-coach-backup-${calc.isoDatum()}.json`;
  const backupBlob = async () => new Blob([JSON.stringify(await db.exportAlles(), null, 2)], { type: 'application/json' });
  const exportieren = async () => {
    try {
      const url = URL.createObjectURL(await backupBlob());
      const a = h('a', { href: url, download: dateiName() });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast('Backup exportiert');
    } catch (e) { toast('Export fehlgeschlagen: ' + fehlerText(e)); }
  };
  const teilen = async () => {
    try {
      const file = new File([await backupBlob()], dateiName(), { type: 'application/json' });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) { toast('Teilen wird hier nicht unterstützt – bitte Export nutzen.'); return; }
      await navigator.share({ files: [file], title: 'Kur-Coach Backup' });
    } catch (e) { if (e?.name !== 'AbortError') toast('Teilen fehlgeschlagen: ' + fehlerText(e)); }
  };
  const datei = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  datei.addEventListener('change', async () => {
    const f = datei.files?.[0];
    datei.value = '';
    if (!f) return;
    let obj;
    try { obj = JSON.parse(await f.text()); } catch { toast('Die Datei ist kein gültiges Backup (JSON).'); return; }
    if (!obj?.tabellen) { toast('Die Datei enthält kein Kur-Coach-Backup.'); return; }
    if (!(await bestaetigen('Backup importieren', 'Die Daten aus der Datei werden eingespielt. Bei Konflikten gewinnt der neuere Eintrag.', 'Importieren'))) return;
    try { await db.importBackup(obj); toast('Backup importiert'); } catch (e) { toast('Import fehlgeschlagen: ' + fehlerText(e)); }
  });
  const loeschen = async () => {
    if (!(await bestaetigen('Lokale Daten löschen', 'Alle Daten auf diesem Gerät werden gelöscht. Nicht synchronisierte Änderungen gehen verloren. Das lässt sich nicht rückgängig machen.', 'Alles löschen'))) return;
    try { await db.lokalLeeren(); } catch (e) { toast(fehlerText(e)); return; }
    location.reload();
  };
  return sektion('Daten', `v${APP_VERSION}`,
    h('div', { class: 'aktionen' },
      h('button', { type: 'button', class: 'btn', onclick: exportieren }, h('span', { html: icon('download', 20) }), ' Backup exportieren'),
      navigator.share ? h('button', { type: 'button', class: 'btn', onclick: teilen }, h('span', { html: icon('share', 20) }), ' Backup teilen') : null,
      h('button', { type: 'button', class: 'btn', onclick: () => datei.click() }, h('span', { html: icon('upload', 20) }), ' Backup importieren'),
      h('button', { type: 'button', class: 'btn gefahr', onclick: loeschen }, h('span', { html: icon('trash', 20) }), ' Lokale Daten löschen')),
    datei,
    h('p', { class: 'muted version' }, `Kur-Coach Version ${APP_VERSION}`)).el;
}

export async function render(el) {
  const [d, ev] = await Promise.all([ladeTag(), ladeEvidenz()]);
  const [health, waage] = await Promise.all([healthSektion(), waageSektion()]);
  el.append(h('div', { class: 'seite backend' },
    h('div', { class: 'kopf-zurueck' },
      h('a', { href: '#/einstellungen', class: 'icon-btn', 'aria-label': 'Zurück zu Einstellungen', html: icon('left', 24) }),
      h('h1', { class: 'titel' }, 'Backend')),
    h('div', { class: 'sek-liste' },
      syncSektion(), health, waage, berechnungSektion(d), belegeSektion(d, ev), supplementSektion(ev),
      watchSektion(), zeitenSektion(d.profil), datenSektion())));
}
