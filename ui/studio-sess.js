// Studio: laufendes Training (Übungsansicht, Satzliste, Tauschen, Beenden)
import * as calc from '../calc.js';
import * as gym from '../gym.js';
import { icon } from './icons.js';
import { sheet, bestaetigen, feld, zahlInput } from './sheet.js';
import { h, toast, zf1, zfEingabe, fehlerText } from './util.js';
import { ladeReadiness } from './daten.js';
import { startPause, stoppe, timerWiederherstellen, wakeLockAn, wakeLockAus, entsperreAudio, piep } from './studio-timer.js';

const KATEGORIEN = { beine: 'Beine', ruecken: 'Rücken', brust: 'Brust', schulter: 'Schulter', arme: 'Arme', rumpf: 'Rumpf', cardio: 'Cardio' };
const TECHNIK_HINWEIS = 'Erstes Mal: leichter Technik-Satz. Danach Satz für Satz um 5–10 % steigern (Isolation 2,5–5 %), bis 8–12 Wdh. mit 1–2 Wdh. Reserve gehen – ab diesem Gewicht zählen die Arbeitssätze.';
const katName = (k) => KATEGORIEN[k] || k || 'Sonstige';

export async function zeigeSession(S, training) {
  const db = S.db;
  let saetze = await db.all('saetze', (s) => s.training_id === training.id);
  const hist = await gym.historieAlle(db, training.id);
  let plan = gym.planAus(training, S.vorlagen, saetze);
  let idx = 0;
  const extra = {};              // uebung_id -> zusätzliche Arbeitssätze
  const drafts = {};             // `${uebung_id}|${typ}|${nr}` -> {gewicht, wdh, rir}
  let aktivKey = null;
  let readiness = null;
  try { readiness = (await ladeReadiness()).ampel; } catch { readiness = null; }

  wakeLockAn();
  timerWiederherstellen();

  const uebungVon = (id) => S.katalog.get(id) || { id, name: id, kategorie: null, typ: 'grund', schrittweite_kg: 2.5, wdh_min: 8, wdh_max: 12 };
  const eigene = (id) => saetze.filter((s) => s.uebung_id === id && !s.geloescht);

  function daten(i) {
    const p = plan[i];
    const u = uebungVon(p.uebung_id);
    const einheiten = (hist.get(u.id) || []).map((g) => g.saetze);
    const v = gym.vorschlagFuer(u, einheiten, readiness, p.saetze);
    const rows = gym.zeilen({ uebung: u, vorschlag: v, modus: gym.aufwaermModus(plan, i, S.katalog), erledigt: eigene(u.id), extra: extra[u.id] || 0 });
    return { p, u, v, rows, einheiten };
  }

  async function planSpeichern() { try { await gym.speicherePlan(db, training, plan); } catch (e) { toast('Plan nicht gespeichert: ' + fehlerText(e)); } }

  // ------------------------------------------------------------ Aktionen
  async function haken(row, d, dr) {
    const { u, v } = d;
    const cardio = gym.istCardio(u), ohne = gym.ohneGewicht(u);
    const gewicht = cardio ? null : ohne ? 0 : calc.zahl(dr.gewicht);
    const wdh = calc.zahl(dr.wdh);
    if (!cardio && !ohne && (gewicht == null || gewicht < 0)) { toast('Bitte zuerst das Gewicht eingeben.'); return; }
    if (wdh == null || wdh <= 0) { toast(cardio ? 'Bitte die Minuten eingeben.' : 'Bitte die Wiederholungen eingeben.'); return; }
    const pause = cardio ? null : calc.pausenDauer(row.typ, u.typ);
    try {
      const s = await gym.speichereSatz(db, {
        training, uebung_id: u.id, reihenfolge: idx + 1, typ: row.typ, nr: row.nr,
        gewicht, wdh: Math.round(wdh), rir: row.typ === 'arbeit' && !cardio ? dr.rir ?? null : null, pause_s: pause,
      });
      saetze.push(s);
      delete drafts[`${u.id}|${row.typ}|${row.nr}`];
      aktivKey = null;
      if (pause) startPause(pause);
      zeichne();
    } catch (e) { toast('Satz nicht gespeichert: ' + fehlerText(e)); }
  }

  // Zeit-Übung: Vorlauf + Countdown, danach Satz über den normalen Erledigt-Weg speichern
  function startCountdown(row, d, dr) {
    const dauer = Math.round(calc.zahl(dr.wdh) || 0);
    if (dauer <= 0) { toast('Bitte zuerst die Sekunden eingeben.'); return; }
    entsperreAudio(); wakeLockAn();
    const start = Date.now();
    const titel = h('div', { class: 'pause-label' }, 'Bereit');
    const zeit = h('div', { class: 'pause-zeit countdown-zeit', role: 'timer' }, '3');
    let tick = null;
    const ende = () => { clearInterval(tick); overlay.remove(); };
    const abbrechen = () => {
      const p = gym.zeitPhase(start, dauer, Date.now());
      ende();
      if (p.gehalten > 0) { dr.wdh = p.gehalten; zeichne(); }
    };
    const overlay = h('div', { class: 'countdown-overlay', role: 'dialog', 'aria-label': 'Countdown' },
      titel, zeit, h('button', { type: 'button', class: 'btn', onclick: abbrechen }, 'Abbrechen'));
    const aktual = () => {
      const p = gym.zeitPhase(start, dauer, Date.now());
      if (p.phase === 'fertig') { ende(); piep(); dr.wdh = p.gehalten; haken(row, d, dr); return; }
      if (p.phase === 'lauf' && titel.textContent !== 'Halten') piep(); // Startsignal nach dem Vorlauf
      titel.textContent = p.phase === 'vorlauf' ? 'Bereit' : 'Halten';
      zeit.textContent = String(p.rest);
    };
    document.body.append(overlay);
    aktual();
    tick = setInterval(aktual, 200);
  }

  function satzBearbeiten(s, u) {
    const cardio = gym.istCardio(u), ohne = gym.ohneGewicht(u);
    sheet(`${u.name}: ${s.typ === 'aufwaermen' ? 'Aufwärmen' : 'Satz'} ${s.satz_nr}`, (body, close) => {
      const g = zahlInput(s.gewicht), w = zahlInput(s.wdh, { ganz: true }), r = zahlInput(s.rir, { ganz: true, platzhalter: '0–4' });
      const speichern = async () => {
        const wdh = calc.zahl(w.value);
        const gew = cardio ? null : ohne ? 0 : calc.zahl(g.value);
        if (wdh == null || wdh <= 0 || (!cardio && !ohne && gew == null)) { toast('Bitte Werte prüfen.'); return; }
        const rir = calc.zahl(r.value);
        const neu = await db.put('saetze', { ...s, gewicht: gew, wdh: Math.round(wdh), rir: rir == null ? null : Math.max(0, Math.min(4, Math.round(rir))) });
        saetze = saetze.map((x) => (x.id === s.id ? neu : x));
        close(); zeichne();
      };
      const loeschen = async () => {
        await db.remove('saetze', s.id);
        saetze = saetze.filter((x) => x.id !== s.id);
        close(); zeichne();
      };
      body.append(
        (cardio || ohne) ? null : feld('Gewicht (kg)', g),
        feld(cardio ? 'Minuten' : u.einheit === 's' ? 'Sekunden' : 'Wiederholungen', w),
        (cardio || s.typ !== 'arbeit') ? null : feld('RIR (0–4, optional)', r),
        h('div', { class: 'btn-reihe' },
          h('button', { type: 'button', class: 'btn gefahr', onclick: loeschen }, h('span', { html: icon('trash', 20) }), ' Löschen'),
          h('button', { type: 'button', class: 'btn primaer', onclick: speichern }, 'Speichern')));
    });
  }

  function geraetBearbeiten(u) {
    sheet(`${u.name}: Gerät`, (body, close) => {
      const e = h('input', { type: 'text', value: u.einstellung || '', placeholder: 'z. B. Sitz 4, Rückenpolster 3', autocomplete: 'off' });
      const n = h('textarea', { rows: '3', placeholder: 'Notiz zur Übung (optional)' }, u.notiz || '');
      n.value = u.notiz || '';
      const speichern = async () => {
        const basis = (S.basis.get(u.id)) || u;
        const best = await db.get('uebungen', u.id);
        const row = gym.ueberschreibung(basis, best, { einstellung: e.value.trim() || null, notiz: n.value.trim() || null });
        await db.put('uebungen', row);
        S.katalog.set(u.id, { ...u, einstellung: row.einstellung ?? null, notiz: row.notiz ?? null });
        toast('Gespeichert');
        close(); zeichne();
      };
      body.append(feld('Geräteeinstellung', e, 'Sitzhöhe, Polster, Griff … – das nächste Mal siehst du sie hier.'), feld('Notiz', n),
        h('button', { type: 'button', class: 'btn primaer gross', onclick: speichern }, 'Speichern'));
    });
  }

  async function tauschen(u) {
    const alt = (u.alternativen || []).map((id) => S.katalog.get(id)).filter(Boolean);
    const gleiche = S.liste.filter((x) => x.kategorie === u.kategorie && x.id !== u.id && !alt.some((a) => a.id === x.id));
    sheet('Übung tauschen', (body, close) => {
      const knopf = (x) => h('button', { type: 'button', class: 'btn liste-btn', onclick: async () => {
        close();
        const vorhanden = plan.findIndex((p) => p.uebung_id === x.id);
        if (vorhanden >= 0) idx = vorhanden;
        else if (eigene(u.id).length) { plan.splice(idx + 1, 0, { uebung_id: x.id, saetze: null }); idx += 1; await planSpeichern(); toast('Neue Übung nach der angefangenen eingefügt'); }
        else { plan[idx] = { uebung_id: x.id, saetze: plan[idx].saetze }; await planSpeichern(); }
        aktivKey = null; zeichne();
      } }, h('span', null, x.name), h('small', { class: 'muted' }, x.geraet || ''));
      body.append(
        alt.length ? h('div', { class: 'klein-titel' }, 'Alternativen') : null, ...alt.map(knopf),
        gleiche.length ? h('div', { class: 'klein-titel' }, `Weitere: ${katName(u.kategorie)}`) : null, ...gleiche.map(knopf),
        !alt.length && !gleiche.length ? h('p', { class: 'muted' }, 'Keine Alternativen im Katalog.') : null);
    });
  }

  function hinzufuegen() {
    sheet('Übung hinzufügen', (body, close) => {
      const gruppen = new Map();
      for (const x of S.liste) { if (!gruppen.has(x.kategorie)) gruppen.set(x.kategorie, []); gruppen.get(x.kategorie).push(x); }
      for (const [k, arr] of gruppen) {
        body.append(h('div', { class: 'klein-titel' }, katName(k)));
        for (const x of arr) {
          body.append(h('button', { type: 'button', class: 'btn liste-btn', onclick: async () => {
            close();
            let i = plan.findIndex((p) => p.uebung_id === x.id);
            if (i < 0) { plan.push({ uebung_id: x.id, saetze: null }); i = plan.length - 1; await planSpeichern(); }
            idx = i; aktivKey = null; zeichne();
          } }, h('span', null, x.name), h('small', { class: 'muted' }, plan.some((p) => p.uebung_id === x.id) ? 'im Training' : (x.geraet || ''))));
        }
      }
    });
  }

  function uebersicht() {
    sheet('Übersicht', (body, close) => {
      plan.forEach((p, i) => {
        const d = daten(i);
        const arb = d.rows.filter((r) => r.typ === 'arbeit');
        const fertig = arb.filter((r) => r.erledigt).length;
        const komplett = fertig >= arb.length;
        body.append(h('button', { type: 'button', class: 'btn liste-btn' + (i === idx ? ' aktiv' : ''), onclick: () => { idx = i; aktivKey = null; close(); zeichne(); } },
          h('span', { class: 'uebersicht-name' }, komplett ? h('span', { class: 'fertig-haken', html: icon('check', 20) }) : null, d.u.name),
          h('small', { class: 'muted' }, `${fertig} / ${arb.length}`)));
      });
      body.append(h('button', { type: 'button', class: 'btn', onclick: () => { close(); hinzufuegen(); } }, h('span', { html: icon('plus', 20) }), ' Übung hinzufügen'));
    });
  }

  async function beenden() {
    const anzahl = saetze.filter((s) => !s.geloescht).length;
    if (!anzahl) {
      if (!(await bestaetigen('Training verwerfen', 'Es wurden keine Sätze erfasst. Das Training wird gelöscht.', 'Verwerfen'))) return;
      await db.remove('trainings', training.id);
      stoppe(); wakeLockAus(); S.zumStart();
      return;
    }
    if (!(await bestaetigen('Training beenden', `${anzahl} Sätze erfasst. Training jetzt beenden?`, 'Beenden'))) return;
    try {
      await gym.beendeTraining(db, training);
      stoppe(); wakeLockAus();
      S.zumEnde(training);
    } catch (e) { toast('Beenden fehlgeschlagen: ' + fehlerText(e)); }
  }

  // ------------------------------------------------------------ Zeichnen
  function stepper(label, wert, aendern, opts = {}) {
    const inp = h('input', { type: 'text', inputmode: opts.ganz ? 'numeric' : 'decimal', autocomplete: 'off', enterkeyhint: 'done', value: zfEingabe(wert), 'aria-label': label });
    inp.addEventListener('input', () => aendern(inp.value, true));
    const knopf = (zeichen, delta, name) => h('button', {
      type: 'button', class: 'step-btn', 'aria-label': `${label} ${name}`,
      onclick: () => { const neu = aendern(delta); inp.value = zfEingabe(neu); },
    }, h('span', { html: icon(zeichen, 28) }));
    return h('div', { class: 'stepper' }, h('span', { class: 'feld-label' }, label), h('div', { class: 'stepper-reihe' }, knopf('minus', -1, 'verringern'), inp, knopf('plus', 1, 'erhöhen')));
  }

  function aktiveZeile(row, d) {
    const { u } = d;
    const cardio = gym.istCardio(u), ohne = gym.ohneGewicht(u);
    const key = `${u.id}|${row.typ}|${row.nr}`;
    const dr = drafts[key] || (drafts[key] = { gewicht: row.gewicht, wdh: row.wdh, rir: null });
    const schritt = u.schrittweite_kg || 2.5;
    const wSchritt = u.einheit === 's' ? 5 : 1;
    const aend = (feldName, st, min) => (x, roh) => {
      if (roh) { dr[feldName] = calc.zahl(x); return dr[feldName]; }
      const alt = calc.zahl(dr[feldName]) ?? (feldName === 'gewicht' ? (d.v.gewicht ?? 0) : 0);
      dr[feldName] = Math.max(min, calc.runde(alt + x * st, 2));
      return dr[feldName];
    };
    const rir = h('div', { class: 'rir', role: 'radiogroup', 'aria-label': 'RIR' }, h('span', { class: 'feld-label' }, 'RIR (optional)'),
      h('div', { class: 'rir-reihe' }, ...[0, 1, 2, 3, 4].map((n) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(dr.rir === n), class: 'rir-btn' + (dr.rir === n ? ' aktiv' : ''),
        onclick: (e) => {
          dr.rir = dr.rir === n ? null : n;
          e.currentTarget.parentNode.querySelectorAll('.rir-btn').forEach((b, i) => { b.classList.toggle('aktiv', dr.rir === i); b.setAttribute('aria-checked', String(dr.rir === i)); });
        },
      }, String(n)))));
    return h('div', { class: 'satz aktiv-satz' },
      h('div', { class: 'satz-kopf' }, h('strong', null, row.typ === 'aufwaermen' ? `Aufwärmen ${row.nr}` : `Satz ${row.nr}`),
        row.typ === 'aufwaermen' ? h('span', { class: 'muted' }, 'leicht') : null),
      (cardio || ohne) ? null : stepper('Gewicht (kg)', dr.gewicht, aend('gewicht', schritt, 0)),
      stepper(cardio ? 'Minuten' : u.einheit === 's' ? 'Sekunden' : 'Wiederholungen', dr.wdh, aend('wdh', wSchritt, 0), { ganz: true }),
      (cardio || row.typ !== 'arbeit') ? null : rir,
      (u.einheit === 's' && !cardio && row.typ === 'arbeit') ? h('button', { type: 'button', class: 'btn haken-btn', onclick: () => startCountdown(row, d, dr) }, h('span', { html: icon('play', 36) }), ' Start') : null,
      h('button', { type: 'button', class: 'btn primaer haken-btn', 'aria-label': 'Satz erledigt', onclick: () => haken(row, d, dr) },
        h('span', { html: icon('check', 36) }), ' Erledigt'));
  }

  function kompakteZeile(row, d) {
    const { u } = d;
    const cardio = gym.istCardio(u), ohne = gym.ohneGewicht(u);
    const name = row.typ === 'aufwaermen' ? `Aufwärmen ${row.nr}` : `Satz ${row.nr}`;
    const wert = cardio ? `${row.wdh ?? '–'} min`
      : `${(ohne ? '' : row.gewicht != null ? zf1(row.gewicht) + ' kg × ' : 'Gewicht? × ')}${row.wdh ?? '–'}${u.einheit === 's' ? ' s' : ''}`;
    if (row.erledigt) {
      const rir = row.erledigt.rir != null ? ` · RIR ${row.erledigt.rir}` : '';
      return h('button', { type: 'button', class: 'satz kompakt erledigt', onclick: () => satzBearbeiten(row.erledigt, u), 'aria-label': `${name} bearbeiten` },
        h('span', { class: 'haken-klein', html: icon('check', 20) }), h('span', { class: 'satz-name' }, name), h('span', { class: 'satz-wert' }, wert + rir));
    }
    return h('button', { type: 'button', class: 'satz kompakt', onclick: () => { aktivKey = `${u.id}|${row.typ}|${row.nr}`; zeichne(); } },
      h('span', { class: 'haken-klein leer' }), h('span', { class: 'satz-name' }, name), h('span', { class: 'satz-wert' }, wert));
  }

  function allgemeinAufwaermen() {
    const vl = String(training.vorlage || '');
    const ok = vl.startsWith('ok'), uk = vl.startsWith('uk');
    const zeile = (titel, text) => h('p', { class: 'klein-text' }, h('strong', null, titel + ': '), text);
    return h('div', { class: 'karte' },
      h('div', { class: 'klein-titel' }, 'Allgemein aufwärmen (5 min)'),
      h('p', null, '3–5 min Rad oder Crosstrainer locker (leicht schwitzen, gut sprechen können), dann 1–2 min Gelenke mobilisieren:'),
      !uk ? zeile('Oberkörper', 'Schulter- und Armkreisen, Band-Pull-Aparts') : null,
      !ok ? zeile('Unterkörper', 'Hüftkreisen, Beinpendel, 10 Kniebeugen ohne Gewicht') : null);
  }

  function zeichne() {
    const d = daten(idx);
    const { u, v, rows } = d;
    const cardio = gym.istCardio(u), ohne = gym.ohneGewicht(u);
    const offen = rows.filter((r) => !r.erledigt);
    const aktivRow = offen.find((r) => `${u.id}|${r.typ}|${r.nr}` === aktivKey) || offen[0] || null;
    const letzte = hist.get(u.id)?.[0];
    const letztText = letzte ? (cardio ? `${letzte.saetze.filter((s) => s.typ === 'arbeit').reduce((a, s) => a + (s.wdh || 0), 0)} min` : calc.letztesMalText(letzte.saetze)) : null;
    const heuteText = cardio ? `${v.wdhZiel[0]} min`
      : ohne ? `${v.wdhMin}–${v.wdhMax}${u.einheit === 's' ? ' s' : ' Wdh.'}`
        : v.gewicht != null ? `${zf1(v.gewicht)} kg × ${v.wdhMin}–${v.wdhMax}` : 'Gewicht selbst wählen';
    const erstesMal = !letzte && !u.einstellung;
    const technik = !cardio && !ohne && !v.gewicht;
    const arbeitFertig = rows.filter((r) => r.typ === 'arbeit').every((r) => r.erledigt);

    const kopf = h('div', { class: 'sess-kopf' },
      h('button', { type: 'button', class: 'btn klein', onclick: uebersicht }, h('span', { html: icon('list', 20) }), ` ${idx + 1} / ${plan.length}`),
      h('button', { type: 'button', class: 'btn klein gefahr', onclick: beenden }, 'Training beenden'));

    const karte = h('div', { class: 'karte uebung-karte' },
      h('div', { class: 'muted' }, `${katName(u.kategorie)}${u.geraet ? ' · ' + u.geraet : ''}`),
      h('h1', { class: 'titel' }, u.name),
      h('button', { type: 'button', class: 'geraet-box', onclick: () => geraetBearbeiten(u) },
        u.einstellung ? h('span', null, h('strong', null, 'Einstellung: '), u.einstellung) : h('span', { class: 'muted' }, 'Geräteeinstellung notieren'),
        u.notiz ? h('span', { class: 'muted' }, u.notiz) : null),
      erstesMal ? h('div', { class: 'info-box' }, h('span', { html: icon('alert', 22) }), h('p', null, 'Erstes Mal an dieser Übung: Geräteeinstellung notieren (Sitz, Polster) und ein Foto machen.')) : null,
      h('div', { class: 'vergleich' },
        h('div', null, h('span', { class: 'muted' }, 'Letztes Mal: '), letztText || 'noch keine Daten'),
        h('div', null, h('span', { class: 'muted' }, 'Heute: '), h('strong', null, heuteText)),
        !cardio ? h('div', { class: 'muted klein-text' }, v.grund) : null,
        v.hinweis ? h('div', { class: 'hinweis' }, v.hinweis) : null,
        technik ? h('div', { class: 'hinweis' }, TECHNIK_HINWEIS) : null));

    const nochLeer = !saetze.some((s) => !s.geloescht);
    const allg = nochLeer ? allgemeinAufwaermen() : null;

    const liste = h('div', { class: 'saetze' }, ...rows.map((r) => (aktivRow && r === aktivRow ? aktiveZeile(r, d) : kompakteZeile(r, d))));

    const mehr = h('div', { class: 'btn-reihe' },
      h('button', { type: 'button', class: 'btn klein', onclick: () => { extra[u.id] = (extra[u.id] || 0) + 1; aktivKey = null; zeichne(); } }, h('span', { html: icon('plus', 18) }), ' Satz'),
      h('button', { type: 'button', class: 'btn klein', onclick: () => tauschen(u) }, h('span', { html: icon('sync', 18) }), ' Übung tauschen'),
      h('button', { type: 'button', class: 'btn klein', onclick: hinzufuegen }, h('span', { html: icon('plus', 18) }), ' Übung'));

    const unten = h('div', { class: 'sess-unten' },
      h('button', { type: 'button', class: 'btn', disabled: idx === 0, 'aria-label': 'Vorherige Übung', onclick: () => { idx--; aktivKey = null; zeichne(); } }, h('span', { html: icon('left', 24) })),
      idx < plan.length - 1
        ? h('button', { type: 'button', class: 'btn gross ' + (arbeitFertig ? 'primaer' : ''), onclick: () => { idx++; aktivKey = null; zeichne(); } }, 'Nächste Übung')
        : h('button', { type: 'button', class: 'btn gross ' + (arbeitFertig ? 'primaer' : ''), onclick: beenden }, 'Training beenden'));

    const inhalt = h('div', { class: 'studio-sess' }, kopf, allg, karte, liste, mehr, unten);
    let x0 = 0, y0 = 0;
    inhalt.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    inhalt.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      if (Math.abs(dx) > 80 && Math.abs(dy) < 50) {
        if (dx < 0 && idx < plan.length - 1) { idx++; aktivKey = null; zeichne(); window.scrollTo(0, 0); }
        else if (dx > 0 && idx > 0) { idx--; aktivKey = null; zeichne(); window.scrollTo(0, 0); }
      }
    }, { passive: true });
    S.zeige(inhalt);
  }

  if (!plan.length) { plan = []; hinzufuegen(); S.zeige(h('div', { class: 'studio-sess' }, h('div', { class: 'karte' }, h('p', null, 'Wähle die erste Übung.'),
    h('button', { type: 'button', class: 'btn primaer gross', onclick: hinzufuegen }, 'Übung hinzufügen')))); return; }
  // erste Übung mit offenen Arbeitssätzen
  const erste = plan.findIndex((_, i) => daten(i).rows.some((r) => r.typ === 'arbeit' && !r.erledigt));
  idx = erste >= 0 ? erste : 0;
  zeichne();
}
