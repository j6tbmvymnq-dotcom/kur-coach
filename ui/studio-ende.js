// Studio: Zusammenfassung nach "Training beenden"
import * as gym from '../gym.js';
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
    h('div', { class: 'btn-reihe' },
      h('button', { type: 'button', class: 'btn gross', onclick: kopieren }, h('span', { html: icon('copy', 22) }), ' Als Text kopieren'),
      h('button', { type: 'button', class: 'btn primaer gross', onclick: S.zumStart }, 'Zur Übersicht'))));
}
