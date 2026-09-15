'use strict';
/* ═══════════════════════════════════════════════════════════════
   Depot — Vermögensübersicht für Aktien, ETFs, Fonds, Krypto & Co.

   Aufbau dieser Datei:
     1. Konstanten, Anlageklassen, Themes
     2. Datenmodell, Normalisierung, Persistenz
     3. Helfer und Formatierung
     4. Berechnung (Werte, Gewinne, Summen)
     5. Navigation
     6. Sheet-System und Dialoge
     7. Zurück-Taste
     8. Charts (handgezeichnetes SVG)
     9. Ansichten
    10. Formulare und Buchungen
    11. Kursabruf
    12. Einstellungen, Backup, Update
    13. Start
   ═══════════════════════════════════════════════════════════════ */

/* ── 1. Konstanten ──────────────────────────────────────────── */

const KEY = 'depot.v1';
/* Bei jeder Änderung hochzählen — wird in den Einstellungen angezeigt, damit
   sich auf dem Handy prüfen lässt, welche Fassung wirklich läuft. */
const APP_VERSION = '1.0.1';

const THEME_KEY = 'depot.theme';
/* `bar` ist die Hintergrundfarbe des Themes und landet im
   <meta name="theme-color">, damit die Systemleiste des Handys mitzieht —
   muss mit --bg in style.css übereinstimmen. */
const THEMES = {
  dark:  { label: 'Dunkel', bar: '#0b0e14' },
  light: { label: 'Hell',   bar: '#f3f5f9' },
};

/* Anlageklassen. `quote` sagt, woher der Kurs kommt: 'sec' = Twelve Data,
   'cg' = CoinGecko, 'none' = nur von Hand. `tok` ist das Farb-Token — hier
   steht bewusst keine Farbe, sondern nur ihr Name. */
const KINDS = [
  { k: 'aktie',   label: 'Aktie',     plural: 'Aktien',      short: 'AK',  tok: '--k-aktie',   quote: 'sec'  },
  { k: 'etf',     label: 'ETF',       plural: 'ETFs',        short: 'ETF', tok: '--k-etf',     quote: 'sec'  },
  { k: 'fonds',   label: 'Fonds',     plural: 'Fonds',       short: 'FO',  tok: '--k-fonds',   quote: 'sec'  },
  { k: 'krypto',  label: 'Krypto',    plural: 'Krypto',      short: '₿',   tok: '--k-krypto',  quote: 'cg'   },
  { k: 'anleihe', label: 'Anleihe',   plural: 'Anleihen',    short: 'AN',  tok: '--k-anleihe', quote: 'sec'  },
  { k: 'cash',    label: 'Cash',      plural: 'Cash',        short: '€',   tok: '--k-cash',    quote: 'none' },
  { k: 'sonst',   label: 'Sonstiges', plural: 'Sonstiges',   short: '··',  tok: '--k-sonst',   quote: 'none' },
];
const kindOf = (k) => KINDS.find((x) => x.k === k) || KINDS[KINDS.length - 1];

/* Buchungsarten fürs Journal. `init` entsteht beim Anlegen einer Position mit
   Bestand — wir fangen beim heutigen Stand an, die Vorgeschichte fehlt. */
const TXTYPES = {
  init: { label: 'Anfangsbestand', sign: 0 },
  buy:  { label: 'Kauf',           sign: -1 },
  sell: { label: 'Verkauf',        sign: 1 },
  div:  { label: 'Ausschüttung',   sign: 1 },
};

/* ── 2. Datenmodell ─────────────────────────────────────────── */

/** Frische Grundstruktur. Basis beim Laden und beim Backup-Import, damit
    später ergänzte Felder in alten Daten nicht fehlen. */
const blank = () => ({
  v: 1,
  positions: [],      // siehe blankPos()
  tx: [],             // {id, ts, pid, name, type, qty, price, fee, amount, gain, note}
  hist: [],           // {d:'YYYY-MM-DD', v:Gesamtwert €, c:Einstand €} — ein Eintrag je Tag
  targets: {},        // Zielquoten je Anlageklasse in Prozent, z.B. {etf:60, krypto:10}
  fx: { rates: null, at: null },   // "1 EUR = x Fremdwährung", von frankfurter.dev
  tdKey: '',          // eigener kostenloser Twelve-Data-Schlüssel
  autoQuotes: true,   // beim Start automatisch Kurse holen
  quotesAt: null,     // Zeitpunkt des letzten Sammelabrufs
  theme: 'dark',
  setup: false,       // Ersteinrichtung erledigt?
  lastBackup: null,
});

/** Leere Position. `cost` ist der Ø-Einstand JE STÜCK in Euro, `price` der
    letzte Kurs in der Notierungswährung `cur` — die beiden hängen bewusst
    nicht an derselben Währung: bezahlt wurde in Euro, notiert wird in USD. */
const blankPos = () => ({
  id: '', name: '', sym: '', mic: '', exch: '', cgId: '',
  kind: 'aktie', cur: 'EUR',
  qty: 0, cost: 0,
  price: 0, prev: null, priceAt: null, src: 'manuell',
  realized: 0,      // Summe realisierter Gewinne aus Verkäufen, in Euro
  div: 0,           // Summe erhaltener Ausschüttungen, in Euro
  note: '',
});

let db = blank();

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Zahl aus fremden Daten absichern: ein `undefined` aus einer älteren Fassung
    würde sich sonst durch jede Summe ziehen und alles zu NaN machen. */
const n0 = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

/** Fremden Datensatz (aus localStorage oder Backup) auf die aktuelle Struktur
    bringen. Object.assign allein reicht nicht: es ersetzt verschachtelte
    Objekte im Ganzen — ein älteres Unterobjekt ohne ein neues Feld würde die
    Vorgabe nicht ergänzen, sondern löschen. Daten haben Vorrang vor Vorgabe. */
function normalize(src) {
  const base = blank();
  const d = Object.assign(blank(), src || {});
  delete d.meta;                          // Kopfdaten des Backups gehören nicht in die Daten

  d.positions = (Array.isArray(d.positions) ? d.positions : []).map((p) => {
    const q = Object.assign(blankPos(), p || {});
    if (!q.id) q.id = uid();
    if (!kindOf(q.kind) || !KINDS.some((x) => x.k === q.kind)) q.kind = 'sonst';
    q.cur = String(q.cur || 'EUR');
    ['qty', 'cost', 'price', 'realized', 'div'].forEach((f) => { q[f] = n0(q[f]); });
    q.prev = typeof q.prev === 'number' && isFinite(q.prev) ? q.prev : null;
    return q;
  });

  d.tx = (Array.isArray(d.tx) ? d.tx : []).map((t) => {
    const x = Object.assign({ id: '', ts: '', pid: '', name: '', type: 'buy',
      qty: 0, price: 0, fee: 0, amount: 0, gain: 0, note: '' }, t || {});
    if (!x.id) x.id = uid();
    if (!TXTYPES[x.type]) x.type = 'buy';
    ['qty', 'price', 'fee', 'amount', 'gain'].forEach((f) => { x[f] = n0(x[f]); });
    return x;
  }).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

  d.hist = (Array.isArray(d.hist) ? d.hist : [])
    .filter((h) => h && typeof h.d === 'string')
    .map((h) => ({ d: h.d, v: n0(h.v), c: n0(h.c) }))
    .sort((a, b) => a.d.localeCompare(b.d));

  d.fx = Object.assign({ rates: null, at: null }, d.fx || {});
  d.targets = (d.targets && typeof d.targets === 'object') ? d.targets : {};
  d.tdKey = String(d.tdKey || '');
  if (!THEMES[d.theme]) d.theme = base.theme;
  return d;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    db = normalize(JSON.parse(raw));
  } catch (e) { console.warn('Laden fehlgeschlagen', e); }
}

function save() {
  snapshot();                                   // Tagesstand für den Verlauf festhalten
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Speichern fehlgeschlagen!'); console.error(e); }
}

/** Ein Eintrag je Tag im Depotverlauf, der letzte des Tages gewinnt. Die App
    fängt beim heutigen Stand an — der Verlauf wächst also ab der Einrichtung
    und kann nicht rückwirkend befüllt werden. */
function snapshot() {
  if (!db.positions.length) return;
  const t = totals();
  const d = todayISO();
  const last = db.hist[db.hist.length - 1];
  if (last && last.d === d) { last.v = t.val; last.c = t.cost; return; }
  db.hist.push({ d: d, v: t.val, c: t.cost });
  if (db.hist.length > 3000) db.hist = db.hist.slice(-3000);
}

/** Theme aufs Dokument legen. Der Spiegel in THEME_KEY ist das, was das
    Startskript in index.html liest — ohne ihn flackert der Start. */
function applyTheme(t) {
  if (!THEMES[t]) t = 'dark';
  db.theme = t;
  document.documentElement.dataset.theme = t;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = THEMES[t].bar;
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* nicht schlimm */ }
}

