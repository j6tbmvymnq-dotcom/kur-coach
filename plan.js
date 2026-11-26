// Trainingsexport (TRAININGSLOG v1 für das Claude-Projekt) und Planänderungen (KURLOG-Schlüssel "plan").
// Reine Logik ohne DOM; db wird als Parameter übergeben.
import * as calc from './calc.js';
import * as gym from './gym.js';

const zf = (n, st = 1) => (n == null || !isFinite(n) ? '–' : String(Math.round(n * 10 ** st) / 10 ** st).replace('.', ','));
const istArbeit = (s) => s && !s.geloescht && s.typ !== 'aufwaermen';
const sortSatz = (a, b) => (a.reihenfolge || 0) - (b.reihenfolge || 0) || (a.satz_nr || 0) - (b.satz_nr || 0)
  || String(a.erledigt_at || '').localeCompare(String(b.erledigt_at || ''));

/** ISO-Kalenderwoche relativ zum Kurstart: Kurwoche 1 = Tage 1–7 */
function kurWoche(kurStart, datum) {
  const t = calc.kurTag(kurStart, datum, 999).tag;
  return t == null || t < 1 ? 0 : Math.ceil(t / 7);
}

/**
 * Kompakter Text aller Trainings für die KI-Analyse.
 * daten = { profil, trainings, saetze, tageswerte, katalogMap, vorlagen, heute }
 */
export function trainingsExport({ profil = {}, trainings = [], saetze = [], tageswerte = [], katalogMap = new Map(), vorlagen = {}, heute = calc.isoDatum() }) {
  const kurStart = profil.kur_start || '2026-11-25';
  const name = (id) => katalogMap.get(id)?.name || id;
  const zeilen = [];
  const kt = calc.kurTag(kurStart, heute, profil.kur_tage || 21);
  zeilen.push(`TRAININGSLOG v1 (Stand ${heute}${kt.status === 'laeuft' ? `, Kurtag ${kt.tag} von ${kt.von}` : ''}, Ziel ${calc.ZIEL_MODI[calc.modus(profil)]?.name || calc.modus(profil)})`);
  zeilen.push('Format Satz: kg×Wdh, R=RIR (Wdh in Reserve), Aufwärmsätze weggelassen. e1RM nach Epley.');

  zeilen.push('', 'PLAN (aktuell)');
  for (const [key, v] of Object.entries(vorlagen)) {
    zeilen.push(`${key} ${v.name}: ` + (v.uebungen || []).map((p) => {
      const u = katalogMap.get(p.id);
      return `${p.id} ${p.saetze ?? '?'}×${u?.wdh_min ?? '?'}–${u?.wdh_max ?? '?'}`;
    }).join(', '));
  }

  if (katalogMap.size) {
    const proKat = new Map();
    for (const u of katalogMap.values()) if (u.aktiv !== false) (proKat.get(u.kategorie) || proKat.set(u.kategorie, []).get(u.kategorie)).push(u.id);
    zeilen.push('', 'KATALOG (verfügbare Übungs-ids)');
    for (const [k, ids] of proKat) zeilen.push(`${k}: ${ids.join(', ')}`);
  }

  const aktiv = trainings.filter((t) => t && !t.geloescht).sort((a, b) => String(a.datum).localeCompare(String(b.datum)) || String(a.start || '').localeCompare(String(b.start || '')));
  const proTraining = new Map();
  for (const s of saetze) if (istArbeit(s)) (proTraining.get(s.training_id) || proTraining.set(s.training_id, []).get(s.training_id)).push(s);

  const kraft = aktiv.filter((t) => t.vorlage || proTraining.has(t.id));
  zeilen.push('', 'KRAFT');
  if (!kraft.length) zeilen.push('(noch keine Krafteinheit)');
  const volumen = new Map(); // woche -> Map(kategorie -> saetze)
  for (const t of kraft) {
    const ss = (proTraining.get(t.id) || []).sort(sortSatz);
    const kopf = [t.datum, t.titel || vorlagen[t.vorlage]?.name || t.vorlage || 'Kraft', t.vorlage ? `[${t.vorlage}]` : null,
      t.minuten ? `${t.minuten} min` : null, t.extra?.readiness ? `Readiness ${t.extra.readiness}` : null].filter(Boolean).join(' ');
    zeilen.push(kopf);
    const proUeb = new Map();
    for (const s of ss) (proUeb.get(s.uebung_id) || proUeb.set(s.uebung_id, []).get(s.uebung_id)).push(s);
    const w = kurWoche(kurStart, t.datum);
    const vw = volumen.get(w) || volumen.set(w, new Map()).get(w);
    for (const [uid, liste] of proUeb) {
      const u = katalogMap.get(uid);
      const kat = u?.kategorie || 'sonstiges';
      vw.set(kat, (vw.get(kat) || 0) + liste.length);
      const teile = liste.map((s) => {
        const basis = gym.istCardio(u) ? `${zf(s.wdh, 0)} min` : s.gewicht ? `${zf(s.gewicht)}×${zf(s.wdh, 0)}` : `${zf(s.wdh, 0)} ${gym.einheitLabel(u)}`;
        return basis + (s.rir != null ? ` R${s.rir}` : '');
      });
      const best = Math.max(0, ...liste.map((s) => (s.gewicht && s.wdh ? calc.e1rm(s.gewicht, s.wdh) : 0)));
      zeilen.push(`- ${name(uid)}: ${teile.join(', ')}${best ? ` | e1RM ${zf(best)}` : ''}`);
    }
    if (t.notiz) zeilen.push(`  Notiz: ${t.notiz}`);
  }

  if (volumen.size) {
    zeilen.push('', 'HARTE SÄTZE JE MUSKELGRUPPE');
    for (const [w, m] of [...volumen].sort((a, b) => a[0] - b[0])) {
      zeilen.push(`Kurwoche ${w || '?'}: ` + [...m].map(([k, n]) => `${k} ${n}`).join(', '));
    }
  }

  const sonst = aktiv.filter((t) => !kraft.includes(t));
  zeilen.push('', 'AUSDAUER / KURSE / SAUNA');
  if (!sonst.length) zeilen.push('(keine)');
  for (const t of sonst) {
    zeilen.push([t.datum, t.start ? new Date(t.start).toTimeString().slice(0, 5) : null, t.titel || t.art,
      t.minuten ? `${t.minuten} min` : null, t.kcal_watch ? `${t.kcal_watch} kcal` : null,
      t.puls_avg ? `Puls Ø ${t.puls_avg}` : null, t.extra?.km ? `${zf(t.extra.km, 2)} km` : null,
      t.intensitaet || null, t.quelle === 'apple-health' ? '(Health)' : null].filter(Boolean).join(' '));
  }

  const tw = tageswerte.filter((x) => x && x.datum >= kurStart && x.datum <= heute).sort((a, b) => a.datum.localeCompare(b.datum));
  if (tw.length) {
    zeilen.push('', 'ERHOLUNG (datum: schritte | ruhepuls | hrv ms | schlaf h | energie 1–5)');
    for (const x of tw) {
      zeilen.push(`${x.datum}: ${x.schritte ?? '–'} | ${x.ruhepuls ?? '–'} | ${x.hrv_ms != null ? Math.round(x.hrv_ms) : '–'} | ${x.schlaf_min != null ? zf(x.schlaf_min / 60) : '–'} | ${x.energie_1_5 ?? '–'}`);
    }
  }
  return zeilen.join('\n');
}

