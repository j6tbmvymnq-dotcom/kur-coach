// Einstellungen: Profil, Checklisten, Slot-Zeiten, Backup, Konto
import * as db from '../db.js';
import * as calc from '../calc.js';
import { icon } from './icons.js';
import { h, zf, toast, kopiere, fehlerText, APP_VERSION, minZuHhmm } from './util.js';
import { bestaetigen } from './sheet.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { profilFormular, profilZeile } from './profilform.js';
import { standardChecklisten, slotStarts, ladeEvidenz, ladeTag } from './daten.js';

export const keinAutoRender = true;

async function profilJetzt() { return (await db.get('profil', 'me')) || {}; }

async function einstellungenSpeichern(teil) {
  const p = await profilJetzt();
  await db.put('profil', { ...p, einstellungen: { ...(p.einstellungen || {}), ...teil } });
}

function karte(titel, ...inhalt) {
  return h('section', { class: 'karte einst' }, h('h2', { class: 'klein-titel' }, titel), ...inhalt);
}

// ---------------------------------------------------------------- Ziele & Belege
const dez = (n) => String(n).replace('.', ',');
const quellenListe = (q) => h('ul', { class: 'quellen' }, (q || []).map((x) => h('li', null, x)));

function zeile(label, wert) {
  return h('div', { class: 'wert-zeile' }, h('span', { class: 'muted' }, label), h('strong', null, wert));
}