/* ── 3. Helfer und Formatierung ─────────────────────────────── */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Formatierung immer über Intl — nie von Hand mit toFixed und Komma-Ersatz. */
const nfa = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfq = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 8 });
const dfLong = new Intl.DateTimeFormat('de-DE',
  { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const dfShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
const dfMonth = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
const dfTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/* Eingaben können deutsches Komma oder englischen Punkt als Dezimaltrennzeichen
   haben — und Tausenderpunkte obendrein. Maßgeblich ist das ZULETZT stehende
   Trennzeichen: kommt es nur einmal vor, trennt es die Nachkommastellen, sonst
   gruppiert es Tausender. Blind jeden Punkt vor drei Ziffern zu streichen ging
   nicht: <input type="number"> liefert immer die Punktschreibweise, aus "0,125
   Stück" wurde damit die Zahl 125 — Teilstücke waren schlicht nicht buchbar. */
const num = (v) => {
  let s = String(v == null ? '' : v).trim().replace(/[\s\u00a0\u202f']/g, '');
  if (!s) return 0;
  const i = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (i >= 0) {
    const sep = s[i];
    s = s.indexOf(sep) === i
      ? s.slice(0, i).replace(/[.,]/g, '') + '.' + s.slice(i + 1)   // Dezimaltrenner
      : s.replace(/[.,]/g, '');                                     // Tausendertrenner
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
};

const money = (v) => (v < 0 ? '−' : '') + nfa.format(Math.abs(v)) + ' €';
const money0 = (v) => (v < 0 ? '−' : '') + nf0.format(Math.abs(v)) + ' €';
const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + nfa.format(Math.abs(v)) + ' €';
const pct = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + nf1.format(Math.abs(v)) + ' %';
const cls = (v) => (v > 0.005 ? 'up' : v < -0.005 ? 'down' : 'flat');
const qtyF = (v) => nfq.format(v);

/** Kurse brauchen je nach Größenordnung unterschiedlich viele Nachkommastellen:
    bei einer Aktie zu 182,34 € sind zwei richtig, bei 0,00004312 € pro Token
    wäre alles unter sechs eine glatte Null. */
function priceF(v, cur) {
  const a = Math.abs(v);
  const d = a >= 10 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8;
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: d })
    .format(v) + (cur ? ' ' + curSym(cur) : '');
}
const CUR_SYM = { EUR: '€', USD: '$', GBP: '£', GBp: 'p', GBX: 'p', CHF: 'CHF', JPY: '¥' };
const curSym = (c) => CUR_SYM[c] || c || '';

const todayISO = () => localDate(new Date());

/** Lokales Datum als YYYY-MM-DD. toISOString() liefert UTC und verschiebt das
    Datum je nach Uhrzeit um einen Tag — abends in Deutschland immer. */
function localDate(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
}

/* ── 4. Berechnung ──────────────────────────────────────────── */

/** Umrechnungsfaktor Fremdwährung → Euro. Fehlt der Devisenkurs, wird 1:1
    gerechnet und die Position in der Liste mit „FX?" gekennzeichnet — das ist
    ehrlicher als eine Position, die plötzlich 0 € wert ist. */
function fxRate(cur) {
  const r = Quotes.rate(cur, db.fx.rates || {});
  return r || 1;
}
const fxUnknown = (cur) => !Quotes.rate(cur, db.fx.rates || {});

const pEur  = (p) => n0(p.price) * fxRate(p.cur);        // Kurs je Stück in Euro
const pVal  = (p) => n0(p.qty) * pEur(p);                // Positionswert in Euro
const pCost = (p) => n0(p.qty) * n0(p.cost);             // eingesetztes Kapital
const pGain = (p) => pVal(p) - pCost(p);                 // Buchgewinn
const pGainP = (p) => (pCost(p) > 0 ? (pGain(p) / pCost(p)) * 100 : 0);

/** Tagesveränderung in Euro, oder null wenn kein Vortagskurs bekannt ist.
    null ist nicht 0 — „unbekannt" muss sich von „unverändert" unterscheiden,
    sonst meldet die Übersicht nach dem Anlegen fälschlich ±0. */
function pDay(p) {
  if (p.prev == null || !n0(p.price)) return null;
  return n0(p.qty) * (n0(p.price) - n0(p.prev)) * fxRate(p.cur);
}

const openPositions = () => db.positions.filter((p) => n0(p.qty) > 0);

/** Alle Summen in einem Durchlauf. Wird von jeder Ansicht gebraucht und ist
    billig genug, um sie nicht zwischenzuspeichern. */
function totals() {
  let val = 0, cost = 0, day = 0, dayKnown = false, realized = 0, div = 0;
  db.positions.forEach((p) => {
    val += pVal(p); cost += pCost(p);
    realized += n0(p.realized); div += n0(p.div);
    const d = pDay(p);
    if (d != null) { day += d; dayKnown = true; }
  });
  const gain = val - cost;
  return {
    val, cost, gain,
    gainP: cost > 0 ? (gain / cost) * 100 : 0,
    day: dayKnown ? day : null,
    dayP: dayKnown && val - day !== 0 ? (day / (val - day)) * 100 : null,
    realized, div,
    total: gain + realized + div,        // Gesamtergebnis inkl. verkaufter Stücke
  };
}

/** Werte je Anlageklasse, absteigend — Grundlage für Donut und Legende. */
function byKind() {
  const map = {};
  openPositions().forEach((p) => {
    map[p.kind] = (map[p.kind] || 0) + pVal(p);
  });
  const sum = Object.values(map).reduce((a, b) => a + b, 0);
  return KINDS.filter((k) => map[k.k] > 0)
    .map((k) => ({ k: k.k, label: k.label, tok: k.tok, val: map[k.k],
      share: sum > 0 ? (map[k.k] / sum) * 100 : 0,
      target: n0(db.targets[k.k]) }))
    .sort((a, b) => b.val - a.val);
}

/** Ausschüttungen eines Kalenderjahres. */
function divYear(year) {
  return db.tx.filter((t) => t.type === 'div' && new Date(t.ts).getFullYear() === year)
    .reduce((a, t) => a + n0(t.amount), 0);
}
function realizedYear(year) {
  return db.tx.filter((t) => t.type === 'sell' && new Date(t.ts).getFullYear() === year)
    .reduce((a, t) => a + n0(t.gain), 0);
}

const posById = (id) => db.positions.find((p) => p.id === id);

/* ── 5. Navigation ──────────────────────────────────────────── */

const TITLES = { home: 'Übersicht', depot: 'Depot', kurse: 'Kurse', journal: 'Journal' };
let view = 'home';

function nav(v) {
  view = v;
  $$('.view').forEach((s) => s.classList.toggle('hidden', s.id !== 'view-' + v));
  $$('.tabbar button[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === v));
  $('#viewTitle').textContent = TITLES[v] || '';
  window.scrollTo(0, 0);
  armBack();                    // Zurück soll auf die Übersicht führen, nicht aus der App
  render();
}

/** Alles neu zeichnen. Bei den Datenmengen einer Handy-App ist gezieltes
    Aktualisieren unnötige Komplexität — einmal neu rendern ist schnell genug
    und kann nicht aus dem Tritt geraten. */
function render() {
  if (view === 'home') renderHome();
  else if (view === 'depot') renderDepot();
  else if (view === 'kurse') renderKurse();
  else if (view === 'journal') renderJournal();
}

/* ── 6. Sheet-System und Dialoge ────────────────────────────── */

let sheetSaveFn = null;

function openSheet(title, html, saveFn, saveLabel) {
  armBack();                              // Zurück soll das Sheet schließen, nicht die App
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheetBody').onclick = null;         // Handler des vorherigen Sheets verwerfen
  $('#sheetBody').oninput = null;         // auch den: die Live-Summe der Buchung
                                          // greift sonst im nächsten Formular ins Leere
  $('#sheetCancel').onclick = closeSheet; // ggf. überschriebenes Abbrechen zurücksetzen
  sheetSaveFn = saveFn || null;
  const btn = $('#sheetSave');
  btn.classList.toggle('hidden', !saveFn);
  btn.textContent = saveLabel || 'Sichern';
  $('#sheet').classList.remove('hidden');
  $('#scrim').classList.remove('hidden');
  $('#sheetBody').scrollTop = 0;
}

function closeSheet() {
  $('#sheet').classList.add('hidden');
  $('#scrim').classList.add('hidden');
  sheetSaveFn = null;
}

const sheetOpen = () => !$('#sheet').classList.contains('hidden');

/* ── Dialoge ────────────────────────────────────────────────────
   Ersatz für confirm() / prompt() / alert(): installierte Web-Apps
   unterdrücken die nativen Dialoge je nach Gerät kommentarlos — der Knopf
   tut dann scheinbar nichts. Diese hier sind normale Sheets und
   funktionieren überall gleich.
   `back` führt zurück zum vorherigen Sheet statt alles zuzuklappen. */

function askSheet(title, text, okLabel, onOk, back, danger) {
  openSheet(title, `
    <p class="dlg-t">${esc(text)}</p>
    <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" id="dlgOk">${esc(okLabel)}</button>
    <button class="btn btn-block" id="dlgNo" style="margin-top:8px">Abbrechen</button>
  `, null);
  const zurueck = () => (back ? back() : closeSheet());
  $('#dlgOk').onclick = onOk;
  $('#dlgNo').onclick = zurueck;
  $('#sheetCancel').onclick = zurueck;
}

function infoSheet(title, text, back) {
  openSheet(title, `
    <p class="dlg-t">${esc(text)}</p>
    <button class="btn btn-primary btn-block" id="dlgOk">Verstanden</button>
  `, null);
  const zurueck = () => (back ? back() : closeSheet());
  $('#dlgOk').onclick = zurueck;
  $('#sheetCancel').onclick = zurueck;
}

/** Einzeiliger Texteingabe-Dialog. `opts`: {value, placeholder, numeric, okLabel} */
function askText(title, label, opts, onOk, back) {
  opts = opts || {};
  openSheet(title, `
    <label>${esc(label)}<input id="dlg_in"
      ${opts.numeric ? 'type="number" inputmode="decimal" step="any"' : 'autocomplete="off"'}
      placeholder="${esc(opts.placeholder || '')}"
      value="${esc(opts.value == null ? '' : opts.value)}"></label>
    ${opts.hint ? `<p class="hint">${esc(opts.hint)}</p>` : ''}
  `, () => onOk($('#dlg_in').value), opts.okLabel || 'Übernehmen');
  if (back) $('#sheetCancel').onclick = back;
  const inp = $('#dlg_in');
  inp.focus(); inp.select && inp.select();
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); sheetSaveFn && sheetSaveFn(); } };
}

/** Auswahlliste als Sheet — ersetzt die Fälle, in denen ein <select> auf dem
    Handy unhandlich wäre (lange Listen, Einträge mit Zusatzzeile). */
function pickSheet(title, items, onPick, back) {
  openSheet(title, items.length
    ? items.map((it) => `
        <button class="res" data-pick="${esc(it.value)}">
          <b>${esc(it.label)}</b>${it.sub ? `<span>${esc(it.sub)}</span>` : ''}
        </button>`).join('')
    : '<div class="empty">Nichts zur Auswahl</div>', null);
  $('#sheetBody').onclick = (e) => {
    const b = e.target.closest('[data-pick]');
    if (b) onPick(b.dataset.pick);
  };
  if (back) $('#sheetCancel').onclick = back;
}

/* ── 7. Zurück-Taste ────────────────────────────────────────────
   Ohne Zutun beendet ein einziger Druck auf Zurück die installierte App —
   viel zu leicht aus Versehen. Deshalb liegt ein zusätzlicher Verlaufseintrag
   („Wächter") über der App: Zurück landet dann bei uns statt beim System.

   Der Druck schließt der Reihe nach, was offen ist — Sheet, Unterseite — und
   baut den Wächter danach wieder auf. Steht nichts mehr offen und Du bist auf
   der Übersicht, fragt ein Dialog nach. */
let guardUp = false;
let leaving = false;

function pushGuard() {
  if (guardUp) return;
  guardUp = true;
  try { history.pushState({ g: 1 }, ''); } catch (e) { guardUp = false; }
}

/** Vor allem, was die Zurück-Taste abfangen soll: Sheet öffnen, Seite wechseln. */
function armBack() { pushGuard(); }

/** „Verlassen" im Abschiedsdialog: der Dialog hat selbst einen Wächter
    aufgebaut (jedes Sheet tut das). Erst ihn abräumen, dann führt der zweite
    Schritt aus der App. Beides muss über zwei Runden laufen — history.back()
    zweimal hintereinander fasst der Browser zu einem Schritt zusammen. */
function leaveApp() {
  closeSheet();
  leaving = true;
  history.back();
}

function wireBack() {
  pushGuard();
  window.addEventListener('popstate', () => {
    guardUp = false;

    if (leaving) {
      leaving = false;
      history.back();
      // Falls nichts mehr zum Zurückgehen da ist (im Browser-Tab, in dem die App
      // der erste Eintrag ist), bleiben wir hier — dann fehlt der Wächter. Kein
      // Timer zum Nachrüsten: ein pushState würde den laufenden Schritt abbrechen
      // und genau das Verlassen verhindern. Also erst beim nächsten Antippen.
      document.addEventListener('pointerdown', pushGuard, { once: true });
      return;
    }
    // Über den Abbrechen-Knopf, nicht über closeSheet: verschachtelte Sheets
    // haben dort ihren Rückweg zum vorherigen Sheet hinterlegt.
    if (sheetOpen()) { $('#sheetCancel').click(); pushGuard(); return; }
    if (view !== 'home') { nav('home'); pushGuard(); return; }

    askSheet('App verlassen?', 'Möchtest Du die App wirklich schließen?',
      'Verlassen', leaveApp);
  });
}

/* ── 8. Charts ──────────────────────────────────────────────────
   Von Hand gezeichnetes inline-SVG. Keine Bibliothek: eine Linie und ein
   Ring sind zusammen keine 120 Zeilen, eine Chart-Bibliothek wären 200 KB.
   Alle Farben laufen über Tokens, damit der Theme-Wechsel mitzieht. */

const CH_W = 320, CH_H = 150;   // Zeichenfläche; das SVG skaliert per viewBox mit

/** Depotverlauf als Linie mit gefüllter Fläche.
    `pts`: [{d:'YYYY-MM-DD', v:Wert}] aufsteigend sortiert. */
function lineChart(pts) {
  if (pts.length < 2) {
    return `<div class="chart-empty">Der Verlauf entsteht ab heute — ab dem
      zweiten erfassten Tag wird hier eine Linie gezeichnet.</div>`;
  }
  const padL = 4, padR = 4, padT = 14, padB = 20;
  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  // Völlig flache Linie: ohne künstliche Spanne teilt der Code durch null und
  // die Linie klebt am oberen Rand.
  if (hi - lo < 0.01) { hi += Math.max(1, hi * 0.01); lo -= Math.max(1, lo * 0.01); }
  const span = hi - lo;
  const x = (i) => padL + (i * (CH_W - padL - padR)) / (pts.length - 1);
  const y = (v) => padT + (1 - (v - lo) / span) * (CH_H - padT - padB);

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${CH_H - padB} L${padL} ${CH_H - padB} Z`;
  const rising = pts[pts.length - 1].v >= pts[0].v;
  const dir = rising ? 'up' : 'down';
  const gid = 'g' + (rising ? 'u' : 'd');

  const first = dfShort.format(new Date(pts[0].d));
  const last = dfShort.format(new Date(pts[pts.length - 1].d));

  return `<svg class="chart" viewBox="0 0 ${CH_W} ${CH_H}" role="img"
      aria-label="Depotverlauf von ${esc(first)} bis ${esc(last)}">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(${rising ? '--up' : '--down'})" stop-opacity=".55"/>
        <stop offset="1" stop-color="var(${rising ? '--up' : '--down'})" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <line class="grid-line" x1="${padL}" y1="${CH_H - padB}" x2="${CH_W - padR}" y2="${CH_H - padB}"/>
    <path class="area" d="${area}" fill="url(#${gid})"/>
    <path class="line ${dir}" d="${line}"/>
    <circle class="dot" cx="${x(pts.length - 1).toFixed(1)}" cy="${y(pts[pts.length - 1].v).toFixed(1)}"
      r="4" stroke="var(${rising ? '--up' : '--down'})"/>
    <text class="axis-t" x="${padL}" y="${CH_H - 6}">${esc(first)}</text>
    <text class="axis-t" x="${CH_W - padR}" y="${CH_H - 6}" text-anchor="end">${esc(last)}</text>
    <text class="axis-t" x="${padL}" y="10">${esc(money0(hi))}</text>
  </svg>`;
}

/** Ring nach Anlageklasse. Gezeichnet mit stroke-dasharray auf konzentrischen
    Kreisen — ein Segment je Klasse, gedreht um seinen Startwinkel. Das ist
    deutlich weniger Rechnerei als Kreisbogen-Pfade und sieht gleich aus. */
function donutChart(rows, centerVal, centerSub) {
  const R = 54, C = 2 * Math.PI * R;
  let off = 0;
  const segs = rows.map((r) => {
    const len = (r.share / 100) * C;
    const s = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="var(${r.tok})"
      stroke-width="16" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
      stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"
      stroke-linecap="butt"></circle>`;
    off += len;
    return s;
  }).join('');
  return `<svg class="donut" viewBox="0 0 140 140" role="img" aria-label="Aufteilung nach Anlageklasse">
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--line)" stroke-width="16"/>
    ${segs}
    <circle class="donut-hole" cx="70" cy="70" r="${R - 8}"/>
    <text class="donut-mid" x="70" y="70">${esc(centerVal)}</text>
    <text class="donut-sub" x="70" y="85">${esc(centerSub)}</text>
  </svg>`;
}

