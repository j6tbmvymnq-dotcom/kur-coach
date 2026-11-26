// Studio (Gym-Logger, M2): Startscreen, Bestwerte; Training in studio-sess.js, Zusammenfassung in studio-ende.js
import * as db from '../db.js';
import * as gym from '../gym.js';
import * as calc from '../calc.js';
import { icon } from './icons.js';
import { h, zf1, toast, fehlerText, kopiere } from './util.js';
import { trainingsExportAusDb, planZuruecksetzen } from '../plan.js';
import { ladeReadiness } from './daten.js';
import { zeigeSession } from './studio-sess.js';
import { zeigeEnde } from './studio-ende.js';
import { wakeLockAus } from './studio-timer.js';

// Während des Trainings darf ein Datenbank-Change die Ansicht nicht neu aufbauen (Eingaben gehen sonst verloren)
export const keinAutoRender = true;

const datumDe = (iso) => String(iso || '').split('-').reverse().join('.');

/** Kleines SVG-Liniendiagramm (bester e1RM je Einheit, älteste links) */
export function liniendiagramm(verlauf) {
  const w = 120, hh = 40, pad = 4;
  if (verlauf.length < 2) {
    return h('span', { class: 'chart-leer muted' }, verlauf.length ? 'erste Einheit' : '');
  }
  const ys = verlauf.map((v) => v.e1rm);
  const min = Math.min(...ys), max = Math.max(...ys), spanne = max - min || 1;
  const pts = verlauf.map((v, i) => [pad + (i * (w - 2 * pad)) / (verlauf.length - 1), hh - pad - ((v.e1rm - min) / spanne) * (hh - 2 * pad)]);
  const letzter = pts[pts.length - 1];
  const svg = `<svg class="chart" viewBox="0 0 ${w} ${hh}" width="${w}" height="${hh}" role="img" aria-label="Verlauf e1RM">`
    + `<polyline fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}"/>`
    + `<circle cx="${letzter[0].toFixed(1)}" cy="${letzter[1].toFixed(1)}" r="3" fill="var(--accent)"/></svg>`;
  return h('span', { html: svg });
}

export async function render(el) {
  const root = h('div', { class: 'seite schmal studio' });
  el.append(root);
  const S = { db, root };
  S.zeige = (node) => { root.replaceChildren(node); };

  try {
    const k = await gym.ladeUebungen(db);
    S.liste = k.liste; S.vorlagen = k.vorlagen;
    S.katalog = k.map;
    S.basis = new Map((await gym.ladeKatalog()).uebungen.map((u) => [u.id, u]));
  } catch (e) {
    root.append(h('div', { class: 'karte' }, h('p', { class: 'fehler' }, 'Katalog nicht verfügbar: ' + fehlerText(e))));
    return;
  }

  S.zumStart = () => { wakeLockAus(); zeigeStart(S); };
  S.zumEnde = (training) => zeigeEnde(S, training);
  S.zeigeSession = (training) => zeigeSession(S, training);

  const laufend = await gym.laufendesTraining(db);
  if (laufend) await zeigeSession(S, laufend);
  else await zeigeStart(S);
}

