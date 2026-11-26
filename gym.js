// Gym-Logger: Datenlogik ohne DOM. Die db wird als Parameter übergeben (testbar mit Fake-db).
import * as calc from './calc.js';

/** Spalten der Tabelle `uebungen` (alles andere würde den Sync stören) */
export const UEB_SPALTEN = ['id', 'name', 'kategorie', 'typ', 'geraet', 'einstellung', 'schrittweite_kg',
  'wdh_min', 'wdh_max', 'alternativen', 'notiz', 'aktiv'];

// ---------------------------------------------------------------- Katalog
let katalogCache = null;

/** Katalog + Vorlagen aus data/uebungen.json (Netz nur für die eigene statische Datei bzw. Cache des SW) */
export async function ladeKatalog() {
  if (katalogCache) return katalogCache;
  const r = await fetch(new URL('./data/uebungen.json', import.meta.url));
  if (!r.ok) throw new Error('Übungskatalog konnte nicht geladen werden.');
  katalogCache = await r.json();
  return katalogCache;
}

/** Katalog + Overrides aus db `uebungen` (gleiche id überschreibt Felder; neue ids werden angehängt) -> Array */
export function mergeKatalog(basis = [], overrides = []) {
  const ov = new Map();
  for (const o of overrides) if (o && o.id && !o.geloescht) ov.set(o.id, o);
  const out = basis.map((b) => {
    const o = ov.get(b.id);
    if (!o) return { ...b };
    const m = { ...b };
    for (const [k, v] of Object.entries(o)) if (v != null && v !== '') m[k] = v;
    return m;
  });
  const bekannt = new Set(basis.map((b) => b.id));
  for (const o of ov.values()) if (!bekannt.has(o.id) && o.name) out.push({ ...o });
  return out;
}

export async function ladeUebungen(db) {
  const k = await ladeKatalog();
  const [ov, profil] = await Promise.all([db.all('uebungen'), db.get('profil', 'me')]);
  const liste = mergeKatalog(k.uebungen, ov);
  // Planänderungen aus dem Claude-Projekt (KURLOG "plan") überschreiben einzelne Vorlagen
  const planVorlagen = profil?.einstellungen?.plan?.vorlagen || {};
  return { liste, map: new Map(liste.map((u) => [u.id, u])), vorlagen: { ...(k.vorlagen || {}), ...planVorlagen } };
}

/** Zeile für db.put('uebungen', …): Katalogwerte + bestehender Override + Änderungen, nur Tabellenspalten */
export function ueberschreibung(basis, bestehend, felder) {
  const m = { ...basis, ...(bestehend || {}), ...felder };
  const out = {};
  for (const k of UEB_SPALTEN) if (m[k] !== undefined) out[k] = m[k];
  return out;
}

export const istCardio = (u) => u?.typ === 'cardio';
export const ohneGewicht = (u) => !istCardio(u) && u?.schrittweite_kg === 0;
export const einheitLabel = (u) => (istCardio(u) ? 'min' : u?.einheit === 's' ? 's' : 'Wdh');

// ---------------------------------------------------------------- Historie
function trainingZeit(tr) {
  if (!tr) return 0;
  if (tr.start && String(tr.start).includes('T')) {
    const t = Date.parse(tr.start);
    if (!isNaN(t)) return t;
  }
  const [y, m, d] = String(tr.datum || '1970-01-01').split('-').map(Number);
  const hm = /^(\d\d):(\d\d)/.exec(tr.start || '');
  return new Date(y, m - 1, d, hm ? +hm[1] : 0, hm ? +hm[2] : 0).getTime();
}

const sortSaetze = (a, b) => String(a.erledigt_at || '').localeCompare(String(b.erledigt_at || '')) || (a.satz_nr || 0) - (b.satz_nr || 0);

/**
 * Sätze + Trainings -> Map uebung_id -> [{training_id, datum, zeit, saetze}] NEUESTE ZUERST.
 * Gelöschte Sätze und das Training `ausserId` werden ausgelassen.
 */
export function baueHistorie(saetze = [], trainings = [], ausserId = null) {
  const tm = new Map(trainings.map((t) => [t.id, t]));
  const gr = new Map();
  for (const s of saetze) {
    if (!s || s.geloescht || s.training_id === ausserId) continue;
    const tr = tm.get(s.training_id);
    let m = gr.get(s.uebung_id);
    if (!m) gr.set(s.uebung_id, (m = new Map()));
    let g = m.get(s.training_id);
    if (!g) {
      const zeit = tr ? trainingZeit(tr) : (Date.parse(s.erledigt_at) || 0);
      g = { training_id: s.training_id, datum: tr?.datum || (zeit ? calc.isoDatum(new Date(zeit)) : null), zeit, saetze: [] };
      m.set(s.training_id, g);
    }
    g.saetze.push(s);
  }
  const out = new Map();
  for (const [id, m] of gr) {
    const arr = [...m.values()].sort((a, b) => b.zeit - a.zeit);
    arr.forEach((g) => g.saetze.sort(sortSaetze));
    out.set(id, arr);
  }
  return out;
}

