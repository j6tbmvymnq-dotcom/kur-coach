import { trainingsExport, pruefePlan, speicherePlan } from '../plan.js';

const KAT = new Map([
  ['latzug', { id: 'latzug', name: 'Latzug', kategorie: 'ruecken', wdh_min: 8, wdh_max: 12 }],
  ['seitheben-kh', { id: 'seitheben-kh', name: 'Seitheben', kategorie: 'schulter', wdh_min: 12, wdh_max: 20 }],
  ['bizeps-kabel', { id: 'bizeps-kabel', name: 'Bizeps Kabel', kategorie: 'arme', wdh_min: 10, wdh_max: 15 }],
]);
const VORL = { 'ok-a': { name: 'Oberkörper A', uebungen: [{ id: 'latzug', saetze: 3 }, { id: 'seitheben-kh', saetze: 4 }, { id: 'bizeps-kabel', saetze: 2 }] } };

export default function (t) {
  t.gruppe('Trainingsexport');
  const text = trainingsExport({
    profil: { kur_start: '2026-11-25' },
    heute: '2026-11-26',
    katalogMap: KAT, vorlagen: VORL,
    trainings: [
      { id: 'k1', datum: '2026-11-26', vorlage: 'ok-a', titel: 'Oberkörper A', art: 'kraft', minuten: 52 },
      { id: 'h1', datum: '2026-11-26', art: 'schwimmen', titel: 'Schwimmen', minuten: 30, kcal_watch: 240, quelle: 'apple-health' },
    ],
    saetze: [
      { training_id: 'k1', uebung_id: 'latzug', typ: 'aufwaermen', gewicht: 30, wdh: 10, reihenfolge: 1, satz_nr: 1 },
      { training_id: 'k1', uebung_id: 'latzug', typ: 'arbeit', gewicht: 60, wdh: 10, rir: 2, reihenfolge: 1, satz_nr: 2 },
      { training_id: 'k1', uebung_id: 'latzug', typ: 'arbeit', gewicht: 60, wdh: 9, rir: 1, reihenfolge: 1, satz_nr: 3 },
      { training_id: 'k1', uebung_id: 'seitheben-kh', typ: 'arbeit', gewicht: 10, wdh: 15, reihenfolge: 2, satz_nr: 1 },
    ],
    tageswerte: [{ datum: '2026-11-26', schritte: 9000, ruhepuls: 55, hrv_ms: 61.4, schlaf_min: 420 }],
  });
  t.wahr(text.startsWith('TRAININGSLOG v1'), 'Kopfzeile TRAININGSLOG v1');
  t.wahr(text.includes('Latzug: 60×10 R2, 60×9 R1'), 'Arbeitssätze mit RIR, Aufwärmen weggelassen');
  t.wahr(!text.includes('30×10'), 'Aufwärmsatz nicht im Export');
  t.wahr(text.includes('Kurwoche 1: ruecken 2, schulter 1'), 'harte Sätze je Muskelgruppe');
  t.wahr(/Schwimmen 30 min 240 kcal.*\(Health\)/.test(text), 'Health-Training unter Ausdauer');
  t.wahr(text.includes('2026-11-26: 9000 | 55 | 61 | 7 | –'), 'Erholungszeile');
  t.wahr(text.includes('ok-a Oberkörper A: latzug 3×8–12'), 'aktueller Plan im Export');

  t.gruppe('Planänderung prüfen');
  const g = pruefePlan({
    vorlagen: { 'ok-a': { uebungen: [{ id: 'latzug', saetze: 4 }, { id: 'seitheben-kh', saetze: 4 }, { id: 'face-pull-neu', saetze: 3 }, { id: 'quatsch', saetze: 2 }] } },
    uebungen: [{ id: 'face-pull-neu', name: 'Face Pull', kategorie: 'schulter', wdh_min: 12, wdh_max: 20 }, { id: 'bizeps-kabel', wdh_min: 8, wdh_max: 12 }],
    begruendung: 'Mehr Rückenvolumen',
  }, KAT, VORL);
  t.gleich(g.vorlagen['ok-a'].uebungen.map((p) => p.id), ['latzug', 'seitheben-kh', 'face-pull-neu'], 'unbekannte Übung verworfen, neue akzeptiert');
  t.wahr(g.vorlagen['ok-a'].name === 'Oberkörper A', 'Name der bestehenden Vorlage bleibt');
  t.wahr(g.warnungen.some((w) => w.includes('quatsch')), 'Warnung für unbekannte Übung');
  t.wahr(g.aenderungen.some((a) => a.includes('Latzug 3 → 4 Sätze') && a.includes('+ Face Pull 3 Sätze') && a.includes('− Bizeps Kabel')), 'Änderungstext der Vorlage');
  t.wahr(g.aenderungen.some((a) => a.includes('Bizeps Kabel: 10–15 → 8–12 Wdh')), 'Änderung Wiederholungsbereich');
  t.wahr(g.aenderungen.some((a) => a.startsWith('Neue Übung: Face Pull')), 'neue Übung genannt');
  const g2 = pruefePlan({ vorlagen: { 'ok-a': { uebungen: [{ id: 'latzug', saetze: 99 }] } } }, KAT, VORL);
  t.gleich(g2.vorlagen['ok-a'].uebungen[0].saetze, 8, 'Satzzahl auf 1–8 begrenzt');
  const g3 = pruefePlan({ vorlagen: { neu: { uebungen: [{ id: 'latzug', saetze: 3 }] } } }, KAT, VORL);
  t.wahr(!g3.vorlagen.neu && g3.warnungen.length === 1, 'neue Vorlage ohne Namen abgelehnt');

  t.gruppe('Planänderung speichern');
  const speicher = { profil: { me: { einstellungen: { ziel_modus: 'rekomposition' } } }, uebungen: {} };
  const fakeDb = {
    get: async (tab, k) => speicher[tab][k],
    put: async (tab, row) => { speicher[tab][row.id ?? 'me'] = row; },
    patch: async (tab, k, f) => { speicher[tab][k] = { ...(speicher[tab][k] || {}), ...f }; },
  };
  const g4 = pruefePlan({ vorlagen: { 'ok-a': { uebungen: [{ id: 'latzug', saetze: 4 }] } } }, KAT, VORL);
  return speicherePlan(g4, fakeDb, new Date('2026-11-27T08:00:00Z')).then(() => {
    const e = speicher.profil.me.einstellungen;
    t.gleich(e.plan.vorlagen['ok-a'].uebungen, [{ id: 'latzug', saetze: 4 }], 'Vorlage im Profil gespeichert');
    t.wahr(e.ziel_modus === 'rekomposition', 'andere Einstellungen bleiben erhalten');
    t.wahr(e.plan.verlauf.length === 1 && e.plan.stand.startsWith('2026-11-27'), 'Verlauf und Stand gespeichert');
  });
}
