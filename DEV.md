# Kur-Coach – Entwickler-Schnittstellen (verbindlich für alle Module)

Statische PWA, Vanilla JS, ES-Module, kein Build. Alles liegt in `app/` (wird 1:1 auf GitHub Pages deployt,
Unterpfad z. B. `/kur-coach/` → **nur relative Pfade** verwenden, nie mit `/` beginnend).
UI Deutsch, mobile-first (390 px), iPad ab 768 px zweispaltig, Dark Mode Standard, große Tipp-Flächen
(min. 56 px hoch). **Keine Emojis/Unicode-Symbole als Icons** – Icons nur als Inline-SVG. Keine externen
Requests außer Supabase (keine CDNs, keine Webfonts).

## Dateien & Zuständigkeit
| Datei | Inhalt |
|---|---|
| `config.js` | `export const SUPABASE_URL = ''; export const SUPABASE_ANON_KEY = '';` (leer = Offline-Demo-Modus) |
| `vendor/supabase.js` | gebündeltes supabase-js, `import { createClient } from './vendor/supabase.js'` |
| `calc.js` | reine Rechenfunktionen (fertig, siehe Exporte unten) |
| `db.js` | IndexedDB + Sync-Queue + Auth (API unten) |
| `kurlog.js` | KURLOG-Parser/Import + KURKONTEXT-Erzeugung |
| `app.js`, `ui/*.js`, `styles.css`, `index.html` | Oberfläche, Router |
| `gym.js` | Gym-Logger (M2) |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |
| `data/checklisten.json`, `data/uebungen.json` | Startdaten |
| `tests.html`, `tests/*.test.js` | Tests im Browser |

## Tabellen (Supabase = IndexedDB-Stores, gleiche Feldnamen; siehe ../supabase/schema.sql)
Alle Zeilen haben `updated_at` (ISO, vom Gerät gesetzt), `server_at` (vom Server), `geloescht` (Soft-Delete).
| Tabelle | lokaler Schlüssel (`key`) | onConflict | wichtige Felder |
|---|---|---|---|
| `profil` | immer `'me'` | `user_id` | geschlecht 'm'/'w', geburtsjahr, groesse_cm, defizit_prozent, protein_g_pro_kg, schritte_ziel, kur_start (YYYY-MM-DD), kur_tage, vorgaben_arzt, einstellungen (jsonb: `checklisten`, `slot_zeiten`, `onboarding_fertig`, `aerztliche_sperre: ['sauna']`) |
| `mahlzeiten` | `id` | `id` | datum, zeit 'HH:MM', typ, beschreibung, komponenten, kcal, protein, kh, fett, konfidenz, notiz, extra |
| `messungen` | `id` | `id` | datum, zeit, bedingung (nuechtern/nach_sauna/nach_sport/sonstiges), gewicht, kfa, fettmasse, muskelmasse, koerperwasser, viszeralfett, ruhepuls, quelle |
| `uebungen` | `id` | `id` | Overrides/eigene Übungen zum Katalog `data/uebungen.json` |
| `trainings` | `id` | `id` | datum, start/ende (ISO timestamptz), minuten, art, titel, vorlage, intensitaet, kcal_watch, puls_avg, quelle, notiz |
| `saetze` | `id` | `id` | training_id, uebung_id, reihenfolge, satz_nr, typ (aufwaermen/arbeit/backoff/drop), gewicht, wdh, rir, pause_s, erledigt_at, notiz |
| `tageswerte` | `datum` | `user_id,datum` | schritte, aktive_kcal, ruhepuls, hrv_ms, schlaf_min, alkohol, stimmung_1_5, energie_1_5, hunger_1_5, wasser_ml, notiz … (**Patch-Semantik**, Server nimmt bei schritte das Maximum) |
| `termine` | `id` | `id` | datum, start 'HH:MM', ende, titel, kategorie (therapie/arzt/kurs/sonstiges), ort, notiz |
| `checklisten_status` | `` `${datum}|${punkt_id}` `` | `user_id,datum,punkt_id` | datum, punkt_id, slot, erledigt_at; Abhaken rückgängig = `remove()` |