export async function trainingsExportAusDb(db) {
  const [profil, trainings, saetze, tageswerte, k] = await Promise.all([
    db.get('profil', 'me'), db.all('trainings'), db.all('saetze'), db.all('tageswerte'), gym.ladeUebungen(db)]);
  return trainingsExport({ profil: profil || {}, trainings, saetze, tageswerte, katalogMap: k.map, vorlagen: k.vorlagen });
}

// ---------------------------------------------------------------- Planänderungen

const ganz = (v, lo, hi) => { const n = calc.zahl(v); return n == null ? null : Math.min(hi, Math.max(lo, Math.round(n))); };
const UEB_FELDER = ['name', 'kategorie', 'typ', 'geraet', 'einstellung', 'notiz'];

/**
 * Prüft einen "plan"-Block aus dem KURLOG gegen Katalog und aktuelle Vorlagen.
 * roh = { vorlagen: { key: { name?, uebungen: [{id, saetze}] } }, uebungen: [{id, name?, wdh_min?, wdh_max?, ...}], begruendung }
 * -> { vorlagen, uebungen, begruendung, aenderungen: [text], warnungen: [text] }
 */
export function pruefePlan(roh, katalogMap, vorlagenAktuell = {}) {
  const out = { vorlagen: {}, uebungen: [], begruendung: roh?.begruendung ? String(roh.begruendung) : '', aenderungen: [], warnungen: [] };
  if (!roh || typeof roh !== 'object') { out.warnungen.push('Plan: kein gültiger Block.'); return out; }
  const neueIds = new Map();
  for (const u of Array.isArray(roh.uebungen) ? roh.uebungen : []) {
    if (!u || !u.id) { out.warnungen.push('Plan: Übung ohne id übersprungen.'); continue; }
    const id = String(u.id);
    const bekannt = katalogMap.get(id);
    if (!bekannt && !u.name) { out.warnungen.push(`Plan: neue Übung „${id}“ ohne Namen übersprungen.`); continue; }
    const z = { id };
    for (const f of UEB_FELDER) if (u[f] != null && u[f] !== '') z[f] = String(u[f]);
    const wmin = ganz(u.wdh_min, 1, 50), wmax = ganz(u.wdh_max, 1, 60), sw = calc.zahl(u.schrittweite_kg);
    if (wmin != null) z.wdh_min = wmin;
    if (wmax != null) z.wdh_max = Math.max(wmax, wmin ?? 1);
    if (sw != null && sw >= 0 && sw <= 20) z.schrittweite_kg = sw;
    if (Array.isArray(u.alternativen)) z.alternativen = u.alternativen.map(String);
    if (!bekannt) { z.kategorie ||= 'sonstiges'; z.typ ||= 'isolation'; z.schrittweite_kg ??= 2.5; z.wdh_min ??= 8; z.wdh_max ??= 12; }
    out.uebungen.push(z);
    neueIds.set(id, z);
    const name = z.name || bekannt?.name || id;
    if (!bekannt) out.aenderungen.push(`Neue Übung: ${name} (${z.wdh_min}–${z.wdh_max} Wdh)`);
    else if ((z.wdh_min != null && z.wdh_min !== bekannt.wdh_min) || (z.wdh_max != null && z.wdh_max !== bekannt.wdh_max)) {
      out.aenderungen.push(`${name}: ${bekannt.wdh_min}–${bekannt.wdh_max} → ${z.wdh_min ?? bekannt.wdh_min}–${z.wdh_max ?? bekannt.wdh_max} Wdh`);
    }
  }
  const vl = roh.vorlagen && typeof roh.vorlagen === 'object' ? roh.vorlagen : {};
  for (const [key, v] of Object.entries(vl)) {
    if (!v || !Array.isArray(v.uebungen) || !v.uebungen.length) { out.warnungen.push(`Plan: Vorlage „${key}“ ohne Übungen übersprungen.`); continue; }
    const alt = vorlagenAktuell[key];
    const name = v.name ? String(v.name) : alt?.name;
    if (!name) { out.warnungen.push(`Plan: neue Vorlage „${key}“ ohne Namen übersprungen.`); continue; }
    const liste = [];
    for (const p of v.uebungen) {
      const id = String(p?.id ?? '');
      if (!katalogMap.has(id) && !neueIds.has(id)) { out.warnungen.push(`Plan ${key}: unbekannte Übung „${id}“ übersprungen.`); continue; }
      liste.push({ id, saetze: ganz(p.saetze, 1, 8) ?? 3 });
    }
    if (!liste.length) continue;
    out.vorlagen[key] = { name, uebungen: liste };
    const nm = (id) => neueIds.get(id)?.name || katalogMap.get(id)?.name || id;
    if (!alt) { out.aenderungen.push(`Neue Einheit ${name}: ` + liste.map((p) => `${nm(p.id)} ${p.saetze}`).join(', ')); continue; }
    const altMap = new Map((alt.uebungen || []).map((p) => [p.id, p.saetze]));
    const neuMap = new Map(liste.map((p) => [p.id, p.saetze]));
    const d = [];
    for (const [id, n] of neuMap) {
      if (!altMap.has(id)) d.push(`+ ${nm(id)} ${n} Sätze`);
      else if (altMap.get(id) !== n) d.push(`${nm(id)} ${altMap.get(id)} → ${n} Sätze`);
    }
    for (const id of altMap.keys()) if (!neuMap.has(id)) d.push(`− ${nm(id)}`);
    const reihenfolgeNeu = liste.map((p) => p.id).filter((id) => altMap.has(id)).join();
    const reihenfolgeAlt = [...altMap.keys()].filter((id) => neuMap.has(id)).join();
    if (!d.length && reihenfolgeNeu !== reihenfolgeAlt) d.push('Reihenfolge geändert');
    if (d.length) out.aenderungen.push(`${name}: ${d.join('; ')}`);
  }
  if (!out.aenderungen.length && !out.warnungen.length) out.aenderungen.push('Plan: keine Änderung gegenüber dem aktuellen Stand.');
  return out;
}

