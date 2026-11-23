// Onboarding in 3 Schritten: Körperdaten, Gewicht, Kur-Ziele
import * as db from '../db.js';
import * as calc from '../calc.js';
import { h, fehlerText, hhmm, pad2 } from './util.js';
import { feld, zahlInput } from './sheet.js';
import { profilFormular, profilZeile } from './profilform.js';

export const keinAutoRender = true;

export async function render(el, params = {}) {
  const altProfil = await db.get('profil', 'me');
  const form = profilFormular(altProfil, { mitStandard: true });
  const gew = zahlInput(null, { platzhalter: 'kg' });
  const kfa = zahlInput(null, { platzhalter: '%' });
  let werteK = null;
  let schritt = 1;

  const wrap = h('div', { class: 'seite schmal' });
  el.append(wrap);

  const zeige = () => {
    const fb = h('p', { class: 'fehler', role: 'alert', hidden: true });
    const fehler = (t) => { fb.textContent = t; fb.hidden = !t; };
    const kopf = h('div', { class: 'onb-kopf' }, h('h1', { class: 'titel' }, 'Willkommen'), h('p', { class: 'muted' }, `Schritt ${schritt} von 3`));
    const zurueck = schritt > 1 ? h('button', { type: 'button', class: 'btn', onclick: () => { schritt--; zeige(); } }, 'Zurück') : null;
    let inhalt, weiter;

    if (schritt === 1) {
      inhalt = [h('p', null, 'Diese Angaben brauche ich für Grundumsatz und Kalorienziel.'), form.koerper];
      weiter = () => {
        const r = form.lesen({ kurPruefen: false });
        if (r.fehler) return fehler(r.fehler);
        werteK = r.werte; schritt = 2; zeige();
      };
    } else if (schritt === 2) {
      inhalt = [h('p', null, 'Dein aktuelles Gewicht (am besten nüchtern gewogen).'), feld('Gewicht (kg)', gew), feld('Körperfett (%)  – optional', kfa, 'Mit Körperfettwert wird das Proteinziel genauer.')];
      weiter = () => {
        const g = calc.zahl(gew.value);
        if (g == null || g < 30 || g > 300) return fehler('Bitte ein Gewicht zwischen 30 und 300 kg eingeben.');
        const k = calc.zahl(kfa.value);
        if (kfa.value.trim() && (k == null || k < 2 || k > 70)) return fehler('Körperfett bitte in Prozent angeben (2 bis 70) oder leer lassen.');
        schritt = 3; zeige();
      };
    } else {
      inhalt = [h('p', null, 'Rahmen der Kur.'), form.kur,
        h('p', { class: 'hinweis' }, 'Deine Ziele berechnet die App aus deinen Messwerten nach aktueller Studienlage (Einstellungen → Ziele & Belege).')];
      weiter = async () => {
        const r = form.lesen({ koerperPruefen: false });
        if (r.fehler) return fehler(r.fehler);
        try {
          const jetzt = new Date();
          const mess = {
            id: `${calc.isoDatum(jetzt)}-${pad2(jetzt.getHours())}${pad2(jetzt.getMinutes())}`,
            datum: calc.isoDatum(jetzt), zeit: hhmm(jetzt), bedingung: 'nuechtern', gewicht: calc.zahl(gew.value), quelle: 'onboarding',
          };
          const k = calc.zahl(kfa.value);
          if (k != null) mess.kfa = k;
          await db.put('messungen', mess);
          await db.put('profil', profilZeile(altProfil, { ...werteK, ...r.werte }, { onboarding_fertig: true }));
          params.weiter?.();
        } catch (e) { fehler(fehlerText(e)); }
      };
    }
    const btn = h('button', { type: 'button', class: 'btn primaer gross', onclick: weiter }, schritt === 3 ? 'Fertig' : 'Weiter');
    wrap.replaceChildren(kopf, h('div', { class: 'karte' }, ...inhalt), fb, h('div', { class: 'btn-reihe' }, zurueck, btn));
    window.scrollTo(0, 0);
  };
  zeige();
}
