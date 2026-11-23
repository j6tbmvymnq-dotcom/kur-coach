// Gemeinsame Datenladung für Heute, Checkliste und Tagesstart
import * as db from '../db.js';
import * as calc from '../calc.js';
import { kurkontext } from '../kurlog.js';

export const ZIEL_TRAINING_MIN = 45;

let standardCache = null;
export async function standardChecklisten() {
  if (!standardCache) {
    try {
      const r = await fetch('./data/checklisten.json');
      const j = await r.json();
      delete j._hinweis;
      standardCache = j;
    } catch { standardCache = {}; }
  }
  return JSON.parse(JSON.stringify(standardCache));
}

/** Messungen mit Gewicht, neueste zuletzt */
export function messungenAufsteigend(alle) {
  return alle.filter((m) => m.gewicht != null)
    .sort((a, b) => `${a.datum} ${a.zeit || ''}`.localeCompare(`${b.datum} ${b.zeit || ''}`));
}

/** Letzte Messung mit Gewicht, nüchterne bevorzugt */
export function letzteMessung(alle) {
  const l = messungenAufsteigend(alle);
  const nuecht = l.filter((m) => m.bedingung === 'nuechtern');
  return (nuecht.length ? nuecht : l).at(-1) || null;
}

export function slotStarts(einst) {
  const out = { ...calc.SLOT_START };
  for (const [s, t] of Object.entries(einst?.slot_zeiten || {})) {
    const m = calc.zeitZuMin(t);
    if (m != null && calc.istSlot(s)) out[s] = m;
  }
  return out;
}

export async function ladeTag(datum = calc.isoDatum()) {
  const [profil, messungen, tageswerte, trainings, mahlzeiten, termine] = await Promise.all([
    db.get('profil', 'me'), db.all('messungen'), db.get('tageswerte', datum),
    db.byDatum('trainings', datum), db.byDatum('mahlzeiten', datum), db.byDatum('termine', datum),
  ]);
  const tag = tageswerte || {};
  const messung = letzteMessung(messungen);
  const ziele = calc.tagesziele({ profil: profil || {}, messung, tag, trainings, datum });
  const summe = calc.summeMahlzeiten(mahlzeiten);
  const trainingMin = trainings.reduce((s, t) => s + (t.minuten || 0), 0);
  const kurtag = calc.kurTag(profil?.kur_start, datum, profil?.kur_tage || 21);
  return {
    datum, profil, einst: profil?.einstellungen || {}, messung, tag, trainings, mahlzeiten,
    termine: termine.sort((a, b) => (a.start || '').localeCompare(b.start || '')),
    ziele, summe, trainingMin, kurtag, messungen,
  };
}

/** Checklistenpunkte eines Slots (gefiltert nach `wenn`, plus Termine der nächsten 3 h) */
export async function punkteFuerSlot(slot, d) {
  const std = await standardChecklisten();
  const basis = d.einst.checklisten?.[slot] ?? std[slot] ?? [];
  const ctx = {
    schritte: d.tag.schritte || 0, proteinIst: d.summe.protein, proteinZiel: d.ziele.makros?.protein ?? null,
    termine: d.termine, jetzt: new Date(), aerztlicheSperre: d.einst.aerztliche_sperre || [],
  };
  const punkte = basis.filter((p) => calc.bedingungErfuellt(p.wenn, ctx));
  return [...punkte, ...calc.terminPunkte(d.termine, new Date(), 3)];
}

/** Warnung: 2 Tage in Folge > 1.000 kcal unter Ziel (nur bei erfassten Mahlzeiten) */
export async function zuWenigWarnung(d) {
  if (!d.profil) return false;
  const tage = [];
  for (const off of [-2, -1]) {
    const dat = calc.addTage(d.datum, off);
    const [mz, tw, tr] = await Promise.all([db.byDatum('mahlzeiten', dat), db.get('tageswerte', dat), db.byDatum('trainings', dat)]);
    const ziel = calc.tagesziele({ profil: d.profil, messung: d.messung, tag: tw || {}, trainings: tr, datum: dat }).kcal;
    tage.push({ kcalIst: mz.length ? calc.summeMahlzeiten(mz).kcal : null, kcalZiel: ziel });
  }
  return calc.warnungZuWenig(tage);
}

/** KURKONTEXT-Text für den Tagesstart */
export async function baueKurkontext() {
  const d = await ladeTag();
  const gestern = calc.addTage(d.datum, -1);
  const [mzG, twG, trG] = await Promise.all([
    db.byDatum('mahlzeiten', gestern), db.get('tageswerte', gestern), db.byDatum('trainings', gestern),
  ]);
  const sg = calc.summeMahlzeiten(mzG);
  const sortiert = messungenAufsteigend(d.messungen);
  const nuecht = sortiert.filter((m) => m.bedingung === 'nuechtern');
  const reihe = nuecht.length ? nuecht : sortiert;
  const mitKfa = reihe.filter((m) => m.kfa != null);
  const hinweise = [];
  if (!d.messung) hinweise.push('Noch kein Gewicht erfasst – Kalorienziel kann nicht berechnet werden.');
  if (await zuWenigWarnung(d)) hinweise.push('Seit zwei Tagen mehr als 1.000 kcal unter dem Ziel.');
  if (d.tag.schritte == null) hinweise.push('Für heute sind noch keine Schritte eingetragen.');
  const s = {
    tag: d.kurtag.tag, kurTage: d.profil?.kur_tage || 21, datum: d.datum,
    profil: {
      geschlecht: d.profil?.geschlecht ?? null, alter: calc.alter(d.profil?.geburtsjahr, d.datum),
      groesse_cm: d.profil?.groesse_cm ?? null,
    },
    ziele: {
      kcal: d.ziele.kcal, protein: d.ziele.makros?.protein ?? null, schritte: d.ziele.schritte,
      training: ZIEL_TRAINING_MIN,
    },
    gestern: {
      kcal: mzG.length ? sg.kcal : null, protein: mzG.length ? sg.protein : null,
      schritte: twG?.schritte ?? null, training: trG.reduce((a, t) => a + (t.minuten || 0), 0),
    },
    trend: {
      gewichtVon: reihe[0]?.gewicht ?? null, gewichtBis: reihe.at(-1)?.gewicht ?? null,
      kfaVon: mitKfa[0]?.kfa ?? null, kfaBis: mitKfa.at(-1)?.kfa ?? null,
    },
    plan: d.termine.map((t) => ({ start: t.start, titel: t.titel })),
    hinweise,
  };
  return kurkontext(s);
}