/** Waagerechter Balken für Gewinner/Verlierer — Länge relativ zum größten
    Ausschlag, damit auch kleine Bewegungen sichtbar bleiben. */
function barRow(label, sub, value, pctv, max) {
  const w = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  const c = cls(value);
  return `<div class="legend-row" style="align-items:flex-start">
    <div class="row-main">
      <div class="row-t">${esc(label)}</div>
      <div class="bar"><span style="width:${w.toFixed(1)}%;background:var(--${c === 'flat' ? 'line' : c})"></span></div>
      <div class="row-s">${esc(sub)}</div>
    </div>
    <div class="row-end">
      <div class="row-v ${c}">${esc(signed(value))}</div>
      <div class="row-d ${c}">${esc(pct(pctv))}</div>
    </div>
  </div>`;
}

/* ── 9. Ansichten ───────────────────────────────────────────── */

let chartRange = 90;            // Tage; 0 = alles
let depotFilter = 'alle';
let depotSort = 'wert';
let journalFilter = 'alle';

/* ── Übersicht ──────────────────────────────────────────────── */

function renderHome() {
  const el = $('#view-home');
  if (!db.positions.length) {
    el.innerHTML = `
      <div class="empty" style="margin-top:var(--sp-5)">
        <strong>Dein Depot ist noch leer</strong>
        Lege die erste Position an — Aktie, ETF, Fonds, Krypto oder was sonst
        im Depot liegt. Wir fangen beim heutigen Bestand an.
      </div>
      <button class="btn btn-primary btn-block" data-act="newpos"
        style="margin-top:var(--sp-4)">Erste Position anlegen</button>`;
    return;
  }

  const t = totals();
  const kinds = byKind();
  const year = new Date().getFullYear();

  /* Verlauf auf den gewählten Zeitraum kürzen. Der erste Punkt bleibt der
     älteste im Fenster — so ist die Linie auch bei wenigen Tagen ehrlich. */
  let pts = db.hist;
  if (chartRange > 0) {
    const from = new Date(); from.setDate(from.getDate() - chartRange);
    const fromS = localDate(from);
    pts = db.hist.filter((h) => h.d >= fromS);
  }
  const rangeGain = pts.length > 1 ? pts[pts.length - 1].v - pts[0].v : null;

  /* Cash bleibt draußen: ein Verrechnungskonto gewinnt und verliert nichts und
     stünde sonst als ewige Null zwischen den echten Positionen. */
  const ranked = openPositions().filter((p) => p.kind !== 'cash' && pCost(p) > 0)
    .sort((a, b) => pGain(b) - pGain(a));
  const maxAbs = ranked.length ? Math.max(...ranked.map((p) => Math.abs(pGain(p)))) : 0;
  const top = ranked.slice(0, 3);
  // Verlierer nur zeigen, wenn es welche gibt — sonst wäre die zweite Gruppe
  // bloß die Fortsetzung der ersten und das Wort „Verlierer" schlicht falsch.
  const flop = ranked.filter((p) => pGain(p) < 0 && !top.includes(p))
    .slice(-3).reverse();

  el.innerHTML = `
    <div class="hero">
      <div class="hero-label">Depotwert</div>
      <div class="hero-value">${esc(money(t.val))}</div>
      <div class="hero-row">
        ${t.day == null
          ? '<span class="delta-pill flat">Tagesveränderung unbekannt</span>'
          : `<span class="delta-pill ${cls(t.day)}">${esc(signed(t.day))}
             ${t.dayP == null ? '' : '· ' + esc(pct(t.dayP))} heute</span>`}
        <span class="delta ${cls(t.gain)}">${esc(signed(t.gain))} · ${esc(pct(t.gainP))}</span>
      </div>
      <div class="stats">
        <div><div class="stat-k">Einstand</div><div class="stat-v">${esc(money(t.cost))}</div></div>
        <div><div class="stat-k">Buchgewinn</div>
          <div class="stat-v ${cls(t.gain)}">${esc(signed(t.gain))}</div></div>
        <div><div class="stat-k">Realisiert</div>
          <div class="stat-v ${cls(t.realized)}">${esc(signed(t.realized))}</div></div>
        <div><div class="stat-k">Ausschüttungen ${year}</div>
          <div class="stat-v">${esc(money(divYear(year)))}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Verlauf</h2>
        ${rangeGain == null ? '' :
          `<span class="delta ${cls(rangeGain)}">${esc(signed(rangeGain))}</span>`}
      </div>
      ${lineChart(pts)}
      <div class="range-row">
        ${[[30, '30 T'], [90, '3 M'], [365, '1 J'], [0, 'Max']].map(([v, l]) =>
          `<button data-range="${v}" class="${chartRange === v ? 'on' : ''}">${l}</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Aufteilung</h2>
        <button class="link" data-act="targets">Zielquoten</button></div>
      <div class="donut-wrap">
        ${donutChart(kinds, money0(t.val),
          kinds.length + (kinds.length === 1 ? ' Klasse' : ' Klassen'))}
        <div class="legend">
          ${kinds.map((r) => `
            <div class="legend-row">
              <span class="legend-dot" style="background:var(${r.tok})"></span>
              <span class="legend-name">${esc(r.label)}</span>
              <span class="legend-val">${esc(nf1.format(r.share))} %</span>
            </div>
            ${r.target ? `<div class="legend-target" style="margin:-4px 0 2px 18px">
              Ziel ${esc(nf0.format(r.target))} % ·
              <span class="${cls(r.share - r.target)}">${esc(pct(r.share - r.target))}</span>
            </div>` : ''}`).join('')}
        </div>
      </div>
    </div>

    ${ranked.length ? `
    <div class="card">
      <div class="card-head"><h2>${flop.length ? 'Gewinner &amp; Verlierer' : 'Größte Gewinne'}</h2></div>
      <div class="legend">
        ${top.map((p) => barRow(p.name, kindOf(p.kind).label + ' · ' + money(pVal(p)),
            pGain(p), pGainP(p), maxAbs)).join('')}
        ${flop.length ? '<div style="height:2px"></div>' : ''}
        ${flop.map((p) => barRow(p.name, kindOf(p.kind).label + ' · ' + money(pVal(p)),
            pGain(p), pGainP(p), maxAbs)).join('')}
      </div>
    </div>` : ''}

    ${backupHint()}`;
}

/** Erinnerung ans Backup. Die Daten liegen nur auf diesem Gerät — „Browserdaten
    löschen" nimmt sie ohne Rückfrage mit. */
function backupHint() {
  if (!db.positions.length) return '';
  const days = db.lastBackup
    ? Math.floor((Date.now() - new Date(db.lastBackup).getTime()) / 86400000) : null;
  if (days != null && days < 30) return '';
  return `<div class="note warn">
    <strong>${days == null ? 'Noch kein Backup' : `Letztes Backup vor ${days} Tagen`}.</strong>
    Die Daten liegen ausschließlich auf diesem Gerät. Ein Backup dauert zwei
    Sekunden: Einstellungen → Backup speichern.
    <button class="link" data-act="backup">Jetzt sichern</button>
  </div>`;
}

/* ── Depot ──────────────────────────────────────────────────── */

const SORTS = { wert: 'Wert', gewinn: 'Gewinn', name: 'Name', tag: 'Tag' };

function sortPositions(list) {
  const s = depotSort;
  return list.slice().sort((a, b) => {
    if (s === 'name') return a.name.localeCompare(b.name, 'de');
    if (s === 'gewinn') return pGainP(b) - pGainP(a);
    if (s === 'tag') return (pDay(b) || 0) - (pDay(a) || 0);
    return pVal(b) - pVal(a);
  });
}

/** Eine Position als Listenzeile. `total` dient dem Gewichtsbalken. */
function posRow(p, total) {
  const k = kindOf(p.kind);
  const val = pVal(p);
  const g = pGain(p);
  const day = pDay(p);
  const w = total > 0 ? (val / total) * 100 : 0;
  const sub = p.kind === 'cash'
    ? 'Verrechnungskonto'
    : `${qtyF(p.qty)} × ${priceF(pEur(p), 'EUR')}`;
  return `<button class="row" data-id="${esc(p.id)}">
    <span class="badge" style="background:var(${k.tok})">${esc(k.short)}</span>
    <span class="row-main">
      <span class="row-t">${esc(p.name)}</span>
      <span class="row-s">${esc(sub)}${p.sym ? ' · ' + esc(p.sym) : ''}${
        fxUnknown(p.cur) ? ' · <b class="src-tag err">FX?</b>' : ''}</span>
      <span class="bar"><span style="width:${w.toFixed(1)}%;background:var(${k.tok})"></span></span>
    </span>
    <span class="row-end">
      <span class="row-v">${esc(money(val))}</span>
      <span class="row-d ${cls(p.kind === 'cash' ? 0 : g)}">${
        p.kind === 'cash' ? '' : esc(pct(pGainP(p)))}${
        day != null && p.kind !== 'cash' ? ' · <span class="' + cls(day) + '">' + esc(signed(day)) + '</span>' : ''}</span>
    </span>
  </button>`;
}

function renderDepot() {
  const el = $('#view-depot');
  const open = openPositions();
  const closed = db.positions.filter((p) => n0(p.qty) <= 0);

  if (!db.positions.length) {
    el.innerHTML = `<div class="empty" style="margin-top:var(--sp-4)">
      <strong>Keine Positionen</strong>Tippe unten auf ＋, um anzufangen.</div>`;
    return;
  }

  const present = KINDS.filter((k) => open.some((p) => p.kind === k.k));
  const total = open.reduce((a, p) => a + pVal(p), 0);
  const shown = depotFilter === 'alle' ? open : open.filter((p) => p.kind === depotFilter);

  let body;
  if (depotFilter === 'alle') {
    // Nach Anlageklasse gruppiert, Gruppen nach Gesamtwert absteigend
    body = present
      .map((k) => ({ k, list: sortPositions(open.filter((p) => p.kind === k.k)) }))
      .map((g) => Object.assign(g, { sum: g.list.reduce((a, p) => a + pVal(p), 0) }))
      .sort((a, b) => b.sum - a.sum)
      .map((g) => `
        <div class="group-head">
          <span class="legend-dot" style="background:var(${g.k.tok})"></span>
          <span class="t">${esc(g.k.plural)}</span>
          <span class="v">${esc(money0(g.sum))} · ${esc(nf0.format(total ? g.sum / total * 100 : 0))} %</span>
        </div>
        ${g.list.map((p) => posRow(p, total)).join('')}`).join('');
  } else {
    body = sortPositions(shown).map((p) => posRow(p, total)).join('')
      || '<div class="empty">Keine Position in dieser Klasse</div>';
  }

  el.innerHTML = `
    <div class="chips">
      <button class="chip ${depotFilter === 'alle' ? 'on' : ''}" data-filter="alle">Alle</button>
      ${present.map((k) => `<button class="chip ${depotFilter === k.k ? 'on' : ''}"
        data-filter="${esc(k.k)}">${esc(k.plural)}</button>`).join('')}
    </div>
    <div class="group-head" style="margin-top:0">
      <span class="t">${esc(shown.length)} ${shown.length === 1 ? 'Position' : 'Positionen'}</span>
      <button class="link v" data-act="sort" style="padding:11px 0;margin:-11px 0">
        Sortiert nach ${esc(SORTS[depotSort])} ▾</button>
    </div>
    ${body}
    ${closed.length ? `
      <div class="group-head">
        <span class="t">Geschlossen</span>
        <span class="v">${esc(closed.length)}</span>
      </div>
      ${closed.map((p) => `<button class="row" data-id="${esc(p.id)}">
        <span class="badge" style="background:var(--k-cash)">✓</span>
        <span class="row-main">
          <span class="row-t">${esc(p.name)}</span>
          <span class="row-s">Vollständig verkauft</span>
        </span>
        <span class="row-end">
          <span class="row-v ${cls(n0(p.realized))}">${esc(signed(n0(p.realized)))}</span>
          <span class="row-d muted">realisiert</span>
        </span>
      </button>`).join('')}` : ''}`;
}

/* ── Kurse ──────────────────────────────────────────────────── */

function renderKurse() {
  const el = $('#view-kurse');
  const list = openPositions().filter((p) => p.kind !== 'cash');

  if (!list.length) {
    el.innerHTML = `<div class="empty" style="margin-top:var(--sp-4)">
      <strong>Nichts zu bewerten</strong>Sobald Positionen im Depot liegen,
      stehen hier ihre Kurse zum Abrufen oder Eintippen.</div>`;
    return;
  }

  const needKey = list.some((p) => kindOf(p.kind).quote === 'sec') && !db.tdKey;
  const fxAt = db.fx.at ? dfShort.format(new Date(db.fx.at)) : null;

  el.innerHTML = `
    <div class="note">
      Beim Abrufen verlassen nur <b>Wertpapierkennungen</b> das Gerät —
      Symbol, Börsenplatz, Währung. Stückzahlen, Einstände und Depotwerte
      werden nie übertragen und nirgends gespeichert.
      ${fxAt ? `<br>Devisenkurse vom ${esc(fxAt)}.` : ''}
    </div>

    ${needKey ? `<div class="note warn">
      Für Aktien, ETFs, Fonds und Anleihen fehlt noch der kostenlose
      Twelve-Data-Schlüssel. Krypto funktioniert auch ohne.
      <button class="link" data-act="apikey">Schlüssel eintragen</button>
    </div>` : ''}

    <button class="btn btn-primary btn-block" data-act="fetch"
      style="margin-bottom:var(--sp-4)">Kurse abrufen</button>

    ${list.map((p) => {
      const k = kindOf(p.kind);
      const tag = p.src === 'live'
        ? '<b class="src-tag live">Abruf</b>'
        : '<b class="src-tag">manuell</b>';
      const when = p.priceAt
        ? dfShort.format(new Date(p.priceAt)) + ' ' + dfTime.format(new Date(p.priceAt))
        : 'nie';
      return `<div class="quote-row">
        <span class="badge" style="background:var(${k.tok})">${esc(k.short)}</span>
        <span class="quote-main">
          <span class="row-t">${esc(p.name)}</span>
          <span class="row-s">${esc(p.sym || p.cgId || 'ohne Symbol')}${
            p.exch ? ' · ' + esc(p.exch) : ''} · ${esc(when)} ${tag}</span>
        </span>
        <input class="quote-in" type="number" inputmode="decimal" step="any"
          data-price="${esc(p.id)}" value="${p.price || ''}"
          aria-label="Kurs ${esc(p.name)} in ${esc(p.cur)}">
      </div>`;
    }).join('')}

    <p class="hint" style="margin-top:var(--sp-3)">
      Kurse in der jeweiligen Notierungswährung eintragen — die Umrechnung in
      Euro macht die App.</p>`;
}

/* ── Journal ────────────────────────────────────────────────── */

function renderJournal() {
  const el = $('#view-journal');
  const year = new Date().getFullYear();

  const filters = [['alle', 'Alle'], ['buy', 'Käufe'], ['sell', 'Verkäufe'],
    ['div', 'Ausschüttungen']];
  const list = journalFilter === 'alle'
    ? db.tx
    : db.tx.filter((t) => t.type === journalFilter
        || (journalFilter === 'buy' && t.type === 'init'));

  const head = `
    <div class="chips">
      ${filters.map(([v, l]) => `<button class="chip ${journalFilter === v ? 'on' : ''}"
        data-jfilter="${v}">${esc(l)}</button>`).join('')}
    </div>
    <div class="card">
      <div class="card-head"><h2>Jahr ${esc(year)}</h2></div>
      <div class="stats" style="margin:0;padding:0;border:0">
        <div><div class="stat-k">Ausschüttungen</div>
          <div class="stat-v">${esc(money(divYear(year)))}</div></div>
        <div><div class="stat-k">Realisiert</div>
          <div class="stat-v ${cls(realizedYear(year))}">${esc(signed(realizedYear(year)))}</div></div>
      </div>
    </div>`;

  if (!list.length) {
    el.innerHTML = head + `<div class="empty">
      <strong>Noch keine Buchungen</strong>
      Käufe, Verkäufe und Ausschüttungen landen hier — tippe unten auf ＋.</div>`;
    return;
  }

  /* Nach Monat gruppieren. db.tx ist bereits absteigend sortiert, also reicht
     ein Durchlauf ohne weitere Sortierung. */
  let out = '', curMonth = '';
  list.forEach((t) => {
    const d = new Date(t.ts);
    const m = d.getFullYear() + '-' + d.getMonth();
    if (m !== curMonth) {
      curMonth = m;
      const sum = list.filter((x) => {
        const xd = new Date(x.ts);
        return xd.getFullYear() + '-' + xd.getMonth() === m;
      }).length;
      out += `<div class="group-head"><span class="t">${esc(dfMonth.format(d))}</span>
        <span class="v">${esc(sum)} ${sum === 1 ? 'Buchung' : 'Buchungen'}</span></div>`;
    }
    out += txRow(t);
  });
  el.innerHTML = head + out;
}

function txRow(t) {
  const p = posById(t.pid);
  const k = kindOf(p ? p.kind : 'sonst');
  const meta = TXTYPES[t.type] || TXTYPES.buy;
  const d = new Date(t.ts);
  let end, sub;
  if (t.type === 'div') {
    end = `<span class="row-v up">${esc(signed(t.amount))}</span>
           <span class="row-d muted">Ausschüttung</span>`;
    sub = dfShort.format(d);
  } else {
    /* Auf einem Verrechnungskonto ist „8.200 × 1,00 €" nur Lärm — dort zählt
       der Betrag, und aus Kauf/Verkauf werden Ein- und Auszahlung. Das dreht
       auch das Vorzeichen um: ein „Kauf" von Guthaben ist Geld, das hereinkommt. */
    const isCash = p && p.kind === 'cash';
    const sign = t.type === 'init' ? ''
      : (t.type === 'sell') !== isCash ? '+' : '−';
    const lab = isCash
      ? (t.type === 'sell' ? 'Auszahlung' : t.type === 'buy' ? 'Einzahlung' : meta.label)
      : meta.label;
    end = `<span class="row-v">${esc(sign + nfa.format(Math.abs(t.amount)) + ' €')}</span>
           ${t.type === 'sell' && !isCash
             ? `<span class="row-d ${cls(t.gain)}">${esc(signed(t.gain))}</span>`
             : `<span class="row-d muted">${esc(lab)}</span>`}`;
    sub = dfShort.format(d)
        + (isCash ? '' : ` · ${qtyF(t.qty)} × ${priceF(t.price, 'EUR')}`)
        + (t.fee ? ` · ${nfa.format(t.fee)} € Gebühr` : '');
  }
  return `<button class="row" data-tx="${esc(t.id)}">
    <span class="badge" style="background:var(${k.tok})">${esc(k.short)}</span>
    <span class="row-main">
      <span class="row-t">${esc(t.name || (p ? p.name : 'Gelöschte Position'))}</span>
      <span class="row-s">${esc(sub)}</span>
    </span>
    <span class="row-end">${end}</span>
  </button>`;
}

/* ── 10. Buchungen ──────────────────────────────────────────────
   Bestand, Einstand, realisierter Gewinn und Ausschüttungen einer Position
   werden NIE direkt fortgeschrieben, sondern immer aus den Buchungen neu
   gerechnet. Das kostet nichts und macht das Löschen einer Buchung
   gefahrlos — sonst müsste jede Rücknahme die Mittelwertbildung von Hand
   umkehren, was schon beim zweiten Kauf nicht mehr eindeutig ist. */

function recalcPos(p) {
  const list = db.tx.filter((t) => t.pid === p.id)
    .slice().sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  /* Ohne jede Buchung bleibt der Bestand stehen, wie er ist. Sonst würde ein
     Datensatz, dem die Buchungen fehlen (Import von Hand, Fassung von früher),
     beim Start stillschweigend auf null gesetzt — der Nutzer sähe ein leeres
     Depot und hätte keine Ahnung, warum. */
  if (!list.length) return;
  let qty = 0, cost = 0, realized = 0, div = 0;

  list.forEach((t) => {
    if (t.type === 'init') {
      qty = n0(t.qty); cost = n0(t.price);
    } else if (t.type === 'buy') {
      const nq = qty + n0(t.qty);
      cost = nq > 0 ? (qty * cost + n0(t.qty) * n0(t.price) + n0(t.fee)) / nq : 0;
      qty = nq;
    } else if (t.type === 'sell') {
      // Mehr verkaufen als vorhanden geht nicht — sonst liefe der Bestand
      // negativ und jede Prozentzahl danach wäre Unsinn.
      const q = Math.min(n0(t.qty), qty);
      t.gain = q * n0(t.price) - n0(t.fee) - q * cost;
      realized += t.gain;
      qty -= q;
    } else if (t.type === 'div') {
      div += n0(t.amount);
    }
  });

  p.qty = qty; p.cost = cost; p.realized = realized; p.div = div;
  if (p.kind === 'cash') { p.price = 1; p.cur = 'EUR'; }
}

function recalcAll() { db.positions.forEach(recalcPos); }

function addTx(t) {
  t.id = t.id || uid();
  db.tx.push(t);
  db.tx.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const p = posById(t.pid);
  if (p) recalcPos(p);
  save();
}

function delTx(id) {
  const t = db.tx.find((x) => x.id === id);
  db.tx = db.tx.filter((x) => x.id !== id);
  const p = t && posById(t.pid);
  if (p) recalcPos(p);
  save();
}

/** Die Buchung „Anfangsbestand" einer Position — der Startpunkt, bei dem wir
    anfangen. Beim Bearbeiten wird sie angepasst statt eine neue anzulegen. */
function initTx(pid) { return db.tx.find((t) => t.pid === pid && t.type === 'init'); }

/* ── Positionsdetail ────────────────────────────────────────── */

function openPos(id) {
  const p = posById(id);
  if (!p) return;
  const k = kindOf(p.kind);
  const val = pVal(p), g = pGain(p), day = pDay(p);
  const isCash = p.kind === 'cash';
  const last = db.tx.filter((t) => t.pid === p.id).slice(0, 4);

  const kv = (a, b, c) => `<div class="kv"><span class="muted">${esc(a)}</span>
    <b class="${c || ''}">${esc(b)}</b></div>`;

  openSheet(p.name, `
    <div class="hero" style="margin-bottom:var(--sp-4)">
      <div class="hero-label">${esc(k.label)}${p.sym ? ' · ' + esc(p.sym) : ''}${
        p.exch ? ' · ' + esc(p.exch) : ''}</div>
      <div class="hero-value">${esc(money(val))}</div>
      ${isCash ? '' : `<div class="hero-row">
        <span class="delta-pill ${cls(g)}">${esc(signed(g))} · ${esc(pct(pGainP(p)))}</span>
        ${day == null ? '' : `<span class="delta ${cls(day)}">${esc(signed(day))} heute</span>`}
      </div>`}
    </div>

    ${isCash ? kv('Betrag', money(p.qty)) : `
      ${kv('Bestand', qtyF(p.qty) + ' Stück')}
      ${kv('Ø-Einstand', priceF(p.cost, 'EUR'))}
      ${kv('Aktueller Kurs', priceF(p.price, p.cur)
        + (p.cur !== 'EUR' ? ' = ' + priceF(pEur(p), 'EUR') : ''))}
      ${kv('Eingesetzt', money(pCost(p)))}
      ${kv('Buchgewinn', signed(g), cls(g))}`}
    ${n0(p.realized) ? kv('Realisiert', signed(p.realized), cls(p.realized)) : ''}
    ${n0(p.div) ? kv('Ausschüttungen', money(p.div)) : ''}
    ${p.priceAt ? kv('Kurs vom', dfShort.format(new Date(p.priceAt)) + ' '
      + dfTime.format(new Date(p.priceAt)) + (p.src === 'live' ? ' (Abruf)' : ' (manuell)')) : ''}
    ${p.note ? `<p class="hint" style="margin-top:var(--sp-3)">${esc(p.note)}</p>` : ''}

    <div class="btn-row" style="margin-top:var(--sp-5)">
      <button class="btn btn-primary" data-pa="buy">${isCash ? 'Einzahlung' : 'Kaufen'}</button>
      <button class="btn" data-pa="sell">${isCash ? 'Auszahlung' : 'Verkaufen'}</button>
    </div>
    ${isCash ? '' : `<div class="btn-row" style="margin-top:var(--sp-2)">
      <button class="btn" data-pa="div">Ausschüttung</button>
      <button class="btn" data-pa="price">Kurs ändern</button>
    </div>`}
    <div class="btn-row" style="margin-top:var(--sp-2)">
      <button class="btn" data-pa="edit">Bearbeiten</button>
      <button class="btn btn-danger" data-pa="del">Löschen</button>
    </div>

    ${last.length ? `<div class="group-head"><span class="t">Letzte Buchungen</span></div>
      ${last.map(txRow).join('')}` : ''}
  `, null);

  $('#sheetBody').onclick = (e) => {
    const t = e.target.closest('[data-tx]');
    if (t) { openTx(t.dataset.tx, () => openPos(id)); return; }
    const b = e.target.closest('[data-pa]');
    if (!b) return;
    const a = b.dataset.pa;
    const back = () => openPos(id);
    if (a === 'buy')   txForm({ type: 'buy', pid: id }, back);
    if (a === 'sell')  txForm({ type: 'sell', pid: id }, back);
    if (a === 'div')   txForm({ type: 'div', pid: id }, back);
    if (a === 'price') editPrice(p, back);
    if (a === 'edit')  posForm(draftFromPos(p), id, back);
    if (a === 'del')   askSheet('Position löschen?',
      `„${p.name}" und alle zugehörigen Buchungen werden entfernt. `
      + 'Das lässt sich nicht rückgängig machen.',
      'Löschen', () => {
        db.positions = db.positions.filter((x) => x.id !== id);
        db.tx = db.tx.filter((t) => t.pid !== id);
        save(); closeSheet(); render(); toast('Position gelöscht');
      }, back, true);
  };
}

