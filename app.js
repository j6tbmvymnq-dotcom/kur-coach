// Kur-Coach: Start, Hash-Router, Statusleiste, Navigation, Service Worker
import * as db from './db.js';
import * as calc from './calc.js';
import { icon } from './ui/icons.js';
import { h } from './ui/util.js';
import { slotStarts } from './ui/daten.js';
import * as heute from './ui/heute.js';
import * as checkliste from './ui/checkliste.js';
import * as studio from './ui/studio.js';
import * as freizeit from './ui/freizeit.js';
import * as einstellungen from './ui/einstellungen.js';
import * as backend from './ui/backend.js';
import * as login from './ui/login.js';
import * as onboarding from './ui/onboarding.js';

const ROUTEN = { heute, checkliste, studio, freizeit, einstellungen, backend };
const NAV = [
  ['heute', 'Heute', 'home'], ['checkliste', 'Checkliste', 'check'],
  ['studio', 'Studio', 'dumbbell'], ['freizeit', 'Freizeit', 'compass'], ['einstellungen', 'Einstellungen', 'gear'],
];

const main = document.getElementById('main');
const nav = document.getElementById('nav');
let token = 0;
let aktuell = null;       // { name, modul }
let rerenderTimer = null;

// ---------------------------------------------------------------- Start-Parameter
async function startParameter() {
  const q = new URLSearchParams(location.search);
  const slot = q.get('slot');
  const steps = q.get('steps');
  if (steps != null) {
    const n = calc.zahl(steps);
    if (n != null && n >= 0) {
      const heuteDatum = calc.isoDatum();
      try {
        const alt = await db.get('tageswerte', heuteDatum);
        if (Math.round(n) > (alt?.schritte || 0)) await db.patch('tageswerte', heuteDatum, { datum: heuteDatum, schritte: Math.round(n) });
      } catch { /* Schritte sind nicht kritisch */ }
    }
  }
  let ziel = location.hash && /^#\/(heute|checkliste|studio|freizeit|einstellungen|backend)/.test(location.hash) ? location.hash : '#/heute';
  if (slot && calc.istSlot(slot)) ziel = `#/checkliste/${slot}`;
  history.replaceState(null, '', location.pathname + ziel);   // Query entfernt
}

// ---------------------------------------------------------------- Router
function navZeichnen(aktiv) {
  nav.replaceChildren(...NAV.map(([name, text, ic]) => h('a', {
    href: `#/${name}`, class: 'nav-punkt' + (name === aktiv ? ' aktiv' : ''), 'aria-current': name === aktiv ? 'page' : null,
  }, h('span', { html: icon(ic, 24) }), h('span', null, text))));
}

async function route() {
  const mein = ++token;
  const teile = (location.hash || '#/heute').replace(/^#\/?/, '').split('/');
  let name = ROUTEN[teile[0]] ? teile[0] : 'heute';
  const params = { weiter: route, slot: teile[1] };
  let modul, anzeigeName = name;

  let session = null, profil = null;
  try { session = await db.session(); } catch { session = null; }
  if (session) { try { profil = await db.get('profil', 'me'); } catch { profil = null; } }

  if (!session) { modul = login; anzeigeName = 'login'; }
  else if (!profil?.einstellungen?.onboarding_fertig) { modul = onboarding; anzeigeName = 'onboarding'; }
  else {
    modul = ROUTEN[name];
    if (name === 'checkliste' && !calc.istSlot(params.slot)) {
      params.slot = calc.slotNachUhrzeit(new Date(), slotStarts(profil.einstellungen));
    }
  }
  if (mein !== token) return;

  const x = window.scrollY;
  const behalten = aktuell && aktuell.name === anzeigeName && aktuell.slot === params.slot;
  const wrap = h('div', { class: 'ansicht' });
  try {
    await modul.render(wrap, params);
  } catch (e) {
    console.error(e);
    wrap.replaceChildren(h('div', { class: 'seite schmal' }, h('div', { class: 'karte' },
      h('p', { class: 'fehler' }, 'Diese Ansicht konnte nicht geladen werden.'), h('p', { class: 'muted' }, String(e?.message || e)))));
  }
  if (mein !== token) return;
  main.replaceChildren(wrap);
  aktuell = { name: anzeigeName, slot: params.slot, modul };
  const zeigeNav = anzeigeName !== 'login' && anzeigeName !== 'onboarding';
  nav.hidden = !zeigeNav;
  document.body.classList.toggle('ohne-nav', !zeigeNav);
  if (zeigeNav) navZeichnen(name === 'backend' ? 'einstellungen' : name);
  window.scrollTo(0, behalten ? x : 0);
}

function neuRendernPlanen() {
  if (!aktuell || aktuell.modul.keinAutoRender) return;
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(route, 150);
}

// ---------------------------------------------------------------- Statusleiste
function statusZeichnen(s) {
  const b = document.getElementById('statusleiste');
  let text, art;
  if (!db.istOnlineModus()) { text = 'Demo-Modus – Daten nur auf diesem Gerät'; art = 'demo'; }
  else if (s.fehler) { text = 'Sync-Fehler – tippen zum Wiederholen'; art = 'fehler'; }
  else if (!s.online) { text = s.offen ? `Offline – ${s.offen} offen` : 'Offline'; art = 'offline'; }
  else if (s.offen > 0) { text = `${s.offen} offen – tippen zum Senden`; art = 'offen'; }
  else if (s.angemeldet === false) { text = 'Nicht angemeldet'; art = 'offline'; }
  else { text = 'Synchron'; art = 'ok'; }
  b.className = `status ${art}`;
  b.replaceChildren(h('span', { html: icon(art === 'offline' ? 'cloudoff' : art === 'fehler' ? 'alert' : 'cloud', 16) }), ' ', text);
}

// ---------------------------------------------------------------- Service Worker
function swRegistrieren() {
  if (!('serviceWorker' in navigator)) return;
  const hinweis = document.getElementById('update');
  let neu = null;
  const zeige = (w) => { neu = w; hinweis.hidden = false; };
  hinweis.addEventListener('click', () => { if (neu) neu.postMessage('skipWaiting'); else location.reload(); });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) zeige(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) zeige(w); });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch((e) => console.warn('Service Worker:', e));
  let neuGeladen = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!neuGeladen) { neuGeladen = true; location.reload(); } });
}

// ---------------------------------------------------------------- Start
async function start() {
  main.textContent = 'Lade ...';
  try {
    await db.init();
    await startParameter();
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('div', { class: 'seite schmal' }, h('div', { class: 'karte' },
      h('p', { class: 'fehler' }, 'Die lokale Datenbank konnte nicht geöffnet werden.'), h('p', { class: 'muted' }, String(e?.message || e)))));
    return;
  }
  document.getElementById('statusleiste').addEventListener('click', () => { db.sync().catch(() => {}); });
  db.onSyncStatus(statusZeichnen);
  statusZeichnen(db.syncStatus());
  db.onChange(neuRendernPlanen);
  db.onAuth(() => route());
  window.addEventListener('hashchange', route);
  swRegistrieren();
  route();
}

start();

// Kein Pinch-Zoom (iOS ignoriert user-scalable=no teilweise)
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
