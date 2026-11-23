// Kleine Helfer für alle Screens
export const APP_VERSION = '1.0.0';

function anhaengen(el, kind) {
  if (kind == null || kind === false || kind === true) return;
  if (Array.isArray(kind)) { kind.forEach((k) => anhaengen(el, k)); return; }
  el.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
}

/** h('div', {class:'x', onclick:fn}, kinder...) */
export function h(tag, attrs, ...kinder) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  anhaengen(el, kinder);
  return el;
}

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
export const zf = (n) => (n == null || !isFinite(n) ? '–' : nf0.format(n));
export const zf1 = (n) => (n == null || !isFinite(n) ? '–' : nf1.format(n));
/** Zahl für Eingabefelder (Komma) */
export const zfEingabe = (n) => (n == null || !isFinite(n) ? '' : String(n).replace('.', ','));

export const pad2 = (n) => String(n).padStart(2, '0');
export const hhmm = (d = new Date()) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
export const minZuHhmm = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

export function toast(text) {
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2800);
}

/** In die Zwischenablage kopieren; false, wenn nicht möglich */
export async function kopiere(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* Fallback */ }
  const ta = h('textarea', { value: text, readonly: true, class: 'kopier-ta' });
  document.body.append(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export function fehlerText(e) {
  return (e && e.message) ? e.message : 'Unbekannter Fehler.';
}
