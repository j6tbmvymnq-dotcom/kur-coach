// Screen "Heute": Ringe, Zeitleiste, Schnellaktionen
import * as calc from '../calc.js';
import { icon } from './icons.js';
import { h, zf, minZuHhmm, hhmm } from './util.js';
import { ladeTag, slotStarts, zuWenigWarnung, ZIEL_TRAINING_MIN } from './daten.js';
import * as db from '../db.js';
import { schritteSheet, wiegenSheet, kurlogSheet, tagesstartKopieren, sheet, feld, zahlInput } from './sheet.js';
import { tipp as freizeitTipp } from './freizeit.js';

function ring({ wert, ziel, farbe, label, gross, klein }) {
  const r = 42, u = 2 * Math.PI * r;
  const p = ziel > 0 ? Math.min(1, wert / ziel) : 0;
  return h('div', { class: 'ring-box' },
    h('div', { class: 'ring-wrap' },
      h('span', { html: `<svg viewBox="0 0 100 100" class="ring" aria-hidden="true"><circle cx="50" cy="50" r="${r}" class="ring-bg"/><circle cx="50" cy="50" r="${r}" class="ring-fg" stroke="${farbe}" stroke-dasharray="${(p * u).toFixed(1)} ${u.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>` }),
      h('div', { class: 'ring-mitte' }, h('strong', null, gross), h('span', null, klein))),
    h('div', { class: 'ring-label' }, label));
}

function kopfText(k, profil) {
  if (!profil?.kur_start) return 'Kur-Coach';
  if (k.status === 'vorher') {
    const n = calc.tageZwischen(calc.isoDatum(), profil.kur_start);
    return n === 1 ? 'Kur beginnt morgen' : `Kur beginnt in ${n} Tagen`;
  }
  if (k.status === 'vorbei') return 'Kur beendet';
  return `Tag ${k.tag}/${k.von}`;
}

function zeitleiste(d, starts) {
  const jetzt = new Date();
  const nowMin = jetzt.getHours() * 60 + jetzt.getMinutes();
  const eintraege = [];
  for (const t of d.termine) {
    // geplantes Training grün, Therapie/Arzt/Kurs grau
    const art = t.kategorie === 'training' || t.kategorie === 'bewegung' ? 'training' : 'termin';
    eintraege.push({ min: calc.zeitZuMin(t.start), art, titel: t.titel, sub: [t.ende ? `bis ${t.ende.slice(0, 5)}` : null, t.ort].filter(Boolean).join(' · '), zeit: t.start?.slice(0, 5) });
  }
  for (const t of d.trainings) {
    let min = null, zeit = null;
    if (t.start) { const dt = new Date(t.start); if (!isNaN(dt)) { min = dt.getHours() * 60 + dt.getMinutes(); zeit = hhmm(dt); } }
    eintraege.push({ min, art: t.art === 'sauna' ? 'sauna' : 'training', titel: t.titel || t.art || 'Training', sub: t.minuten ? `${t.minuten} min` : '', zeit });
  }
  for (const m of d.mahlzeiten) {
    eintraege.push({ min: calc.zeitZuMin(m.zeit), art: 'essen', titel: m.beschreibung || m.typ || 'Mahlzeit', sub: m.kcal != null ? `${zf(calc.zahl(m.kcal))} kcal` : '', zeit: m.zeit?.slice(0, 5) });
  }
  let n = 0;
  for (const s of calc.SLOTS) {
    if (starts[s] > nowMin && n < 3) { n++; eintraege.push({ min: starts[s], art: 'slot', titel: `Checkliste ${calc.SLOT_NAMEN[s]}`, sub: '', zeit: minZuHhmm(starts[s]), href: `#/checkliste/${s}` }); }
  }
  eintraege.sort((a, b) => (a.min ?? 9999) - (b.min ?? 9999));
  if (!eintraege.length) return h('p', { class: 'leer' }, 'Heute ist noch nichts eingetragen.');
  return h('ul', { class: 'zeit' }, eintraege.map((e) => {
    const inh = [h('span', { class: 'zeit-uhr' }, e.zeit || ''), h('span', { class: 'zeit-punkt' }),
      h('span', { class: 'zeit-text' }, h('strong', null, e.titel), e.sub ? h('small', null, e.sub) : null)];
    const vorbei = e.min != null && e.min < nowMin && e.art !== 'slot';
    return h('li', { class: `zeit-eintrag ${e.art}` + (vorbei ? ' vorbei' : '') },
      e.href ? h('a', { href: e.href, class: 'zeit-zeile' }, inh) : h('div', { class: 'zeit-zeile' }, inh));
  }));
}

