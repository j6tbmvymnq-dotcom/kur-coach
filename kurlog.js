// kurlog.js – KURLOG-Parser/Import und KURKONTEXT-Erzeugung (reine Funktionen, kein DOM, keine DB-Importe)
import { zahl } from './calc.js';

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- Parser

/** Entfernt Kommas vor } oder ] (außerhalb von Strings). */
function ohneTrailingKommas(s) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += s[++i] ?? ''; } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '}' || s[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

/** Klammerzählung ab erster Klammer nach pos (Strings beachtet). */
function extrahiereJson(text, pos) {
  const start = text.indexOf('{', pos);
  if (start < 0) return { fehler: 'kein' };
  let tiefe = 0, inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') tiefe++;
    else if (c === '}') {
      tiefe--;
      if (tiefe === 0) return { json: text.slice(start, i + 1), ende: i + 1 };
    }
  }
  return { fehler: 'offen' };
}

function versuche(text, pos) {
  const r = extrahiereJson(text, pos);
  if (r.fehler) return r;
  try {
    return { obj: JSON.parse(ohneTrailingKommas(r.json)), ende: r.ende };
  } catch (e) {
    return { fehler: 'json', meldung: e.message, ende: r.ende };
  }
}

export function parseKurlog(text) {
  const t = String(text ?? '');
  if (!t.trim()) return { ok: false, daten: null, fehler: 'Der Text ist leer. Bitte den KURLOG-Block aus der Claude-Antwort einfügen.' };
  // Zeichenweise 1:1-Ersetzung typografischer Anführungszeichen, Indizes bleiben gleich
  const t2 = t.replace(/[„“”‟″«»]/g, '"');
  const re = /KURLOG\s*v1/gi;
  const treffer = [];
  let m;
  while ((m = re.exec(t)) !== null) treffer.push(m.index + m[0].length);
  // Ohne Kopfzeile: reines JSON mit bekannten Listen akzeptieren (Claude lässt „KURLOG v1“ manchmal weg)
  if (!treffer.length && /"(mahlzeiten|messungen|trainings|termine|schritte|tag|plan|loeschen)"\s*:/.test(t2)) {
    const i = t2.indexOf('{');
    if (i >= 0) treffer.push(i);
  }
  if (!treffer.length) {
    return { ok: false, daten: null, fehler: 'Kein KURLOG-Block gefunden. Der Text muss „KURLOG v1“ enthalten, direkt gefolgt vom JSON in geschweiften Klammern.' };
  }
  const bloecke = [];
  const fehler = [];
  let bis = 0;
  treffer.forEach((pos, i) => {
    if (pos < bis) return; // liegt innerhalb eines bereits gelesenen JSON
    let r = versuche(t, pos);
    if (!r.obj) {
      const r2 = versuche(t2, pos);
      if (r2.obj) r = r2;
    }
    if (r.obj && typeof r.obj === 'object' && !Array.isArray(r.obj)) {
      bloecke.push(r.obj);
      bis = r.ende;
    } else if (r.fehler === 'kein') {
      fehler.push(`Block ${i + 1}: Nach „KURLOG v1“ folgt kein JSON (keine geschweifte Klammer gefunden).`);
    } else if (r.fehler === 'offen') {
      fehler.push(`Block ${i + 1}: Das JSON ist unvollständig (Klammer wird nicht geschlossen). Wurde die Antwort abgeschnitten? Bitte den ganzen Block kopieren.`);
    } else {
      fehler.push(`Block ${i + 1}: Das JSON ist fehlerhaft (${r.meldung || 'ungültige Struktur'}). Bitte Claude bitten, den KURLOG erneut auszugeben.`);
    }
  });
  if (fehler.length) return { ok: false, daten: null, fehler: fehler.join('\n') };
  return { ok: true, daten: mergeBloecke(bloecke), fehler: null };
}

