import { mergeKatalog, ueberschreibung, baueHistorie, historie, aufwaermModus, planAus, zeilen, vorschlagFuer,
  laufendesTraining, startTraining, beendeTraining, speichereSatz, zusammenfassung, trainingsText, bestwerteListe, zeitPhase } from '../gym.js';

function fakeDb(start = {}) {
  const t = { uebungen: [], trainings: [], saetze: [], ...start };
  let n = 0;
  return {
    t,
    neueId: (p) => `${p}-${++n}`,
    async all(tab, f) { return t[tab].filter((r) => !r.geloescht && (!f || f(r))); },
    async byDatum(tab, d) { return t[tab].filter((r) => !r.geloescht && r.datum === d); },
    async put(tab, row) { const i = t[tab].findIndex((r) => r.id === row.id); const r = { ...row, geloescht: false }; if (i >= 0) t[tab][i] = r; else t[tab].push(r); return r; },
    async patch(tab, id, f) { let r = t[tab].find((x) => x.id === id); if (!r) { r = { id }; t[tab].push(r); } Object.assign(r, f); return r; },
    async remove(tab, id) { const r = t[tab].find((x) => x.id === id); if (r) r.geloescht = true; },
  };
}

const KAT = [
  { id: 'a', name: 'A', kategorie: 'beine', typ: 'grund', schrittweite_kg: 5, wdh_min: 8, wdh_max: 12 },
  { id: 'b', name: 'B', kategorie: 'beine', typ: 'isolation', schrittweite_kg: 5, wdh_min: 10, wdh_max: 15 },
  { id: 'c', name: 'C', kategorie: 'beine', typ: 'grund', schrittweite_kg: 5, wdh_min: 8, wdh_max: 12 },
  { id: 'd', name: 'D', kategorie: 'brust', typ: 'grund', schrittweite_kg: 5, wdh_min: 8, wdh_max: 12 },
  { id: 'plank', name: 'Plank', kategorie: 'rumpf', typ: 'isolation', schrittweite_kg: 0, wdh_min: 30, wdh_max: 60, einheit: 's' },
  { id: 'erg', name: 'Ergometer', kategorie: 'cardio', typ: 'cardio', schrittweite_kg: 0, einheit: 'min' },
];
const sz = (id, tr, u, typ, nr, g, w, rir, at) => ({ id, training_id: tr, uebung_id: u, typ, satz_nr: nr, gewicht: g, wdh: w, rir, erledigt_at: at });

