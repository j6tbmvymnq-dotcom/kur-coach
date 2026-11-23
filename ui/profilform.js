// Profil-Formular (Onboarding + Einstellungen). Gibt Gruppen von Feldern und eine Lese-/Prüffunktion zurück.
import * as calc from '../calc.js';
import { h, zf1 } from './util.js';
import { feld, zahlInput } from './sheet.js';

export const STANDARD = { kur_start: '2026-11-25', kur_tage: 21, defizit_prozent: 25, protein_g_pro_kg: 2.0, schritte_ziel: 15000 };

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
  const defI = h('input', { type: 'range', min: '15', max: '30', step: '1', value: String(v('defizit_prozent') ?? 25) });
  const defT = h('output', null, '');
  const proI = h('input', { type: 'range', min: '1.8', max: '2.4', step: '0.1', value: String(v('protein_g_pro_kg') ?? 2.0) });
  const proT = h('output', null, '');
  const sch = zahlInput(v('schritte_ziel'), { ganz: true });
  const arzt = h('textarea', { rows: '3', placeholder: 'Optional: Vorgaben deines Arztes', value: p.vorgaben_arzt || '' });
  const sperre = h('input', { type: 'checkbox', checked: sauna });
  const aktual = () => {
    defT.textContent = `${defI.value} %`;
    proT.textContent = `${zf1(Number(proI.value))} g/kg`;
  };
  defI.addEventListener('input', aktual); proI.addEventListener('input', aktual); aktual();

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
    h('div', { class: 'feld' }, h('span', { class: 'feld-label' }, 'Kaloriendefizit ', defT), defI,
      h('span', { class: 'feld-hinweis' }, 'Zwischen 15 und 30 %. Das Ziel liegt nie unter dem Grundumsatz.')),
    h('div', { class: 'feld' }, h('span', { class: 'feld-label' }, 'Protein ', proT), proI),
    feld('Schritte-Ziel pro Tag', sch),
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
      const kt = calc.zahl(tage.value), sz = calc.zahl(sch.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start.value)) return { fehler: 'Bitte das Datum des Kurstarts wählen.' };
      if (kt == null || kt < 1 || kt > 120) return { fehler: 'Bitte die Anzahl der Kurtage eingeben.' };
      if (sz == null || sz < 1000 || sz > 60000) return { fehler: 'Bitte ein Schritte-Ziel zwischen 1.000 und 60.000 eingeben.' };
      Object.assign(out, {
        kur_start: start.value, kur_tage: Math.round(kt), defizit_prozent: Number(defI.value),
        protein_g_pro_kg: Number(proI.value), schritte_ziel: Math.round(sz),
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