/** Geprüften Plan speichern: Vorlagen ins Profil (einstellungen.plan), Übungen als Overrides in `uebungen` */
export async function speicherePlan(geprueft, db, jetzt = new Date()) {
  if (!geprueft) return 0;
  let n = 0;
  if (geprueft.uebungen.length) {
    const k = await gym.ladeKatalog();
    const basis = new Map((k.uebungen || []).map((u) => [u.id, u]));
    for (const u of geprueft.uebungen) {
      const bestehend = await db.get('uebungen', u.id);
      await db.put('uebungen', gym.ueberschreibung(basis.get(u.id) || {}, bestehend, u));
      n++;
    }
  }
  if (Object.keys(geprueft.vorlagen).length) {
    const p = (await db.get('profil', 'me')) || {};
    const altPlan = p.einstellungen?.plan || {};
    const verlauf = [...(altPlan.verlauf || []), { am: jetzt.toISOString(), begruendung: geprueft.begruendung, aenderungen: geprueft.aenderungen }].slice(-10);
    await db.patch('profil', 'me', { einstellungen: { ...(p.einstellungen || {}),
      plan: { vorlagen: { ...(altPlan.vorlagen || {}), ...geprueft.vorlagen }, stand: jetzt.toISOString(), verlauf } } });
    n += Object.keys(geprueft.vorlagen).length;
  }
  return n;
}

/** Plan-Anpassungen verwerfen: Vorlagen wieder aus dem Grundplan */
export async function planZuruecksetzen(db) {
  const p = (await db.get('profil', 'me')) || {};
  const e = { ...(p.einstellungen || {}) };
  delete e.plan;
  await db.put('profil', { ...p, einstellungen: e });
}
