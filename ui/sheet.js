// Wiederverwendbare Dialoge (Bottom-Sheets)
import * as db from '../db.js';
import * as calc from '../calc.js';
import { parseKurlog, normalisiere, vorschauText, uebernehmen } from '../kurlog.js';
import { baueKurkontext } from './daten.js';
import * as gym from '../gym.js';
import { pruefePlan, speicherePlan } from '../plan.js';
import { icon } from './icons.js';
import { h, toast, kopiere, fehlerText, zfEingabe, hhmm, pad2 } from './util.js';

export function sheet(titel, bauen, beimSchliessen) {
  const body = h('div', { class: 'sheet-body' });
  const bg = h('div', { class: 'sheet-bg' });
  const esc = (e) => { if (e.key === 'Escape') close(); };
  function close() { bg.remove(); document.removeEventListener('keydown', esc); if (beimSchliessen) beimSchliessen(); }
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': titel },
    h('div', { class: 'sheet-kopf' },
      h('h2', null, titel),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', onclick: close, html: icon('close') })),
    body);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', esc);
  bg.append(panel);
  document.body.append(bg);
  bauen(body, close);
  const first = body.querySelector('input,textarea');
  if (first) setTimeout(() => first.focus(), 60);
  return close;
}

export function bestaetigen(titel, text, okText = 'Ja') {
  return new Promise((resolve) => {
    let fertig = false;
    const ende = (v) => { if (!fertig) { fertig = true; resolve(v); } };
    sheet(titel, (body, close2) => {
      body.append(
        h('p', { class: 'sheet-text' }, text),
        h('div', { class: 'btn-reihe' },
          h('button', { type: 'button', class: 'btn', onclick: () => { ende(false); close2(); } }, 'Abbrechen'),
          h('button', { type: 'button', class: 'btn gefahr', onclick: () => { ende(true); close2(); } }, okText)));
    }, () => ende(false));
  });
}

export function feld(label, input, hinweis) {
  return h('label', { class: 'feld' }, h('span', { class: 'feld-label' }, label), input,
    hinweis ? h('span', { class: 'feld-hinweis' }, hinweis) : null);
}

export function zahlInput(wert, opts = {}) {
  return h('input', {
    type: 'text', inputmode: opts.ganz ? 'numeric' : 'decimal', autocomplete: 'off',
    enterkeyhint: 'done', value: zfEingabe(wert), placeholder: opts.platzhalter || '',
  });
}

function fehlerBox() { return h('p', { class: 'fehler', role: 'alert', hidden: true }); }
function zeigeFehler(box, text) { box.textContent = text; box.hidden = !text; }

// ---------------------------------------------------------------- Schritte
export async function schritteSheet() {
  const datum = calc.isoDatum();
  const tw = await db.get('tageswerte', datum);
  sheet('Schritte eintragen', (body, close) => {
    const inp = zahlInput(tw?.schritte, { ganz: true, platzhalter: 'z. B. 8500' });
    const fb = fehlerBox();
    const speichern = async () => {
      const n = calc.zahl(inp.value);
      if (n == null || n < 0 || n > 100000) { zeigeFehler(fb, 'Bitte eine Schrittzahl zwischen 0 und 100.000 eingeben.'); return; }
      await db.patch('tageswerte', datum, { datum, schritte: Math.round(n) });
      toast('Schritte gespeichert');
      close();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') speichern(); });
    body.append(feld('Schritte heute (aktueller Stand)', inp), fb,
      h('button', { type: 'button', class: 'btn primaer gross', onclick: speichern }, 'Speichern'));
  });
}

// ---------------------------------------------------------------- Wiegen
const BEDINGUNGEN = [['nuechtern', 'Nüchtern'], ['nach_sauna', 'Nach Sauna'], ['nach_sport', 'Nach Sport'], ['sonstiges', 'Sonstiges']];

export function wiegenSheet() {
  sheet('Wiegen eintragen', (body, close) => {
    let bedingung = 'nuechtern';
    const gew = zahlInput(null, { platzhalter: 'kg' });
    const kfa = zahlInput(null, { platzhalter: '%' });
    const musk = zahlInput(null, { platzhalter: 'kg' });
    const visz = zahlInput(null, { platzhalter: 'Stufe' });
    const puls = zahlInput(null, { platzhalter: 'Schläge/min', ganz: true });
    const fb = fehlerBox();
    const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Bedingung' });
    const zeichne = () => {
      chips.replaceChildren(...BEDINGUNGEN.map(([k, t]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(k === bedingung),
        class: 'chip' + (k === bedingung ? ' aktiv' : ''), onclick: () => { bedingung = k; zeichne(); },
      }, t)));
    };
    zeichne();
    const speichern = async () => {
      const g = calc.zahl(gew.value);
      if (g == null || g < 30 || g > 300) { zeigeFehler(fb, 'Bitte ein Gewicht zwischen 30 und 300 kg eingeben.'); return; }
      const jetzt = new Date();
      const row = {
        id: `${calc.isoDatum(jetzt)}-${pad2(jetzt.getHours())}${pad2(jetzt.getMinutes())}`,
        datum: calc.isoDatum(jetzt), zeit: hhmm(jetzt), bedingung, gewicht: g, quelle: 'manuell',
      };
      for (const [k, inp] of [['kfa', kfa], ['muskelmasse', musk], ['viszeralfett', visz], ['ruhepuls', puls]]) {
        const n = calc.zahl(inp.value);
        if (n != null) row[k] = n;
      }
      await db.put('messungen', row);
      toast('Messung gespeichert');
      close();
    };
    body.append(
      feld('Gewicht (kg)', gew), feld('Körperfett (%)  – optional', kfa),
      feld('Muskelmasse (kg)  – optional', musk), feld('Viszeralfett  – optional', visz),
      feld('Ruhepuls  – optional', puls),
      h('div', { class: 'feld' }, h('span', { class: 'feld-label' }, 'Bedingung'), chips),
      fb, h('button', { type: 'button', class: 'btn primaer gross', onclick: speichern }, 'Speichern'));
  });
}