/** Kurs von Hand setzen. Eigener kleiner Dialog statt Umweg über das
    Bearbeiten-Formular — das ist der häufigste Handgriff ohne Kursabruf. */
function editPrice(p, back) {
  askText('Kurs ändern', `Kurs in ${p.cur}`, {
    value: p.price || '', numeric: true, okLabel: 'Übernehmen',
    hint: 'Notierungswährung, nicht Euro — die Umrechnung macht die App.',
  }, (v) => {
    p.price = num(v);
    p.priceAt = new Date().toISOString();
    p.src = 'manuell';
    save(); render();
    back ? back() : closeSheet();
    toast('Kurs aktualisiert');
  }, back);
}

/* ── Buchung einer Buchung ansehen ──────────────────────────── */

function openTx(id, back) {
  const t = db.tx.find((x) => x.id === id);
  if (!t) return;
  const meta = TXTYPES[t.type] || TXTYPES.buy;
  const kv = (a, b, c) => `<div class="kv"><span class="muted">${esc(a)}</span>
    <b class="${c || ''}">${esc(b)}</b></div>`;

  openSheet(meta.label, `
    ${kv('Position', t.name || '—')}
    ${kv('Datum', dfLong.format(new Date(t.ts)))}
    ${t.type === 'div' ? kv('Betrag', money(t.amount)) : `
      ${kv('Stück', qtyF(t.qty))}
      ${kv('Kurs', priceF(t.price, 'EUR'))}
      ${t.fee ? kv('Gebühren', money(t.fee)) : ''}
      ${kv('Summe', money(t.amount))}
      ${t.type === 'sell' ? kv('Realisiert', signed(t.gain), cls(t.gain)) : ''}`}
    ${t.note ? `<p class="hint" style="margin-top:var(--sp-3)">${esc(t.note)}</p>` : ''}
    ${t.type === 'init'
      ? '<p class="hint" style="margin-top:var(--sp-4)">Der Anfangsbestand lässt '
        + 'sich über „Position bearbeiten" ändern.</p>'
      : `<button class="btn btn-danger btn-block" id="txDel"
          style="margin-top:var(--sp-5)">Buchung löschen</button>`}
  `, null);
  if (back) $('#sheetCancel').onclick = back;
  const del = $('#txDel');
  if (del) del.onclick = () => askSheet('Buchung löschen?',
    'Bestand und Einstand der Position werden anschließend neu berechnet.',
    'Löschen', () => {
      delTx(id); render();
      back ? back() : closeSheet();
      toast('Buchung gelöscht');
    }, () => openTx(id, back), true);
}