async function zeigeStart(S) {
  const { db: d } = S;
  const start = async (key) => {
    try {
      // Kurwoche 1: ein Satz weniger je Übung (Wiedereinstieg nach Pause)
      const profil = await d.get('profil', 'me');
      const kt = calc.kurTag(profil?.kur_start, calc.isoDatum(), profil?.kur_tage ?? 21);
      const abzug = kt.status === 'laeuft' && kt.tag <= 7 ? 1 : 0;
      const t = await gym.startTraining(d, key, S.vorlagen, new Date(), abzug);
      await zeigeSession(S, t);
    } catch (e) { toast('Start fehlgeschlagen: ' + fehlerText(e)); }
  };

  const letzte = await gym.letzteKrafteinheiten(d, 5);
  const hist = await gym.historieAlle(d);
  const best = gym.bestwerteListe(hist, S.katalog);

  // Nächste Vorlage = die nach der zuletzt trainierten (Rotation)
  const keys = Object.keys(S.vorlagen);
  const zuletzt = letzte.find((t) => keys.includes(t.vorlage))?.vorlage;
  const naechste = zuletzt ? keys[(keys.indexOf(zuletzt) + 1) % keys.length] : keys[0];
  const vorlagenKnoepfe = keys.map((key) => {
    const v = S.vorlagen[key];
    return h('button', { type: 'button', class: key === naechste ? 'btn primaer gross' : 'btn gross', onclick: () => start(key) },
      h('span', { html: icon('play', 22) }), ` ${v.name}${key === naechste ? ' – als Nächstes' : ''}`);
  });

  const profil = await d.get('profil', 'me');
  const plan = profil?.einstellungen?.plan;
  const exportKopieren = async () => {
    try {
      const text = await trainingsExportAusDb(d);
      toast((await kopiere(text)) ? 'Trainingsdaten kopiert – im Claude-Projekt einfügen' : 'Kopieren nicht möglich');
    } catch (e) { toast('Export fehlgeschlagen: ' + fehlerText(e)); }
  };
  const zuruecksetzen = async () => {
    if (!confirm('Plan-Anpassungen verwerfen und den Grundplan wiederherstellen?')) return;
    await planZuruecksetzen(d);
    toast('Grundplan wiederhergestellt');
    const k = await gym.ladeUebungen(d); S.vorlagen = k.vorlagen;
    zeigeStart(S);
  };
  const letzteAenderung = plan?.verlauf?.[plan.verlauf.length - 1];
  const planKarte = h('div', { class: 'karte' },
    h('div', { class: 'klein-titel' }, 'Plan prüfen lassen'),
    h('p', { class: 'muted' }, 'Kopiert alle Trainings, Sätze und Erholungswerte. Im Claude-Projekt einfügen, die Antwort (KURLOG mit Plan) unter „KURLOG importieren“ übernehmen.'),
    h('button', { type: 'button', class: 'btn gross', onclick: exportKopieren }, h('span', { html: icon('copy', 22) }), ' Trainingsdaten kopieren'),
    plan?.stand ? h('p', { class: 'muted' }, `Plan angepasst am ${datumDe(plan.stand.slice(0, 10))}` + (letzteAenderung?.aenderungen?.length ? ': ' + letzteAenderung.aenderungen.join(' · ') : '')) : null,
    plan?.stand ? h('button', { type: 'button', class: 'btn', onclick: zuruecksetzen }, 'Grundplan wiederherstellen') : null);

  let rot = false;
  try { rot = (await ladeReadiness()).ampel === 'rot'; } catch { rot = false; }
  const seite = h('div', { class: 'spalte' },
    h('h1', { class: 'titel gross' }, 'Studio'),
    rot ? h('div', { class: 'warnung-box', role: 'alert' }, h('span', { html: icon('alert', 22) }),
      h('p', null, 'Readiness rot: heute lieber locker. Die Vorschläge haben einen Satz weniger je Übung.')) : null,
    h('div', { class: 'info-box' }, h('span', { html: icon('clock', 22) }),
      h('p', null, 'Auf der Watch „Traditionelles Krafttraining“ starten, dann hier das Training beginnen.')),
    h('div', { class: 'karte' },
      h('div', { class: 'klein-titel' }, 'Training starten'),
      ...vorlagenKnoepfe,
      h('button', { type: 'button', class: 'btn gross', onclick: () => start(null) }, h('span', { html: icon('plus', 22) }), ' Frei')),
    h('div', { class: 'karte' },
      h('div', { class: 'klein-titel' }, 'Letzte Krafteinheiten'),
      letzte.length
        ? h('ul', { class: 'edit-liste' }, ...letzte.map((t) => h('li', { class: 'letzte-zeile' },
          h('span', null, datumDe(t.datum)), h('strong', null, t.titel || 'Kraft'),
          h('span', { class: 'muted' }, t.minuten ? `${t.minuten} min` : ''))))
        : h('p', { class: 'leer' }, 'Noch keine Krafteinheit.')),
    h('div', { class: 'karte' },
      h('div', { class: 'klein-titel' }, 'Bestwerte (e1RM)'),
      best.length
        ? h('ul', { class: 'edit-liste' }, ...best.map((b) => h('li', { class: 'best-zeile' },
          h('div', { class: 'best-text' }, h('strong', null, b.name), h('span', { class: 'muted' }, `${zf1(b.best)} kg`)),
          liniendiagramm(b.verlauf))))
        : h('p', { class: 'leer' }, 'Sobald du Sätze erfasst hast, erscheinen hier deine Bestwerte.')),
    planKarte);
  S.zeige(seite);
}
