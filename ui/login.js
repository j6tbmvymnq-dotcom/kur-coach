// Login: E-Mail -> Link + Code; Code im Home-Bildschirm-App eingeben
import * as db from '../db.js';
import { h, fehlerText } from './util.js';
import { feld } from './sheet.js';

export const keinAutoRender = true;

export async function render(el, params = {}) {
  const box = h('div', { class: 'karte login' });
  el.append(h('div', { class: 'seite schmal' }, h('h1', { class: 'titel' }, 'Kur-Coach'), box));

  if (!db.istOnlineModus()) {
    box.append(
      h('p', null, 'Demo-Modus: Es ist kein Server eingerichtet. Alle Daten bleiben nur auf diesem Gerät.'),
      h('button', { type: 'button', class: 'btn primaer gross', onclick: () => params.weiter?.() }, 'Weiter im Demo-Modus'));
    return;
  }

  let email = '';
  const schrittEmail = () => {
    const inp = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', placeholder: 'name@beispiel.de', value: email });
    const fb = h('p', { class: 'fehler', role: 'alert', hidden: true });
    const btn = h('button', { type: 'button', class: 'btn primaer gross' }, 'Link + Code senden');
    const senden = async () => {
      email = inp.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { fb.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.'; fb.hidden = false; return; }
      btn.disabled = true; fb.hidden = true;
      try { await db.loginLink(email); schrittCode(); } catch (e) { fb.textContent = fehlerText(e); fb.hidden = false; btn.disabled = false; }
    };
    btn.addEventListener('click', senden);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') senden(); });
    box.replaceChildren(
      h('p', null, 'Melde dich mit deiner E-Mail-Adresse an. Du bekommst eine Mail mit Link und 6-stelligem Code.'),
      feld('E-Mail', inp), fb, btn);
  };

  const schrittCode = () => {
    const inp = h('input', {
      type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]*',
      placeholder: '123456', class: 'code-input',
    });
    const fb = h('p', { class: 'fehler', role: 'alert', hidden: true });
    const btn = h('button', { type: 'button', class: 'btn primaer gross' }, 'Anmelden');
    const pruefen = async () => {
      const code = inp.value.replace(/\D/g, '');
      if (code.length !== 6) { fb.textContent = 'Der Code hat 6 Ziffern.'; fb.hidden = false; return; }
      btn.disabled = true; fb.hidden = true;
      try {
        await db.loginCode(email, code);
        try { await db.sync(); } catch { /* offline: später */ }
        params.weiter?.();
      } catch (e) { fb.textContent = fehlerText(e); fb.hidden = false; btn.disabled = false; }
    };
    btn.addEventListener('click', pruefen);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') pruefen(); });
    inp.addEventListener('input', () => { if (inp.value.replace(/\D/g, '').length === 6) pruefen(); });
    box.replaceChildren(
      h('p', null, `Mail an ${email} gesendet.`),
      h('p', { class: 'hinweis' }, 'In der App auf dem Home-Bildschirm bitte den Code aus der Mail eingeben. Der Link in der Mail öffnet nur Safari und meldet dort an.'),
      feld('Code aus der Mail', inp), fb, btn,
      h('button', { type: 'button', class: 'btn', onclick: schrittEmail }, 'Andere E-Mail oder neuer Code'));
  };

  schrittEmail();
}