/* ── Position anlegen und bearbeiten ────────────────────────── */

const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP', 'GBp', 'JPY', 'SEK', 'DKK',
  'NOK', 'PLN', 'CZK', 'CAD', 'AUD', 'HKD'];

/** Formularstand aus einer Position. Bestand und Einstand kommen aus der Buchung
    „Anfangsbestand" und ausdrücklich NICHT aus p.qty/p.cost: sobald Käufe oder
    Verkäufe gebucht sind, ist p.qty deren Ergebnis. Beim Speichern landete es
    wieder als Anfangsbestand in der Buchung — und alles danach Gebuchte zählte
    ein zweites Mal. Schon das bloße Umbenennen einer Position blähte so den
    Bestand auf. Gibt es Buchungen, aber keinen Anfangsbestand, ist er null. */
const draftFromPos = (p) => {
  const t = initTx(p.id);
  const hasTx = db.tx.some((x) => x.pid === p.id);
  return {
    kind: p.kind, name: p.name, sym: p.sym, mic: p.mic, exch: p.exch,
    cgId: p.cgId, cur: p.cur, price: p.price, note: p.note,
    qty:  t ? n0(t.qty)   : (hasTx ? 0 : n0(p.qty)),
    cost: t ? n0(t.price) : (hasTx ? 0 : n0(p.cost)),
  };
};

/** Formularstand einsammeln, bevor das Sheet ersetzt wird — beim Wechsel der
    Anlageklasse und vor der Suche. Ohne das wäre alles Getippte weg. */
function readPosForm(draft) {
  /* Fehlt ein Feld im gerade sichtbaren Formular — Cash hat weder Symbol noch
     Kurs —, bleibt der bisherige Wert stehen, statt gelöscht zu werden. Sonst
     wäre nach einem Ausflug auf „Cash" und zurück alles Getippte weg. */
  const g = (sel, fb) => {
    const e = $(sel);
    return e ? e.value : (fb == null ? '' : String(fb));
  };
  return Object.assign({}, draft, {
    name: g('#pf_name', draft.name).trim(),
    sym: g('#pf_sym', draft.sym).trim(),
    cur: g('#pf_cur', draft.cur) || draft.cur,
    qty: num(g('#pf_qty', draft.qty)),
    cost: num(g('#pf_cost', draft.cost)),
    price: num(g('#pf_price', draft.price)),
    note: g('#pf_note', draft.note).trim(),
  });
}