## db.js – API
```js
import * as db from './db.js';
await db.init();                       // IDB öffnen, Supabase-Client (falls config gesetzt), Sync-Schleife starten
db.istOnlineModus()                    // true, wenn SUPABASE_URL gesetzt ist
await db.session()                     // Supabase-Session oder null (im Demo-Modus: {demo:true})
db.onAuth(cb)                          // cb(session|null)
await db.loginLink(email)              // Magic Link + Code per Mail (signInWithOtp, emailRedirectTo = aktuelle App-URL ohne Query/Hash)
await db.loginCode(email, code)        // 6-stelliger Code aus der Mail (verifyOtp type 'email')
await db.logout()

await db.put(table, row)               // ganze Zeile speichern (lokal sofort, dann Queue). Setzt updated_at, geloescht=false. -> row
await db.patch(table, key, felder)     // Felder ändern; legt Zeile an, wenn sie fehlt (tageswerte: key = datum). -> row
await db.remove(table, key)            // Soft-Delete
await db.get(table, key)               // -> row | undefined (auch gelöschte nicht: undefined)
await db.all(table, filterFn?)         // -> rows ohne gelöschte
await db.byDatum(table, datum)         // -> rows mit row.datum === datum
db.neueId(prefix)                      // eindeutige Text-ID, z. B. 'mz-lx3k9a-4f2c'
db.onChange(cb)                        // cb({table}) nach lokalem Schreiben ODER Pull. -> unsubscribe()

await db.sync()                        // Queue senden + Änderungen holen. -> {gesendet, geholt, fehler}
db.syncStatus()                        // {online:bool, offen:int, letzterSync:ISO|null, fehler:string|null, angemeldet:bool}
db.onSyncStatus(cb)                    // -> unsubscribe()
await db.rpc(name, args)               // supabase.rpc, wirft Error mit deutscher Meldung
await db.exportAlles()                 // {version:1, exportiert_at, tabellen:{name:[rows]}}
await db.importBackup(obj)             // Rows einspielen (put je Zeile, neuerer updated_at gewinnt)
await db.lokalLeeren()                 // IDB komplett leeren (nach Rückfrage in der UI)
```

## calc.js – Exporte (fertig)
`MET, runde, zahl, isoDatum, tageZwischen, addTage, kurTag(kurStart, datum, kurTage)->{tag,status,von}, alter,
bmrMifflin, bmrKatch, fettfreieMasse, grundumsatz(profil, messung, datum)->{mifflin,katch,wert},
trainingKcal, schritteKcal, gesamtumsatz({bmr,aktiveKcal,schritte,gewicht,trainings})->{wert,quelle},
kcalZiel, makros(kcal,gewicht,proteinGkg)->{protein,fett,kh}, schritteZiel,
tagesziele({profil,messung,tag,trainings,datum})->{grundumsatz,umsatz,kcal,makros,schritte},
summeMahlzeiten(rows)->{kcal,protein,kh,fett}, warnungZuWenig,
SLOTS, SLOT_NAMEN, SLOT_START, slotNachUhrzeit(date, starts), istSlot, zeitZuMin, tagesAnteil,
bedingungErfuellt(wenn, ctx{schritte,proteinIst,proteinZiel,termine,jetzt,aerztlicheSperre}),
terminPunkte(termine, jetzt, stunden)->[{id,text,termin:true}], streak,
e1rm, aufSchritt(gewicht,schritt,modus), aufwaermsaetze(gewicht,schritt,nurEiner), pausenDauer(satzTyp,uebungTyp),
einheitZusammenfassung(saetze), vorschlag(uebung, einheitenNeuesteZuerst, readiness)->{gewicht,saetze,wdhMin,wdhMax,wdhZiel[],grund,hinweis},
letztesMalText(saetze), neueBestwerte(heute, historie)`

## Tests
`tests.html` lädt alle Module aus `tests/*.test.js` (Liste in tests.html). Jedes Modul:
```js
export default function (t) {
  t.gruppe('Name');
  t.gleich(ist, soll, 'Beschreibung');      // deep-equal via JSON
  t.nahe(ist, soll, toleranz, 'Beschreibung');
  t.wahr(bedingung, 'Beschreibung');
}
```
Ergebnis oben als „X von Y bestanden“, Fehlschläge rot mit ist/soll. Zusätzlich `window.TEST_ERGEBNIS = {bestanden, gesamt, fehler:[...]}` setzen (für automatisierte Prüfung).
