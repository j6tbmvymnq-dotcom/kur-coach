import { parseKurlog, normalisiere, vorschauText, uebernehmen, kurkontext } from '../kurlog.js';

const BEISPIEL_JSON = `{
  "version": 1,
  "mahlzeiten": [
    {"id":"2026-11-29-fruehstueck","datum":"2026-11-29","zeit":"07:45","typ":"fruehstueck","beschreibung":"3 Rühreier, Magerquark","kcal":640,"protein":52,"kh":48,"fett":26,"konfidenz":"mittel"},
    {"id":"2026-11-29-mittag","datum":"2026-11-29","zeit":"12:30","typ":"mittag","beschreibung":"Linsensuppe, 1 Apfel","kcal":420,"protein":22,"kh":60,"fett":8,"konfidenz":"mittel"},
    {"id":"2026-11-29-abendessen","datum":"2026-11-29","zeit":"18:30","typ":"abendessen","beschreibung":"Hähnchenbrust, Reis","kcal":780,"protein":62,"kh":65,"fett":24,"konfidenz":"mittel"}
  ],
  "messungen": [
    {"id":"2026-11-29-0645","datum":"2026-11-29","zeit":"06:45","bedingung":"nuechtern","gewicht":"87,9","kfa":21.4,"fettmasse":18.8,"muskelmasse":65.1,"viszeralfett":9,"ruhepuls":58,"quelle":"S400-Screenshot"}
  ],
  "trainings": [
    {"id":"2026-11-29-kraft-a","datum":"2026-11-29","start":"14:00","minuten":60,"art":"kraft","titel":"Kraft A","intensitaet":"hart","uebungen":[{"name":"Beinpresse","saetze":3,"wdh":10,"gewicht":140}]},
    {"id":"2026-11-29-ried","datum":"2026-11-29","start":"08:30","minuten":75,"art":"gehen","titel":"Runde Wurzacher Ried","intensitaet":"locker"}
  ],
  "schritte": [{"id":"2026-11-29","datum":"2026-11-29","anzahl":21400}],
  "tag": {"datum":"2026-11-29","alkohol":false,"schlaf_stunden":7.5,"stimmung_1_5":4,"energie_1_5":4,"hunger_1_5":3}
}`;

const MIT_FENCE = 'Hier dein Tagesabschluss für Tag 5:\n\n```\nKURLOG v1\n' + BEISPIEL_JSON + '\n```\n\nMorgen: Protein ist top.';
const OHNE_FENCE = 'KURLOG v1\n' + BEISPIEL_JSON;

function lokalIso(y, mo, d, h, mi) { return new Date(y, mo - 1, d, h, mi, 0).toISOString(); }