export default async function (t) {
  t.gruppe('Gym: Katalog-Merge');
  const m = mergeKatalog(KAT, [{ id: 'a', name: 'A', einstellung: 'Sitz 4', schrittweite_kg: 2.5 }, { id: 'x', name: 'Eigene' }, { id: 'b', name: 'B', geloescht: true, einstellung: 'nein' }]);
  t.gleich(m.length, KAT.length + 1, 'eigene Übung wird angehängt');
  t.gleich(m[0].einstellung, 'Sitz 4', 'Override ergänzt Feld');
  t.gleich(m[0].schrittweite_kg, 2.5, 'Override überschreibt Feld');
  t.gleich(m[0].wdh_max, 12, 'nicht überschriebene Felder bleiben');
  t.gleich(m[1].einstellung, undefined, 'gelöschter Override wird ignoriert');
  const ue = ueberschreibung({ ...KAT[4] }, null, { einstellung: 'x' });
  t.gleich(ue.einheit, undefined, 'ueberschreibung enthält nur Tabellenspalten');
  t.gleich(ue.einstellung, 'x', 'ueberschreibung setzt Feld');

  t.gruppe('Gym: Historie');
  const trs = [
    { id: 't1', datum: '2026-11-20', start: '2026-11-20T08:00:00.000Z' },
    { id: 't2', datum: '2026-11-22', start: '2026-11-22T08:00:00.000Z' },
    { id: 't3', datum: '2026-11-23', start: '2026-11-23T08:00:00.000Z' },
  ];
  const ss = [
    sz('1', 't1', 'a', 'arbeit', 1, 100, 10, 2, '2026-11-20T08:10:00Z'),
    sz('2', 't2', 'a', 'arbeit', 2, 105, 8, 1, '2026-11-22T08:20:00Z'),
    sz('3', 't2', 'a', 'arbeit', 1, 105, 9, 1, '2026-11-22T08:10:00Z'),
    { ...sz('4', 't2', 'a', 'arbeit', 3, 105, 7, 0, '2026-11-22T08:30:00Z'), geloescht: true },
    sz('5', 't3', 'a', 'arbeit', 1, 110, 8, 1, '2026-11-23T08:10:00Z'),
    sz('6', 't2', 'b', 'arbeit', 1, 40, 12, null, '2026-11-22T08:40:00Z'),
  ];
  const h1 = baueHistorie(ss, trs, 't3').get('a');
  t.gleich(h1.map((g) => g.training_id), ['t2', 't1'], 'neueste Einheit zuerst, aktuelles Training ausgeschlossen');
  t.gleich(h1[0].saetze.map((s) => s.id), ['3', '2'], 'Sätze innerhalb der Einheit chronologisch, Gelöschte fehlen');
  t.gleich(h1[0].datum, '2026-11-22', 'Datum aus Training');
  t.gleich(baueHistorie(ss, trs, null).get('a').length, 3, 'ohne Ausschluss alle Einheiten');
  t.gleich(baueHistorie(ss, trs).get('b').length, 1, 'andere Übung getrennt');
  const dbH = fakeDb({ trainings: trs, saetze: ss });
  t.gleich((await historie(dbH, 'a', 't3')).length, 2, 'historie() über Fake-db');
  t.gleich((await historie(dbH, 'zzz')).length, 0, 'unbekannte Übung leer');

  t.gruppe('Gym: Aufwärm-Modus');
  const km = new Map([...KAT, { id: 'lat', kategorie: 'ruecken', typ: 'grund' }, { id: 'rud', kategorie: 'ruecken', typ: 'grund' }, { id: 'seit', kategorie: 'schulter', typ: 'isolation' }].map((u) => [u.id, u]));
  const plan = [{ uebung_id: 'lat' }, { uebung_id: 'rud' }, { uebung_id: 'seit' }];
  t.gleich([0, 1, 2].map((i) => aufwaermModus(plan, i, km)), ['grund-erst', 'grund-folge', 'iso-erst'], 'Modus je Übung im Plan');
  t.gleich(aufwaermModus([{ uebung_id: 'a' }, { uebung_id: 'b' }], 1, km), 'iso-folge', 'Isolation, Kategorie schon vorher');
  t.gleich(aufwaermModus([{ uebung_id: 'zzz' }], 0, km), 'grund-erst', 'unbekannte Übung');

  t.gruppe('Gym: Plan und Zeilen');
  const vorl = { 'kraft-a': { name: 'Kraft A', uebungen: [{ id: 'a', saetze: 3 }, { id: 'd', saetze: 2 }] } };
  const tr = { id: 'tx', vorlage: 'kraft-a' };
  t.gleich(planAus(tr, vorl, []).map((p) => p.uebung_id), ['a', 'd'], 'Plan aus Vorlage');
  t.gleich(planAus(tr, vorl, [sz('9', 'tx', 'b', 'arbeit', 1, 1, 1)]).map((p) => p.uebung_id), ['a', 'd', 'b'], 'getauschte/zusätzliche Übung aus Sätzen');
  t.gleich(planAus({ id: 'tx', extra: { plan: [{ uebung_id: 'c' }] } }, vorl, []).map((p) => p.uebung_id), ['c'], 'gespeicherter Plan hat Vorrang');

  const vErst = vorschlagFuer(KAT[0], [], null, 3);
  t.gleich(vErst.gewicht, null, 'erstes Mal: kein Gewicht');
  const zErst = zeilen({ uebung: KAT[0], vorschlag: vErst });
  t.gleich(zErst.length, 4, 'erstes Mal: 1 Technik-Zeile + 3 Arbeitssätze');
  t.gleich([zErst[0].typ, zErst[0].gewicht, zErst[0].wdh], ['aufwaermen', null, 10], 'erstes Mal ohne Gewicht: Aufwärmzeile gewicht null, 10 Wdh.');
  const einh = [[sz('1', 'x', 'a', 'arbeit', 1, 100, 12, 1), sz('2', 'x', 'a', 'arbeit', 2, 100, 12, 1), sz('3', 'x', 'a', 'arbeit', 3, 100, 12, 2)]];
  const v2 = vorschlagFuer(KAT[0], einh, null, 3);
  t.gleich(v2.gewicht, 105, 'Vorschlag: alle oben -> +Schritt');
  const z2 = zeilen({ uebung: KAT[0], vorschlag: v2 });
  t.gleich(z2.filter((r) => r.typ === 'aufwaermen').length, 3, 'drei Aufwärmsätze (grund-erst)');
  t.gleich(z2.filter((r) => r.typ === 'arbeit').length, 3, 'drei Arbeitssätze');
  t.gleich(zeilen({ uebung: KAT[0], vorschlag: v2, modus: 'grund-folge' }).filter((r) => r.typ === 'aufwaermen').length, 1, 'grund-folge: 1 Aufwärmsatz');
  const z3 = zeilen({ uebung: KAT[0], vorschlag: v2, erledigt: [sz('s', 'tx', 'a', 'arbeit', 1, 107.5, 8, null)], extra: 1 });
  t.gleich(z3.filter((r) => r.typ === 'arbeit').length, 4, '+ Satz erhöht Anzahl');
  t.wahr(z3.find((r) => r.typ === 'arbeit' && r.nr === 1).erledigt, 'erledigter Satz verknüpft');
  t.gleich(z3.find((r) => r.typ === 'arbeit' && r.nr === 2).gewicht, 107.5, 'Folgesatz übernimmt tatsächliches Gewicht');
  const zp = zeilen({ uebung: KAT[4], vorschlag: vorschlagFuer(KAT[4], [], null, 2) });
  t.gleich(zp.length, 2, 'Plank: 2 Arbeitssätze, kein Aufwärmen');
  const zc = zeilen({ uebung: KAT[5], vorschlag: vorschlagFuer(KAT[5], [], null) });
  t.gleich([zc.length, zc[0].wdh], [1, 20], 'Cardio: eine Zeile, Standard 20 min');

  t.gruppe('Gym: Training anlegen/beenden');
  const db = fakeDb();
  t.gleich(await laufendesTraining(db, '2026-11-23'), null, 'kein laufendes Training');
  const tn = await startTraining(db, 'kraft-a', vorl, new Date('2026-11-23T10:00:00'));
  t.gleich([tn.art, tn.titel, tn.quelle, tn.vorlage], ['kraft', 'Kraft A', 'app', 'kraft-a'], 'Training angelegt');
  t.gleich(tn.extra.plan.length, 2, 'Plan im Training gespeichert');
  t.gleich((await laufendesTraining(db, tn.datum))?.id, tn.id, 'laufendes Training gefunden');
  const frei = await startTraining(db, null, vorl, new Date('2026-11-24T10:00:00'));
  t.gleich([frei.titel, frei.vorlage], ['Freies Training', 'frei'], 'freies Training');
  await speichereSatz(db, { training: tn, uebung_id: 'a', reihenfolge: 1, typ: 'arbeit', nr: 1, gewicht: 100, wdh: 10, rir: 1, pause_s: 150, jetzt: new Date('2026-11-23T10:05:00') });
  await speichereSatz(db, { training: tn, uebung_id: 'a', reihenfolge: 1, typ: 'aufwaermen', nr: 1, gewicht: 50, wdh: 10, jetzt: new Date('2026-11-23T10:02:00') });
  await beendeTraining(db, tn, new Date(Date.parse(tn.start) + 62 * 60000));
  t.gleich(db.t.trainings[0].minuten, 62, 'Minuten berechnet');
  t.gleich(await laufendesTraining(db, tn.datum), null, 'beendet ist nicht mehr laufend');

  t.gruppe('Gym: Zusammenfassung');
  const vorher = baueHistorie([sz('o1', 'alt', 'a', 'arbeit', 1, 90, 10, 2, '2026-11-01T08:00:00Z')], [{ id: 'alt', datum: '2026-11-01', start: '2026-11-01T08:00:00Z', minuten: 50 }]);
  const heuteS = db.t.saetze;
  const z = zusammenfassung(db.t.trainings[0], heuteS, vorher, km, planAus(db.t.trainings[0], vorl, heuteS));
  t.gleich([z.minuten, z.anzahlSaetze, z.volumen], [62, 1, 1000], 'Dauer, Sätze (ohne Aufwärmen), Volumen');
  t.gleich(z.bestwerte.map((b) => b.uebung_id), ['a'], 'neuer Bestwert gegen Historie');
  t.gleich(z.uebungen.length, 1, 'nur Übungen mit Sätzen');
  t.gleich(z.uebungen[0].letzte.topGewicht, 90, 'Vergleich mit letzter Einheit');
  t.gleich(trainingsText(db.t.trainings[0], z).split('\n')[1], 'A: 100×10 (RIR 1)', 'Text für Claude');
  const bw = bestwerteListe(baueHistorie(ss, trs), km);
  t.gleich(bw.find((b) => b.id === 'a').verlauf.map((v) => v.datum), ['2026-11-20', '2026-11-22', '2026-11-23'], 'Bestwerte-Verlauf älteste zuerst');
  t.gleich(bw.find((b) => b.id === 'a').best, 139.3, 'bester e1RM');
  t.gruppe('Gym: Zeit-Countdown');
  t.gleich([zeitPhase(1000, 30, 1000).phase, zeitPhase(1000, 30, 1000).rest], ['vorlauf', 3], 'Vorlauf startet bei 3');
  t.gleich([zeitPhase(0, 30, 3000).phase, zeitPhase(0, 30, 3000).rest], ['lauf', 30], 'Lauf beginnt nach dem Vorlauf');
  t.gleich(zeitPhase(0, 30, 3000 + 12500), { phase: 'lauf', rest: 18, gehalten: 12 }, 'Restzeit aufgerundet, gehalten abgerundet');
  t.gleich(zeitPhase(0, 30, 40000), { phase: 'fertig', rest: 0, gehalten: 30 }, 'fertig nach Ablauf (auch bei Drift)');
}
