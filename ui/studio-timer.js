// Studio: Pausentimer (Endzeitpunkt-basiert), Ton, Vibration, Screen Wake Lock
import { h } from './util.js';

const KEY = 'kc_pause_ende';
let ende = null, bar = null, zeitEl = null, labelEl = null, tick = null, ctx = null;

// ---------------------------------------------------------------- Audio (iOS: beim ersten Tipp entsperren)
export function entsperreAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* kein Ton */ }
}
document.addEventListener('pointerdown', entsperreAudio, { capture: true, passive: true });

export function piep() {
  try {
    entsperreAudio();
    if (ctx) {
      const t0 = ctx.currentTime;
      [0, 0.28, 0.56].forEach((d, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = i === 2 ? 1175 : 880;
        g.gain.setValueAtTime(0.0001, t0 + d);
        g.gain.exponentialRampToValueAtTime(0.5, t0 + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.2);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0 + d); o.stop(t0 + d + 0.22);
      });
    }
  } catch { /* still */ }
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]); } catch { /* nicht überall */ }
}

// ---------------------------------------------------------------- Timer
const imStudio = () => (location.hash || '').startsWith('#/studio');
const speichern = () => { try { if (ende) sessionStorage.setItem(KEY, String(ende)); else sessionStorage.removeItem(KEY); } catch { /* egal */ } };
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function baue() {
  if (bar) return;
  zeitEl = h('div', { class: 'pause-zeit', 'aria-live': 'off' }, '0:00');
  labelEl = h('div', { class: 'pause-label' }, 'Pause');
  bar = h('div', { class: 'pause-leiste', role: 'timer', hidden: true },
    h('div', { class: 'pause-info' }, labelEl, zeitEl),
    h('button', { type: 'button', class: 'btn', onclick: () => { ende = (ende || Date.now()) + 30000; speichern(); aktualisiere(); } }, '+30 s'),
    h('button', { type: 'button', class: 'btn', onclick: stoppe }, 'Überspringen'));
  document.body.append(bar);
}

function aktualisiere() {
  if (!ende) { if (bar) bar.hidden = true; return; }
  const rest = Math.ceil((ende - Date.now()) / 1000);
  if (rest <= 0) { fertig(); return; }
  bar.hidden = !imStudio();
  bar.classList.remove('vorbei');
  labelEl.textContent = 'Pause';
  zeitEl.textContent = mmss(rest);
}

function fertig() {
  ende = null; speichern();
  clearInterval(tick); tick = null;
  if (!bar) return;
  piep();
  bar.hidden = !imStudio();
  bar.classList.add('vorbei');
  labelEl.textContent = 'Pause vorbei';
  zeitEl.textContent = '0:00';
  setTimeout(() => { if (!ende && bar) { bar.hidden = true; bar.classList.remove('vorbei'); } }, 4000);
}

function laufen() {
  clearInterval(tick);
  tick = setInterval(aktualisiere, 250);
  aktualisiere();
}

export function startPause(sekunden) {
  baue();
  ende = Date.now() + sekunden * 1000;
  speichern();
  laufen();
}

export function stoppe() {
  ende = null; speichern();
  clearInterval(tick); tick = null;
  if (bar) { bar.hidden = true; bar.classList.remove('vorbei'); }
}

/** Beim Betreten des Studios: laufenden Timer nach Neuladen wiederherstellen */
export function timerWiederherstellen() {
  baue();
  if (ende) { laufen(); return; }
  let v = null;
  try { v = Number(sessionStorage.getItem(KEY)); } catch { v = null; }
  if (v && v > Date.now()) { ende = v; laufen(); } else { speichern(); aktualisiere(); }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && ende) aktualisiere(); });
window.addEventListener('hashchange', () => { if (bar && ende) bar.hidden = !imStudio(); });

// ---------------------------------------------------------------- Wake Lock
let sentinel = null, wlAktiv = false;
async function anfordern() {
  try {
    if (!wlAktiv || !navigator.wakeLock || (sentinel && !sentinel.released)) return;
    sentinel = await navigator.wakeLock.request('screen');
  } catch { /* still ignorieren */ }
}
export function wakeLockAn() { wlAktiv = true; anfordern(); }
export function wakeLockAus() {
  wlAktiv = false;
  try { sentinel?.release(); } catch { /* egal */ }
  sentinel = null;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && wlAktiv) anfordern(); });
window.addEventListener('hashchange', () => { if (!imStudio()) wakeLockAus(); });