function posForm(draft, editId, back) {
  draft = Object.assign({ kind: 'aktie', name: '', sym: '', mic: '', exch: '',
    cgId: '', cur: 'EUR', qty: 0, cost: 0, price: 0, note: '' }, draft || {});
  const k = kindOf(draft.kind);
  const isCash = draft.kind === 'cash';
  const searchable = k.quote !== 'none';
  const curList = CURRENCIES.includes(draft.cur) ? CURRENCIES : CURRENCIES.concat([draft.cur]);
  /* Liegen schon Buchungen vor, ist das Feld unten nicht der aktuelle Bestand,
     sondern der Startpunkt, auf den sie gerechnet werden. Das muss dranstehen —
     sonst trägt man dort den Bestand ein, den die Buchungen längst ergeben. */
  const booked = !!editId && db.tx.some((x) => x.pid === editId && x.type !== 'init');

  openSheet(editId ? 'Position bearbeiten' : 'Neue Position', `
    <label>Anlageklasse</label>
    <div class="seg">
      ${KINDS.map((x) => `<button data-kind="${x.k}" class="${x.k === draft.kind ? 'on' : ''}">${esc(x.label)}</button>`).join('')}
    </div>

    ${searchable ? `<button class="btn btn-block" id="pf_search" style="margin-bottom:var(--sp-4)">
      ${draft.kind === 'krypto' ? 'Münze suchen' : 'Wertpapier suchen'}</button>` : ''}

    <label>Bezeichnung
      <input id="pf_name" autocomplete="off" placeholder="${isCash ? 'Tagesgeld' : 'z.B. Allianz'}"
        value="${esc(draft.name)}"></label>

    ${isCash ? '' : `
      <div class="field-row">
        <label>Symbol
          <input id="pf_sym" autocomplete="off" placeholder="z.B. ALV"
            value="${esc(draft.sym)}"></label>
        <label>Währung
          <select id="pf_cur">${curList.map((c) =>
            `<option value="${esc(c)}" ${c === draft.cur ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </label>
      </div>
      ${draft.exch ? `<p class="hint">Handelsplatz: ${esc(draft.exch)}${
        draft.mic && draft.mic !== draft.exch ? ' (' + esc(draft.mic) + ')' : ''}</p>` : ''}
      ${draft.cgId ? `<p class="hint">CoinGecko-Kennung: ${esc(draft.cgId)}</p>` : ''}`}

    <div class="field-row">
      <label>${booked ? (isCash ? 'Anfangsbetrag (€)' : 'Anfangsbestand (Stück)')
        : (isCash ? 'Betrag (€)' : 'Stück')}
        <input id="pf_qty" type="number" inputmode="decimal" step="any"
          value="${draft.qty || ''}"></label>
      ${isCash ? '' : `<label>Ø-Einstand (€)
        <input id="pf_cost" type="number" inputmode="decimal" step="any"
          value="${draft.cost || ''}"></label>`}
    </div>
    ${booked ? `<p class="hint">Der Startpunkt der Position — Deine gebuchten
      ${isCash ? 'Ein- und Auszahlungen' : 'Käufe und Verkäufe'} werden darauf
      gerechnet. Der heutige Bestand steht in der Übersicht der Position.</p>` : ''}
    ${isCash || booked ? '' : '<p class="hint">Teilstücke sind erlaubt — z.B. 0,125.</p>'}

    ${isCash ? '' : `<label>Aktueller Kurs (${esc(draft.cur)})
      <input id="pf_price" type="number" inputmode="decimal" step="any"
        value="${draft.price || ''}"></label>
      <p class="hint">Leer lassen und später abrufen — dann zählt der Einstand
        als Wert, bis ein Kurs da ist.</p>`}

    <label>Notiz
      <input id="pf_note" autocomplete="off" placeholder="optional" value="${esc(draft.note)}"></label>
  `, () => savePosForm(draft, editId, back), editId ? 'Sichern' : 'Anlegen');

  if (back) $('#sheetCancel').onclick = back;

  $('#sheetBody').onclick = (e) => {
    const b = e.target.closest('[data-kind]');
    if (b) {
      // Formular neu aufbauen: Cash und Wertpapier haben andere Felder
      const d = readPosForm(draft);
      d.kind = b.dataset.kind;
      posForm(d, editId, back);
      return;
    }
    if (e.target.closest('#pf_search')) searchSheet(readPosForm(draft), editId, back);
  };
}

function savePosForm(draft, editId, back) {
  const d = readPosForm(draft);
  if (!d.name) { toast('Bezeichnung fehlt'); return; }
  const isCash = d.kind === 'cash';
  if (isCash) { d.cost = 1; d.price = 1; d.cur = 'EUR'; }
  /* Ohne Kurs zählt der Einstand als Wert. Sonst stünde eine frisch angelegte
     Position mit 0 € im Depot und die Übersicht zeigt einen Totalverlust. */
  if (!isCash && !d.price) d.price = d.cost * (d.cur === 'EUR' ? 1 : 1 / fxRate(d.cur));

  let p;
  if (editId) {
    p = posById(editId);
    if (!p) return;
    const priceChanged = n0(p.price) !== n0(d.price);
    Object.assign(p, {
      name: d.name, sym: d.sym, mic: d.mic, exch: d.exch, cgId: d.cgId,
      kind: d.kind, cur: d.cur, price: d.price, note: d.note,
    });
    if (priceChanged) { p.priceAt = new Date().toISOString(); p.src = 'manuell'; }
  } else {
    p = Object.assign(blankPos(), {
      id: uid(), name: d.name, sym: d.sym, mic: d.mic, exch: d.exch, cgId: d.cgId,
      kind: d.kind, cur: d.cur, price: d.price, note: d.note,
      priceAt: d.price ? new Date().toISOString() : null, src: 'manuell',
    });
    db.positions.push(p);
  }

  /* Bestand und Einstand stecken in der Buchung „Anfangsbestand" — von dort
     rechnet recalcPos alles Weitere. Beim Bearbeiten wird sie angepasst. */
  let t = initTx(p.id);
  if (d.qty > 0) {
    if (!t) {
      /* Der Anfangsbestand ist der Startpunkt und muss VOR allen bereits
         gebuchten Käufen liegen — recalcPos läuft nach Zeitstempel und würde
         den Bestand sonst zum Schluss wieder auf ihn zurücksetzen. */
      const first = db.tx.filter((x) => x.pid === p.id)
        .reduce((a, x) => (!a || String(x.ts) < a ? String(x.ts) : a), '');
      const ts = first
        ? new Date(new Date(first).getTime() - 1000).toISOString()
        : new Date().toISOString();
      t = { id: uid(), ts, pid: p.id, type: 'init',
        qty: 0, price: 0, fee: 0, amount: 0, gain: 0, note: '' };
      db.tx.push(t);
    }
    t.qty = d.qty; t.price = d.cost; t.amount = d.qty * d.cost; t.name = d.name;
  } else if (t) {
    db.tx = db.tx.filter((x) => x.id !== t.id);
  }
  // Der Name steht in jeder Buchung mit, damit das Journal nach dem Löschen
  // einer Position noch lesbar bleibt.
  db.tx.forEach((x) => { if (x.pid === p.id) x.name = d.name; });
  db.tx.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

  recalcPos(p);
  save(); render();
  back ? back() : closeSheet();
  toast(editId ? 'Gespeichert' : 'Position angelegt');
}

/* ── Wertpapier- und Münzsuche ──────────────────────────────── */

let searchRes = [];

function searchSheet(draft, editId, back) {
  const crypto = draft.kind === 'krypto';
  const zurueck = () => posForm(draft, editId, back);

  const shell = (inner, q) => `
    <label>Suchbegriff
      <input id="sq" autocomplete="off" enterkeyhint="search"
        placeholder="${crypto ? 'Bitcoin, ETH …' : 'Allianz, IE00B4L5Y983, VWCE …'}"
        value="${esc(q || '')}"></label>
    <button class="btn btn-primary btn-block" id="sgo">Suchen</button>
    <div id="sres" style="margin-top:var(--sp-4)">${inner}</div>
    <p class="hint" style="margin-top:var(--sp-4)">
      Es geht nur der Suchbegriff hinaus — sonst nichts.</p>`;

  openSheet(crypto ? 'Münze suchen' : 'Wertpapier suchen', shell(''), null);
  $('#sheetCancel').onclick = zurueck;

  const run = () => {
    const q = $('#sq').value.trim();
    if (q.length < 2) { toast('Mindestens zwei Zeichen'); return; }
    $('#sres').innerHTML = '<div class="empty">Suche läuft …</div>';
    const p = crypto ? Quotes.searchCrypto(q, 15) : Quotes.searchSecurity(q, 15);
    p.then((rows) => {
      searchRes = rows;
      if (!rows.length) {
        $('#sres').innerHTML = `<div class="empty">Nichts gefunden.
          Du kannst die Position auch von Hand anlegen.</div>`;
        return;
      }
      $('#sres').innerHTML = rows.map((r, i) => `
        <button class="res" data-res="${i}">
          <b>${esc(r.name)}</b>
          <span>${esc(r.sym)}${r.exch ? ' · ' + esc(r.exch) : ''}
            ${r.cur ? ' · ' + esc(r.cur) : ''}${r.type ? ' · ' + esc(r.type) : ''}</span>
        </button>`).join('');
    }).catch((e) => {
      $('#sres').innerHTML = `<div class="empty">Suche fehlgeschlagen: ${esc(e.message)}</div>`;
    });
  };

  $('#sgo').onclick = run;
  $('#sq').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
  $('#sq').focus();

  $('#sres').onclick = (e) => {
    const b = e.target.closest('[data-res]');
    if (!b) return;
    const r = searchRes[Number(b.dataset.res)];
    if (!r) return;
    const d = Object.assign({}, draft, {
      name: draft.name || r.name, sym: r.sym, mic: r.mic || '', exch: r.exch || '',
      cgId: r.cgId || '', cur: r.cur || draft.cur,
    });
    posForm(d, editId, back);
  };
}

/* ── Kauf, Verkauf, Ausschüttung buchen ─────────────────────── */

function txForm(opts, back) {
  opts = opts || {};
  if (!db.positions.length) {
    infoSheet('Noch keine Position',
      'Lege zuerst eine Position an — danach lassen sich Käufe, Verkäufe und '
      + 'Ausschüttungen darauf buchen.', back);
    return;
  }
  const type = opts.type || 'buy';
  const pid = opts.pid || db.positions[0].id;
  const p = posById(pid) || db.positions[0];
  const isCash = p.kind === 'cash';
  const isDiv = type === 'div';

  /* Gegenbuchung aufs Verrechnungskonto: nur anbieten, wenn es eines gibt und
     die Buchung nicht selbst auf einem Cash-Konto läuft. */
  const cashAccts = db.positions.filter((x) => x.kind === 'cash' && x.id !== p.id);
  const payFrom = opts.pay == null ? (cashAccts.length ? cashAccts[0].id : '') : opts.pay;

  const label = isCash
    ? (type === 'sell' ? 'Auszahlung' : 'Einzahlung')
    : TXTYPES[type].label;

  openSheet(label, `
    ${isCash ? '' : `<div class="seg">
      ${[['buy', 'Kauf'], ['sell', 'Verkauf'], ['div', 'Ausschüttung']].map(([v, l]) =>
        `<button data-type="${v}" class="${v === type ? 'on' : ''}">${l}</button>`).join('')}
    </div>`}

    <label>Position
      <select id="tf_pid">${db.positions.map((x) =>
        `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    </label>

    <label>Datum
      <input id="tf_date" type="date" value="${esc(todayISO())}" max="${esc(todayISO())}"></label>

    ${isDiv ? `
      <label>Betrag (€, netto nach Steuern)
        <input id="tf_amount" type="number" inputmode="decimal" step="any" placeholder="0,00"></label>`
    : `
      <div class="field-row">
        <label>${isCash ? 'Betrag (€)' : 'Stück'}
          <input id="tf_qty" type="number" inputmode="decimal" step="any" placeholder="0"></label>
        ${isCash ? '' : `<label>Kurs (€ je Stück)
          <input id="tf_price" type="number" inputmode="decimal" step="any"
            placeholder="${p.price ? nfa.format(pEur(p)) : '0,00'}"></label>`}
      </div>
      ${isCash ? '' : `<p class="hint">Teilstücke sind erlaubt — z.B. 0,125.</p>
      <label>Gebühren (€)
        <input id="tf_fee" type="number" inputmode="decimal" step="any" placeholder="0,00"></label>`}`}

    <label>Notiz
      <input id="tf_note" autocomplete="off" placeholder="optional"></label>

    ${cashAccts.length && !isCash ? `
      <label style="display:flex;align-items:center;gap:10px;margin-top:var(--sp-2)">
        <input type="checkbox" id="tf_pay" ${payFrom ? 'checked' : ''}
          style="width:22px;height:22px;min-height:22px;margin:0;flex:none">
        <span>Verrechnungskonto mitbuchen</span>
      </label>
      ${cashAccts.length > 1 ? `<select id="tf_acct">${cashAccts.map((c) =>
        `<option value="${esc(c.id)}" ${c.id === payFrom ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`
        : `<input type="hidden" id="tf_acct" value="${esc(cashAccts[0].id)}">`}` : ''}

    <div id="tf_sum" style="margin-top:var(--sp-4)"></div>
  `, () => saveTx(type, back), 'Buchen');

  if (back) $('#sheetCancel').onclick = back;

  const summary = () => {
    const cur = posById($('#tf_pid').value) || p;
    const el = $('#tf_sum');
    if (isDiv) {
      const a = num($('#tf_amount').value);
      el.innerHTML = `<div class="kv kv-total"><span>Gutschrift</span>
        <b class="up">${esc(signed(a))}</b></div>`;
      return;
    }
    const q = num($('#tf_qty').value);
    const pr = isCash ? 1 : num($('#tf_price').value);
    const fee = isCash ? 0 : num($('#tf_fee').value);
    const gross = q * pr;
    const total = type === 'sell' ? gross - fee : gross + fee;
    let extra = '';
    if (type === 'sell' && q > 0) {
      const gain = gross - fee - q * n0(cur.cost);
      extra = `<div class="kv"><span class="muted">Realisierter Gewinn</span>
        <b class="${cls(gain)}">${esc(signed(gain))}</b></div>`;
      if (q > n0(cur.qty) + 1e-9) extra += `<div class="kv"><span class="muted">Hinweis</span>
        <b class="down">Mehr als im Bestand (${esc(qtyF(cur.qty))})</b></div>`;
    }
    el.innerHTML = `
      ${isCash ? '' : `<div class="kv"><span class="muted">Kurswert</span>
        <b>${esc(money(gross))}</b></div>`}
      ${fee ? `<div class="kv"><span class="muted">Gebühren</span>
        <b>${esc(money(fee))}</b></div>` : ''}
      ${extra}
      <div class="kv kv-total"><span>${type === 'sell' ? 'Gutschrift' : 'Belastung'}</span>
        <b class="${type === 'sell' ? 'up' : ''}">${esc(money(total))}</b></div>`;
  };

  $('#sheetBody').oninput = summary;
  $('#sheetBody').onclick = (e) => {
    const b = e.target.closest('[data-type]');
    if (b) txForm({ type: b.dataset.type, pid: $('#tf_pid').value }, back);
  };
  $('#tf_pid').onchange = () => txForm({ type, pid: $('#tf_pid').value }, back);
  summary();
}

function saveTx(type, back) {
  const p = posById($('#tf_pid').value);
  if (!p) { toast('Position fehlt'); return; }
  const isCash = p.kind === 'cash';
  /* Der Datumswähler liefert nur den Tag. Die Uhrzeit von jetzt anzuhängen
     hält die Reihenfolge mehrerer Buchungen desselben Tages stabil — recalcPos
     sortiert nach `ts`. */
  const day = $('#tf_date').value || todayISO();
  const now = new Date();
  const ts = new Date(`${day}T${String(now.getHours()).padStart(2, '0')}:`
    + `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`).toISOString();
  const note = $('#tf_note').value.trim();

  const t = { id: uid(), ts, pid: p.id, name: p.name, type,
    qty: 0, price: 0, fee: 0, amount: 0, gain: 0, note };

  if (type === 'div') {
    t.amount = num($('#tf_amount').value);
    if (!t.amount) { toast('Betrag fehlt'); return; }
  } else {
    t.qty = num($('#tf_qty').value);
    t.price = isCash ? 1 : num($('#tf_price').value);
    t.fee = isCash ? 0 : num($('#tf_fee').value);
    if (t.qty <= 0) { toast(isCash ? 'Betrag fehlt' : 'Stückzahl fehlt'); return; }
    if (!isCash && t.price <= 0) { toast('Kurs fehlt'); return; }
    if (type === 'sell' && t.qty > n0(p.qty) + 1e-9) {
      toast(`Nur ${qtyF(p.qty)} im Bestand`); return;
    }
    t.amount = type === 'sell' ? t.qty * t.price - t.fee : t.qty * t.price + t.fee;
  }

  addTx(t);

  // Gegenbuchung aufs Verrechnungskonto — als ganz normale Buchung dort,
  // damit sie im Journal sichtbar und einzeln löschbar ist.
  const chk = $('#tf_pay');
  const acct = $('#tf_acct');
  if (chk && chk.checked && acct && acct.value) {
    const c = posById(acct.value);
    if (c) {
      const out = type === 'buy';
      addTx({ id: uid(), ts, pid: c.id, name: c.name, type: out ? 'sell' : 'buy',
        qty: Math.abs(t.amount), price: 1, fee: 0, amount: Math.abs(t.amount), gain: 0,
        note: `${TXTYPES[type].label} ${p.name}` });
    }
  }

  render();
  back ? back() : closeSheet();
  toast(TXTYPES[type].label + ' gebucht');
}

/* ── 11. Kursabruf ──────────────────────────────────────────────
   Steuert quotes.js. Dieses Modul bekommt nur Kennungen zu sehen — welche
   Stückzahlen dahinterstehen, erfährt es nicht. */

let fetching = false;

/** Devisenkurse sind einen halben Tag lang gut genug; Wertpapierkurse nicht. */
const FX_MAX_AGE = 12 * 3600 * 1000;

function fetchQuotes(loud) {
  if (fetching) return Promise.resolve();
  const items = openPositions()
    .filter((p) => p.kind !== 'cash' && (p.cgId || p.sym))
    .map((p) => ({ k: p.id, sym: p.sym, mic: p.mic, cur: p.cur, cgId: p.cgId }));

  if (!items.length) {
    if (loud) toast('Keine Position mit Symbol');
    return Promise.resolve();
  }
  if (!navigator.onLine) {
    if (loud) toast('Keine Verbindung');
    return Promise.resolve();
  }

  const fxOld = !db.fx.rates || !db.fx.at
    || Date.now() - new Date(db.fx.at).getTime() > FX_MAX_AGE;
  const needFx = fxOld && db.positions.some((p) => p.cur && p.cur !== 'EUR');

  fetching = true;
  $('#btnRefresh').classList.add('spin');
  if (loud) toast('Kurse werden abgerufen …');

  return Quotes.fetchAll(items, { tdKey: db.tdKey, needFx })
    .then((r) => {
      if (r.fx) db.fx = { rates: r.fx, at: new Date().toISOString() };
      const now = new Date().toISOString();
      let ok = 0;
      const errs = [];
      Object.keys(r.quotes).forEach((id) => {
        const q = r.quotes[id];
        const p = posById(id);
        if (!p) return;
        if (q.err) { errs.push(`${p.name}: ${q.err}`); return; }
        p.price = q.price;
        p.prev = q.prev == null ? p.prev : q.prev;
        if (q.cur) p.cur = q.cur;
        p.priceAt = now; p.src = 'live';
        ok++;
      });
      db.quotesAt = now;
      save(); render();

      if (!loud) return;
      if (ok && !errs.length) toast(`${ok} ${ok === 1 ? 'Kurs' : 'Kurse'} aktualisiert`);
      else if (ok) toast(`${ok} aktualisiert, ${errs.length} fehlgeschlagen`);
      else quoteErrorSheet(errs);
    })
    .catch((e) => { if (loud) toast('Abruf fehlgeschlagen: ' + e.message); })
    .finally(() => { fetching = false; $('#btnRefresh').classList.remove('spin'); });
}

/** Wenn gar nichts durchkam, hilft eine Zeile „fehlgeschlagen" nicht weiter —
    meist fehlt der Schlüssel oder ein Symbol stimmt nicht. */
function quoteErrorSheet(errs) {
  openSheet('Abruf fehlgeschlagen', `
    <p class="dlg-t">Kein einziger Kurs kam durch:</p>
    ${errs.slice(0, 8).map((e) => `<div class="kv"><span>${esc(e)}</span></div>`).join('')}
    ${errs.length > 8 ? `<p class="hint">… und ${errs.length - 8} weitere</p>` : ''}
    <button class="btn btn-primary btn-block" id="qeKey" style="margin-top:var(--sp-5)">
      Kursquelle einrichten</button>
    <button class="btn btn-block" id="qeOk" style="margin-top:var(--sp-2)">Schließen</button>
  `, null);
  $('#qeKey').onclick = () => apiKeySheet(closeSheet);
  $('#qeOk').onclick = closeSheet;
}

function apiKeySheet(back) {
  openSheet('Kursquelle', `
    <div class="note">
      Aktien, ETFs, Fonds und Anleihen kommen von <b>twelvedata.com</b>. Der
      Zugang ist kostenlos, braucht aber einen persönlichen Schlüssel:
      auf twelvedata.com registrieren, den API-Key kopieren und hier einfügen.
      Krypto (CoinGecko) und Devisen (frankfurter.dev) laufen ohne Schlüssel.
    </div>
    <label>Twelve-Data-Schlüssel
      <input id="ak" autocomplete="off" spellcheck="false" placeholder="z.B. a1b2c3…"
        value="${esc(db.tdKey)}"></label>
    <p class="hint">Der Schlüssel bleibt auf diesem Gerät und wandert nur an
      twelvedata.com — zusammen mit dem Symbol, sonst nichts.</p>
    <label style="display:flex;align-items:center;gap:10px">
      <input type="checkbox" id="ak_auto" ${db.autoQuotes ? 'checked' : ''}
        style="width:22px;height:22px;min-height:22px;margin:0;flex:none">
      <span>Beim Start automatisch abrufen</span>
    </label>
  `, () => {
    db.tdKey = $('#ak').value.trim();
    db.autoQuotes = $('#ak_auto').checked;
    save();
    back ? back() : closeSheet();
    toast('Gespeichert');
  });
  if (back) $('#sheetCancel').onclick = back;
}

/* ── Zielquoten ─────────────────────────────────────────────── */

function targetsSheet(back) {
  openSheet('Zielquoten', `
    <p class="hint" style="margin-top:0">Wunschanteil je Anlageklasse in
      Prozent. Die Übersicht zeigt dann die Abweichung. Leer oder 0 heißt
      „kein Ziel".</p>
    ${KINDS.map((k) => `<label>${esc(k.plural)}
      <input id="tg_${k.k}" type="number" inputmode="decimal" step="any"
        value="${n0(db.targets[k.k]) || ''}"></label>`).join('')}
  `, () => {
    KINDS.forEach((k) => {
      const v = num($('#tg_' + k.k).value);
      if (v > 0) db.targets[k.k] = v; else delete db.targets[k.k];
    });
    save(); render();
    back ? back() : closeSheet();
    toast('Zielquoten gespeichert');
  });
  if (back) $('#sheetCancel').onclick = back;
}

/* ── 12. Einstellungen, Backup, Update ──────────────────────── */

function openSettings() {
  const cached = db.lastBackup ? dfLong.format(new Date(db.lastBackup)) : 'noch nie';
  openSheet('Einstellungen', `
    <label>Erscheinungsbild</label>
    <div class="seg">
      ${Object.keys(THEMES).map((t) => `<button data-settheme="${t}"
        class="${db.theme === t ? 'on' : ''}">${esc(THEMES[t].label)}</button>`).join('')}
    </div>

    <div class="group-head"><span class="t">Kurse</span></div>
    <button class="btn btn-block" data-s="key">Kursquelle &amp; Schlüssel</button>
    <button class="btn btn-block" data-s="fetch" style="margin-top:var(--sp-2)">Kurse jetzt abrufen</button>
    <button class="btn btn-block" data-s="targets" style="margin-top:var(--sp-2)">Zielquoten</button>

    <div class="group-head"><span class="t">Backup</span></div>
    <div class="note">
      Alle Daten liegen ausschließlich in diesem Browser. Wird der Speicher
      geleert oder das Gerät getauscht, sind sie weg — ohne Backup
      unwiederbringlich. Letztes Backup: ${esc(cached)}.
    </div>
    <button class="btn btn-primary btn-block" data-s="export">Backup speichern</button>
    <button class="btn btn-block" data-s="import" style="margin-top:var(--sp-2)">Backup laden</button>
    <input type="file" id="impFile" accept="application/json,.json" class="hidden">

    <div class="group-head"><span class="t">App</span></div>
    <div class="kv"><span class="muted">Version</span><b>${esc(APP_VERSION)}</b></div>
    <div class="kv"><span class="muted">Positionen</span><b>${esc(db.positions.length)}</b></div>
    <div class="kv"><span class="muted">Buchungen</span><b>${esc(db.tx.length)}</b></div>
    <div class="kv"><span class="muted">Verlaufstage</span><b>${esc(db.hist.length)}</b></div>
    <button class="btn btn-block" data-s="update" style="margin-top:var(--sp-3)">Nach Update suchen</button>
    <button class="btn btn-block" data-s="wipe" style="margin-top:var(--sp-2)">Alle Daten löschen</button>

    <p class="hint" style="margin-top:var(--sp-5)">
      Depot — Vermögensübersicht ohne Konto und ohne Server. Kursabruf ist die
      einzige Verbindung nach außen und überträgt nur Wertpapierkennungen.</p>
  `, null);

  $('#sheetBody').onclick = (e) => {
    /* NICHT `data-theme` nennen: closest() läuft bis <html data-theme="…"> hoch
       und würde damit jeden Klick im Sheet als Theme-Wechsel deuten — die
       anderen Knöpfe der Einstellungen täten dann gar nichts. */
    const th = e.target.closest('[data-settheme]');
    if (th) { applyTheme(th.dataset.settheme); save(); openSettings(); return; }
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const a = b.dataset.s;
    if (a === 'key')     apiKeySheet(openSettings);
    if (a === 'targets') targetsSheet(openSettings);
    if (a === 'fetch')   { closeSheet(); fetchQuotes(true); }
    if (a === 'export')  exportBackup();
    if (a === 'import')  $('#impFile').click();
    if (a === 'update')  checkUpdate();
    if (a === 'wipe')    askSheet('Alle Daten löschen?',
      'Positionen, Buchungen und Verlauf werden vollständig entfernt. '
      + 'Ohne Backup ist das endgültig.',
      'Alles löschen', () => {
        db = blank();
        applyTheme(db.theme);
        try { localStorage.removeItem(KEY); } catch (e) { /* egal */ }
        save(); closeSheet(); nav('home'); toast('Alle Daten gelöscht');
      }, openSettings, true);
  };
  /* Feld leeren: sonst gilt dieselbe Datei beim zweiten Mal nicht als Änderung,
     'change' bleibt aus und „Backup laden" tut scheinbar nichts. */
  $('#impFile').onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    importBackup(f);
  };
}

function exportBackup() {
  db.lastBackup = new Date().toISOString();
  save();
  /* Der gesamte Datensatz wandert unverändert in die Datei. `meta` steht nur
     als Kopfzeile davor und wird beim Import wieder entfernt (siehe
     normalize), damit es nicht in die Daten wandert. */
  const payload = Object.assign({
    meta: { app: 'Depot', appVersion: APP_VERSION, format: db.v, exported: db.lastBackup },
  }, db);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `depot-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Backup gespeichert');
}

function importBackup(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.positions)) throw new Error('Die Datei ist kein Backup dieser App.');
      const stand = d.meta && d.meta.exported ? ` vom ${dfLong.format(new Date(d.meta.exported))}` : '';
      askSheet('Backup laden',
        `Das Backup${stand} enthält ${d.positions.length} Positionen und `
        + `${Array.isArray(d.tx) ? d.tx.length : 0} Buchungen. `
        + 'Deine jetzigen Daten werden dabei ersetzt.',
        'Laden', () => {
          // normalize() ergänzt, was in einem älteren Backup fehlt, und wirft
          // die Kopfzeile `meta` weg.
          db = normalize(d);
          recalcAll();
          applyTheme(db.theme);
          save(); closeSheet(); render(); toast('Backup geladen');
        }, openSettings);
    } catch (e) { infoSheet('Import fehlgeschlagen', e.message, openSettings); }
  };
  r.readAsText(file);
}

/* ── Update-Erkennung ───────────────────────────────────────────
   Ohne das merkt die installierte App nie, dass eine neue Fassung online ist —
   der Service Worker liefert die alte weiter, teilweise über Tage. */

/** Welche APP_VERSION liegt im Offline-Cache? Das ist die Fassung, die beim
    nächsten Laden ausgeliefert wird — nicht zwingend die laufende. */
async function cachedVersion() {
  if (!('caches' in window)) return null;
  for (const k of await caches.keys()) {
    if (!k.startsWith('depot')) continue;
    const c = await caches.open(k);
    const res = (await c.match('./app.js')) || (await c.match('app.js'));
    if (!res) continue;
    const m = (await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/);
    if (m) return m[1];
  }
  return null;
}

/** Lädt neu, wenn im Cache eine andere Fassung liegt als die laufende. Die
    Sperre in sessionStorage verhindert eine Endlosschleife, falls das
    Neuladen die Version wider Erwarten nicht ändert. */
let reloading = false;
async function applyIfNewer(announce) {
  if (reloading) return false;
  const cv = await cachedVersion();
  if (!cv || cv === APP_VERSION) return false;
  if (sessionStorage.getItem('dt-reload') === cv) return false;   // schon versucht
  if (sheetOpen()) {                                              // Formular offen
    toast(`Version ${cv} bereit — App neu starten`);
    return true;
  }
  reloading = true;
  sessionStorage.setItem('dt-reload', cv);
  if (announce) toast(`Version ${cv} wird geladen …`);
  setTimeout(() => location.reload(), announce ? 700 : 0);
  return true;
}

function checkUpdate() {
  if (!('serviceWorker' in navigator)) { toast('Kein Service Worker'); return; }
  toast('Suche nach Update …');
  navigator.serviceWorker.getRegistration()
    .then((reg) => (reg ? reg.update() : null))
    .then(() => new Promise((r) => setTimeout(r, 1500)))
    .then(() => applyIfNewer(true))
    .then((found) => { if (!found) toast(`Version ${APP_VERSION} ist aktuell`); })
    .catch(() => toast('Update-Prüfung fehlgeschlagen'));
}

function wireUpdates() {
  if (!('serviceWorker' in navigator)) return;

  /* Auf 'controllerchange' ist kein Verlass: aktualisiert sich dieselbe
     Registrierung, gilt die Seite nicht als "neu kontrolliert" und das
     Ereignis bleibt aus. Verlässlich ist der Zustandswechsel des neuen
     Workers auf 'activated' — dann liegt der frische Cache bereit. */
  const watch = (w) => {
    if (!w) return;
    if (w.state === 'activated') { applyIfNewer(false); return; }
    w.addEventListener('statechange', () => {
      if (w.state === 'activated') applyIfNewer(false);
    });
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => applyIfNewer(false));

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      watch(reg.installing); watch(reg.waiting);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      navigator.serviceWorker.ready.then(() => applyIfNewer(false));
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});
  });
}