async function zieleKarte() {
  const [d, ev] = await Promise.all([ladeTag(), ladeEvidenz()]);
  const z = d.ziele, m = d.messung;
  const aktiv = calc.modus(d.profil);
  const modusWahl = h('div', { class: 'chips' }, ...Object.entries(calc.ZIEL_MODI).map(([key, M]) =>
    h('button', {
      type: 'button', class: key === aktiv ? 'chip aktiv' : 'chip', 'aria-pressed': String(key === aktiv),
      onclick: async () => {
        const p = (await db.get('profil', 'me')) || {};
        await db.patch('profil', 'me', { einstellungen: { ...(p.einstellungen || {}), ziel_modus: key } });
        toast(`Ziel: ${M.name}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));   // Seite mit neuen Zielen neu aufbauen
      },
    }, M.name)));
  let werte;
  if (!m || z.kcal == null || !z.makros) {
    werte = h('p', { class: 'hinweis' }, 'Erst Gewicht eintragen, dann berechnet die App deine Ziele.');
  } else {
    const plan = calc.proteinPlan(m, d.profil);
    const n = plan.mahlzeiten.filter((x) => x.g === plan.portion).length;
    const rate = z.rate ?? calc.EVIDENZ.abnahmeProzentWoche;
    const kgWoche = Math.abs(m.gewicht * rate / 100);
    const ueberschuss = (z.defizit ?? 0) < 0;
    werte = h('div', { class: 'werte' },
      zeile('Kalorienziel', `${zf(z.kcal)} kcal`),
      zeile(ueberschuss ? '\u00dcberschuss' : 'Defizit', `${zf(Math.abs(z.defizit ?? 0))} kcal/Tag`),
      h('p', { class: 'muted klein-text' }, `${dez(Math.abs(rate))} % pro Woche \u2248 ${dez(kgWoche.toFixed(2))} kg/Woche ${rate < 0 ? 'Zunahme' : 'Abnahme'}`),
      zeile('Protein', `${zf(z.makros.protein)} g`),
      h('p', { class: 'muted klein-text' }, `${n} \u00d7 ~${plan.portion} g + ${calc.EVIDENZ.proteinVorSchlafG[1]} g vor dem Schlafen`),
      zeile('Fett', `${zf(z.makros.fett)} g`),
      zeile('Kohlenhydrate', `${zf(z.makros.kh)} g`),
      zeile('Schritte', zf(z.schritte)));
  }
  const belege = (ev?.ziele || []).map((t) => h('details', { class: 'beleg' },
    h('summary', null, t.titel),
    h('p', null, h('strong', null, 'Regel: '), t.regel),
    h('p', null, h('strong', null, 'Warum: '), t.warum),
    quellenListe(t.quellen)));
  return karte('Ziele & Belege', h('p', { class: 'muted klein-text' }, 'Ziel der Kur'), modusWahl, werte, ...belege);
}

async function supplementKarte() {
  const ev = await ladeEvidenz();
  if (!ev) return karte('Supplements & Einnahme', h('p', { class: 'muted' }, 'Daten nicht verfügbar.'));
  const badgeKlasse = { 'hast du': 'ok', empfohlen: 'akzent' };
  return karte('Supplements & Einnahme',
    ...(ev.supplements || []).map((s) => h('div', { class: 'supp' },
      h('div', { class: 'supp-kopf' }, h('strong', null, s.name), h('span', { class: 'badge ' + (badgeKlasse[s.status] || '') }, s.status)),
      h('p', null, s.dosis), s.zeit ? h('p', { class: 'muted' }, s.zeit) : null,
      h('p', { class: 'muted klein-text' }, s.warum), quellenListe(s.quellen))),
    ev.nicht_noetig ? h('p', null, h('strong', null, 'Nicht nötig: '), ev.nicht_noetig) : null,
    ev.hinweis ? h('p', { class: 'hinweis' }, ev.hinweis) : null);
}

// ---------------------------------------------------------------- Profil
function profilKarte(profil) {
  const form = profilFormular(profil);
  const fb = h('p', { class: 'fehler', role: 'alert', hidden: true });
  const speichern = async () => {
    const r = form.lesen();
    fb.textContent = r.fehler || ''; fb.hidden = !r.fehler;
    if (r.fehler) return;
    const cur = await profilJetzt();
    await db.put('profil', profilZeile(cur, r.werte));
    toast('Profil gespeichert');
  };
  return karte('Profil', form.koerper, form.kur, fb,
    h('button', { type: 'button', class: 'btn primaer', onclick: speichern }, 'Profil speichern'));
}

// ---------------------------------------------------------------- Checklisten
function checklistenKarte(profil) {
  let slot = 'morgen';
  let arbeit = null;   // Kopie der Punkte des gewählten Slots
  const wrap = h('div', null);
  const gespeichert = () => profil.einstellungen?.checklisten || {};

  async function laden() {
    const std = await standardChecklisten();
    arbeit = JSON.parse(JSON.stringify(gespeichert()[slot] ?? std[slot] ?? []));
    zeichne();
  }

  function zeichne() {
    const chips = h('div', { class: 'chips scroll' }, calc.SLOTS.map((s) => h('button', {
      type: 'button', class: 'chip' + (s === slot ? ' aktiv' : ''), onclick: () => { slot = s; laden(); },
    }, calc.SLOT_NAMEN[s])));
    const zeilen = arbeit.map((p, i) => {
      const inp = h('input', { type: 'text', value: p.text, 'aria-label': 'Text des Punkts' });
      inp.addEventListener('input', () => { p.text = inp.value; });
      const tausch = (j) => { [arbeit[i], arbeit[j]] = [arbeit[j], arbeit[i]]; zeichne(); };
      return h('li', { class: 'edit-zeile' }, inp,
        p.wenn ? h('span', { class: 'bedingung', title: 'Bedingung' }, p.wenn) : null,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Nach oben', disabled: i === 0, onclick: () => tausch(i - 1), html: icon('up') }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Nach unten', disabled: i === arbeit.length - 1, onclick: () => tausch(i + 1), html: icon('down') }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Löschen', onclick: () => { arbeit.splice(i, 1); zeichne(); }, html: icon('trash') }));
    });
    const eigene = !!gespeichert()[slot];
    wrap.replaceChildren(chips,
      h('ul', { class: 'edit-liste' }, zeilen),
      h('button', { type: 'button', class: 'btn', onclick: () => { arbeit.push({ id: db.neueId('cl'), text: '' }); zeichne(); } }, h('span', { html: icon('plus', 20) }), ' Punkt hinzufügen'),
      h('div', { class: 'btn-reihe' },
        h('button', { type: 'button', class: 'btn primaer', onclick: speichern }, 'Slot speichern'),
        h('button', { type: 'button', class: 'btn', disabled: !eigene, onclick: zuruecksetzen }, 'Auf Standard zurücksetzen')));
  }

  async function speichern() {
    const sauber = arbeit.map((p) => ({ ...p, text: (p.text || '').trim() })).filter((p) => p.text);
    const neu = { ...gespeichert(), [slot]: sauber };
    await einstellungenSpeichern({ checklisten: neu });
    profil.einstellungen = { ...(profil.einstellungen || {}), checklisten: neu };
    toast(`${calc.SLOT_NAMEN[slot]} gespeichert`);
    laden();
  }

  async function zuruecksetzen() {
    if (!(await bestaetigen('Auf Standard zurücksetzen', `Eigene Änderungen für „${calc.SLOT_NAMEN[slot]}“ gehen verloren.`, 'Zurücksetzen'))) return;
    const neu = { ...gespeichert() };
    delete neu[slot];
    await einstellungenSpeichern({ checklisten: neu });
    profil.einstellungen = { ...(profil.einstellungen || {}), checklisten: neu };
    toast('Standard wiederhergestellt');
    laden();
  }

  laden();
  return karte('Checklisten bearbeiten', wrap);
}

// ---------------------------------------------------------------- Slot-Zeiten
function zeitenKarte(profil) {
  const starts = slotStarts(profil.einstellungen);
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
  return karte('Slot-Startzeiten und Kurzbefehle',
    h('p', { class: 'muted' }, 'Die Zeiten steuern die Anzeige. Die Kurzbefehl-Automation selbst stellst du in der Kurzbefehle-App ein und trägst dort die URL ein.'),
    h('ul', { class: 'slot-liste' }, zeilen),
    h('button', { type: 'button', class: 'btn primaer', onclick: speichern }, 'Zeiten speichern'));
}

// ---------------------------------------------------------------- Apple Watch / Kurzbefehl
function kopierZeile(label, wert) {
  return h('div', { class: 'kb-zeile' },
    h('span', { class: 'muted klein-text' }, label),
    h('div', { class: 'url-zeile' }, h('code', null, wert),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${label} kopieren`, html: icon('copy'),
        onclick: async () => toast((await kopiere(wert)) ? 'Kopiert' : 'Kopieren nicht möglich') })));
}

function watchKarte() {
  if (!db.istOnlineModus()) return null;
  const status = h('p', { class: 'muted' }, 'Zuletzt empfangen: wird geladen …');
  const tokenBox = h('div', null);
  const anleitung = h('div', null, h('p', { class: 'muted' }, 'Anleitung folgt'));
  const zeigeStatus = async () => {
    try {
      const r = await db.rpc('ingest_status');
      const wert = Array.isArray(r) ? r[0] : r;
      const t = wert && typeof wert === 'object' ? (Object.values(wert)[0] ?? null) : wert;
      const dt = t ? new Date(t) : null;
      status.textContent = dt && !isNaN(dt)
        ? `Zuletzt empfangen: ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(dt)}`
        : 'Zuletzt empfangen: noch nie';
    } catch (e) { status.textContent = 'Zuletzt empfangen: nicht abrufbar (' + fehlerText(e) + ')'; }
  };
  zeigeStatus();
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
  return karte('Apple Watch / Kurzbefehl',
    status,
    h('button', { type: 'button', class: 'btn', onclick: erzeugen }, 'Kurzbefehl-Token erzeugen'),
    tokenBox,
    kopierZeile('URL', basis),
    kopierZeile('Header apikey', SUPABASE_ANON_KEY),
    kopierZeile('Header Content-Type', 'application/json'),
    kopierZeile('Beispiel-Body', body),
    h('details', { class: 'beleg' }, h('summary', null, 'Schritt-für-Schritt-Anleitung'), anleitung));
}

// ---------------------------------------------------------------- Daten & Konto
function datenKarte(params) {
  const dateiName = () => `kur-coach-backup-${calc.isoDatum()}.json`;
  const backupBlob = async () => new Blob([JSON.stringify(await db.exportAlles(), null, 2)], { type: 'application/json' });

  const exportieren = async () => {
    try {
      const blob = await backupBlob();
      const url = URL.createObjectURL(blob);
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
  const syncen = async () => {
    try {
      const r = await db.sync();
      toast(r?.fehler ? `Sync-Fehler: ${r.fehler}` : `Synchronisiert (${r?.gesendet ?? 0} gesendet, ${r?.geholt ?? 0} geholt)`);
    } catch (e) { toast('Sync fehlgeschlagen: ' + fehlerText(e)); }
  };
  const abmelden = async () => {
    if (!(await bestaetigen('Abmelden', 'Nicht synchronisierte Änderungen bleiben lokal, bis du dich wieder anmeldest.', 'Abmelden'))) return;
    try { await db.logout(); } catch (e) { toast(fehlerText(e)); }
    params.weiter?.();
  };
  const loeschen = async () => {
    if (!(await bestaetigen('Lokale Daten löschen', 'Alle Daten auf diesem Gerät werden gelöscht. Nicht synchronisierte Änderungen gehen verloren. Das lässt sich nicht rückgängig machen.', 'Alles löschen'))) return;
    try { await db.lokalLeeren(); } catch (e) { toast(fehlerText(e)); return; }
    location.reload();
  };

  return karte('Daten und Konto',
    h('div', { class: 'aktionen' },
      h('button', { type: 'button', class: 'btn', onclick: exportieren }, h('span', { html: icon('download', 20) }), ' Backup exportieren'),
      navigator.share ? h('button', { type: 'button', class: 'btn', onclick: teilen }, h('span', { html: icon('share', 20) }), ' Backup teilen') : null,
      h('button', { type: 'button', class: 'btn', onclick: () => datei.click() }, h('span', { html: icon('upload', 20) }), ' Backup importieren'),
      h('button', { type: 'button', class: 'btn', onclick: syncen }, h('span', { html: icon('sync', 20) }), ' Sync jetzt'),
      db.istOnlineModus() ? h('button', { type: 'button', class: 'btn', onclick: abmelden }, 'Abmelden') : null,
      h('button', { type: 'button', class: 'btn gefahr', onclick: loeschen }, h('span', { html: icon('trash', 20) }), ' Lokale Daten löschen')),
    datei);
}

export async function render(el, params = {}) {
  const profil = await profilJetzt();
  profil.einstellungen = profil.einstellungen || {};
  const [zk, sk] = await Promise.all([zieleKarte(), supplementKarte()]);
  el.append(h('div', { class: 'seite einstellungen' },
    h('h1', { class: 'titel gross' }, 'Einstellungen'),
    h('div', { class: 'spalten' },
      h('div', { class: 'spalte' }, zk, profilKarte(profil), zeitenKarte(profil)),
      h('div', { class: 'spalte' }, sk, watchKarte(), checklistenKarte(profil), datenKarte(params))),
    h('p', { class: 'muted version' }, `Kur-Coach Version ${APP_VERSION}`)));
}
