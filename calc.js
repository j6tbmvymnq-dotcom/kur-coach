// calc.js – alle Berechnungen von Kur-Coach. Reine Funktionen, keine DOM-/DB-Zugriffe.
// Tests: tests.html

export const MET = {
  gehen: 3.5, nordic_walking: 5.0, rad_indoor: 6.8, rad_outdoor: 6.8, rad_intensiv: 8.5,
  schwimmen: 6.0, aquagym: 4.0, kraft: 5.0, tabata: 8.0, hiit: 8.0, kurs: 6.5, zumba: 6.5,
  yoga: 2.5, sauna: 0, sonstiges: 3.0,
};

// ---------------------------------------------------------------- Hilfen
export const runde = (x, stellen = 0) => {
  if (x == null || !isFinite(x)) return null;
  const f = 10 ** stellen;
  return Math.round(x * f) / f;
};

/** "87,9" | "1.234,5" | 87.9 | "" -> Zahl oder null */
export function zahl(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[^0-9,.\-]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/** Lokales Datum als YYYY-MM-DD (nicht UTC!) */
export function isoDatum(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function tageZwischen(vonIso, bisIso) {
  const a = Date.UTC(...vonIso.split('-').map((x, i) => (i === 1 ? x - 1 : +x)));
  const b = Date.UTC(...bisIso.split('-').map((x, i) => (i === 1 ? x - 1 : +x)));
  return Math.round((b - a) / 86400000);
}

export function addTage(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDatum(new Date(y, m - 1, d + n));
}

/** Kurtag 1..kurTage; vor Beginn negativ/0 -> {tag, status:'vorher'|'laeuft'|'vorbei'} */
export function kurTag(kurStart, datum, kurTage = 21) {
  if (!kurStart) return { tag: null, status: 'unbekannt', von: kurTage };
  const tag = tageZwischen(kurStart, datum) + 1;
  const status = tag < 1 ? 'vorher' : tag > kurTage ? 'vorbei' : 'laeuft';
  return { tag, status, von: kurTage };
}

export function alter(geburtsjahr, datum = isoDatum()) {
  if (!geburtsjahr) return null;
  return Number(datum.slice(0, 4)) - geburtsjahr;   // Jahresgenauigkeit reicht für den Grundumsatz
}

// ---------------------------------------------------------------- Umsatz
/** Mifflin-St Jeor. geschlecht 'm' | 'w' */
export function bmrMifflin({ geschlecht, gewicht, groesse_cm, alter }) {
  if (!gewicht || !groesse_cm || alter == null) return null;
  const s = geschlecht === 'w' ? -161 : 5;
  return 10 * gewicht + 6.25 * groesse_cm - 5 * alter + s;
}

/** Katch-McArdle: 370 + 21,6 × fettfreie Masse (kg) */
export function bmrKatch(fettfreieMasse) {
  if (!fettfreieMasse) return null;
  return 370 + 21.6 * fettfreieMasse;
}

/** Fettfreie Masse aus Messung (fettmasse oder kfa) */
export function fettfreieMasse({ gewicht, fettmasse, kfa }) {
  if (!gewicht) return null;
  if (fettmasse != null) return gewicht - fettmasse;
  if (kfa != null) return gewicht * (1 - kfa / 100);
  return null;
}

/** Grundumsatz: Mifflin, bei bekannter Fettmasse Mittelwert aus Mifflin und Katch. */
export function grundumsatz(profil, messung, datum = isoDatum()) {
  const gewicht = messung?.gewicht;
  const mifflin = bmrMifflin({
    geschlecht: profil?.geschlecht, gewicht, groesse_cm: profil?.groesse_cm,
    alter: alter(profil?.geburtsjahr, datum),
  });
  const ffm = messung ? fettfreieMasse(messung) : null;
  const katch = ffm ? bmrKatch(ffm) : null;
  const wert = mifflin != null && katch != null ? (mifflin + katch) / 2 : mifflin ?? katch;
  return { mifflin: runde(mifflin), katch: runde(katch), wert: runde(wert) };
}

/** kcal einer Trainingseinheit nach MET (nur Mehrverbrauch über Ruhe: MET − 1) */
export function trainingKcal(art, minuten, gewicht) {
  const met = MET[art] ?? MET.sonstiges;
  if (!met || !minuten || !gewicht) return 0;
  return Math.max(0, (met - 1) * gewicht * (minuten / 60));
}

/** Schritte -> kcal. 0,04 kcal pro Schritt bei 70 kg, linear aufs Körpergewicht normiert. */
export function schritteKcal(schritte, gewicht) {
  if (!schritte || !gewicht) return 0;
  return schritte * 0.04 * (gewicht / 70);
}

/**
 * Gesamtumsatz.
 * Mit Watch (aktiveKcal != null): BMR + aktive × 0,8 (ersetzt die Schätzung, nie doppelt).
 * Ohne: BMR × 1,35 + Schritte + Trainings (MET).
 */
export function gesamtumsatz({ bmr, aktiveKcal = null, schritte = 0, gewicht, trainings = [] }) {
  if (!bmr) return { wert: null, quelle: 'fehlt' };
  if (aktiveKcal != null && aktiveKcal > 0) {
    return { wert: runde(bmr + aktiveKcal * 0.8), quelle: 'watch' };
  }
  const tr = trainings.reduce((s, t) => s + trainingKcal(t.art, t.minuten, gewicht), 0);
  return { wert: runde(bmr * 1.35 + schritteKcal(schritte, gewicht) + tr), quelle: 'schaetzung' };
}

/** Tagesziel kcal = Umsatz − Defizit (15–30 %), nie unter Grundumsatz */
export function kcalZiel(umsatz, bmr, defizitProzent = 25) {
  if (!umsatz) return null;
  const d = Math.min(30, Math.max(15, defizitProzent ?? 25)) / 100;
  return runde(Math.max(bmr ?? 0, umsatz * (1 - d)));
}

/** Makros: Protein g/kg (1,8–2,4), Fett ≥ 0,7 g/kg, Rest KH */
export function makros(kcal, gewicht, proteinGkg = 2.0) {
  if (!kcal || !gewicht) return null;
  const pk = Math.min(2.4, Math.max(1.8, proteinGkg ?? 2.0));
  const protein = runde(gewicht * pk);
  const fett = runde(gewicht * 0.7);
  const kh = Math.max(0, runde((kcal - protein * 4 - fett * 9) / 4));
  return { protein, fett, kh };
}

/** Schritteziel: Basis, an Tagen mit wenig Training (< 45 min geplant/geloggt) 20.000 */
export function schritteZiel(basis = 15000, trainingsMinuten = 0) {
  return trainingsMinuten < 45 ? Math.max(basis, 20000) : basis;
}

// ---------------------------------------------------------------- Evidenzbasierte Ziele
// Werte und Quellen: docs/evidenz.md. Der Nutzer setzt keine Ziele selbst.
export const EVIDENZ = {
  abnahmeProzentWoche: 0.8,     // 0,5–1,0 %/Woche erhält Magermasse (Helms 2014; Garthe 2011)
  maxDefizitAnteil: 0.30,       // nie mehr als 30 % unter Umsatz
  proteinGproKgFFM: 2.6,        // 2,3–3,1 g/kg FFM im Defizit + Kraft (Helms 2014; ISSN Jäger 2017)
  proteinGproKgOhneFFM: 2.0,    // Fallback ohne Körperfett-Messung
  proteinGrenzenGkg: [1.6, 2.4],
  proteinProMahlzeitGkg: 0.4,   // 4 Mahlzeiten à 0,4 g/kg (Schoenfeld & Aragon 2018)
  proteinVorSchlafG: [30, 40],  // Trommelen/Snijders, Kasein-reich (Magerquark/Skyr)
  fettMinGkg: 0.7, fettMinAnteil: 0.20,
  kcalProKgFett: 7700,
  kreatinG: 5,                  // 3–5 g/Tag Monohydrat, Zeitpunkt egal (ISSN Kreider 2017)
};

/** Protein-Tagesziel in g: über fettfreie Masse, sonst Körpergewicht; begrenzt auf 1,6–2,4 g/kg */
export function proteinZiel(messung) {
  const g = messung?.gewicht;
  if (!g) return null;
  const ffm = fettfreieMasse(messung);
  const roh = ffm ? ffm * EVIDENZ.proteinGproKgFFM : g * EVIDENZ.proteinGproKgOhneFFM;
  const [lo, hi] = EVIDENZ.proteinGrenzenGkg;
  return runde(Math.min(hi * g, Math.max(lo * g, roh)));
}

/** Defizit in kcal/Tag aus Zielrate (% Körpergewicht pro Woche). readiness 'rot' -> halbe Rate */
export function defizitKcal(gewicht, readiness = null, rate = EVIDENZ.abnahmeProzentWoche) {
  if (!gewicht) return null;
  const r = readiness === 'rot' ? rate / 2 : rate;
  return runde((gewicht * (r / 100) * EVIDENZ.kcalProKgFett) / 7);
}

/** kcal-Ziel = Umsatz − Defizit, Defizit max. 30 % des Umsatzes, nie unter Grundumsatz */
export function kcalZielEvidenz(umsatz, bmr, gewicht, readiness = null) {
  if (!umsatz) return null;
  const d = Math.min(defizitKcal(gewicht, readiness) ?? 0, umsatz * EVIDENZ.maxDefizitAnteil);
  return runde(Math.max(bmr ?? 0, umsatz - d));
}

/** Makros nach Evidenz: Protein fest, Fett ≥ 0,7 g/kg und ≥ 20 % kcal, Rest KH */
export function makrosEvidenz(kcal, messung) {
  const gewicht = messung?.gewicht;
  if (!kcal || !gewicht) return null;
  const protein = proteinZiel(messung);
  const fett = runde(Math.max(gewicht * EVIDENZ.fettMinGkg, (kcal * EVIDENZ.fettMinAnteil) / 9));
  const kh = Math.max(0, runde((kcal - protein * 4 - fett * 9) / 4));
  return { protein, fett, kh };
}

/** Protein-Verteilung: Portionen über den Tag (für Checklisten/Plan) */
export function proteinPlan(messung) {
  const ziel = proteinZiel(messung);
  if (!ziel) return null;
  const portion = runde(messung.gewicht * EVIDENZ.proteinProMahlzeitGkg);
  const schlaf = EVIDENZ.proteinVorSchlafG[1];
  return {
    ziel, portion,
    mahlzeiten: [
      { slot: 'fruehstueck', g: portion }, { slot: 'mittag', g: portion },
      { slot: 'nachmittag', g: Math.max(0, ziel - 3 * portion - schlaf) },
      { slot: 'abend', g: portion }, { slot: 'spaetabend', g: schlaf },
    ],
  };
}

/** Ein kompletter Tagesziel-Block (für Heute-Screen und KURKONTEXT) – evidenzbasiert */
export function tagesziele({ profil, messung, tag = {}, trainings = [], datum = isoDatum(), readiness = null }) {
  const gu = grundumsatz(profil, messung, datum);
  const gewicht = messung?.gewicht ?? null;
  const um = gesamtumsatz({
    bmr: gu.wert, aktiveKcal: tag.aktive_kcal ?? null, schritte: tag.schritte ?? 0, gewicht, trainings,
  });
  const kcal = kcalZielEvidenz(um.wert, gu.wert, gewicht, readiness);
  const trMin = trainings.reduce((s, t) => s + (t.minuten || 0), 0);
  return {
    grundumsatz: gu, umsatz: um, kcal,
    defizit: um.wert && kcal ? runde(um.wert - kcal) : null,
    makros: makrosEvidenz(kcal, messung),
    schritte: schritteZiel(15000, trMin),
  };
}

/** Summen aus Mahlzeiten */
export function summeMahlzeiten(mahlzeiten = []) {
  return mahlzeiten.filter((m) => !m.geloescht).reduce(
    (s, m) => ({
      kcal: s.kcal + (zahl(m.kcal) || 0), protein: s.protein + (zahl(m.protein) || 0),
      kh: s.kh + (zahl(m.kh) || 0), fett: s.fett + (zahl(m.fett) || 0),
    }),
    { kcal: 0, protein: 0, kh: 0, fett: 0 },
  );
}

/** Warnung: an den letzten 2 Tagen jeweils > 1.000 kcal unter Ziel. tage: [{kcalIst, kcalZiel}] (älteste zuerst) */
export function warnungZuWenig(tage = []) {
  const l = tage.slice(-2);
  return l.length === 2 && l.every((t) => t.kcalZiel && t.kcalIst != null && t.kcalZiel - t.kcalIst > 1000);
}

// ---------------------------------------------------------------- Checklisten / Slots
export const SLOTS = ['morgen', 'fruehstueck', 'vormittag', 'mittag', 'nachmittag', 'abend', 'spaetabend', 'abschluss'];
export const SLOT_NAMEN = {
  morgen: 'Morgen', fruehstueck: 'Frühstück', vormittag: 'Vormittag', mittag: 'Mittag',
  nachmittag: 'Nachmittag', abend: 'Abend', spaetabend: 'Später Abend', abschluss: 'Tagesabschluss',
};
// Startzeiten (Minuten seit 0 Uhr); entsprechen den Automationen in docs/iphone-automationen.md
export const SLOT_START = {
  morgen: 0, fruehstueck: 450, vormittag: 630, mittag: 720, nachmittag: 900,
  abend: 1080, spaetabend: 1230, abschluss: 1290,
};

export function slotNachUhrzeit(d = new Date(), starts = SLOT_START) {
  const min = d.getHours() * 60 + d.getMinutes();
  let slot = 'morgen';
  for (const s of SLOTS) if (min >= (starts[s] ?? SLOT_START[s])) slot = s;
  if (min < 240) slot = 'abschluss';           // 0–4 Uhr gehört noch zum Vortag
  return slot;
}

export function istSlot(s) { return SLOTS.includes(s); }

export const zeitZuMin = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * Anteil des Tagesziels, der bis jetzt erreicht sein sollte (07:00 -> 0, 21:00 -> 1).
 */
export function tagesAnteil(d = new Date()) {
  const min = d.getHours() * 60 + d.getMinutes();
  return Math.min(1, Math.max(0, (min - 420) / (840)));
}

/**
 * Bedingung eines Checklistenpunkts. Unbekannte Bedingungen -> true (lieber zeigen als verstecken).
 * ctx: { schritte, proteinIst, proteinZiel, termine:[{start,titel,kategorie}], jetzt:Date, aerztlicheSperre:[...] }
 */
export function bedingungErfuellt(wenn, ctx = {}) {
  if (!wenn) return true;
  const w = String(wenn).trim();
  let m = w.match(/^steps\s*(<|<=|>|>=)\s*(\d+)$/);
  if (m) {
    const s = ctx.schritte ?? 0, n = Number(m[2]);
    return { '<': s < n, '<=': s <= n, '>': s > n, '>=': s >= n }[m[1]];
  }
  m = w.match(/^kein_termin_vor_(\d{1,2}):(\d{2})$/);
  if (m) {
    const grenze = Number(m[1]) * 60 + Number(m[2]);
    return !(ctx.termine || []).some((t) => !t.geloescht && zeitZuMin(t.start) != null && zeitZuMin(t.start) < grenze);
  }
  if (w === 'protein_unter_plan') {
    if (!ctx.proteinZiel) return true;
    return (ctx.proteinIst ?? 0) < ctx.proteinZiel * tagesAnteil(ctx.jetzt ?? new Date());
  }
  if (w === 'keine_aerztliche_sperre') {
    return !(ctx.aerztlicheSperre || []).includes('sauna');
  }
  return true;
}

/** Termine der nächsten `stunden` h ab jetzt als zusätzliche Checklistenpunkte */
export function terminPunkte(termine = [], jetzt = new Date(), stunden = 3) {
  const now = jetzt.getHours() * 60 + jetzt.getMinutes();
  return termine
    .filter((t) => !t.geloescht && t.start)
    .filter((t) => { const s = zeitZuMin(t.start); return s >= now - 15 && s <= now + stunden * 60; })
    .sort((a, b) => zeitZuMin(a.start) - zeitZuMin(b.start))
    .map((t) => ({ id: `termin_${t.id}`, text: `${t.start.slice(0, 5)} ${t.titel}${t.ort ? ' – ' + t.ort : ''}`, termin: true }));
}

/** Streak: Anzahl aufeinanderfolgender Tage (bis einschließlich heute/gestern) mit erfuellt(tag) */
export function streak(tageNeuesteZuerst = [], erfuellt) {
  let n = 0;
  for (const t of tageNeuesteZuerst) { if (erfuellt(t)) n++; else break; }
  return n;
}

// ---------------------------------------------------------------- Gym: Progression
/** Epley */
export function e1rm(gewicht, wdh) {
  if (!gewicht || !wdh) return null;
  return runde(gewicht * (1 + wdh / 30), 1);
}

/** Auf Schrittweite des Geräts runden (Standard: abrunden) */
export function aufSchritt(gewicht, schritt = 2.5, modus = 'ab') {
  if (gewicht == null) return null;
  const s = schritt || 2.5;
  const f = modus === 'auf' ? Math.ceil : modus === 'nah' ? Math.round : Math.floor;
  return runde(f(gewicht / s + 1e-9) * s, 2);
}

/**
 * Aufwärmsätze. nurEiner: ab der 3. Übung derselben Muskelgruppe nur 1 Satz (~60 %).
 * -> [{typ:'aufwaermen', gewicht, wdh, prozent}]
 */
export function aufwaermsaetze(arbeitsgewicht, schritt = 2.5, nurEiner = false) {
  if (!arbeitsgewicht || arbeitsgewicht <= 0) return [];
  const plan = nurEiner ? [[0.6, 6]] : [[0.4, 10], [0.6, 6], [0.8, 3]];
  const out = [];
  for (const [p, wdh] of plan) {
    const g = aufSchritt(arbeitsgewicht * p, schritt, 'nah');
    if (g <= 0 || g >= arbeitsgewicht) continue;
    if (out.length && out[out.length - 1].gewicht === g) continue;
    out.push({ typ: 'aufwaermen', gewicht: g, wdh, prozent: Math.round(p * 100) });
  }
  return out;
}

/** Pausentimer in Sekunden */
export function pausenDauer(satzTyp, uebungTyp = 'grund') {
  if (satzTyp === 'aufwaermen') return 60;
  return uebungTyp === 'isolation' ? 90 : 150;
}

/** Arbeitssätze einer Einheit zusammenfassen */
export function einheitZusammenfassung(saetze = []) {
  const arbeit = saetze.filter((s) => !s.geloescht && s.typ === 'arbeit' && s.gewicht != null && s.wdh != null);
  if (!arbeit.length) return null;
  const topGewicht = Math.max(...arbeit.map((s) => s.gewicht));
  const top = arbeit.filter((s) => s.gewicht === topGewicht);
  return {
    topGewicht, saetze: top, anzahl: top.length,
    gesamtWdh: top.reduce((s, x) => s + x.wdh, 0),
    volumen: arbeit.reduce((s, x) => s + x.gewicht * x.wdh, 0),
    bestE1rm: Math.max(...arbeit.map((s) => e1rm(s.gewicht, s.wdh))),
  };
}

/**
 * Double Progression (docs/gym-logger.md).
 * uebung: { schrittweite_kg, wdh_min, wdh_max }
 * einheiten: Array von Satz-Arrays, NEUESTE ZUERST (nur diese Übung).
 * readiness: 'gruen' | 'gelb' | 'rot' | 'kalibrierung' | null
 * -> { gewicht, wdhMin, wdhMax, wdhZiel:[pro Satz], saetze, grund, hinweis }
 */
export function vorschlag(uebung = {}, einheiten = [], readiness = null) {
  const schritt = zahl(uebung.schrittweite_kg) || 2.5;
  const wmin = uebung.wdh_min ?? 8, wmax = uebung.wdh_max ?? 12;
  const zus = einheiten.map(einheitZusammenfassung).filter(Boolean);
  const basis = { wdhMin: wmin, wdhMax: wmax, hinweis: null };

  if (!zus.length) {
    return { ...basis, gewicht: null, saetze: 3, wdhZiel: [wmin, wmin, wmin],
      grund: `Erstes Mal: Gewicht wählen, mit dem ${wmin}–${wmax} saubere Wdh. gehen.` };
  }
  const l = zus[0];
  const saetzeAnzahl = Math.max(2, l.anzahl);
  let gewicht = l.topGewicht, wdhZiel, grund, hinweis = null, saetze = saetzeAnzahl;

  const alleOben = l.saetze.every((s) => s.wdh >= wmax && (s.rir == null || s.rir >= 1));
  // Rückgang: 2 Einheiten in Folge weniger Gesamt-Wdh bei gleichem Gewicht
  const rueckgang = zus.length >= 3
    && zus[0].topGewicht === zus[1].topGewicht && zus[1].topGewicht === zus[2].topGewicht
    && zus[0].gesamtWdh < zus[1].gesamtWdh && zus[1].gesamtWdh < zus[2].gesamtWdh;

  if (rueckgang) {
    gewicht = aufSchritt(l.topGewicht * 0.95, schritt, 'ab');
    if (gewicht >= l.topGewicht) gewicht = l.topGewicht - schritt;
    wdhZiel = Array(saetze).fill(wmin);
    grund = '2× in Folge weniger Wdh. → 1 Einheit −5 %.';
    hinweis = 'Erholung prüfen (Schlaf, HRV). Im Defizit ist Halten okay.';
  } else if (alleOben) {
    gewicht = runde(l.topGewicht + schritt, 2);
    wdhZiel = Array(saetze).fill(wmin);
    grund = `Alle Sätze ≥ ${wmax} Wdh. → +${String(schritt).replace('.', ',')} kg`;
  } else {
    const wdh = l.saetze.map((s) => s.wdh);
    while (wdh.length < saetze) wdh.push(wdh[wdh.length - 1]);
    const schwach = wdh.indexOf(Math.min(...wdh));
    wdhZiel = wdh.map((w, i) => Math.min(wmax, i === schwach ? w + 1 : w));
    grund = `Gleiches Gewicht, +1 Wdh. im schwächsten Satz (${wdh[schwach]} → ${wdh[schwach] + 1})`;
  }

  if (readiness === 'rot') {
    if (gewicht > l.topGewicht) gewicht = l.topGewicht;
    saetze = Math.max(1, saetze - 1);
    wdhZiel = wdhZiel.slice(0, saetze);
    grund = 'Readiness rot: gleiches Gewicht, 1 Satz weniger.';
  }
  return { ...basis, gewicht, saetze, wdhZiel, grund, hinweis };
}

/** "140 kg × 12, 12, 11 (RIR 1)" */
export function letztesMalText(saetze = []) {
  const z = einheitZusammenfassung(saetze);
  if (!z) return null;
  const rirs = z.saetze.map((s) => s.rir).filter((r) => r != null);
  const g = String(z.topGewicht).replace('.', ',');
  return `${g} kg × ${z.saetze.map((s) => s.wdh).join(', ')}${rirs.length ? ` (RIR ${Math.min(...rirs)})` : ''}`;
}

/** Neue Bestwerte einer Einheit gegenüber der Historie: [{uebung_id, e1rm, vorher}] */
export function neueBestwerte(saetzeHeute = [], saetzeHistorie = []) {
  const best = {};
  for (const s of saetzeHistorie) {
    if (s.geloescht || s.typ !== 'arbeit') continue;
    const e = e1rm(s.gewicht, s.wdh);
    if (e && (best[s.uebung_id] ?? 0) < e) best[s.uebung_id] = e;
  }
  const heute = {};
  for (const s of saetzeHeute) {
    if (s.geloescht || s.typ !== 'arbeit') continue;
    const e = e1rm(s.gewicht, s.wdh);
    if (e && (heute[s.uebung_id] ?? 0) < e) heute[s.uebung_id] = e;
  }
  return Object.entries(heute)
    .filter(([id, e]) => e > (best[id] ?? 0))
    .map(([uebung_id, e]) => ({ uebung_id, e1rm: e, vorher: best[uebung_id] ?? null }));
}