/* ── 13. Verdrahtung und Start ──────────────────────────────── */

/** Der ＋-Knopf: erst fragen, was gebucht werden soll. Eine neue Position und
    ein Kauf auf eine bestehende sind zwei verschiedene Dinge — sie in ein
    Formular zu pressen hat sich als verwirrend erwiesen. */
function newEntry() {
  const has = db.positions.length > 0;
  openSheet('Neu', `
    <button class="btn btn-primary btn-block" data-new="pos">Position anlegen</button>
    ${has ? `
      <button class="btn btn-block" data-new="buy" style="margin-top:var(--sp-2)">Kauf buchen</button>
      <button class="btn btn-block" data-new="sell" style="margin-top:var(--sp-2)">Verkauf buchen</button>
      <button class="btn btn-block" data-new="div" style="margin-top:var(--sp-2)">Ausschüttung buchen</button>`
      : '<p class="hint" style="margin-top:var(--sp-4)">Buchungen gibt es, sobald die erste Position steht.</p>'}
  `, null);
  $('#sheetBody').onclick = (e) => {
    const b = e.target.closest('[data-new]');
    if (!b) return;
    const a = b.dataset.new;
    if (a === 'pos') posForm({}, null, newEntry);
    else txForm({ type: a }, newEntry);
  };
}

