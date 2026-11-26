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
  // Standard: E-Mail + Passwort (funktioniert in Safari und in der Home-Bildschirm-App gleich)
  const schrittPasswort = (neu = false, hinweis = '') => {
    const inpMail = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', placeholder: 'name@beispiel.de', value: email });
    const inpPw = h('input', { type: 'password', autocomplete: neu ? 'new-password' : 'current-password', placeholder: neu ? 'mind. 6 Zeichen' : 'Passwort' });
    const fb = h('p', { class: 'fehler', role: 'alert', hidden: true });
    const info = h('p', { class: 'hinweis', hidden: !hinweis }, hinweis);
    const btn = h('button', { type: 'button', class: 'btn primaer gross' }, neu ? 'Konto anlegen' : 'Anmelden');
    const los = async () => {
      email = inpMail.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { fb.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.'; fb.hidden = false; return; }
      if (inpPw.value.length < 6) { fb.textContent = 'Das Passwort muss mindestens 6 Zeichen haben.'; fb.hidden = false; return; }
      btn.disabled = true; fb.hidden = true;
      try {
        const r = await db.loginPasswort(email, inpPw.value, neu);
        if (r.bestaetigen) {
          schrittPasswort(false, 'Fast geschafft: Bestätigungsmail ist unterwegs. Link in der Mail antippen, dann hier mit E-Mail und Passwort anmelden.');
          return;
        }
        try { await db.sync(); } catch { /* offline: später */ }
        params.weiter?.();
      } catch (e) { fb.textContent = fehlerText(e); fb.hidden = false; btn.disabled = false; }
    };
    btn.addEventListener('click', los);
    inpPw.addEventListener('keydown', (e) => { if (e.key === 'Enter') los(); });
    box.replaceChildren(
      h('p', null, neu ? 'Neues Konto: E-Mail und ein Passwort wählen.' : 'Mit E-Mail und Passwort anmelden.'),
      feld('E-Mail', inpMail), feld('Passwort', inpPw), fb, info, btn,
      h('button', { type: 'button', class: 'btn', onclick: () => schrittPasswort(!neu) }, neu ? 'Ich habe schon ein Konto' : 'Erstes Mal? Konto anlegen'),
      h('button', { type: 'button', class: 'btn', onclick: () => schrittEmail() }, 'Stattdessen Link per Mail'));
  };

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
      h('p', null, 'Du bekommst eine Mail mit Anmelde-Link (öffnet Safari).'),
      feld('E-Mail', inp), fb, btn,
      h('button', { type: 'button', class: 'btn', onclick: () => schrittPasswort(false) }, 'Zurück zu Passwort'));
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

  schrittPasswort(false);
}