export async function historieAlle(db, ausserId = null) {
  const [saetze, trainings] = await Promise.all([db.all('saetze'), db.all('trainings')]);
  return baueHistorie(saetze, trainings, ausserId);
}

export async function historie(db, uebungId, ausserId = null) {
  const saetze = await db.all('saetze', (s) => s.uebung_id === uebungId);
  const trainings = await db.all('trainings');
  return baueHistorie(saetze, trainings, ausserId).get(uebungId) || [];
}

// ---------------------------------------------------------------- Plan / Aufwärmen
/** Aufwärm-Modus: Typ (Grund/Isolation) + erste Übung der Kategorie im Plan oder Folgeübung */
export function aufwaermModus(plan, index, katalogMap) {
  const u = katalogMap.get(plan[index]?.uebung_id);
  const iso = u?.typ === 'isolation' ? 'iso' : 'grund';
  const kat = u?.kategorie;
  let folge = false;
  if (kat) for (let i = 0; i < index; i++) if (katalogMap.get(plan[i].uebung_id)?.kategorie === kat) { folge = true; break; }
  return `${iso}-${folge ? 'folge' : 'erst'}`;
}

/** Übungsliste eines Trainings: gespeicherter Plan (extra.plan) oder Vorlage, plus Übungen, die nur in Sätzen vorkommen */
export function planAus(training, vorlagen = {}, saetze = []) {
  const gespeichert = training?.extra?.plan;
  let plan = Array.isArray(gespeichert) && gespeichert.length
    ? gespeichert.map((p) => ({ uebung_id: p.uebung_id, saetze: p.saetze ?? null }))
    : (vorlagen[training?.vorlage]?.uebungen || []).map((p) => ({ uebung_id: p.id, saetze: p.saetze ?? null }));
  const seen = new Set(plan.map((p) => p.uebung_id));
  for (const s of [...saetze].sort((a, b) => (a.reihenfolge || 0) - (b.reihenfolge || 0))) {
    if (s.geloescht || s.training_id !== training.id || seen.has(s.uebung_id)) continue;
    seen.add(s.uebung_id);
    plan.push({ uebung_id: s.uebung_id, saetze: null });
  }
  return plan;
}

/** Vorschlag inkl. Sonderfälle (Cardio, Körpergewicht, Vorlagen-Satzzahl beim ersten Mal) */
export function vorschlagFuer(uebung, einheiten, readiness = null, vorlagenSaetze = null) {
  if (istCardio(uebung)) {
    const letzte = einheiten.map((e) => e.filter((s) => s.typ === 'arbeit').reduce((a, s) => a + (s.wdh || 0), 0)).find((m) => m > 0);
    return { gewicht: null, saetze: 1, wdhMin: 0, wdhMax: 0, wdhZiel: [letzte || 20], grund: letzte ? `Letztes Mal ${letzte} min.` : 'Erstes Mal: Dauer wählen.', hinweis: null };
  }
  const v = calc.vorschlag(uebung, einheiten, readiness);
  const hatHistorie = einheiten.some((e) => calc.einheitZusammenfassung(e));
  if (vorlagenSaetze) {
    // Satzzahl = Volumen laut Plan (Hypertrophie-Reiz); Progression nur über Gewicht/Wdh.
    const n = readiness === 'rot' ? Math.max(1, vorlagenSaetze - 1) : vorlagenSaetze;
    const z = hatHistorie ? v.wdhZiel.slice(0, n) : [];
    while (z.length < n) z.push(z.length ? z[z.length - 1] : v.wdhMin);
    v.saetze = n;
    v.wdhZiel = z;
  }
  if (ohneGewicht(uebung)) {
    v.gewicht = 0;
    if (hatHistorie) v.grund = v.grund.replace(/ → \+[\d,]+ kg/, ' → mehr Wdh./Zeit steigern');
  }
  return v;
}

/**
 * Zeilen einer Übung im Training: Aufwärm- + Arbeitssätze, erledigte sind mit ihrer Satz-Zeile verknüpft.
 * erledigt: Sätze dieser Übung in diesem Training. extra: zusätzliche Arbeitssätze ("+ Satz").
 * -> [{typ, nr, gewicht, wdh, erledigt: Satz|null}]
 */