/** Begrüßung beim allerersten Start. Erklärt in drei Sätzen, worauf die App
    aufbaut — vor allem, dass der Verlauf ab heute wächst. */
function welcome() {
  openSheet('Willkommen', `
    <p class="dlg-t">Diese App bildet Dein Depot ab: Aktien, ETFs, Fonds,
      Krypto, Anleihen und Cash — alles auf diesem Gerät, ohne Konto.</p>
    <div class="kv"><span class="muted">Start</span><b>heutiger Bestand</b></div>
    <div class="kv"><span class="muted">Danach</span><b>Käufe &amp; Verkäufe buchen</b></div>
    <div class="kv"><span class="muted">Verlauf</span><b>wächst ab heute</b></div>
    <p class="hint" style="margin-top:var(--sp-4)">Kurse lassen sich abrufen
      oder von Hand eintragen. Beim Abruf gehen nur Wertpapierkennungen hinaus,
      nie Stückzahlen oder Beträge.</p>
    <button class="btn btn-primary btn-block" id="wGo" style="margin-top:var(--sp-4)">
      Erste Position anlegen</button>
    <button class="btn btn-block" id="wSkip" style="margin-top:var(--sp-2)">Später</button>
  `, null);
  const done = () => { db.setup = true; save(); };
  $('#wGo').onclick = () => { done(); posForm({}, null, null); };
  $('#wSkip').onclick = () => { done(); closeSheet(); };
  $('#sheetCancel').onclick = () => { done(); closeSheet(); };
}

function wire() {
  document.body.addEventListener('click', (e) => {
    // Im Sheet hängen eigene Handler — sonst liefe jeder Klick doppelt.
    if (e.target.closest('#sheet')) return;

    const n = e.target.closest('[data-nav]');
    if (n) { nav(n.dataset.nav); return; }

    const f = e.target.closest('[data-filter]');
    if (f) { depotFilter = f.dataset.filter; render(); return; }

    const j = e.target.closest('[data-jfilter]');
    if (j) { journalFilter = j.dataset.jfilter; render(); return; }

    const r = e.target.closest('[data-range]');
    if (r) { chartRange = Number(r.dataset.range); render(); return; }

    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'newpos') posForm({}, null, null);
      if (act === 'backup') exportBackup();
      if (act === 'targets') targetsSheet(null);
      if (act === 'apikey') apiKeySheet(null);
      if (act === 'fetch') fetchQuotes(true);
      if (act === 'sort') sortSheet();
      return;
    }

    const t = e.target.closest('[data-tx]');
    if (t) { openTx(t.dataset.tx, null); return; }

    const p = e.target.closest('[data-id]');
    if (p) { openPos(p.dataset.id); return; }
  });

  /* Kurse von Hand: 'change' feuert erst beim Verlassen des Feldes — dann ist
     der Fokus ohnehin weg und ein vollständiges Neuzeichnen stört nicht. */
  document.body.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-price]');
    if (!inp) return;
    const p = posById(inp.dataset.price);
    if (!p) return;
    p.price = num(inp.value);
    p.priceAt = new Date().toISOString();
    p.src = 'manuell';
    save(); render();
  });

  $('#btnNew').onclick = newEntry;
  $('#btnSettings').onclick = openSettings;
  $('#btnRefresh').onclick = () => fetchQuotes(true);
  $('#sheetCancel').onclick = closeSheet;
  $('#scrim').onclick = closeSheet;
  $('#sheetSave').onclick = () => sheetSaveFn && sheetSaveFn();
}

function sortSheet() {
  pickSheet('Sortieren nach',
    Object.keys(SORTS).map((k) => ({ value: k, label: SORTS[k] })),
    (v) => { depotSort = v; closeSheet(); render(); });
}

load();
applyTheme(db.theme);
recalcAll();        // heilt Datensätze, in denen Bestand und Buchungen auseinanderliefen
wire();
wireBack();
nav('home');

/* Bittet den Browser, den Speicher nicht bei Platzmangel wegzuräumen. */
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

if (!db.setup && !db.positions.length) welcome();

/* Kurse im Hintergrund nachziehen, aber nicht bei jedem Blick in die App —
   einmal je Stunde reicht und schont das kostenlose Tageskontingent. */
if (db.autoQuotes) {
  const age = db.quotesAt ? Date.now() - new Date(db.quotesAt).getTime() : Infinity;
  if (age > 3600 * 1000) setTimeout(() => fetchQuotes(false), 1200);
}

wireUpdates();
