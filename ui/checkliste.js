// Checkliste als Vollbild: große Tipp-Flächen, abhaken, fertig
import * as db from '../db.js';
import * as calc from '../calc.js';
import { icon } from './icons.js';
import { h, zf } from './util.js';
import { ladeTag, punkteFuerSlot } from './daten.js';
import { wiegenSheet, kurlogSheet, tagesstartKopieren } from './sheet.js';

const AKTIONEN = {
  tagesstart: ['Tagesstart kopieren', 'copy', () => tagesstartKopieren()],
  werte_eintragen: ['Wiegen eintragen', 'scale', () => wiegenSheet()],
  kurlog_import: ['KURLOG einfügen', 'upload', () => kurlogSheet()],
};

async function umschalten(d, slot, punkt, erledigt) {
  const key = `${d.datum}|${punkt.id}`;
  if (erledigt) await db.remove('checklisten_status', key);
  else await db.put('checklisten_status', { datum: d.datum, punkt_id: punkt.id, slot, erledigt_at: new Date().toISOString() });
}

function mini(label, ist, ziel, farbe, einheit = '') {
  const p = ziel ? Math.min(100, Math.round((ist / ziel) * 100)) : 0;
  return h('div', { class: 'mini' },
    h('div', { class: 'mini-zeile' }, h('span', null, label), h('span', { class: 'muted' }, `${zf(ist)}${ziel ? ' / ' + zf(ziel) : ''}${einheit}`)),
    h('div', { class: 'balken' }, h('div', { class: 'balken-fuell', style: `width:${p}%;background:${farbe}` })));
}

export async function render(el, params = {}) {
  const d = await ladeTag();
  const slot = calc.istSlot(params.slot) ? params.slot : calc.slotNachUhrzeit(new Date());
  const [punkte, status] = await Promise.all([punkteFuerSlot(slot, d), db.byDatum('checklisten_status', d.datum)]);
  const erledigtSet = new Set(status.map((s) => s.punkt_id));
  const offen = punkte.filter((p) => !erledigtSet.has(p.id));
  const fertig = punkte.filter((p) => erledigtSet.has(p.id));
  const alleFertig = punkte.length > 0 && offen.length === 0;

  const kachel = (p) => {
    const erl = erledigtSet.has(p.id);
    const akt = !erl && AKTIONEN[p.id];
    return h('li', { class: 'punkt' + (erl ? ' erledigt' : '') + (p.termin ? ' termin' : '') },
      h('button', {
        type: 'button', class: 'punkt-haupt', role: 'checkbox', 'aria-checked': String(erl),
        onclick: () => umschalten(d, slot, p, erl),
      },
      h('span', { class: 'haken', html: erl ? icon('check', 22) : '' }),
      h('span', { class: 'punkt-text' }, p.text)),
      akt ? h('button', { type: 'button', class: 'btn klein punkt-aktion', onclick: akt[2] },
        h('span', { html: icon(akt[1], 18) }), ' ', akt[0]) : null);
  };

  const slotStarts = Object.keys(calc.SLOT_NAMEN);
  el.append(h('div', { class: 'seite checkseite' },
    h('div', { class: 'check-kopf' },
      h('h1', { class: 'titel gross' }, calc.SLOT_NAMEN[slot]),
      h('div', { class: 'fortschritt', 'aria-label': 'Fortschritt' }, `${fertig.length}/${punkte.length}`)),
    h('div', { class: 'chips scroll', role: 'tablist', 'aria-label': 'Tageszeit' },
      slotStarts.map((s) => h('a', {
        href: `#/checkliste/${s}`, role: 'tab', 'aria-selected': String(s === slot), class: 'chip' + (s === slot ? ' aktiv' : ''),
      }, calc.SLOT_NAMEN[s]))),
    punkte.length ? h('ul', { class: 'punkte' }, offen.map(kachel), fertig.map(kachel))
      : h('p', { class: 'leer' }, 'Für diese Tageszeit gibt es gerade keine Punkte.'),
    alleFertig ? h('div', { class: 'fertig-box' },
      h('span', { class: 'fertig-haken', html: icon('check', 26) }),
      h('div', null, h('strong', null, 'Fertig'), h('p', { class: 'muted' }, 'Alles erledigt für diese Tageszeit.')),
      h('a', { href: '#/heute', class: 'btn primaer' }, 'Zur Übersicht')) : null,
    h('div', { class: 'karte tagesstand' },
      h('h2', { class: 'klein-titel' }, 'Tagesstand'),
      mini('Kalorien', d.summe.kcal, d.ziele.kcal, 'var(--orange)', ' kcal'),
      mini('Protein', d.summe.protein, d.ziele.makros?.protein, 'var(--accent)', ' g'),
      mini('Schritte', d.tag.schritte || 0, d.ziele.schritte, 'var(--blau)')),
  ));
}