function mergeBloecke(bloecke) {
  const d = { version: 1 };
  const listen = ['mahlzeiten', 'messungen', 'trainings', 'termine', 'schritte'];
  listen.forEach(k => { d[k] = []; });
  d.tag = [];
  for (const b of bloecke) {
    for (const [k, v] of Object.entries(b)) {
      if (listen.includes(k)) d[k].push(...(Array.isArray(v) ? v : [v]));
      else if (k === 'tag') d.tag.push(...(Array.isArray(v) ? v : [v]));
      else if (k !== 'version') d[k] = v;
    }
  }
  return d;
}

// ---------------------------------------------------------------- Normalisieren

const slug = s => String(s ?? '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const istObj = o => o && typeof o === 'object' && !Array.isArray(o);
const txt = v => (v == null || v === '' ? undefined : String(v));
const ZEIT_RE = /^(\d{1,2}):(\d{2})/;

function zeitNorm(v) {
  const m = ZEIT_RE.exec(String(v ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : undefined;
}

/** Lokales datum + 'HH:MM' -> ISO-Zeitstempel (UTC-Darstellung der lokalen Zeit). */
function lokalIso(datum, hhmm, plusMin = 0) {
  const [y, mo, d] = datum.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi + plusMin, 0).toISOString();
}

/** Baut Zeile: bekannte Felder typisiert, Rest -> extra. */
function baueZeile(roh, spec, ausschluss = []) {
  const row = {};
  const extra = {};
  for (const [k, v] of Object.entries(roh)) {
    if (ausschluss.includes(k)) continue;
    const typ = spec[k];
    if (!typ) { extra[k] = v; continue; }
    if (typ === 'z') { const n = zahl(v); if (n != null) row[k] = n; }
    else if (typ === 't') { const s = txt(v); if (s !== undefined) row[k] = s; }
    else if (typ === 'raw') { if (v != null) row[k] = v; }
  }
  return { row, extra };
}

const SPEC = {
  mahlzeiten: { id: 't', datum: 't', zeit: 't', typ: 't', beschreibung: 't', komponenten: 'raw', kcal: 'z', protein: 'z', kh: 'z', fett: 'z', konfidenz: 't', notiz: 't' },
  messungen: { id: 't', datum: 't', zeit: 't', bedingung: 't', gewicht: 'z', kfa: 'z', fettmasse: 'z', muskelmasse: 'z', koerperwasser: 'z', viszeralfett: 'z', ruhepuls: 'z', quelle: 't', notiz: 't' },
  trainings: { id: 't', datum: 't', minuten: 'z', art: 't', titel: 't', vorlage: 't', intensitaet: 't', kcal_watch: 'z', puls_avg: 'z', quelle: 't', notiz: 't' },
  termine: { id: 't', datum: 't', start: 't', ende: 't', titel: 't', kategorie: 't', ort: 't', notiz: 't' },
  tageswerte: { datum: 't', schritte: 'z', aktive_kcal: 'z', ruhepuls: 'z', hrv_ms: 'z', schlaf_min: 'z', wasser_ml: 'z', stimmung_1_5: 'z', energie_1_5: 'z', hunger_1_5: 'z', alkohol: 'raw', notiz: 't' },
};

export function normalisiere(daten) {
  const out = { mahlzeiten: [], messungen: [], trainings: [], termine: [], tageswerte: [], warnungen: [] };
  const d = istObj(daten) ? daten : {};
  const liste = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const warn = (s) => out.warnungen.push(s);
  const labels = { mahlzeiten: 'Mahlzeit', messungen: 'Messung', trainings: 'Training', termine: 'Termin' };
  const genutzt = {};

  function gemeinsam(tab, roh, i) {
    const label = `${labels[tab]} ${i + 1}`;
    if (!istObj(roh)) { warn(`${label}: kein gültiger Eintrag – übersprungen.`); return null; }
    const datum = txt(roh.datum);
    if (!datum) { warn(`${label}: ohne Datum – übersprungen.`); return null; }
    if (!DATUM_RE.test(datum)) { warn(`${label}: Datum „${datum}“ ist nicht im Format JJJJ-MM-TT – übersprungen.`); return null; }
    return { label, datum };
  }

  function idFinal(tab, roh, basis) {
    let id = txt(roh.id);
    const set = (genutzt[tab] ||= new Set());
    if (!id) {
      // Doppelte automatisch erzeugte IDs im selben Import deterministisch nach Reihenfolge unterscheiden
      let n = 2, kand = basis;
      while (set.has(kand)) kand = `${basis}-${n++}`;
      id = kand;
    }
    set.add(id);
    return id;
  }

  const ersetzeOderAnhaengen = (arr, row, key) => {
    const i = arr.findIndex(r => r[key] === row[key]);
    if (i >= 0) arr[i] = row; else arr.push(row);
  };

  liste(d.mahlzeiten).forEach((roh, i) => {
    const g = gemeinsam('mahlzeiten', roh, i); if (!g) return;
    const { row, extra } = baueZeile(roh, SPEC.mahlzeiten, ['extra']);
    if (istObj(roh.extra)) Object.assign(extra, roh.extra);
    if (row.zeit) row.zeit = zeitNorm(row.zeit) ?? row.zeit;
    row.id = idFinal('mahlzeiten', roh, [g.datum, slug(roh.typ) || 'mahlzeit', (zeitNorm(roh.zeit) || '').replace(':', '')].filter(Boolean).join('-'));
    if (Object.keys(extra).length) row.extra = extra;
    ersetzeOderAnhaengen(out.mahlzeiten, row, 'id');
  });

  liste(d.messungen).forEach((roh, i) => {
    const g = gemeinsam('messungen', roh, i); if (!g) return;
    const { row, extra } = baueZeile(roh, SPEC.messungen);
    if (row.zeit) row.zeit = zeitNorm(row.zeit) ?? row.zeit;
    row.id = idFinal('messungen', roh, [g.datum, (zeitNorm(roh.zeit) || '').replace(':', '') || slug(roh.bedingung) || 'messung'].join('-'));
    if (Object.keys(extra).length) row.extra = extra;
    ersetzeOderAnhaengen(out.messungen, row, 'id');
  });

  liste(d.trainings).forEach((roh, i) => {
    const g = gemeinsam('trainings', roh, i); if (!g) return;
    const { row, extra } = baueZeile(roh, SPEC.trainings, ['start', 'ende', 'uebungen']);
    if (roh.uebungen != null) extra.uebungen = roh.uebungen;
    const st = zeitNorm(roh.start);
    if (st) {
      row.start = lokalIso(g.datum, st);
      const en = zeitNorm(roh.ende);
      if (en) row.ende = lokalIso(g.datum, en);
      else if (row.minuten != null) row.ende = lokalIso(g.datum, st, row.minuten);
    } else if (roh.start != null && roh.start !== '') {
      const dt = new Date(roh.start);
      if (!isNaN(dt)) row.start = dt.toISOString();
      else warn(`${g.label}: Startzeit „${roh.start}“ nicht lesbar – ohne Startzeit übernommen.`);
      if (roh.ende != null && !isNaN(new Date(roh.ende))) row.ende = new Date(roh.ende).toISOString();
    }
    row.id = idFinal('trainings', roh, [g.datum, slug(roh.titel) || slug(roh.art) || 'training'].join('-'));
    if (Object.keys(extra).length) row.extra = extra;
    ersetzeOderAnhaengen(out.trainings, row, 'id');
  });

  liste(d.termine).forEach((roh, i) => {
    const g = gemeinsam('termine', roh, i); if (!g) return;
    const { row, extra } = baueZeile(roh, SPEC.termine);
    if (row.start) row.start = zeitNorm(row.start) ?? row.start;
    if (row.ende) row.ende = zeitNorm(row.ende) ?? row.ende;
    row.id = idFinal('termine', roh, [g.datum, (zeitNorm(roh.start) || '').replace(':', ''), slug(roh.titel) || 'termin'].filter(Boolean).join('-'));
    if (Object.keys(extra).length) row.extra = extra;
    ersetzeOderAnhaengen(out.termine, row, 'id');
  });

  // Tageswerte (tag + schritte), pro Datum zusammenführen
  const tw = new Map();
  const mische = (datum, felder, extra) => {
    const cur = tw.get(datum) || { datum };
    Object.assign(cur, felder);
    if (extra && Object.keys(extra).length) cur.extra = { ...(cur.extra || {}), ...extra };
    tw.set(datum, cur);
  };
  liste(d.tag).forEach((roh, i) => {
    if (!istObj(roh)) { warn(`Tag ${i + 1}: kein gültiger Eintrag – übersprungen.`); return; }
    const datum = txt(roh.datum);
    if (!datum || !DATUM_RE.test(datum)) { warn(`Tag ${i + 1}: ohne gültiges Datum – übersprungen.`); return; }
    const { row, extra } = baueZeile(roh, SPEC.tageswerte, ['datum']);
    if (roh.schlaf_stunden != null && row.schlaf_min == null) {
      const h = zahl(roh.schlaf_stunden);
      if (h != null) row.schlaf_min = Math.round(h * 60);
    }
    delete extra.schlaf_stunden;
    mische(datum, row, extra);
  });
  liste(d.schritte).forEach((roh, i) => {
    if (!istObj(roh)) { warn(`Schritte ${i + 1}: kein gültiger Eintrag – übersprungen.`); return; }
    const datum = txt(roh.datum);
    if (!datum || !DATUM_RE.test(datum)) { warn(`Schritte ${i + 1}: ohne gültiges Datum – übersprungen.`); return; }
    const n = zahl(roh.anzahl ?? roh.schritte);
    if (n == null) { warn(`Schritte ${i + 1}: keine Anzahl – übersprungen.`); return; }
    mische(datum, { schritte: n }, null);
  });
  out.tageswerte = [...tw.values()];
  if (istObj(d.plan)) out.plan = d.plan; // wird in der Oberfläche gegen den Katalog geprüft (plan.js)
  // loeschen: { termine: ['id', ...], mahlzeiten: [...], trainings: [...], messungen: [...] } -> weich löschen
  if (istObj(d.loeschen)) {
    const del = {};
    for (const tab of ['mahlzeiten', 'messungen', 'trainings', 'termine']) {
      const ids = liste(d.loeschen[tab]).map((x) => String(x ?? '').trim()).filter(Boolean);
      if (ids.length) del[tab] = [...new Set(ids)];
    }
    for (const k of Object.keys(d.loeschen)) if (!['mahlzeiten', 'messungen', 'trainings', 'termine'].includes(k)) warn(`loeschen: unbekannte Tabelle „${k}“ ignoriert`);
    if (Object.keys(del).length) out.loeschen = del;
  }
  return out;
}

// ---------------------------------------------------------------- Vorschau / Übernahme

export function vorschauText(norm) {
  const defs = [['mahlzeiten', 'Mahlzeit', 'Mahlzeiten'], ['messungen', 'Messung', 'Messungen'],
    ['trainings', 'Training', 'Trainings'], ['termine', 'Termin', 'Termine'], ['tageswerte', 'Tageswert', 'Tageswerte']];
  const teile = [];
  let summe = 0;
  for (const [k, s, p] of defs) {
    const n = norm?.[k]?.length || 0;
    if (n > 0) { teile.push(`${n} ${n === 1 ? s : p}`); summe += n; }
  }
  if (norm?.plan) { teile.push('Planänderung'); summe += 1; }
  const nDel = Object.values(norm?.loeschen || {}).reduce((a, l) => a + l.length, 0);
  if (!teile.length && nDel) return `${nDel} ${nDel === 1 ? 'Eintrag wird' : 'Einträge werden'} gelöscht`;
  if (nDel) return `${teile.join(', ')} ${summe === 1 ? 'wird' : 'werden'} übernommen, ${nDel} gelöscht`;
  if (!teile.length) return 'Nichts zu übernehmen';
  return `${teile.join(', ')} ${summe === 1 ? 'wird' : 'werden'} übernommen`;
}

export async function uebernehmen(norm, db) {
  let n = 0;
  for (const tab of ['mahlzeiten', 'messungen', 'trainings', 'termine']) {
    for (const row of norm[tab] || []) { await db.put(tab, row); n++; }
  }
  for (const row of norm.tageswerte || []) {
    const { datum, ...felder } = row;
    await db.patch('tageswerte', datum, { datum, ...felder });
    n++;
  }
  for (const [tab, ids] of Object.entries(norm.loeschen || {})) {
    for (const id of ids) { await db.remove(tab, id); n++; }
  }
  return n;
}

// ---------------------------------------------------------------- KURKONTEXT

const fehlt = v => v == null || v === '' || (typeof v === 'number' && !isFinite(v));
const dez = (v, stellen) => {
  const n = zahl(v);
  return n == null ? '–' : n.toFixed(stellen).replace('.', ',');
};
const ganz = v => { const n = zahl(v); return n == null ? '–' : String(Math.round(n)); };
const tausend = v => { const n = zahl(v); return n == null ? '–' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
const txtOderStrich = v => (fehlt(v) ? '–' : String(v));

export function kurkontext(s = {}) {
  const p = s.profil || {}, z = s.ziele || {}, g = s.gestern || {}, tr = s.trend;
  const zeilen = ['KURKONTEXT v1'];
  zeilen.push(`tag: ${txtOderStrich(s.tag)}/${txtOderStrich(s.kurTage)} | datum: ${txtOderStrich(s.datum)}`);
  zeilen.push(`profil: ${txtOderStrich(p.geschlecht)}, ${ganz(p.alter)} J, ${ganz(p.groesse_cm)} cm`);
  zeilen.push(`ziele_heute: kcal ${ganz(z.kcal)} | protein ${ganz(z.protein)} g | schritte ${tausend(z.schritte)} | training: ${txtOderStrich(z.training)}`);
  zeilen.push(`gestern: kcal ${ganz(g.kcal)} | protein ${ganz(g.protein)} g | schritte ${tausend(g.schritte)} | training: ${txtOderStrich(g.training)}`);
  if (tr && [tr.gewichtVon, tr.gewichtBis, tr.kfaVon, tr.kfaBis].some(v => !fehlt(v))) {
    zeilen.push(`trend_7d: gewicht ${dez(tr.gewichtVon, 1)} → ${dez(tr.gewichtBis, 1)} kg (Ø) | kfa ${dez(tr.kfaVon, 1)} → ${dez(tr.kfaBis, 1)} % (Ø)`);
  }
  const plan = Array.isArray(s.plan) ? s.plan.filter(x => x && (x.start || x.titel)) : [];
  zeilen.push(`plan_heute: ${plan.length ? plan.map(x => `${txtOderStrich(x.start)} ${txtOderStrich(x.titel)}`).join(' | ') : '–'}`);
  if (!fehlt(s.readiness)) {
    const r = typeof s.readiness === 'object' ? [s.readiness.ampel, s.readiness.text].filter(x => !fehlt(x)).join(' – ') : s.readiness;
    if (r) zeilen.push(`readiness: ${r}`);
  }
  const hin = Array.isArray(s.hinweise) ? s.hinweise.filter(h => !fehlt(h)) : [];
  if (hin.length) zeilen.push(`hinweise: ${hin.join(' | ')}`);
  return zeilen.join('\n');
}
