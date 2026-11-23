// Profil-Formular (Onboarding + Einstellungen). Gibt Gruppen von Feldern und eine Lese-/Prüffunktion zurück.
import * as calc from '../calc.js';
import { h } from './util.js';
import { feld, zahlInput } from './sheet.js';

export const STANDARD = { kur_start: '2026-11-25', kur_tage: 21 };

export function profilFormular(profil = {}, { mitStandard = false } = {}) {
  const p = profil || {};
  const std = mitStandard ? STANDARD : {};
  const v = (k) => p[k] ?? std[k] ?? null;
  const sauna = (p.einstellungen?.aerztliche_sperre || []).includes('sauna');
  let geschlecht = p.geschlecht ?? null;

  const geb = zahlInput(v('geburtsjahr'), { ganz: true, platzhalter: 'z. B. 1990' });
  const gr = zahlInput(v('groesse_cm'), { platzhalter: 'cm' });
  const start = h('input', { type: 'date', value: v('kur_start') || '' });
  const tage = zahlInput(v('kur_tage'), { ganz: true });
  const arzt = h('textarea', { rows: '3', placeholder: 'Optional: Vorgaben deines Arztes', value: p.vorgaben_arzt || '' });
  const sperre = h('input', { type: 'checkbox', checked: sauna });

  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Geschlecht' });
  const zeichneChips = () => chips.replaceChildren(...[['m', 'Männlich'], ['w', 'Weiblich']].map(([k, t]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(geschlecht === k), class: 'chip' + (geschlecht === k ? ' aktiv' : ''),
    onclick: () => { geschlecht = k; zeichneChips(); },
  }, t)));
  zeichneChips();

  const koerper = h('div', { class: 'gruppe' },
    h('div', { class: 'feld' }, h('span', { class: 'feld-label' }, 'Geschlecht'), chips),
    feld('Geburtsjahr', geb), feld('Größe (cm)', gr));

  const kur = h('div', { class: 'gruppe' },
    feld('Kurstart', start), feld('Kurtage', tage),
    feld('Ärztliche Vorgaben (optional)', arzt),
    h('label', { class: 'check-zeile' }, sperre, h('span', null, 'Sauna ärztlich gesperrt')));

  /** -> { fehler: string|null, werte } (werte für Profil; einstellungen separat gemergt) */
  function lesen({ koerperPruefen = true, kurPruefen = true } = {}) {
    const out = {};
    if (koerperPruefen) {
      const jahr = calc.zahl(geb.value), groesse = calc.zahl(gr.value);
      if (!geschlecht) return { fehler: 'Bitte das Geschlecht wählen.' };
      if (jahr == null || jahr < 1930 || jahr > new Date().getFullYear() - 14) return { fehler: 'Bitte ein gültiges Geburtsjahr eingeben (z. B. 1990).' };
      if (groesse == null || groesse < 120 || groesse > 230) return { fehler: 'Bitte die Größe in cm eingeben (120 bis 230).' };
      Object.assign(out, { geschlecht, geburtsjahr: Math.round(jahr), groesse_cm: groesse });
    }
    if (kurPruefen) {
      const kt = calc.zahl(tage.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start.value)) return { fehler: 'Bitte das Datum des Kurstarts wählen.' };
      if (kt == null || kt < 1 || kt > 120) return { fehler: 'Bitte die Anzahl der Kurtage eingeben.' };
      Object.assign(out, {
        kur_start: start.value, kur_tage: Math.round(kt),
        vorgaben_arzt: arzt.value.trim() || null, _sauna_gesperrt: sperre.checked,
      });
    }
    return { fehler: null, werte: out };
  }

  return { koerper, kur, lesen };
}

/** Werte aus lesen() in eine Profilzeile mischen */
export function profilZeile(alt, werte, extraEinstellungen = {}) {
  const w = { ...werte };
  const sauna = w._sauna_gesperrt;
  delete w._sauna_gesperrt;
  const einst = { ...(alt?.einstellungen || {}), ...extraEinstellungen };
  if (sauna != null) einst.aerztliche_sperre = sauna ? ['sauna'] : [];
  return { ...(alt || {}), ...w, einstellungen: einst };
}
