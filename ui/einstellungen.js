// Einstellungen: Profil, Ziel der Kur, Checklisten, Konto; Details im Backend (#/backend)
import * as db from '../db.js';
import * as calc from '../calc.js';
import { icon } from './icons.js';
import { h, toast, fehlerText } from './util.js';
import { bestaetigen, sheet } from './sheet.js';
import { profilFormular, profilZeile } from './profilform.js';
import { standardChecklisten } from './daten.js';

export const keinAutoRender = true;

async function profilJetzt() { return (await db.get('profil', 'me')) || {}; }

async function einstellungenSpeichern(teil) {
  const p = await profilJetzt();
  await db.put('profil', { ...p, einstellungen: { ...(p.einstellungen || {}), ...teil } });
}

function karte(titel, ...inhalt) {
  return h('section', { class: 'karte einst' }, h('h2', { class: 'klein-titel' }, titel), ...inhalt);
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

// ---------------------------------------------------------------- Ziel der Kur
const MODUS_TEXT = {
  fettabbau: 'Fett abbauen, Muskeln halten',
  rekomposition: 'Muskeln aufbauen, Fett leicht senken',
  aufbau: 'Muskeln aufbauen, kleiner Überschuss',
};

function zielKarte(profil) {
  const aktiv = calc.modus(profil);
  const chips = h('div', { class: 'chips' }, ...Object.entries(calc.ZIEL_MODI).map(([key, M]) =>
    h('button', {
      type: 'button', class: key === aktiv ? 'chip aktiv' : 'chip', 'aria-pressed': String(key === aktiv),
      onclick: async () => {
        const p = (await db.get('profil', 'me')) || {};
        await db.patch('profil', 'me', { einstellungen: { ...(p.einstellungen || {}), ziel_modus: key } });
        toast(`Ziel: ${M.name}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      },
    }, M.name)));
  return karte('Ziel der Kur', chips, h('p', { class: 'muted' }, MODUS_TEXT[aktiv] || ''));
}

// ---------------------------------------------------------------- Checklisten
function checklistenEditor(profil) {
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
  return wrap;
}

// ---------------------------------------------------------------- Checklisten, Konto
function checklistenKarte() {
  return karte('Checklisten',
    h('button', {
      type: 'button', class: 'btn',
      onclick: async () => {
        const p = await profilJetzt();
        p.einstellungen = p.einstellungen || {};
        sheet('Checklisten bearbeiten', (body) => body.append(checklistenEditor(p)));
      },
    }, 'Checklisten bearbeiten'));
}

async function kontoKarte(params) {
  let email = null;
  try { const s = await db.session(); email = s?.demo ? null : (s?.user?.email || null); } catch { email = null; }
  const abmelden = async () => {
    if (!(await bestaetigen('Abmelden', 'Nicht synchronisierte Änderungen bleiben lokal, bis du dich wieder anmeldest.', 'Abmelden'))) return;
    try { await db.logout(); } catch (e) { toast(fehlerText(e)); }
    params.weiter?.();
  };
  return karte('Konto',
    h('p', null, db.istOnlineModus() ? `Angemeldet als ${email || 'unbekannt'}` : 'Demo-Modus – Daten nur auf diesem Gerät'),
    db.istOnlineModus() ? h('button', { type: 'button', class: 'btn', onclick: abmelden }, 'Abmelden') : null);
}

export async function render(el, params = {}) {
  const profil = await profilJetzt();
  profil.einstellungen = profil.einstellungen || {};
  const konto = await kontoKarte(params);
  el.append(h('div', { class: 'seite einstellungen' },
    h('h1', { class: 'titel gross' }, 'Einstellungen'),
    h('div', { class: 'spalten' },
      profilKarte(profil), zielKarte(profil), checklistenKarte(), konto,
      h('a', { href: '#/backend', class: 'zeilen-link' }, h('span', null, 'Backend & Details'), h('span', { html: icon('right', 22) })))));
}