export function zeilen({ uebung, vorschlag: v, modus = 'grund-erst', erledigt = [], extra = 0 }) {
  const fertig = erledigt.filter((s) => !s.geloescht);
  const doneWarm = fertig.filter((s) => s.typ === 'aufwaermen');
  const doneArb = fertig.filter((s) => s.typ !== 'aufwaermen');
  const mitGewicht = !istCardio(uebung) && !ohneGewicht(uebung);
  // Erstes Mal ohne bekanntes Gewicht: ein leichter Technik-Satz (Steigerungs-Hinweis in der Übungsansicht)
  const warm = mitGewicht && v.gewicht
    ? calc.aufwaermsaetze(v.gewicht, uebung.schrittweite_kg || 2.5, modus)
    : mitGewicht ? [{ typ: 'aufwaermen', gewicht: null, wdh: 10, prozent: null }] : [];
  const out = [];
  const nWarm = Math.max(warm.length, ...doneWarm.map((s) => s.satz_nr || 0), 0);
  for (let i = 1; i <= nWarm; i++) {
    const d = doneWarm.find((s) => s.satz_nr === i);
    const w = warm[i - 1];
    out.push({ typ: 'aufwaermen', nr: i, gewicht: d ? d.gewicht : w?.gewicht ?? null, wdh: d ? d.wdh : w?.wdh ?? null, erledigt: d || null });
  }
  const nArb = Math.max((v.saetze || 1) + extra, ...doneArb.map((s) => s.satz_nr || 0), 1);
  let letztesGewicht = null;
  for (let i = 1; i <= nArb; i++) {
    const d = doneArb.find((s) => s.satz_nr === i);
    if (d) { letztesGewicht = d.gewicht; }
    const ziel = v.wdhZiel?.[i - 1] ?? v.wdhZiel?.[v.wdhZiel.length - 1] ?? v.wdhMin ?? null;
    out.push({
      typ: 'arbeit', nr: i,
      gewicht: d ? d.gewicht : (letztesGewicht ?? v.gewicht ?? null),
      wdh: d ? d.wdh : ziel, erledigt: d || null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- Training anlegen / beenden
export async function laufendesTraining(db, datum = calc.isoDatum()) {
  const heute = await db.byDatum('trainings', datum);
  const offen = heute.filter((t) => t.art === 'kraft' && !t.ende && (t.quelle || 'app') === 'app')
    .sort((a, b) => trainingZeit(b) - trainingZeit(a));
  return offen[0] || null;
}

export async function letzteKrafteinheiten(db, n = 5, ausserId = null) {
  const alle = await db.all('trainings', (t) => t.art === 'kraft' && t.id !== ausserId && (t.ende || t.minuten != null));
  return alle.sort((a, b) => trainingZeit(b) - trainingZeit(a)).slice(0, n);
}

/** saetzeAbzug: z. B. 1 in Kurwoche 1 (Einstieg nach Pause, Muskelkater begrenzen); nie unter 2 Sätze */
export async function startTraining(db, vorlageKey, vorlagen = {}, jetzt = new Date(), saetzeAbzug = 0) {
  const v = vorlagen[vorlageKey];
  const plan = (v?.uebungen || []).map((p) => ({
    uebung_id: p.id,
    saetze: p.saetze == null ? null : p.saetze >= 3 ? Math.max(2, p.saetze - saetzeAbzug) : p.saetze,
  }));
  const row = {
    id: db.neueId('tr'), datum: calc.isoDatum(jetzt), start: jetzt.toISOString(), art: 'kraft',
    titel: v?.name || 'Freies Training', vorlage: v ? vorlageKey : 'frei', quelle: 'app', extra: { plan },
  };
  return db.put('trainings', row);
}

export async function speicherePlan(db, training, plan) {
  const extra = { ...(training.extra || {}), plan };
  const row = await db.patch('trainings', training.id, { extra });
  training.extra = extra;
  return row;
}

export async function speichereSatz(db, { training, uebung_id, reihenfolge, typ, nr, gewicht, wdh, rir = null, pause_s = null, jetzt = new Date() }) {
  return db.put('saetze', {
    id: db.neueId('sz'), training_id: training.id, uebung_id, reihenfolge, satz_nr: nr, typ,
    gewicht, wdh, rir, pause_s, erledigt_at: jetzt.toISOString(),
  });
}

export async function beendeTraining(db, training, jetzt = new Date()) {
  const start = trainingZeit(training);
  const minuten = Math.max(1, Math.round((jetzt.getTime() - start) / 60000));
  const row = await db.patch('trainings', training.id, { ende: jetzt.toISOString(), minuten });
  training.ende = jetzt.toISOString();
  training.minuten = minuten;
  return row;
}

// ---------------------------------------------------------------- Zusammenfassung / Text
const arbeitsSaetze = (saetze) => saetze.filter((s) => !s.geloescht && s.typ !== 'aufwaermen');

/**
 * Zusammenfassung einer beendeten Einheit.
 * hist: Map uebung_id -> Gruppen VOR diesem Training (baueHistorie mit ausserId).
 */
export function zusammenfassung(training, saetzeHeute, hist, katalogMap, plan = []) {
  const heute = saetzeHeute.filter((s) => !s.geloescht && s.training_id === training.id);
  const arb = arbeitsSaetze(heute);
  const volumen = arb.reduce((a, s) => a + (s.gewicht || 0) * (s.wdh || 0), 0);
  const ids = [...plan.map((p) => p.uebung_id), ...heute.map((s) => s.uebung_id)].filter((x, i, a) => a.indexOf(x) === i)
    .filter((id) => heute.some((s) => s.uebung_id === id));
  const flach = [];
  for (const gr of hist.values()) for (const g of gr) flach.push(...g.saetze);
  const bestwerte = calc.neueBestwerte(heute, flach).map((b) => ({ ...b, name: katalogMap.get(b.uebung_id)?.name || b.uebung_id }));
  const uebungen = ids.map((id) => {
    const u = katalogMap.get(id) || { id, name: id };
    const s = heute.filter((x) => x.uebung_id === id).sort(sortSaetze);
    const letzte = hist.get(id)?.[0]?.saetze || null;
    const z = (arr) => {
      const a = arbeitsSaetze(arr);
      if (istCardio(u)) return { minuten: a.reduce((x, y) => x + (y.wdh || 0), 0) };
      const e = calc.einheitZusammenfassung(arr);
      if (!e) return null;
      return { volumen: e.volumen, topGewicht: e.topGewicht, topWdh: Math.max(...e.saetze.map((x) => x.wdh)) };
    };
    return { id, name: u.name, uebung: u, saetze: s, heute: z(s), letzte: letzte ? z(letzte) : null };
  });
  const minuten = training.minuten ?? (training.ende ? Math.max(1, Math.round((Date.parse(training.ende) - trainingZeit(training)) / 60000)) : null);
  return { minuten, anzahlSaetze: arb.length, volumen, bestwerte, uebungen };
}

const zf = (n) => (n == null || !isFinite(n) ? '' : String(Math.round(n * 100) / 100).replace('.', ','));
const datumDe = (iso) => String(iso || '').split('-').reverse().join('.');

/** Kompakter Text für Claude: "Beinpresse: 140×12, 12, 11" */
export function trainingsText(training, z) {
  const kopf = `Training ${datumDe(training.datum)} – ${training.titel || 'Kraft'}`
    + `${z.minuten ? `, ${z.minuten} min` : ''}, ${z.anzahlSaetze} Sätze, Volumen ${zf(z.volumen)} kg`;
  const zeilenT = z.uebungen.map((u) => {
    const a = arbeitsSaetze(u.saetze);
    if (!a.length) return `${u.name}: nur Aufwärmen`;
    if (istCardio(u.uebung)) return `${u.name}: ${a.reduce((x, s) => x + (s.wdh || 0), 0)} min`;
    const teile = [];
    let cur = null;
    for (const s of a) {
      const g = s.gewicht || 0;
      if (cur && cur.g === g) cur.w.push(s.wdh);
      else teile.push((cur = { g, w: [s.wdh] }));
    }
    const einh = u.uebung.einheit === 's' ? ' s' : '';
    const txt = teile.map((t) => (t.g ? `${zf(t.g)}×${t.w.join(', ')}` : t.w.join(', '))).join('; ');
    const rirs = a.map((s) => s.rir).filter((r) => r != null);
    return `${u.name}: ${txt}${einh}${rirs.length ? ` (RIR ${Math.min(...rirs)})` : ''}`;
  });
  const best = z.bestwerte.length ? [`Neue Bestwerte (e1RM): ${z.bestwerte.map((b) => `${b.name} ${zf(b.e1rm)} kg`).join(', ')}`] : [];
  return [kopf, ...zeilenT, ...best].join('\n');
}

// ---------------------------------------------------------------- Bestwerte / Chart
/** je Übung mit Historie: bester e1RM + Verlauf (bester e1RM pro Einheit, ÄLTESTE ZUERST) */
export function bestwerteListe(hist, katalogMap) {
  const out = [];
  for (const [id, gruppen] of hist) {
    const u = katalogMap.get(id);
    if (!u || istCardio(u)) continue;
    const verlauf = gruppen.map((g) => {
      const e = g.saetze.filter((s) => s.typ === 'arbeit').map((s) => calc.e1rm(s.gewicht, s.wdh)).filter((x) => x != null);
      return e.length ? { datum: g.datum, e1rm: Math.max(...e) } : null;
    }).filter(Boolean).reverse();
    if (!verlauf.length) continue;
    out.push({ id, name: u.name, best: Math.max(...verlauf.map((v) => v.e1rm)), verlauf, zuletzt: gruppen[0].zeit });
  }
  return out.sort((a, b) => b.zuletzt - a.zuletzt);
}