export default function (t) {
  t.gruppe('KURLOG Parser');

  const r1 = parseKurlog(MIT_FENCE);
  t.wahr(r1.ok && r1.fehler == null, 'Beispiel mit Fence und Text davor/danach wird gelesen');
  t.gleich(r1.daten.mahlzeiten.length, 3, 'Beispiel: 3 Mahlzeiten');

  const r2 = parseKurlog(OHNE_FENCE);
  t.wahr(r2.ok, 'Beispiel ohne Fences wird gelesen');

  const r3 = parseKurlog('KURLOG v1\n{"mahlzeiten":[{"id":"a","datum":"2026-11-29","kcal":100,},],}');
  t.wahr(r3.ok && r3.daten.mahlzeiten[0].kcal === 100, 'Trailing Commas werden toleriert');

  const r4 = parseKurlog('KURLOG v1\n{„mahlzeiten“:[{„id“:„a“,„datum“:„2026-11-29“,„kcal“:100}]}');
  t.wahr(r4.ok && r4.daten.mahlzeiten[0].id === 'a', 'Typografische Anführungszeichen werden toleriert');

  const r5 = parseKurlog('KURLOG v1\n{"mahlzeiten":[{"id":"a","datum":"2026-11-29","beschreibung":"Suppe { mit } Klammer"}]} danach { Text');
  t.wahr(r5.ok && r5.daten.mahlzeiten[0].beschreibung === 'Suppe { mit } Klammer', 'Klammern in Strings stören die Klammerzählung nicht');

  const r6 = parseKurlog('Erst:\nKURLOG v1\n{"mahlzeiten":[{"id":"a","datum":"2026-11-29"}]}\nDann:\nKURLOG v1\n{"mahlzeiten":[{"id":"b","datum":"2026-11-29"}],"tag":{"datum":"2026-11-29","notiz":"x"}}');
  t.wahr(r6.ok && r6.daten.mahlzeiten.length === 2 && r6.daten.tag.length === 1, 'Mehrere Blöcke werden gemerged');

  const f1 = parseKurlog('Hallo, nichts hier');
  t.wahr(!f1.ok && /KURLOG/.test(f1.fehler), 'Fehler ohne KURLOG-Marker (deutsch)');
  const f2 = parseKurlog('KURLOG v1\n{"mahlzeiten":[{"id":"a"');
  t.wahr(!f2.ok && /unvollständig/.test(f2.fehler), 'Fehler bei abgeschnittenem JSON');
  const f3 = parseKurlog('KURLOG v1\n{"mahlzeiten": [oops]}');
  t.wahr(!f3.ok && /fehlerhaft/.test(f3.fehler), 'Fehler bei kaputtem JSON');

  t.gruppe('KURLOG normalisieren');

  const n = normalisiere(r1.daten);
  t.gleich([n.mahlzeiten.length, n.messungen.length, n.trainings.length, n.termine.length, n.tageswerte.length], [3, 1, 2, 0, 1], 'Beispiel: Anzahl je Tabelle');
  t.gleich(n.warnungen, [], 'Beispiel: keine Warnungen');
  t.gleich(n.messungen[0].gewicht, 87.9, 'Komma-Zahl "87,9" wird zu 87.9');
  t.gleich(n.tageswerte[0].schlaf_min, 450, 'schlaf_stunden 7.5 wird zu schlaf_min 450');
  t.gleich(n.tageswerte[0].schritte, 21400, 'schritte[] landet in tageswerte.schritte (zusammengeführt mit tag)');
  t.gleich(n.tageswerte[0].stimmung_1_5, 4, 'tag-Felder bleiben erhalten');

  const kraft = n.trainings.find(x => x.id === '2026-11-29-kraft-a');
  t.gleich(kraft.start, lokalIso(2026, 11, 29, 14, 0), 'Training start wird lokale ISO-Zeit');
  t.gleich(kraft.minuten, 60, 'Training minuten bleiben');
  t.gleich(kraft.extra.uebungen[0].name, 'Beinpresse', 'uebungen landen in extra');

  const nTagArray = normalisiere({ tag: [{ datum: '2026-11-29', schlaf_stunden: '6,5' }, { datum: '2026-11-30', hunger_1_5: 2 }, { datum: '2026-11-29', energie_1_5: 3 }] });
  t.gleich(nTagArray.tageswerte.length, 2, 'tag als Array: gleiche Daten werden zusammengeführt');
  t.gleich(nTagArray.tageswerte[0].schlaf_min, 390, 'tag-Array: Komma-Stunden "6,5" -> 390 min');
  t.gleich(nTagArray.tageswerte[0].energie_1_5, 3, 'tag-Array: Felder aus beiden Einträgen vereint');

  const nExtra = normalisiere({ mahlzeiten: [{ id: 'x', datum: '2026-11-29', kcal: '1.250,5', wein: 'nein', bewertung: 3 }] });
  t.gleich(nExtra.mahlzeiten[0].extra, { wein: 'nein', bewertung: 3 }, 'Unbekannte Felder landen in extra');
  t.gleich(nExtra.mahlzeiten[0].kcal, 1250.5, 'Zahl mit Tausenderpunkt und Komma');

  const nOhne = normalisiere({ mahlzeiten: [{ id: 'x', kcal: 5 }, { id: 'y', datum: '2026-11-29', kcal: 6 }] });
  t.gleich(nOhne.mahlzeiten.length, 1, 'Eintrag ohne Datum wird verworfen');
  t.wahr(nOhne.warnungen.length === 1 && /Datum/.test(nOhne.warnungen[0]), 'Warnung für fehlendes Datum');

  const ohneId = { mahlzeiten: [{ datum: '2026-11-29', typ: 'Frühstück', kcal: 1 }], trainings: [{ datum: '2026-11-29', titel: 'Kraft A', start: '14:00' }], termine: [{ datum: '2026-11-30', start: '09:30', titel: 'Moorbad' }] };
  const a = normalisiere(ohneId), b = normalisiere(JSON.parse(JSON.stringify(ohneId)));
  t.wahr(!!a.mahlzeiten[0].id && !!a.trainings[0].id && !!a.termine[0].id, 'Einträge ohne id bekommen eine id');
  t.gleich(a.trainings[0].id, b.trainings[0].id, 'Erzeugte IDs sind deterministisch (idempotent)');
  t.gleich([a.mahlzeiten[0].id, a.trainings[0].id, a.termine[0].id], [b.mahlzeiten[0].id, b.trainings[0].id, b.termine[0].id], 'Alle erzeugten IDs stimmen bei Wiederholung überein');
  t.gleich(a.trainings[0].id, '2026-11-29-kraft-a', 'Training-ID aus datum+titel');

  t.gruppe('KURLOG Vorschau und Übernahme');

  t.gleich(vorschauText(n), '3 Mahlzeiten, 1 Messung, 2 Trainings, 1 Tageswert werden übernommen', 'Vorschautext Plural/Singular gemischt');
  t.gleich(vorschauText({ mahlzeiten: [{}], messungen: [], trainings: [], termine: [], tageswerte: [] }), '1 Mahlzeit wird übernommen', 'Vorschautext einzelner Eintrag');
  t.gleich(vorschauText({ mahlzeiten: [], termine: [{}, {}] }), '2 Termine werden übernommen', 'Vorschautext lässt leere Kategorien weg');

  const log = [];
  const speicher = {};
  const fakeDb = {
    async put(tab, row) { log.push(['put', tab, row.id]); (speicher[tab] ||= {})[row.id] = row; return row; },
    async patch(tab, key, felder) { log.push(['patch', tab, key]); speicher[tab] ||= {}; speicher[tab][key] = { ...(speicher[tab][key] || {}), ...felder }; return speicher[tab][key]; },
  };
  return uebernehmen(n, fakeDb).then(async anzahl => {
    t.gleich(anzahl, 7, 'uebernehmen gibt Anzahl zurück');
    t.wahr(log.some(l => l[0] === 'patch' && l[1] === 'tageswerte' && l[2] === '2026-11-29'), 'tageswerte per patch(datum)');
    await uebernehmen(n, fakeDb);
    t.gleich(Object.keys(speicher.mahlzeiten).length, 3, 'Zweiter Import erzeugt keine Duplikate (idempotent)');

    t.gruppe('KURKONTEXT');
    const s = {
      tag: 5, kurTage: 21, datum: '2026-11-29',
      profil: { geschlecht: 'm', alter: 34, groesse_cm: 182 },
      ziele: { kcal: 2150, protein: 180, schritte: 18000, training: 'Kraft A + 60 min Rad' },
      gestern: { kcal: 2230, protein: 171, schritte: 21400, training: 'Tabata, 90 min Gehen' },
      trend: { gewichtVon: 88.4, gewichtBis: 87.6, kfaVon: 21.8, kfaBis: 21.3 },
      plan: [{ start: '08:00', titel: 'Frühstück' }, { start: '09:30', titel: 'Moorbad' }, { start: '20:00', titel: 'Sauna' }],
      hinweise: ['Moorbad heute → keine Sauna direkt danach (falls Arzt so vorgibt)'],
    };
    const soll = [
      'KURKONTEXT v1',
      'tag: 5/21 | datum: 2026-11-29',
      'profil: m, 34 J, 182 cm',
      'ziele_heute: kcal 2150 | protein 180 g | schritte 18.000 | training: Kraft A + 60 min Rad',
      'gestern: kcal 2230 | protein 171 g | schritte 21.400 | training: Tabata, 90 min Gehen',
      'trend_7d: gewicht 88,4 → 87,6 kg (Ø) | kfa 21,8 → 21,3 % (Ø)',
      'plan_heute: 08:00 Frühstück | 09:30 Moorbad | 20:00 Sauna',
      'hinweise: Moorbad heute → keine Sauna direkt danach (falls Arzt so vorgibt)',
    ].join('\n');
    t.gleich(kurkontext(s), soll, 'kurkontext: exaktes Format');

    const leer = kurkontext({ tag: 1, kurTage: 21, datum: '2026-11-25', profil: { geschlecht: 'm', alter: 34, groesse_cm: 182 }, ziele: { kcal: 2000 }, plan: [] });
    t.wahr(/gestern: kcal – \| protein – g \| schritte – \| training: –/.test(leer), 'kurkontext: fehlende Werte als Strich');
    t.wahr(!/trend_7d|hinweise/.test(leer), 'kurkontext: trend und hinweise entfallen, wenn leer');
    t.wahr(/plan_heute: –/.test(leer), 'kurkontext: leerer Plan als Strich');
  });
}
