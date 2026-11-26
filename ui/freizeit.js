// Screen "Freizeit": AuszeitCard, Veranstaltungen, Orte, Empfehlungen (Daten: data/freizeit.json)
import * as db from '../db.js';
import { icon } from './icons.js';
import { h, pad2 } from './util.js';

const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
export const EVENT_ENDE = '2026-12-16';

const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const plusTage = (datum, n) => { const d = parse(datum); d.setDate(d.getDate() + n); return iso(d); };
export function datumKurz(s) {
  const d = parse(s);
  return d ? `${WT[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}` : '';
}

/** Nur echte http(s)-URLs; sonst null */
export function sicherUrl(u) {
  try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; }
}

let cache = null;
/** Lädt data/freizeit.json; null, wenn nicht vorhanden/ungültig */
export async function ladeFreizeit() {
  if (cache) return cache;
  try {
    const r = await fetch('./data/freizeit.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || typeof j !== 'object') return null;
    j.orte = Array.isArray(j.orte) ? j.orte : [];
    j.events = Array.isArray(j.events) ? j.events : [];
    j.empfehlungen = Array.isArray(j.empfehlungen) ? j.empfehlungen : [];
    cache = j;
    return j;
  } catch { return null; }
}

/** Ruhetag: kein Termin der Kategorie 'training' an diesem Datum */
export async function istRuhetag(datum) {
  let t = [];
  try { t = await db.byDatum('termine', datum); } catch { t = []; }
  return !t.some((x) => x.kategorie === 'training');
}

function eventSchneidet(e, von, bis) {
  const a = e.von || e.bis, b = e.bis || e.von;
  if (!a) return false;
  return a <= bis && b >= von;
}
const sortEv = (a, b) => String(a.von || a.bis).localeCompare(String(b.von || b.bis));

/** Passende Empfehlungen für heute (Ruhetag zuerst) */
export async function empfehlungenHeute(daten, jetzt = new Date()) {
  const arten = [];
  if (await istRuhetag(iso(jetzt))) arten.push('ruhetag');
  if (jetzt.getDay() === 0 || jetzt.getDay() === 6) arten.push('wochenende');
  if (jetzt.getHours() >= 17) arten.push('abend');
  const alle = daten.empfehlungen.filter((e) => e && e.titel);
  return arten.flatMap((a) => alle.filter((e) => e.wann === a));
}

/** Für die Heute-Karte: { titel, text } oder null */
export async function tipp() {
  const d = await ladeFreizeit();
  if (!d) return null;
  const jetzt = new Date(), heute = iso(jetzt), morgen = plusTage(heute, 1);
  const ev = d.events.filter((e) => e && e.name && eventSchneidet(e, heute, morgen)).sort(sortEv)[0];
  if (ev) {
    const wann = (ev.von || '') <= heute ? 'Heute' : datumKurz(ev.von);
    return { titel: ev.name, text: [wann, ev.uhrzeit, ev.ort].filter(Boolean).join(' · ') };
  }
  const emp = (await empfehlungenHeute(d, jetzt))[0];
  return emp ? { titel: emp.titel, text: emp.text || '' } : null;
}

// ---------------------------------------------------------------- Bausteine
function link(url, text) {
  const u = sicherUrl(url);
  return u ? h('a', { href: u, class: 'fz-link', rel: 'noopener', target: '_blank' }, text) : null;
}

function zeile(label, wert) {
  return wert ? h('p', { class: 'fz-zeile' }, h('strong', null, `${label}: `), String(wert)) : null;
}

function badges(o) {
  return h('div', { class: 'fz-badges' },
    o.auszeitcard ? h('span', { class: 'badge akzent' }, 'AuszeitCard') : null,
    o.zu_pruefen ? h('span', { class: 'badge' }, 'Termin prüfen') : null);
}

function aufklappbar(kopfInhalt, offen) {
  const knopf = h('button', { type: 'button', class: 'fz-kopf', 'aria-expanded': 'false' },
    kopfInhalt, h('span', { class: 'fz-pfeil', html: icon('down', 22) }));
  knopf.addEventListener('click', () => {
    const auf = offen.hidden;
    offen.hidden = !auf;
    knopf.setAttribute('aria-expanded', String(auf));
    knopf.classList.toggle('offen', auf);
  });
  return h('div', { class: 'karte fz-karte' }, knopf, offen);
}

function auszeitKarte(a) {
  if (!a || typeof a !== 'object') return null;
  const offen = h('div', { class: 'fz-detail', hidden: true });
  const leist = Array.isArray(a.leistungen) ? a.leistungen : [];
  if (a.beschreibung) offen.append(h('p', null, a.beschreibung));
  if (leist.length) offen.append(h('ul', { class: 'fz-liste' }, leist.map((l) => h('li', null, String(l)))));
  if (a.hinweise) offen.append(h('p', { class: 'muted' }, a.hinweise));
  const q = link(a.quelle, 'Quelle');
  if (q) offen.append(q);
  return aufklappbar(h('span', { class: 'fz-kopf-text fz-spalte' },
    h('strong', null, a.name || 'AuszeitCard'),
    a.zu_pruefen ? h('span', { class: 'fz-badges' }, h('span', { class: 'badge' }, 'Angaben prüfen')) : null), offen);
}

function eventKarte(e) {
  const d1 = datumKurz(e.von), d2 = e.bis && e.bis !== e.von ? datumKurz(e.bis) : '';
  const datum = d2 ? `${d1} bis ${d2}` : d1;
  return h('div', { class: 'karte fz-karte fz-inhalt' },
    h('strong', null, e.name), badges(e),
    h('p', { class: 'muted' }, [datum, e.tage, e.uhrzeit, e.ort].filter(Boolean).join(' · ')),
    e.beschreibung ? h('p', null, e.beschreibung) : null,
    zeile('Anreise', e.anreise), link(e.url, 'Website'));
}

function ortKarte(o) {
  const offen = h('div', { class: 'fz-detail', hidden: true });
  const eintritt = [o.eintritt, o.leistung].filter(Boolean).join(' – ');
  const dauer = o.dauer_h != null && o.dauer_h !== '' ? `${String(o.dauer_h).replace('.', ',')} h` : '';
  [zeile('Eintritt/Leistung', eintritt), zeile('Öffnungszeiten', o.oeffnungszeiten), zeile('Dauer', dauer), zeile('Anreise', o.anreise)]
    .forEach((z) => { if (z) offen.append(z); });
  const l = link(o.url, 'Website');
  if (l) offen.append(l);
  const km = o.entfernung_km != null && o.entfernung_km !== '' ? `${String(o.entfernung_km).replace('.', ',')} km` : '';
  return aufklappbar(h('span', { class: 'fz-kopf-text fz-spalte' },
    h('strong', null, o.name),
    h('span', { class: 'muted' }, [o.ort, km].filter(Boolean).join(' · ')),
    o.warum ? h('span', null, o.warum) : null,
    o.beste_zeit ? h('span', { class: 'muted' }, `Beste Zeit: ${o.beste_zeit}`) : null,
    badges(o)), offen);
}

const FILTER = [['alle', 'Alle'], ['card', 'Mit AuszeitCard'], ['natur', 'Natur'], ['kultur', 'Kultur'], ['bad', 'Bad'], ['stadt', 'Stadt'], ['ausflug', 'Ausflug']];
let filter = 'alle';

function ortePanel(orte) {
  const liste = h('div', { class: 'spalte' });
  const chips = h('div', { class: 'chips scroll', role: 'group', 'aria-label': 'Orte filtern' });
  const zeichne = () => {
    const sicht = orte.filter((o) => filter === 'alle' || (filter === 'card' ? o.auszeitcard : o.kategorie === filter));
    liste.replaceChildren(...(sicht.length ? sicht.map(ortKarte) : [h('p', { class: 'leer' }, 'Keine Orte in dieser Auswahl.')]));
    [...chips.children].forEach((c) => { const a = c.dataset.f === filter; c.classList.toggle('aktiv', a); c.setAttribute('aria-pressed', String(a)); });
  };
  FILTER.forEach(([k, t]) => chips.append(h('button', { type: 'button', class: 'chip', 'data-f': k, onclick: () => { filter = k; zeichne(); } }, t)));
  zeichne();
  return h('div', { class: 'spalte' }, chips, liste);
}

function empfKarte(e) {
  return h('div', { class: 'karte fz-karte fz-inhalt fz-empf' }, h('strong', null, e.titel), e.text ? h('p', null, e.text) : null);
}

function abschnitt(titel, ...inhalt) {
  return h('section', { class: 'spalte' }, h('h2', { class: 'klein-titel fz-h2' }, titel), ...inhalt);
}

export async function render(el) {
  const d = await ladeFreizeit();
  const seite = h('div', { class: 'seite freizeit' }, h('h1', { class: 'titel gross' }, 'Freizeit'));
  if (!d) {
    seite.append(h('div', { class: 'karte leer-karte' }, h('span', { html: icon('compass', 32) }), h('p', { class: 'muted' }, 'Freizeit-Infos werden geladen.')));
    el.append(seite);
    return;
  }
  const jetzt = new Date(), heute = iso(jetzt), woche = plusTage(heute, 7);
  const ac = auszeitKarte(d.auszeitcard);
  if (ac) seite.append(ac);

  const emp = await empfehlungenHeute(d, jetzt);
  const wocheEv = d.events.filter((e) => e && e.name && eventSchneidet(e, heute, woche)).sort(sortEv);
  seite.append(abschnitt('Heute & diese Woche',
    ...emp.map(empfKarte),
    ...(wocheEv.length ? wocheEv.map(eventKarte) : [h('p', { class: 'leer' }, 'Keine Veranstaltungen in den nächsten 7 Tagen.')])));

  const alle = d.events.filter((e) => e && e.name && (e.bis || e.von || '') >= heute && (e.von || '') <= EVENT_ENDE).sort(sortEv);
  seite.append(abschnitt('Alle Veranstaltungen bis 16.12.2026',
    ...(alle.length ? alle.map(eventKarte) : [h('p', { class: 'leer' }, 'Keine kommenden Veranstaltungen.')])));

  seite.append(abschnitt('Orte', ortePanel(d.orte.filter((o) => o && o.name))));
  seite.append(h('p', { class: 'muted fz-fuss' }, d.stand ? `Stand: ${d.stand}` : null, d.stand ? h('br') : null, 'Angaben ohne Gewähr – Öffnungszeiten vorher prüfen'));
  el.append(seite);
}