// ---------------------------------------------------------------- KURLOG
function alsListe(x) { return Array.isArray(x) ? x : x ? [x] : []; }

export function kurlogSheet() {
  sheet('KURLOG importieren', (body, close) => {
    const ta = h('textarea', {
      rows: '9', placeholder: 'KURLOG-Block aus dem Claude-Chat hier einfügen', autocapitalize: 'off',
      autocorrect: 'off', spellcheck: 'false', class: 'kurlog-ta',
    });
    const fb = fehlerBox();
    const vorschau = h('div', { class: 'vorschau', hidden: true });
    const aktion = h('div', { class: 'btn-reihe' });
    let norm = null;

    const pruefen = async () => {
      zeigeFehler(fb, '');
      vorschau.hidden = true;
      norm = null;
      const text = ta.value.trim();
      if (!text) { zeigeFehler(fb, 'Bitte zuerst den KURLOG-Text einfügen.'); return; }
      let res;
      try { res = parseKurlog(text); } catch (e) { res = { ok: false, fehler: fehlerText(e) }; }
      if (!res.ok) {
        zeigeFehler(fb, 'KURLOG konnte nicht gelesen werden: ' + alsListe(res.fehler).join(' ') );
        return;
      }
      try { norm = normalisiere(res.daten); } catch (e) { zeigeFehler(fb, 'KURLOG ist unvollständig: ' + fehlerText(e)); return; }
      const warn = alsListe(norm.warnungen);
      let planTeile = [];
      if (norm.plan) {
        try {
          const k = await gym.ladeUebungen(db);
          norm.planGeprueft = pruefePlan(norm.plan, k.map, k.vorlagen);
          warn.push(...norm.planGeprueft.warnungen);
          planTeile = [h('p', null, h('strong', null, 'Planänderung')),
            h('ul', { class: 'plan-aenderungen' }, ...norm.planGeprueft.aenderungen.map((a) => h('li', null, a))),
            norm.planGeprueft.begruendung ? h('p', { class: 'muted' }, norm.planGeprueft.begruendung) : null].filter(Boolean);
        } catch (e) { zeigeFehler(fb, 'Planänderung konnte nicht geprüft werden: ' + fehlerText(e)); norm = null; return; }
      }
      vorschau.replaceChildren(
        h('pre', { class: 'vorschau-text' }, vorschauText(norm)),
        ...planTeile,
        ...warn.map((w) => h('p', { class: 'warnung' }, h('span', { html: icon('alert', 18) }), ' ', String(w))));
      vorschau.hidden = false;
      zeichneAktion(true);
    };

    const uebernehmenKlick = async (btn) => {
      btn.disabled = true;
      try {
        await uebernehmen(norm, db);
        if (norm.planGeprueft) await speicherePlan(norm.planGeprueft, db);
        toast(norm.planGeprueft ? 'KURLOG und Plan übernommen' : 'KURLOG übernommen');
        close();
      } catch (e) {
        btn.disabled = false;
        zeigeFehler(fb, 'Übernehmen fehlgeschlagen: ' + fehlerText(e));
      }
    };

    function zeichneAktion(bereit) {
      aktion.replaceChildren(
        h('button', { type: 'button', class: 'btn', onclick: pruefen }, 'Prüfen'),
        ...(bereit ? [h('button', { type: 'button', class: 'btn primaer', onclick: (e) => uebernehmenKlick(e.currentTarget) }, 'Übernehmen')] : []));
    }
    ta.addEventListener('input', () => { if (norm) { norm = null; vorschau.hidden = true; zeichneAktion(false); } });
    zeichneAktion(false);
    body.append(ta, fb, vorschau, aktion);
  });
}

// ---------------------------------------------------------------- Tagesstart
export async function tagesstartKopieren() {
  let text;
  try { text = await baueKurkontext(); } catch (e) { toast('Tagesstart nicht möglich: ' + fehlerText(e)); return; }
  if (await kopiere(text)) { toast('Tagesstart kopiert – im Claude-Chat einfügen'); return; }
  sheet('Tagesstart manuell kopieren', (body) => {
    const ta = h('textarea', { rows: '12', readonly: true, class: 'kurlog-ta', value: text });
    body.append(h('p', { class: 'sheet-text' }, 'Automatisches Kopieren wurde vom Browser blockiert. Text markieren und kopieren:'), ta);
    setTimeout(() => { ta.focus(); ta.select(); }, 80);
  });
}
