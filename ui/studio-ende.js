// Studio: Zusammenfassung nach "Training beenden"
import * as gym from '../gym.js';
import * as calc from '../calc.js';
import { icon } from './icons.js';
import { h, zf, zf1, toast, kopiere, fehlerText } from './util.js';
import { sheet } from './sheet.js';

function vergleich(u) {
  if (u.uebung.typ === 'cardio') {
    const a = u.heute?.minuten ?? 0, b = u.letzte?.minuten;
    return b == null ? `${a} min` : `${a} min (zuletzt ${b} min)`;
  }
  if (!u.heute) return 'keine Arbeitssätze';
  const top = `${zf1(u.heute.topGewicht)} kg × ${u.heute.topWdh}`;
  if (!u.letzte) return `${top} · erste Einheit`;
  const dv = u.heute.volumen - u.letzte.volumen;
  const vz = dv === 0 ? 'Volumen gleich' : `Volumen ${dv > 0 ? '+' : '−'}${zf(Math.abs(dv))} kg`;
  return `${top} (zuletzt ${zf1(u.letzte.topGewicht)} kg × ${u.letzte.topWdh}) · ${vz}`;
}

const KURS_RE = /yoga|faszien|rücken|ruecken|stretch|mobil|pilates/i;

/** Karte "Abdehnen"; null, wenn die Daten fehlen (Fehler still ignoriert) */
async function dehnKarte(S, training) {
  let dd, kurs = null;
  try { const r = await fetch('./data/dehnen.json'); if (!r.ok) return null; dd = await r.json(); } catch { return null; }
  try {
    const termine = await S.db.byDatum('termine', calc.isoDatum());
    kurs = termine.find((t) => KURS_RE.test(`${t.titel || ''} ${t.kategorie || ''}`)) || null;
  } catch { kurs = null; }
  const vl = String(training.vorlage || '');
  const gruppen = vl.startsWith('ok') ? ['oberkoerper'] : vl.startsWith('uk') ? ['unterkoerper'] : ['oberkoerper', 'unterkoerper'];
  const zeile = (e) => {
    const li = h('li', { class: 'dehn-zeile' }, h('strong', null, e.name), h('span', { class: 'muted' }, ` ${e.ziel} · ${e.dauer}`));
    li.setAttribute('role', 'button'); li.tabIndex = 0;
    const tog = () => li.classList.toggle('erledigt');
    li.addEventListener('click', tog);
    li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tog(); } });
    return li;
  };
  const liste = (nurKurz) => h('ul', { class: 'edit-liste' }, ...gruppen.flatMap((g) => (dd[g] || [])
    .filter((_, i) => !nurKurz || (dd.kurz?.[g] || []).includes(i)).map(zeile)));
  const karte = h('div', { class: 'karte' }, h('div', { class: 'klein-titel' }, 'Abdehnen (ca. 5 min)'));
  if (kurs) {
    const box = h('div', null, liste(true));
    const knopf = h('button', { type: 'button', class: 'btn klein', onclick: () => { box.replaceChildren(liste(false)); knopf.remove(); } }, 'Alle anzeigen');
    karte.append(h('p', null, `Heute steht noch ${kurs.titel || 'ein Kurs'} an – dort wird gedehnt. Hier reicht:`), box, knopf);
  } else karte.append(liste(false));
  karte.append(h('p', { class: 'muted klein-text' }, dd.hinweis || ''));
  return karte;
}

export async function zeigeEnde(S, training) {
  const db = S.db;
  let z, text;
  try {
    const saetze = await db.all('saetze', (s) => s.training_id === training.id);
    const hist = await gym.historieAlle(db, training.id);
    const plan = gym.planAus(training, S.vorlagen, saetze);
    z = gym.zusammenfassung(training, saetze, hist, S.katalog, plan);
    text = gym.trainingsText(training, z);
  } catch (e) {
    S.zeige(h('div', { class: 'karte' }, h('p', { class: 'fehler' }, 'Zusammenfassung nicht möglich: ' + fehlerText(e)),
      h('button', { type: 'button', class: 'btn', onclick: S.zumStart }, 'Zur Übersicht')));
    return;
  }

  const kopieren = async () => {
    if (await kopiere(text)) { toast('Kopiert – im Claude-Chat einfügen'); return; }
    sheet('Text manuell kopieren', (body) => {
      const ta = h('textarea', { rows: '10', readonly: true, class: 'kurlog-ta' });
      ta.value = text;
      body.append(ta);
      setTimeout(() => { ta.focus(); ta.select(); }, 80);
    });
  };

  const dehnen = await dehnKarte(S, training);
  const kachel = (wert, label) => h('div', { class: 'kachel' }, h('strong', null, wert), h('span', { class: 'muted' }, label));
  S.zeige(h('div', { class: 'spalte' },
    h('h1', { class: 'titel gross' }, 'Geschafft'),
    h('div', { class: 'muted' }, training.titel || 'Krafttraining'),
    h('div', { class: 'kacheln' }, kachel(z.minuten ? `${z.minuten} min` : '–', 'Dauer'), kachel(zf(z.anzahlSaetze), 'Sätze'), kachel(`${zf(z.volumen)} kg`, 'Volumen')),
    h('div', { class: 'karte' },
      h('div', { class: 'klein-titel' }, 'Neue Bestwerte'),
      z.bestwerte.length
        ? h('ul', { class: 'edit-liste' }, ...z.bestwerte.map((b) => h('li', null,
          h('strong', null, b.name), ` e1RM ${zf1(b.e1rm)} kg`, b.vorher ? h('span', { class: 'muted' }, ` (vorher ${zf1(b.vorher)})`) : h('span', { class: 'muted' }, ' (erste Einheit)'))))
        : h('p', { class: 'leer' }, 'Diesmal kein neuer Bestwert.')),
    h('div', { class: 'karte' },
      h('div', { class: 'klein-titel' }, 'Vergleich zur letzten Einheit'),
      h('ul', { class: 'edit-liste' }, ...z.uebungen.map((u) => h('li', { class: 'vgl-zeile' }, h('strong', null, u.name), h('span', { class: 'muted' }, vergleich(u)))))),
    dehnen,
    h('div', { class: 'btn-reihe' },
      h('button', { type: 'button', class: 'btn gross', onclick: kopieren }, h('span', { html: icon('copy', 22) }), ' Als Text kopieren'),
      h('button', { type: 'button', class: 'btn primaer gross', onclick: S.zumStart }, 'Zur Übersicht'))));
}