function werteSheet(d) {
  sheet('Werte manuell', (body, close) => {
    const t = d.tag || {};
    const schlaf = zahlInput(t.schlaf_min != null ? calc.runde(t.schlaf_min / 60, 1) : null, { platzhalter: 'z. B. 7,5' });
    const puls = zahlInput(t.ruhepuls, { ganz: true, platzhalter: 'Schläge/min' });
    const hrv = zahlInput(t.hrv_ms != null ? Math.round(t.hrv_ms) : null, { ganz: true, platzhalter: 'ms' });
    const energie = zahlInput(t.energie_1_5, { ganz: true, platzhalter: '1 bis 5' });
    const fb = h('p', { class: 'fehler', role: 'alert', hidden: true });
    const speichern = async () => {
      const f = {};
      const s = calc.zahl(schlaf.value), p = calc.zahl(puls.value), v = calc.zahl(hrv.value), e = calc.zahl(energie.value);
      if (s != null) { if (s < 0 || s > 24) { fb.textContent = 'Schlaf bitte in Stunden (0 bis 24).'; fb.hidden = false; return; } f.schlaf_min = Math.round(s * 60); }
      if (p != null) { if (p < 20 || p > 220) { fb.textContent = 'Ruhepuls bitte zwischen 20 und 220.'; fb.hidden = false; return; } f.ruhepuls = Math.round(p); }
      if (v != null) { if (v < 1 || v > 400) { fb.textContent = 'HRV bitte zwischen 1 und 400 ms.'; fb.hidden = false; return; } f.hrv_ms = Math.round(v); }
      if (e != null) { if (e < 1 || e > 5) { fb.textContent = 'Energie bitte von 1 bis 5.'; fb.hidden = false; return; } f.energie_1_5 = Math.round(e); }
      if (!Object.keys(f).length) { fb.textContent = 'Bitte mindestens einen Wert eintragen.'; fb.hidden = false; return; }
      await db.patch('tageswerte', d.datum, { datum: d.datum, ...f });
      close();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
    body.append(feld('Schlaf (Stunden)', schlaf), feld('Ruhepuls', puls), feld('HRV (ms)', hrv), feld('Energie (1 bis 5)', energie), fb,
      h('button', { type: 'button', class: 'btn primaer gross', onclick: speichern }, 'Speichern'));
  });
}

function readinessKarte(d) {
  const r = d.readiness || { ampel: null, gruende: [] };
  const farbe = { gruen: 'var(--accent)', gelb: 'var(--orange)', rot: '#e5534b', kalibrierung: 'var(--muted, #8a8f98)' }[r.ampel] || 'var(--muted, #8a8f98)';
  const wort = { gruen: 'Gut erholt', gelb: 'Etwas gebremst', rot: 'Erholung zuerst', kalibrierung: 'Sammle Daten' }[r.ampel] || 'Keine Watch-Daten';
  const punkt = h('span', { class: 'ampel-punkt', style: `background:${farbe}`, 'aria-hidden': 'true' });
  const empf = r.ampel === 'gelb' || r.ampel === 'rot' ? h('p', { class: 'muted klein-text' }, calc.READINESS_TEXT[r.ampel]) : null;
  return h('div', { class: 'karte ampel-karte' },
    h('div', { class: 'ampel-zeile' }, punkt, h('strong', null, wort),
      h('button', { type: 'button', class: 'btn klein', onclick: () => werteSheet(d) }, 'Werte')),
    empf);
}

export async function render(el) {
  const d = await ladeTag();
  const warn = await zuWenigWarnung(d);
  const { ziele, summe, tag } = d;
  const starts = slotStarts(d.einst);
  const kcalZiel = ziele.kcal;
  const proteinZiel = ziele.makros?.protein ?? null;

  const kcalRest = kcalZiel != null ? kcalZiel - summe.kcal : null;
  const hinweise = [];
  if (!d.messung) hinweise.push('Trage zuerst dein Gewicht ein (Wiegen eintragen). Dann kann ich dein Kalorienziel berechnen.');
  else if (kcalZiel == null) hinweise.push('Das Kalorienziel kann noch nicht berechnet werden. Bitte Profil in den Einstellungen prüfen.');

  const ringe = h('div', { class: 'ringe' },
    ring({
      wert: summe.kcal, ziel: kcalZiel, farbe: 'var(--orange)', label: 'Kalorien',
      gross: kcalZiel != null ? zf(Math.abs(kcalRest)) : zf(summe.kcal),
      klein: kcalZiel == null ? 'kcal gegessen' : kcalRest >= 0 ? 'kcal übrig' : 'kcal drüber',
    }),
    ring({ wert: summe.protein, ziel: proteinZiel, farbe: 'var(--accent)', label: 'Protein', gross: zf(summe.protein), klein: proteinZiel ? `von ${zf(proteinZiel)} g` : 'g (Ziel offen)' }),
    ring({ wert: tag.schritte || 0, ziel: ziele.schritte, farbe: 'var(--blau)', label: 'Schritte', gross: zf(tag.schritte || 0), klein: `von ${zf(ziele.schritte)}` }),
    ring({ wert: d.trainingMin, ziel: ZIEL_TRAINING_MIN, farbe: '#9be07a', label: 'Training', gross: zf(d.trainingMin), klein: `von ${ZIEL_TRAINING_MIN} min` }));

  const links = h('div', { class: 'spalte' },
    h('div', { class: 'heute-kopf' },
      h('h1', { class: 'titel gross' }, kopfText(d.kurtag, d.profil)),
      h('p', { class: 'muted' }, new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()))),
    readinessKarte(d),
    warn ? h('div', { class: 'warnung-box', role: 'alert' }, h('span', { html: icon('alert', 22) }),
      h('p', null, 'Seit zwei Tagen liegst du deutlich unter deinem Kalorienziel (mehr als 1.000 kcal). Iss ausreichend, Muskeln und Energie brauchen das.')) : null,
    hinweise.map((t) => h('div', { class: 'info-box' }, h('span', { html: icon('scale', 22) }), h('p', null, t))),
    h('div', { class: 'karte' }, ringe),
    h('a', { href: '#/studio', class: 'btn primaer gross training-btn' }, h('span', { html: icon('dumbbell', 24) }), ' Training starten'),
    h('div', { class: 'aktionen' },
      h('button', { type: 'button', class: 'btn', onclick: () => tagesstartKopieren() }, h('span', { html: icon('copy', 20) }), ' Tagesstart kopieren'),
      h('button', { type: 'button', class: 'btn', onclick: () => kurlogSheet() }, h('span', { html: icon('upload', 20) }), ' KURLOG importieren'),
      h('button', { type: 'button', class: 'btn', onclick: () => schritteSheet() }, h('span', { html: icon('steps', 20) }), ' Schritte eintragen'),
      h('button', { type: 'button', class: 'btn', onclick: () => wiegenSheet() }, h('span', { html: icon('scale', 20) }), ' Wiegen eintragen')));

  const rechts = h('div', { class: 'spalte' },
    h('div', { class: 'karte' }, h('h2', { class: 'klein-titel' }, 'Zeitleiste heute'), zeitleiste(d, starts)));

  let tipp = null;
  try { tipp = await freizeitTipp(); } catch { tipp = null; }
  if (tipp) {
    rechts.append(h('a', { href: '#/freizeit', class: 'karte fz-tipp' }, h('span', { html: icon('compass', 26) }),
      h('span', { class: 'fz-kopf-text fz-spalte' }, h('span', { class: 'muted' }, 'Freizeit-Tipp'), h('strong', null, tipp.titel), tipp.text ? h('span', null, tipp.text) : null)));
  }
  el.append(h('div', { class: 'seite heute' }, links, rechts));
}
