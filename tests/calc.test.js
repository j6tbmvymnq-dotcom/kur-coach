// Tests für calc.js. Erwartungswerte von Hand nachgerechnet (nicht aus dem Code abgeleitet).
import * as C from '../calc.js';

const PROFIL_M = { geschlecht: 'm', groesse_cm: 182, geburtsjahr: 1992 };
const U = { schrittweite_kg: 2.5, wdh_min: 8, wdh_max: 12 };
const satz = (gewicht, wdh, rir = 1) => ({ typ: 'arbeit', gewicht, wdh, rir });
const dt = (j, m, t, h = 0, min = 0) => new Date(j, m - 1, t, h, min);

export default function (t) {
  // ------------------------------------------------------------ Zahlen und Datum
  t.gruppe('Zahlen und Datum');
  t.gleich(C.zahl('87,9'), 87.9, 'zahl("87,9") = 87.9');
  t.gleich(C.zahl('1.234,5'), 1234.5, 'zahl("1.234,5") = 1234.5');
  t.gleich(C.zahl(''), null, 'zahl("") = null');
  t.gleich(C.zahl(null), null, 'zahl(null) = null');
  t.gleich(C.zahl(12), 12, 'zahl(12) = 12');
  t.gleich(C.zahl('2,5 kg'), 2.5, 'zahl("2,5 kg") = 2.5 (Einheit entfernt)');
  t.gleich(C.zahl('abc'), null, 'zahl("abc") = null');
  t.gleich(C.isoDatum(dt(2026, 11, 25)), '2026-11-25', 'isoDatum lokal');
  t.gleich(C.isoDatum(dt(2026, 1, 5)), '2026-01-05', 'isoDatum mit führenden Nullen');
  t.gleich(C.tageZwischen('2026-11-25', '2026-12-16'), 21, 'tageZwischen 25.11. -> 16.12. = 21');
  t.gleich(C.tageZwischen('2026-11-25', '2026-11-25'), 0, 'tageZwischen gleicher Tag = 0');
  t.gleich(C.tageZwischen('2026-11-24', '2026-11-25'), 1, 'tageZwischen +1 Tag');
  t.gleich(C.addTage('2026-11-25', 6), '2026-12-01', 'addTage +6 über Monatsgrenze');
  t.gleich(C.addTage('2026-02-28', 1), '2026-03-01', 'addTage 28.02.2026 +1 = 01.03.');
  t.gleich(C.alter(1992, '2026-11-23'), 34, 'alter 1992 bei 2026 = 34');
  t.gleich(C.alter(null), null, 'alter ohne Geburtsjahr = null');

  // ------------------------------------------------------------ Kurtag
  t.gruppe('Kurtag');
  t.gleich(C.kurTag('2026-11-25', '2026-11-25'), { tag: 1, status: 'laeuft', von: 21 }, 'Starttag = Tag 1, läuft');
  t.gleich(C.kurTag('2026-11-25', '2026-11-24'), { tag: 0, status: 'vorher', von: 21 }, 'Tag vor Start = vorher');
  t.gleich(C.kurTag('2026-11-25', '2026-12-15'), { tag: 21, status: 'laeuft', von: 21 }, 'Tag 21 läuft noch');
  t.gleich(C.kurTag('2026-11-25', '2026-12-16'), { tag: 22, status: 'vorbei', von: 21 }, 'Tag 22 = vorbei');
  t.gleich(C.kurTag(null, '2026-11-25').status, 'unbekannt', 'ohne Kurstart = unbekannt');

  // ------------------------------------------------------------ Grundumsatz
  t.gruppe('Grundumsatz');
  t.nahe(C.bmrMifflin({ geschlecht: 'm', gewicht: 88, groesse_cm: 182, alter: 34 }), 1852.5, 0.001, 'Mifflin m: 880+1137,5-170+5 = 1852,5');
  t.nahe(C.bmrMifflin({ geschlecht: 'w', gewicht: 88, groesse_cm: 182, alter: 34 }), 1686.5, 0.001, 'Mifflin w: 1852,5 - 166 = 1686,5');
  t.gleich(C.bmrMifflin({ geschlecht: 'm', gewicht: null, groesse_cm: 182, alter: 34 }), null, 'Mifflin ohne Gewicht = null');
  t.nahe(C.bmrKatch(70), 1882, 0.001, 'Katch-McArdle bei 70 kg FFM = 1882');
  t.nahe(C.fettfreieMasse({ gewicht: 88, fettmasse: 20 }), 68, 0.001, 'FFM aus Fettmasse = 68');
  t.nahe(C.fettfreieMasse({ gewicht: 88, kfa: 25 }), 66, 0.001, 'FFM aus KFA 25 % = 66');
  const gu = C.grundumsatz(PROFIL_M, { gewicht: 88, fettmasse: 20 }, '2026-11-23');
  t.gleich(gu.mifflin, 1853, 'grundumsatz: Mifflin gerundet 1853');
  t.gleich(gu.katch, 1839, 'grundumsatz: Katch gerundet 1839 (1838,8)');
  t.gleich(gu.wert, 1846, 'grundumsatz mit Fettmasse = Mittelwert (1845,65 -> 1846)');
  const gu2 = C.grundumsatz(PROFIL_M, { gewicht: 88 }, '2026-11-23');
  t.gleich(gu2.katch, null, 'grundumsatz ohne Fettmasse: kein Katch');
  t.gleich(gu2.wert, 1853, 'grundumsatz ohne Fettmasse = Mifflin');

  // ------------------------------------------------------------ Umsatz
  t.gruppe('Umsatz');
  t.nahe(C.trainingKcal('kraft', 60, 70), 280, 0.001, 'Kraft 60 min, 70 kg: (5-1)*70*1 = 280');
  t.nahe(C.trainingKcal('gehen', 30, 80), 100, 0.001, 'Gehen 30 min, 80 kg: (3,5-1)*80*0,5 = 100');
  t.nahe(C.trainingKcal('sauna', 60, 80), 0, 0.001, 'Sauna (MET 0) = 0 kcal');
  t.nahe(C.trainingKcal('unbekannt', 60, 70), 140, 0.001, 'Unbekannte Art = sonstiges (MET 3) -> 140');
  t.nahe(C.schritteKcal(10000, 70), 400, 0.001, '10000 Schritte bei 70 kg = 400 kcal');
  t.nahe(C.schritteKcal(5000, 140), 400, 0.001, '5000 Schritte bei 140 kg = 400 kcal');
  t.nahe(C.schritteKcal(0, 70), 0, 0.001, '0 Schritte = 0 kcal');
  const uw = C.gesamtumsatz({ bmr: 1850, aktiveKcal: 600, schritte: 9000, gewicht: 88 });
  t.gleich(uw.wert, 2330, 'Watch: 1850 + 600*0,8 = 2330');
  t.gleich(uw.quelle, 'watch', 'Watch: quelle watch');
  const us = C.gesamtumsatz({ bmr: 1800, aktiveKcal: null, schritte: 8000, gewicht: 70, trainings: [{ art: 'kraft', minuten: 60 }] });
  t.gleich(us.wert, 3030, 'ohne Watch: 1800*1,35 + 320 + 280 = 3030');
  t.gleich(us.quelle, 'schaetzung', 'ohne Watch: quelle schaetzung');
  t.gleich(C.gesamtumsatz({ bmr: 1800, aktiveKcal: 0, schritte: 0, gewicht: 70 }).quelle, 'schaetzung', 'aktive kcal 0 zählt nicht als Watch');
  t.gleich(C.gesamtumsatz({ bmr: 1800, aktiveKcal: 0, schritte: 0, gewicht: 70 }).wert, 2430, 'aktive kcal 0: 1800*1,35 = 2430');
  t.gleich(C.gesamtumsatz({ bmr: null, aktiveKcal: 600 }).quelle, 'fehlt', 'ohne BMR: quelle fehlt');

  // ------------------------------------------------------------ Kalorien und Makros
  t.gruppe('Kalorienziel und Makros');
  t.gleich(C.kcalZiel(3000, 1850, 25), 2250, 'kcalZiel 3000, 25 % Defizit = 2250');
  t.gleich(C.kcalZiel(2000, 1850, 30), 1850, 'kcalZiel Untergrenze: nie unter Grundumsatz');
  t.gleich(C.kcalZiel(3000, 1000, 10), 2550, 'Defizit 10 % wird auf 15 % geklemmt -> 2550');
  t.gleich(C.kcalZiel(3000, 1000, 50), 2100, 'Defizit 50 % wird auf 30 % geklemmt -> 2100');
  t.gleich(C.kcalZiel(3000, 1000, null), 2250, 'Defizit fehlt -> 25 % Standard');
  t.gleich(C.kcalZiel(null, 1850, 25), null, 'ohne Umsatz = null');
  const m = C.makros(2250, 88, 2.0);
  t.gleich(m.protein, 176, 'Protein 2,0 g/kg * 88 = 176');
  t.gleich(m.fett, 62, 'Fett 0,7 g/kg = 61,6 -> 62');
  t.gleich(m.kh, 247, 'KH = (2250 - 704 - 558) / 4 = 247');
  t.gleich(C.makros(2250, 88, 1.0).protein, 158, 'Protein-Faktor auf 1,8 geklemmt: 158');
  t.gleich(C.makros(2250, 88, 3.0).protein, 211, 'Protein-Faktor auf 2,4 geklemmt: 211');
  t.gleich(C.makros(1000, 88, 2.0).kh, 0, 'KH nie negativ');
  t.gleich(C.makros(null, 88, 2.0), null, 'Makros ohne kcal = null');
  const tz = C.tagesziele({
    profil: { geschlecht: 'm', groesse_cm: 182, geburtsjahr: 1992, defizit_prozent: 25, protein_g_pro_kg: 2.0, schritte_ziel: 15000 },
    messung: { gewicht: 88, fettmasse: 20 }, tag: {}, trainings: [], datum: '2026-11-23',
  });
  t.gleich(tz.grundumsatz.wert, 1846, 'tagesziele: Grundumsatz 1846');
  t.gleich(tz.umsatz.wert, 2492, 'tagesziele: Umsatz 1846*1,35 = 2492');
  // Standard-Modus Rekomposition: Defizit 88*0,25%*7700/7 = 242 -> 2492-242 = 2250
  t.gleich(tz.modus, 'rekomposition', 'tagesziele: Standard-Modus Rekomposition');
  t.gleich(tz.kcal, 2250, 'tagesziele Rekomp: 2492-242 = 2250');
  t.gleich(tz.makros.protein, 177, 'tagesziele: Protein 68 kg FFM * 2,6 = 176,8 -> 177');
  t.gleich(tz.makros.kh, 246, 'tagesziele: KH (2250-708-558)/4 = 246');
  const tzF = C.tagesziele({
    profil: { geschlecht: 'm', groesse_cm: 182, geburtsjahr: 1992, einstellungen: { ziel_modus: 'fettabbau' } },
    messung: { gewicht: 88, fettmasse: 20 }, tag: {}, trainings: [], datum: '2026-11-23',
  });
  // Fettabbau: 2492-774 = 1718 < Grundumsatz -> 1846
  t.gleich(tzF.kcal, 1846, 'tagesziele Fettabbau: nie unter Grundumsatz (1846)');
  t.gleich(tzF.schritte, 20000, 'tagesziele Fettabbau: wenig Training -> 20000');
  const tzA = C.tagesziele({
    profil: { geschlecht: 'm', groesse_cm: 182, geburtsjahr: 1992, einstellungen: { ziel_modus: 'aufbau' } },
    messung: { gewicht: 88, fettmasse: 20 }, tag: {}, trainings: [], datum: '2026-11-23',
  });
  t.gleich(tzA.kcal, 2734, 'tagesziele Aufbau: 2492+242 = 2734');
  t.gleich(tzA.makros.protein, 150, 'tagesziele Aufbau: Protein 68*2,2 = 149,6 -> 150');
  t.gleich(C.kcalZielEvidenz(2000, 1500, 200, null, -0.25), 2200, 'Überschuss max +10 %');

  t.gruppe('Readiness');
  const vt = [50, 52, 48, 50].map((h, i) => ({ datum: `2026-11-2${i}`, hrv_ms: h, ruhepuls: 55 }));
  t.gleich(C.readiness({}, vt).ampel, null, 'keine Werte heute -> null');
  t.gleich(C.readiness({ hrv_ms: 50, ruhepuls: 55, schlaf_min: 480 }, vt).ampel, 'gruen', 'alles normal -> grün');
  t.gleich(C.readiness({ hrv_ms: 44, ruhepuls: 58, schlaf_min: 480 }, vt).ampel, 'gelb', 'HRV 88 % (−1) + Puls +3 (−1) -> gelb');
  t.gleich(C.readiness({ hrv_ms: 38, ruhepuls: 61, schlaf_min: 400 }, vt).ampel, 'rot', 'HRV 76 % (−2) + Puls +6 (−2) + 6,7 h (−1) -> rot');
  t.gleich(C.readiness({ schlaf_min: 300 }, vt.slice(0, 2)).ampel, 'kalibrierung', 'weniger als 3 Vortage -> Kalibrierung');
  t.gleich(C.readiness({ schlaf_min: 300 }, vt.slice(0, 2)).gruende.length, 1, 'Kalibrierung nennt trotzdem Gründe');
  t.gleich(C.readiness({ hrv_ms: 50, energie_1_5: 2, schlaf_min: 410 }, vt).ampel, 'gelb', 'Energie 2 (−1) + 6,8 h (−1) -> gelb');

  t.gruppe('Schritte relativ zum Ziel');
  t.gleich(C.bedingungErfuellt('steps<ziel', { schritte: 9000, schritteZiel: 10000 }), true, 'steps<ziel: 9000 < 10000');
  t.gleich(C.bedingungErfuellt('steps<ziel', { schritte: 10500, schritteZiel: 10000 }), false, 'steps<ziel: Ziel erreicht');
  t.gleich(C.bedingungErfuellt('steps<ziel*0.5', { schritte: 4000, schritteZiel: 10000 }), true, 'steps<ziel*0.5: 4000 < 5000');
  t.gleich(C.bedingungErfuellt('steps<ziel*0.5', { schritte: 6000, schritteZiel: 10000 }), false, 'steps<ziel*0.5: 6000 >= 5000');
  t.gleich(C.bedingungErfuellt('steps<ziel', { schritte: 0 }), true, 'ohne Ziel: anzeigen');

  t.gruppe('Evidenzbasierte Ziele');
  t.gleich(C.defizitKcal(88), 774, 'defizitKcal: 88*0,008*7700/7 = 774,4 -> 774');
  t.gleich(C.defizitKcal(88, 'rot'), 387, 'defizitKcal rot: halbe Rate -> 387');
  t.gleich(C.kcalZielEvidenz(3000, 1850, 88), 2226, 'kcalZielEvidenz: 3000-774 = 2226');
  t.gleich(C.kcalZielEvidenz(2000, 1300, 88), 1400, 'kcalZielEvidenz: Defizit max 30 % -> 1400');
  t.gleich(C.proteinZiel({ gewicht: 88.4, kfa: 21.8 }), 180, 'proteinZiel: FFM 69,13*2,6 = 179,7 -> 180');
  t.gleich(C.proteinZiel({ gewicht: 88 }), 176, 'proteinZiel ohne KFA: 2,0 g/kg -> 176');
  t.gleich(C.proteinZiel({ gewicht: 100, kfa: 5 }), 240, 'proteinZiel: Obergrenze 2,4 g/kg');
  t.gleich(C.makrosEvidenz(2200, { gewicht: 88, fettmasse: 20 }).fett, 62, 'makrosEvidenz: Fett max(61,6; 48,9) -> 62');
  t.gleich(C.proteinPlan({ gewicht: 88.4, kfa: 21.8 }).mahlzeiten.reduce((s, m) => s + m.g, 0), 180, 'proteinPlan: Portionen ergeben Tagesziel');
  t.gleich(tz.schritte, 12000, 'tagesziele Rekomp: wenig Training -> 12000 Schritte');

  // ------------------------------------------------------------ Summen, Warnung, Schritte
  t.gruppe('Summen und Warnung');
  t.gleich(C.schritteZiel(15000, 0), 20000, 'schritteZiel: < 45 min Training -> 20000');
  t.gleich(C.schritteZiel(15000, 60), 15000, 'schritteZiel: >= 45 min -> Basis');
  t.gleich(C.summeMahlzeiten([
    { kcal: 500, protein: 30, kh: 50, fett: 20 },
    { kcal: 300, protein: 20, kh: 10, fett: 5, geloescht: true },
    { kcal: '200', protein: '10', kh: 25, fett: 5 },
  ]), { kcal: 700, protein: 40, kh: 75, fett: 25 }, 'summeMahlzeiten ohne gelöschte');
  t.wahr(C.warnungZuWenig([{ kcalIst: 1000, kcalZiel: 2500 }, { kcalIst: 1200, kcalZiel: 2400 }]), 'Warnung: 2 Tage je > 1000 kcal unter Ziel');
  t.wahr(!C.warnungZuWenig([{ kcalIst: 2000, kcalZiel: 2500 }, { kcalIst: 1000, kcalZiel: 2400 }]), 'keine Warnung: nur ein Tag mit > 1000 unter Ziel');
  t.wahr(!C.warnungZuWenig([{ kcalIst: 1000, kcalZiel: 2500 }]), 'keine Warnung bei nur einem Tag');
  t.gleich(C.streak([true, true, false, true], (x) => x), 2, 'streak zählt ab neuestem Tag bis zum ersten Bruch');
  t.gleich(C.streak([], (x) => x), 0, 'streak leer = 0');

  // ------------------------------------------------------------ Slots und Zeit
  t.gruppe('Slots und Uhrzeit');
  t.gleich(C.slotNachUhrzeit(dt(2026, 11, 23, 6, 0)), 'morgen', 'slot 06:00 = morgen');
  t.gleich(C.slotNachUhrzeit(dt(2026, 11, 23, 7, 30)), 'fruehstueck', 'slot 07:30 = fruehstueck');
  t.gleich(C.slotNachUhrzeit(dt(2026, 11, 23, 12, 5)), 'mittag', 'slot 12:05 = mittag');
  t.gleich(C.slotNachUhrzeit(dt(2026, 11, 23, 21, 40)), 'abschluss', 'slot 21:40 = abschluss');
  t.gleich(C.slotNachUhrzeit(dt(2026, 11, 23, 2, 0)), 'abschluss', 'slot 02:00 = abschluss (Vortag)');
  t.gleich(C.slotNachUhrzeit(dt(2026, 11, 23, 3, 59)), 'abschluss', 'slot 03:59 = abschluss');
  t.gleich(C.slotNachUhrzeit(dt(2026, 11, 23, 4, 0)), 'morgen', 'slot 04:00 = morgen');
  t.gleich(C.zeitZuMin('07:30'), 450, 'zeitZuMin 07:30 = 450');
  t.gleich(C.zeitZuMin(''), null, 'zeitZuMin leer = null');
  t.nahe(C.tagesAnteil(dt(2026, 11, 23, 7, 0)), 0, 0.001, 'tagesAnteil 07:00 = 0');
  t.nahe(C.tagesAnteil(dt(2026, 11, 23, 14, 0)), 0.5, 0.001, 'tagesAnteil 14:00 = 0,5');
  t.nahe(C.tagesAnteil(dt(2026, 11, 23, 21, 0)), 1, 0.001, 'tagesAnteil 21:00 = 1');
  t.wahr(C.istSlot('mittag'), 'istSlot mittag');
  t.wahr(!C.istSlot('xyz'), 'istSlot unbekannt = false');

  // ------------------------------------------------------------ Bedingungen
  t.gruppe('Checklisten-Bedingungen');
  t.wahr(C.bedingungErfuellt('steps<8000', { schritte: 5000 }) === true, 'steps<8000 bei 5000 = true');
  t.wahr(C.bedingungErfuellt('steps<8000', { schritte: 9000 }) === false, 'steps<8000 bei 9000 = false');
  t.wahr(C.bedingungErfuellt('steps<=5000', { schritte: 5000 }) === true, 'steps<=5000 bei 5000 = true');
  t.wahr(C.bedingungErfuellt('kein_termin_vor_08:30', { termine: [{ start: '08:00', titel: 'Arzt' }] }) === false, 'Termin 08:00 verletzt kein_termin_vor_08:30');
  t.wahr(C.bedingungErfuellt('kein_termin_vor_08:30', { termine: [{ start: '09:00', titel: 'Arzt' }] }) === true, 'Termin 09:00 ok');
  t.wahr(C.bedingungErfuellt('unbekannte_bedingung', {}) === true, 'unbekannte Bedingung = true');
  t.wahr(C.bedingungErfuellt(null, {}) === true, 'leere Bedingung = true');
  t.wahr(C.bedingungErfuellt('keine_aerztliche_sperre', { aerztlicheSperre: ['sauna'] }) === false, 'Sauna-Sperre: Punkt ausgeblendet');
  t.wahr(C.bedingungErfuellt('keine_aerztliche_sperre', { aerztlicheSperre: [] }) === true, 'ohne Sperre = true');
  t.wahr(C.bedingungErfuellt('protein_unter_plan', { proteinZiel: 176, proteinIst: 50, jetzt: dt(2026, 11, 23, 14, 0) }) === true, 'Protein 50 g um 14:00 (Soll 88) = unter Plan');
  t.wahr(C.bedingungErfuellt('protein_unter_plan', { proteinZiel: 176, proteinIst: 100, jetzt: dt(2026, 11, 23, 14, 0) }) === false, 'Protein 100 g um 14:00 = im Plan');

  // ------------------------------------------------------------ Termine
  t.gruppe('Termine');
  t.gleich(C.terminPunkte(
    [
      { id: 'a', start: '10:00', titel: 'Therapie', ort: 'Praxis' },
      { id: 'b', start: '07:00', titel: 'Frueh' },
      { id: 'c', start: '15:00', titel: 'Spaet' },
      { id: 'd', start: '09:00', titel: 'Geloescht', geloescht: true },
    ],
    dt(2026, 11, 23, 9, 0), 3,
  ), [{ id: 'termin_a', text: '10:00 Therapie – Praxis', termin: true }], 'terminPunkte: nur Termine im 3-h-Fenster');
  t.gleich(C.terminPunkte(
    [{ id: 'a', start: '10:00', titel: 'A' }, { id: 'b', start: '09:30', titel: 'B' }],
    dt(2026, 11, 23, 9, 0), 3,
  ).map((p) => p.id), ['termin_b', 'termin_a'], 'terminPunkte nach Uhrzeit sortiert');

  // ------------------------------------------------------------ Gym: Rechnen
  t.gruppe('Gym: e1RM und Rundung');
  t.nahe(C.e1rm(100, 10), 133.3, 0.05, 'e1RM 100 kg x 10 = 133,3');
  t.gleich(C.e1rm(100, 0), null, 'e1RM ohne Wdh = null');
  t.gleich(C.aufSchritt(61, 2.5), 60, 'aufSchritt 61 auf 2,5 abrunden = 60');
  t.gleich(C.aufSchritt(61, 2.5, 'auf'), 62.5, 'aufSchritt 61 aufrunden = 62,5');
  t.gleich(C.aufSchritt(62.6, 2.5, 'nah'), 62.5, 'aufSchritt 62,6 nächster Schritt = 62,5');
  t.gleich(C.aufSchritt(null), null, 'aufSchritt ohne Gewicht = null');

  // ------------------------------------------------------------ Gym: Aufwärmen, Pausen
  t.gruppe('Gym: Aufwärmen und Pausen');
  const aw = (g, st, m) => C.aufwaermsaetze(g, st, m).map((x) => [x.gewicht, x.wdh]);
  t.gleich(aw(100, 2.5, 'grund-erst'), [[50, 8], [70, 4], [85, 2]], 'grund-erst 100 kg: 50x8, 70x4, 85x2');
  t.gleich(aw(100, 2.5, 'grund-folge'), [[65, 5]], 'grund-folge 100 kg: 65x5');
  t.gleich(aw(100, 2.5, 'iso-erst'), [[50, 10], [75, 4]], 'iso-erst 100 kg: 50x10, 75x4');
  t.gleich(aw(100, 2.5, 'iso-folge'), [[55, 8]], 'iso-folge 100 kg: 55x8');
  t.gleich(aw(10, 1, 'grund-erst'), [[5, 8], [7, 4], [9, 2]], 'grund-erst 10 kg, Schritt 1');
  t.gleich(aw(10, 1, 'iso-erst'), [[5, 10], [8, 4]], 'iso-erst 10 kg, Schritt 1');
  t.gleich(aw(100, 2.5), aw(100, 2.5, 'grund-erst'), 'Standard = grund-erst');
  t.gleich(aw(100, 2.5, true), aw(100, 2.5, 'grund-folge'), 'true = grund-folge (kompatibel)');
  t.gleich(C.aufwaermsaetze(100, 2.5, 'grund-folge')[0].prozent, 65, 'Prozent im Objekt');
  t.gleich(C.aufwaermsaetze(0), [], 'aufwaermsaetze ohne Gewicht = leer');
  t.gleich(C.pausenDauer('aufwaermen'), 60, 'Pause Aufwärmen 60 s');
  t.gleich(C.pausenDauer('arbeit', 'isolation'), 90, 'Pause Isolation 90 s');
  t.gleich(C.pausenDauer('arbeit'), 150, 'Pause Grundübung 150 s');

  // ------------------------------------------------------------ Gym: Einheit und Text
  t.gruppe('Gym: Einheit und Text');
  const ez = C.einheitZusammenfassung([satz(140, 12), satz(140, 12), satz(140, 11)]);
  t.gleich(ez.topGewicht, 140, 'einheit: Topgewicht 140');
  t.gleich(ez.anzahl, 3, 'einheit: 3 Sätze auf Topgewicht');
  t.gleich(ez.gesamtWdh, 35, 'einheit: 35 Wdh gesamt');
  t.gleich(ez.volumen, 4900, 'einheit: Volumen 140*35 = 4900');
  t.nahe(ez.bestE1rm, 196, 0.05, 'einheit: bestes e1RM 140 x 12 = 196');
  t.gleich(C.einheitZusammenfassung([]), null, 'einheit leer = null');
  t.gleich(C.letztesMalText([satz(140, 12, 1), satz(140, 12, 1), satz(140, 11, 1)]), '140 kg × 12, 12, 11 (RIR 1)', 'letztesMalText Standardformat');
  t.gleich(C.letztesMalText([]), null, 'letztesMalText leer = null');

  // ------------------------------------------------------------ Gym: Vorschlag
  t.gruppe('Gym: Vorschlag (Double Progression)');
  const v0 = C.vorschlag(U, [], null);
  t.gleich(v0.gewicht, null, 'keine Historie: kein Gewicht');
  t.gleich(v0.wdhZiel, [8, 8, 8], 'keine Historie: Ziel 8/8/8');
  t.gleich(v0.saetze, 3, 'keine Historie: 3 Sätze');
  const v1 = C.vorschlag(U, [[satz(50, 12), satz(50, 12), satz(50, 12)]], null);
  t.gleich(v1.gewicht, 52.5, 'alle Sätze 12 (RIR 1): +2,5 kg');
  t.gleich(v1.wdhZiel, [8, 8, 8], 'alle Sätze 12: wdhZiel = wdh_min');
  const v2 = C.vorschlag(U, [[satz(50, 12), satz(50, 11), satz(50, 10)]], null);
  t.gleich(v2.gewicht, 50, '[12,11,10]: gleiches Gewicht');
  t.gleich(v2.wdhZiel, [12, 11, 11], '[12,11,10]: Ziel [12,11,11] (schwächster Satz +1)');
  const rueck = [
    [satz(60, 10), satz(60, 10), satz(60, 10)],
    [satz(60, 11), satz(60, 11), satz(60, 11)],
    [satz(60, 12), satz(60, 12), satz(60, 12)],
  ];
  const v3 = C.vorschlag(U, rueck, null);
  t.gleich(v3.gewicht, 55, 'Rückgang 2x in Folge: 60 * 0,95 = 57 -> abgerundet auf 2,5 = 55');
  t.wahr(typeof v3.hinweis === 'string' && v3.hinweis.length > 0, 'Rückgang: Hinweis gesetzt');
  t.gleich(v3.wdhZiel, [8, 8, 8], 'Rückgang: Ziel = wdh_min');
  const v4 = C.vorschlag(U, [[satz(50, 12), satz(50, 12), satz(50, 12)]], 'rot');
  t.gleich(v4.gewicht, 50, 'readiness rot: kein Gewichtsplus');
  t.gleich(v4.saetze, 2, 'readiness rot: 1 Satz weniger');
  t.gleich(v4.wdhZiel, [8, 8], 'readiness rot: Ziel auf 2 Sätze gekürzt');
  const v5 = C.vorschlag(U, [[satz(50, 12), satz(50, 11), satz(50, 10)]], 'rot');
  t.gleich(v5.gewicht, 50, 'readiness rot bei [12,11,10]: gleiches Gewicht');
  t.gleich(v5.saetze, 2, 'readiness rot bei [12,11,10]: 2 Sätze');
  t.gleich(v5.wdhZiel, [12, 11], 'readiness rot bei [12,11,10]: Ziel [12,11]');
  const v6 = C.vorschlag(U, [[satz(50, 12)]], null);
  t.gleich(v6.saetze, 2, 'ein Satz in der Historie: mindestens 2 Sätze');
  t.gleich(v6.wdhZiel, [8, 8], 'ein Satz: wdhZiel für 2 Sätze');
  t.gleich(C.vorschlag({ wdh_min: 8, wdh_max: 12 }, [[satz(50, 12), satz(50, 12)]], null).gewicht, 52.5, 'ohne Schrittweite: Standard 2,5 kg');
  const v7 = C.vorschlag(U, [[satz(50, 12, 0), satz(50, 12, 0), satz(50, 12, 0)]], null);
  t.gleich(v7.gewicht, 50, 'RIR 0: nicht "alle oben", Gewicht bleibt');
  t.gleich(v7.wdhZiel, [12, 12, 12], 'RIR 0: +1 Wdh. im schwächsten Satz, auf wdh_max gedeckelt');

  // ------------------------------------------------------------ Gym: Bestwerte
  t.gruppe('Gym: neue Bestwerte');
  const bw1 = C.neueBestwerte(
    [{ uebung_id: 'bank', gewicht: 100, wdh: 8, typ: 'arbeit' }],
    [{ uebung_id: 'bank', gewicht: 100, wdh: 5, typ: 'arbeit' }],
  );
  t.gleich(bw1, [{ uebung_id: 'bank', e1rm: 126.7, vorher: 116.7 }], 'höheres e1RM als Bestwert erkannt');
  t.gleich(C.neueBestwerte(
    [{ uebung_id: 'bank', gewicht: 100, wdh: 5, typ: 'arbeit' }],
    [{ uebung_id: 'bank', gewicht: 100, wdh: 5, typ: 'arbeit' }],
  ), [], 'gleiches e1RM ist kein neuer Bestwert');
  t.gleich(C.neueBestwerte(
    [{ uebung_id: 'bank', gewicht: 150, wdh: 10, typ: 'aufwaermen' }],
    [],
  ), [], 'Aufwärmsätze zählen nicht');
  t.gleich(C.neueBestwerte(
    [{ uebung_id: 'x', gewicht: 50, wdh: 10, typ: 'arbeit' }],
    [],
  ), [{ uebung_id: 'x', e1rm: 66.7, vorher: null }], 'erste Einheit einer Übung = Bestwert, vorher null');
}
