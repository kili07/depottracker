'use strict';

/* ── Konstanten ─────────────────────────────────────────────────
   KEY: einziger localStorage-Schlüssel für den kompletten Datensatz.
   APP_VERSION: bei jeder Änderung hochzählen — steht in den Einstellungen
   und wird vom Update-Mechanismus im Cache gesucht (siehe wireUpdates). */
const KEY = 'pf.v1';
const APP_VERSION = '1.1.0';

const THEME_KEY = 'pf.theme';
const THEMES = {
  dark:  { label: 'Dunkel', bar: '#0b0e14' },
  light: { label: 'Hell',   bar: '#f3f5f9' },
};

const TYPE_ORDER = ['aktie', 'etf', 'fonds', 'krypto'];
const TYPE_LABELS = { aktie: 'Aktie', etf: 'ETF', fonds: 'Fonds', krypto: 'Krypto' };
const TYPE_ICON = { aktie: '📈', etf: '📊', fonds: '🏦', krypto: '₿' };
/* Dieselben Tokens wie die type-dot-Farben in style.css — damit Donut,
   Balken und die Punkte in der Übersicht immer zusammenpassen. */
const TYPE_COLOR_VAR = { aktie: 'var(--accent)', etf: 'var(--up)', fonds: 'var(--warn)', krypto: 'var(--krypto)' };

/* Ab diesem Alter (Tage) gilt ein manuell gepflegter Kurs als veraltet. */
const STALE_DAYS = 14;

/** Frische Grundstruktur. Basis beim Laden und beim Backup-Import, damit
    später ergänzte Felder in alten Daten nicht fehlen. */
const blank = () => ({
  v: 1,
  positions: [],   // siehe normalize() für die Feldliste je Position
  theme: 'dark',
  tdApiKey: '',    // Twelve-Data-API-Key, vom Nutzer selbst hinterlegt
  lastBackup: null,
});

let db = blank();

/** Fremden Datensatz (aus localStorage oder Backup) auf die aktuelle Struktur
    bringen. Object.assign allein reicht nicht: es ersetzt verschachtelte
    Objekte im Ganzen — ein älteres Unterobjekt ohne ein neues Feld würde die
    Vorgabe nicht ergänzen, sondern löschen. Daten haben Vorrang vor Vorgabe. */
function normalize(src) {
  const base = blank();
  const d = Object.assign(blank(), src || {});
  delete d.meta;                                   // Kopfdaten des Backups gehören nicht in die Daten

  d.positions = Array.isArray(d.positions) ? d.positions : [];
  d.positions.forEach((p) => {
    if (!p.id) p.id = uid();
    if (!TYPE_ORDER.includes(p.type)) p.type = 'aktie';
    if (!['coingecko', 'twelvedata', 'manual'].includes(p.source)) p.source = 'manual';
    if (!p.currency) p.currency = 'EUR';
    p.quantity = num(p.quantity);
    p.buyPrice = num(p.buyPrice);
    if (!p.buyDate) p.buyDate = localISODate(new Date());
    if (p.source === 'manual') p.manualPrice = num(p.manualPrice);
    if (typeof p.note !== 'string') p.note = '';
  });

  if (!THEMES[d.theme]) d.theme = base.theme;
  if (typeof d.tdApiKey !== 'string') d.tdApiKey = '';
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
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Speichern fehlgeschlagen!'); console.error(e); }
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

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ── Helfer und Formatierung ────────────────────────────────────── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Formatierung immer über Intl — nie von Hand mit toFixed und Komma-Ersatz. */
const nfa = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const nfq = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 6 });
const pf2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const dfShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dfLong = new Intl.DateTimeFormat('de-DE',
  { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

/* Eingaben können deutsches Komma enthalten — parseFloat allein verschluckt es. */
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

function fmtMoney(v, currency) {
  currency = currency || 'EUR';
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
  } catch (e) { return pf2.format(v) + ' ' + currency; }
}
function fmtPct(v) { return (v < 0 ? '−' : '+') + pf2.format(Math.abs(v)) + ' %'; }

/** datetime-local/date braucht lokale Zeit ohne Zone — toISOString() liefert
    UTC und verschiebt das Datum je nach Uhrzeit um einen Tag. */
function localISODate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr + 'T00:00:00').getTime()) / 86400000;
}
function relTime(date) {
  if (!date) return '';
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return rtf.format(-diffMin, 'minute');
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return rtf.format(-diffH, 'hour');
  return rtf.format(-Math.round(diffH / 24), 'day');
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ── Kursquellen ────────────────────────────────────────────────
   Krypto: CoinGecko — kostenlos, kein Key, direkter Browser-Zugriff (CORS).
   US-Aktien/ETFs: Twelve Data — kostenloser Key nötig, Gratis-Tarif deckt
   nur US-Börsen ab (geprüft). Deutsche/europäische Werte und die meisten
   Fonds haben dort keine Live-Daten im Gratis-Tarif — die pflegt der Nutzer
   manuell (Feld "Kurs aktualisieren"), das ist bewusst kein Automatismus. */

let quoteCache = {};     // pos.id -> { price, currency, asOf, live, error, changePct? }
let fxUSDEUR = null;     // 1 USD = fxUSDEUR EUR, für die Umrechnung von TD-Kursen in USD
let lastRefresh = null;
let refreshing = false;

async function fetchCoinGeckoQuotes(positions) {
  if (!positions.length) return {};
  const ids = [...new Set(positions.map((p) => p.cgId))];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=eur`;
  const out = {};
  try {
    const data = await (await fetch(url)).json();
    positions.forEach((pos) => {
      const entry = data[pos.cgId];
      out[pos.id] = (entry && typeof entry.eur === 'number')
        ? { price: entry.eur, currency: 'EUR', asOf: new Date(), live: true, error: null }
        : { price: null, currency: 'EUR', asOf: null, live: true, error: 'Kurs nicht verfügbar' };
    });
  } catch (e) {
    positions.forEach((pos) => { out[pos.id] = { price: null, currency: 'EUR', asOf: null, live: true, error: 'Netzwerkfehler' }; });
  }
  return out;
}

async function fetchTwelveDataQuotes(positions, apiKey) {
  if (!positions.length) return {};
  const symParam = positions.map((p) => p.tdMic ? `${p.tdSymbol}:${p.tdMic}` : p.tdSymbol).join(',');
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symParam)}&apikey=${encodeURIComponent(apiKey)}`;
  const out = {};
  let data;
  try {
    data = await (await fetch(url)).json();
  } catch (e) {
    positions.forEach((pos) => { out[pos.id] = { price: null, currency: pos.currency, asOf: null, live: true, error: 'Netzwerkfehler' }; });
    return out;
  }
  if (data && data.status === 'error') {
    const msg = data.message || 'Fehler beim Laden der Kurse';
    positions.forEach((pos) => { out[pos.id] = { price: null, currency: pos.currency, asOf: null, live: true, error: msg }; });
    return out;
  }
  const assign = (pos, obj) => {
    if (!obj || obj.status === 'error' || obj.code) {
      out[pos.id] = { price: null, currency: pos.currency, asOf: null, live: true, error: (obj && obj.message) || 'Kurs nicht verfügbar' };
      return;
    }
    const price = parseFloat(obj.close);
    out[pos.id] = {
      price: isFinite(price) ? price : null,
      currency: obj.currency || pos.currency,
      asOf: new Date(),
      live: true,
      changePct: parseFloat(obj.percent_change),
      error: isFinite(price) ? null : 'Kurs nicht verfügbar',
    };
  };
  if (positions.length === 1) {
    assign(positions[0], data);
  } else {
    positions.forEach((pos) => {
      const key = pos.tdMic ? `${pos.tdSymbol}:${pos.tdMic}` : pos.tdSymbol;
      assign(pos, data[key] || data[pos.tdSymbol]);
    });
  }
  return out;
}

async function fetchFxUSDEUR() {
  try {
    const data = await (await fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=EUR')).json();
    return (data && data.rates && typeof data.rates.EUR === 'number') ? data.rates.EUR : null;
  } catch (e) { return null; }
}

async function refreshQuotes(opts) {
  opts = opts || {};
  if (refreshing) return;
  refreshing = true;
  if (!opts.silent) toast('Kurse werden aktualisiert …');
  try {
    const cgPositions = db.positions.filter((p) => p.source === 'coingecko');
    const tdPositions = db.positions.filter((p) => p.source === 'twelvedata');
    const needsFx = tdPositions.length > 0;

    const tdTask = (() => {
      if (!tdPositions.length) return Promise.resolve({});
      if (!db.tdApiKey) {
        const errs = {};
        tdPositions.forEach((p) => { errs[p.id] = { price: null, currency: p.currency, asOf: null, live: true, error: 'Kein Twelve-Data-Key hinterlegt (Einstellungen)' }; });
        return Promise.resolve(errs);
      }
      return fetchTwelveDataQuotes(tdPositions, db.tdApiKey);
    })();

    const [cgRes, tdRes, fx] = await Promise.all([
      cgPositions.length ? fetchCoinGeckoQuotes(cgPositions) : Promise.resolve({}),
      tdTask,
      needsFx ? fetchFxUSDEUR() : Promise.resolve(fxUSDEUR),
    ]);

    quoteCache = Object.assign({}, quoteCache, cgRes, tdRes);
    if (fx != null) fxUSDEUR = fx;
    lastRefresh = new Date();
    render();
    if (!opts.silent) toast('Kurse aktualisiert');
  } catch (e) {
    console.error(e);
    if (!opts.silent) toast('Kurse konnten nicht aktualisiert werden');
  } finally {
    refreshing = false;
  }
}

function quoteFor(pos) {
  if (pos.source === 'manual') {
    return { price: pos.manualPrice, currency: pos.currency, asOf: pos.manualPriceDate, live: false, error: null };
  }
  return quoteCache[pos.id] || { price: null, currency: pos.currency, asOf: null, live: true, error: null };
}

function toEUR(amount, currency) {
  if (amount == null || !isFinite(amount)) return null;
  if (currency === 'EUR') return amount;
  if (currency === 'USD' && fxUSDEUR) return amount * fxUSDEUR;
  return null;
}

function positionMetrics(pos) {
  const q = quoteFor(pos);
  const qty = num(pos.quantity);
  const buy = num(pos.buyPrice);
  const investedEUR = toEUR(qty * buy, pos.currency);
  let currentEUR = null;
  if (q.price != null) currentEUR = toEUR(qty * q.price, q.currency);
  const gvEUR = (currentEUR != null && investedEUR != null) ? currentEUR - investedEUR : null;
  const gvPct = (gvEUR != null && investedEUR) ? (gvEUR / investedEUR * 100) : null;
  return { q, qty, buy, investedEUR, currentEUR, gvEUR, gvPct };
}

/* Fasst alle Positionen nach Anlageklasse zusammen — Grundlage für die
   Aufteilung auf der Übersicht UND für den Donut im Diagramme-Tab, damit
   beide garantiert dieselben Zahlen zeigen. */
function computeBreakdown() {
  let investedTotal = 0, currentTotal = 0, missing = 0;
  const byType = {};
  db.positions.forEach((pos) => {
    const m = positionMetrics(pos);
    if (m.investedEUR != null) investedTotal += m.investedEUR;
    if (m.currentEUR != null) currentTotal += m.currentEUR; else missing++;
    const t = byType[pos.type] || (byType[pos.type] = { invested: 0, current: 0, count: 0, missing: 0 });
    t.count++;
    if (m.investedEUR != null) t.invested += m.investedEUR;
    if (m.currentEUR != null) t.current += m.currentEUR; else t.missing++;
  });
  return { byType, investedTotal, currentTotal, missing };
}

/* ── Navigation ─────────────────────────────────────────────────── */
const TITLES = { home: 'Übersicht', liste: 'Positionen', charts: 'Diagramme' };
let view = 'home';

function nav(v) {
  view = v;
  $$('.view').forEach((s) => s.classList.toggle('hidden', s.id !== 'view-' + v));
  $$('.tabbar button[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === v));
  $('#viewTitle').textContent = TITLES[v] || '';
  window.scrollTo(0, 0);
  armBack();
  render();
}

function render() {
  if (view === 'home') renderHome();
  else if (view === 'liste') renderListe();
  else if (view === 'charts') renderCharts();
}

function renderHome() {
  const positions = db.positions;
  $('#homeEmpty').classList.toggle('hidden', positions.length > 0);
  if (!positions.length) {
    $('#homeValue').textContent = fmtMoney(0, 'EUR');
    $('#homeChange').textContent = '';
    $('#homeMeta').textContent = 'Noch keine Positionen';
    $('#homeBreakdown').innerHTML = '';
    $('#homeStale').classList.add('hidden');
    return;
  }

  const { byType, investedTotal, currentTotal, missing } = computeBreakdown();
  const gv = currentTotal - investedTotal;
  const gvPct = investedTotal ? (gv / investedTotal * 100) : 0;

  $('#homeValue').textContent = fmtMoney(currentTotal, 'EUR');
  $('#homeChange').innerHTML = `<span class="${gv >= 0 ? 'up' : 'down'}">${gv >= 0 ? '+' : '−'}${fmtMoney(Math.abs(gv), 'EUR')} · ${fmtPct(gvPct)}</span>`;

  const metaParts = [lastRefresh ? `Kurse ${relTime(lastRefresh)} aktualisiert` : 'Kurse noch nicht geladen'];
  if (missing) metaParts.push(`${missing} ohne aktuellen Kurs`);
  $('#homeMeta').innerHTML = `${esc(metaParts.join(' · '))} · <a href="#" id="homeRefreshLink">Aktualisieren</a>`;
  $('#homeRefreshLink').onclick = (e) => { e.preventDefault(); refreshQuotes(); };

  $('#homeBreakdown').innerHTML = TYPE_ORDER.filter((t) => byType[t]).map((t) => {
    const b = byType[t];
    const tgv = b.current - b.invested;
    return `
      <div class="breakdown-row">
        <div>
          <div class="breakdown-name"><span class="type-dot ${t}"></span>${TYPE_ICON[t]} ${esc(TYPE_LABELS[t])}</div>
          <div class="breakdown-sub">${b.count} Position${b.count === 1 ? '' : 'en'}${b.missing ? ' · ' + b.missing + ' ohne Kurs' : ''}</div>
        </div>
        <div class="breakdown-vals">
          <div class="num">${fmtMoney(b.current, 'EUR')}</div>
          <div class="num ${tgv >= 0 ? 'up' : 'down'}" style="font-size:12px">${tgv >= 0 ? '+' : '−'}${fmtMoney(Math.abs(tgv), 'EUR')}</div>
        </div>
      </div>`;
  }).join('');

  const staleManual = positions.filter((p) => p.source === 'manual' && daysSince(p.manualPriceDate) > STALE_DAYS);
  $('#homeStale').classList.toggle('hidden', !staleManual.length);
  if (staleManual.length) {
    $('#homeStale').innerHTML = `<p style="margin:0">⚠️ ${staleManual.length} manuell gepflegte Position${staleManual.length === 1 ? '' : 'en'} könnte${staleManual.length === 1 ? '' : 'n'} einen aktuelleren Kurs gebrauchen.</p>`;
  }
}

function renderListe() {
  const positions = db.positions.slice();
  $('#listeEmpty').classList.toggle('hidden', positions.length > 0);
  const rows = positions.map((pos) => ({ pos, m: positionMetrics(pos) }));
  rows.sort((a, b) => (b.m.currentEUR ?? -1) - (a.m.currentEUR ?? -1));

  $('#listeItems').innerHTML = rows.map(({ pos, m }) => {
    let badge;
    if (pos.source === 'manual') {
      const stale = daysSince(pos.manualPriceDate) > STALE_DAYS;
      const dateTxt = pos.manualPriceDate ? dfShort.format(new Date(pos.manualPriceDate + 'T00:00:00')) : '–';
      badge = `<span class="badge ${stale ? 'stale' : 'manual'}">Manuell · ${dateTxt}</span>`;
    } else if (m.q.error) {
      badge = `<span class="badge stale">Kurs fehlt</span>`;
    } else if (m.q.price != null) {
      badge = `<span class="badge live">Live</span>`;
    } else {
      badge = `<span class="badge">Lädt …</span>`;
    }
    const gv = m.gvEUR, gvPct = m.gvPct;
    return `
      <div class="pos-item" data-id="${pos.id}">
        <div class="pos-main">
          <div class="pos-name">${TYPE_ICON[pos.type]} ${esc(pos.name)}</div>
          <div class="pos-sub">${esc(nfq.format(pos.quantity))} Stk. ${badge}</div>
        </div>
        <div class="pos-vals">
          <div class="pos-value num">${m.currentEUR != null ? fmtMoney(m.currentEUR, 'EUR') : '–'}</div>
          ${gv != null ? `<div class="pos-change num ${gv >= 0 ? 'up' : 'down'}">${gv >= 0 ? '+' : '−'}${fmtMoney(Math.abs(gv), 'EUR')} · ${fmtPct(gvPct)}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* ── Diagramme ──────────────────────────────────────────────────
   Bewusst ohne Chart-Bibliothek: der Donut besteht aus übereinandergelegten
   SVG-Kreisen, deren stroke-dasharray/-dashoffset je Segment berechnet
   werden — ein Standardtrick, der ganz ohne Pfad-Mathematik auskommt. */
function donutSVG(segments, total) {
  const r = 70, cx = 100, cy = 100, sw = 28;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  const rings = segments.map((seg) => {
    const frac = total > 0 ? seg.value / total : 0;
    const len = frac * circ;
    const dashoffset = -acc;
    acc += len;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}"
      stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="${dashoffset.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" />`;
  }).join('');
  const totalTxt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(total);
  return `
    <svg viewBox="0 0 200 200" class="donut" role="img" aria-label="Verteilung nach Anlageklasse">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${sw}" />
      ${rings}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-total">${esc(totalTxt)}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-label">GESAMTWERT</text>
    </svg>`;
}

function renderCharts() {
  const { byType, currentTotal } = computeBreakdown();
  const hasPositions = db.positions.length > 0;
  const hasValue = currentTotal > 0;

  $('#chartsEmpty').classList.toggle('hidden', hasValue);
  $('#chartsContent').classList.toggle('hidden', !hasValue);
  if (!hasValue) {
    $('#chartsEmptyText').textContent = hasPositions
      ? 'Kurse werden geladen …'
      : 'Noch keine Positionen erfasst.';
    return;
  }

  const segments = TYPE_ORDER.filter((t) => byType[t] && byType[t].current > 0)
    .map((t) => ({ type: t, value: byType[t].current, color: TYPE_COLOR_VAR[t] }));

  const legend = segments.map((seg) => {
    const b = byType[seg.type];
    const pct = currentTotal > 0 ? (seg.value / currentTotal * 100) : 0;
    return `
      <div class="breakdown-row">
        <div class="breakdown-name"><span class="type-dot ${seg.type}"></span>${TYPE_ICON[seg.type]} ${esc(TYPE_LABELS[seg.type])}</div>
        <div class="breakdown-vals">
          <div class="num">${fmtMoney(b.current, 'EUR')}</div>
          <div class="muted" style="font-size:12px">${pf2.format(pct)} %</div>
        </div>
      </div>`;
  }).join('');

  $('#chartDonut').innerHTML = `
    <div class="donut-wrap">
      ${donutSVG(segments, currentTotal)}
      <div class="donut-legend">${legend}</div>
    </div>`;

  const TOP_N = 6;
  const rows = db.positions.map((pos) => ({ pos, m: positionMetrics(pos) })).filter((r) => r.m.currentEUR != null);
  rows.sort((a, b) => b.m.currentEUR - a.m.currentEUR);
  const top = rows.slice(0, TOP_N);
  const restValue = rows.slice(TOP_N).reduce((s, r) => s + r.m.currentEUR, 0);

  const barRow = (label, value, color) => {
    const pct = currentTotal > 0 ? (value / currentTotal * 100) : 0;
    return `
      <div class="bar-row">
        <div class="bar-row-head">
          <span class="bar-row-label">${esc(label)}</span>
          <span class="bar-row-val num">${fmtMoney(value, 'EUR')} · ${pf2.format(pct)} %</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(2)}%; background:${color}"></div></div>
      </div>`;
  };

  const bars = top.map(({ pos, m }) => barRow(`${TYPE_ICON[pos.type]} ${pos.name}`, m.currentEUR, TYPE_COLOR_VAR[pos.type])).join('');
  const restRow = restValue > 0 ? barRow(`Sonstige (${rows.length - TOP_N})`, restValue, 'var(--muted)') : '';
  $('#chartHoldings').innerHTML = bars + restRow;
}

/* ── Sheet-System und Dialoge ───────────────────────────────────── */
let sheetSaveFn = null;

function openSheet(title, html, saveFn, saveLabel) {
  armBack();
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheetBody').onclick = null;
  $('#sheetCancel').textContent = 'Abbrechen';
  $('#sheetCancel').onclick = closeSheet;
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

/* ── Neue Position: mehrstufiger Sheet-Flow ────────────────────────
   Typ → (Krypto: Suche) / (Aktie/ETF/Fonds: automatisch suchen oder manuell)
   → Menge & Kaufkurs → speichern. `draft` hält den Stand während des Flows. */
let draft = null;
let searchTimer = null;

function amountsFieldsHTML(d) {
  const qtyLabel = d.type === 'krypto' ? 'Menge (Anzahl Coins)' : 'Menge (Stück/Anteile)';
  const curr = d.currency || 'EUR';
  return `
    <div class="field"><span>${esc(qtyLabel)}</span>
      <input id="f_qty" type="number" inputmode="decimal" step="any" value="${esc(d.quantity ?? '')}" placeholder="z. B. 10"></div>
    <div class="row-2">
      <div class="field"><span>Kaufkurs pro Einheit (${esc(curr)})</span>
        <input id="f_buy" type="number" inputmode="decimal" step="any" value="${esc(d.buyPrice ?? '')}" placeholder="0,00"></div>
      <div class="field"><span>Kaufdatum</span>
        <input id="f_date" type="date" value="${esc(d.buyDate || localISODate(new Date()))}"></div>
    </div>
    <div class="field"><span>Notiz (optional)</span>
      <input id="f_note" type="text" value="${esc(d.note || '')}" placeholder="z. B. Sparplan, Depot XY"></div>
  `;
}

function newItem() {
  draft = {
    type: null, source: null, name: '', currency: 'EUR',
    cgId: null, cgSymbol: null,
    tdSymbol: null, tdMic: null, tdExchange: null, tdCountry: null,
    manualPrice: null, manualPriceDate: null,
    quantity: '', buyPrice: '', buyDate: localISODate(new Date()), note: '',
  };
  stepType();
}

function stepType() {
  openSheet('Neue Position', `
    <div class="stepper"><span class="on"></span><span></span><span></span></div>
    <div class="choice-grid">
      <button class="choice-btn" data-type="aktie" type="button"><span class="ci">📈</span>Aktie</button>
      <button class="choice-btn" data-type="etf" type="button"><span class="ci">📊</span>ETF</button>
      <button class="choice-btn" data-type="fonds" type="button"><span class="ci">🏦</span>Fonds</button>
      <button class="choice-btn" data-type="krypto" type="button"><span class="ci">₿</span>Krypto</button>
    </div>
  `, null);
  $('#sheetBody').onclick = (e) => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    draft.type = b.dataset.type;
    if (draft.type === 'krypto') stepSearchCrypto(); else stepSource();
  };
}

function stepSource() {
  openSheet(TYPE_LABELS[draft.type], `
    <div class="stepper"><span class="on"></span><span class="on"></span><span></span></div>
    <p class="dlg-t">Wie soll der Kurs aktualisiert werden?</p>
    <button class="btn btn-primary btn-block" id="srcAuto" type="button">🔍 Symbol suchen (automatisch, nur US-Börsen)</button>
    <button class="btn btn-block" id="srcManual" type="button">✏️ Manuell eintragen</button>
    <p class="field-hint">Automatische Kurse funktionieren im kostenlosen Tarif nur für an US-Börsen gehandelte Werte. Deutsche/europäische Aktien, ETFs und die meisten Fonds bitte manuell eintragen und gelegentlich aktualisieren.</p>
  `, null);
  $('#srcAuto').onclick = stepSearchStock;
  $('#srcManual').onclick = stepManualName;
  $('#sheetCancel').onclick = stepType;
}

function stepManualName() {
  openSheet(TYPE_LABELS[draft.type], `
    <div class="stepper"><span class="on"></span><span class="on"></span><span></span></div>
    <div class="field"><span>Name</span>
      <input id="f_name" type="text" value="${esc(draft.name || '')}" placeholder="z. B. Deka-MegaTrends"></div>
    <div class="row-2">
      <div class="field"><span>Aktueller Kurs</span>
        <input id="f_price" type="number" inputmode="decimal" step="any" value="${esc(draft.manualPrice || '')}" placeholder="0,00"></div>
      <div class="field"><span>Währung</span>
        <select id="f_curr">
          <option value="EUR"${draft.currency !== 'USD' ? ' selected' : ''}>EUR</option>
          <option value="USD"${draft.currency === 'USD' ? ' selected' : ''}>USD</option>
        </select></div>
    </div>
    <p class="field-hint">Du kannst den Kurs später jederzeit über die Position aktualisieren.</p>
  `, () => {
    const name = $('#f_name').value.trim();
    const price = num($('#f_price').value);
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    if (!price || price <= 0) { toast('Bitte einen gültigen Kurs eingeben'); return; }
    draft.source = 'manual';
    draft.name = name;
    draft.manualPrice = price;
    draft.manualPriceDate = localISODate(new Date());
    draft.currency = $('#f_curr').value;
    stepAmounts();
  }, 'Weiter');
  $('#sheetCancel').onclick = stepSource;
}

function stepSearchStock() {
  openSheet(TYPE_LABELS[draft.type], `
    <div class="stepper"><span class="on"></span><span class="on"></span><span></span></div>
    <div class="search-box"><input id="f_search" type="text" autocomplete="off" placeholder="Name oder Symbol, z. B. Apple, AAPL"></div>
    <div class="search-results" id="searchResults"><p class="muted" style="padding:var(--sp-3)">Tippe, um zu suchen …</p></div>
  `, null);
  $('#sheetCancel').onclick = stepSource;
  const input = $('#f_search');
  input.focus();
  input.oninput = () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { $('#searchResults').innerHTML = '<p class="muted" style="padding:var(--sp-3)">Mindestens 2 Zeichen eingeben …</p>'; return; }
    $('#searchResults').innerHTML = '<p class="muted" style="padding:var(--sp-3)">Suche …</p>';
    searchTimer = setTimeout(() => runStockSearch(q), 350);
  };
}

async function runStockSearch(q) {
  try {
    const data = await (await fetch(`https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(q)}`)).json();
    const items = Array.isArray(data.data) ? data.data.slice(0, 25) : [];
    const box = $('#searchResults');
    if (!box) return; // Nutzer hat den Schritt inzwischen verlassen
    if (!items.length) { box.innerHTML = '<p class="muted" style="padding:var(--sp-3)">Keine Treffer.</p>'; return; }
    box.innerHTML = items.map((it, i) => `
      <div class="search-result" data-i="${i}">
        <span class="sr-name">${esc(it.instrument_name || it.symbol)}</span>
        <span class="sr-sub">${esc(it.symbol)} · ${esc(it.exchange || '')} · ${esc(it.currency || '')}${it.country && it.country !== 'United States' ? ` · <span class="warn-text">${esc(it.country)}, evtl. keine Live-Daten</span>` : ''}</span>
      </div>`).join('');
    box.onclick = (e) => {
      const row = e.target.closest('[data-i]'); if (!row) return;
      const it = items[Number(row.dataset.i)];
      draft.source = 'twelvedata';
      draft.name = it.instrument_name || it.symbol;
      draft.tdSymbol = it.symbol;
      draft.tdMic = it.mic_code || '';
      draft.tdExchange = it.exchange || '';
      draft.tdCountry = it.country || '';
      draft.currency = it.currency || 'EUR';
      stepAmounts();
    };
  } catch (e) {
    const box = $('#searchResults');
    if (box) box.innerHTML = '<p class="muted" style="padding:var(--sp-3)">Suche fehlgeschlagen.</p>';
  }
}

function stepSearchCrypto() {
  draft.source = 'coingecko';
  draft.currency = 'EUR';
  openSheet('Krypto', `
    <div class="stepper"><span class="on"></span><span class="on"></span><span></span></div>
    <div class="search-box"><input id="f_search" type="text" autocomplete="off" placeholder="Name oder Symbol, z. B. Bitcoin, BTC"></div>
    <div class="search-results" id="searchResults"><p class="muted" style="padding:var(--sp-3)">Tippe, um zu suchen …</p></div>
  `, null);
  $('#sheetCancel').onclick = stepType;
  const input = $('#f_search');
  input.focus();
  input.oninput = () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { $('#searchResults').innerHTML = '<p class="muted" style="padding:var(--sp-3)">Mindestens 2 Zeichen eingeben …</p>'; return; }
    $('#searchResults').innerHTML = '<p class="muted" style="padding:var(--sp-3)">Suche …</p>';
    searchTimer = setTimeout(() => runCryptoSearch(q), 350);
  };
}

async function runCryptoSearch(q) {
  try {
    const data = await (await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`)).json();
    const items = Array.isArray(data.coins) ? data.coins.slice(0, 20) : [];
    const box = $('#searchResults');
    if (!box) return;
    if (!items.length) { box.innerHTML = '<p class="muted" style="padding:var(--sp-3)">Keine Treffer.</p>'; return; }
    box.innerHTML = items.map((it, i) => `
      <div class="search-result" data-i="${i}">
        <span class="sr-name">${esc(it.name)}</span>
        <span class="sr-sub">${esc((it.symbol || '').toUpperCase())}${it.market_cap_rank ? ' · Rang ' + it.market_cap_rank : ''}</span>
      </div>`).join('');
    box.onclick = (e) => {
      const row = e.target.closest('[data-i]'); if (!row) return;
      const it = items[Number(row.dataset.i)];
      draft.name = it.name;
      draft.cgId = it.id;
      draft.cgSymbol = (it.symbol || '').toUpperCase();
      stepAmounts();
    };
  } catch (e) {
    const box = $('#searchResults');
    if (box) box.innerHTML = '<p class="muted" style="padding:var(--sp-3)">Suche fehlgeschlagen.</p>';
  }
}

function stepAmounts() {
  openSheet('Menge & Kaufkurs', `
    <div class="stepper"><span class="on"></span><span class="on"></span><span class="on"></span></div>
    <p class="dlg-t">${TYPE_ICON[draft.type]} ${esc(draft.name)}</p>
    ${amountsFieldsHTML(draft)}
  `, finalizeSave, 'Speichern');
  $('#sheetCancel').onclick = () => {
    if (draft.type === 'krypto') stepSearchCrypto();
    else if (draft.source === 'manual') stepManualName();
    else stepSearchStock();
  };
}

function finalizeSave() {
  const qty = num($('#f_qty').value);
  const buy = num($('#f_buy').value);
  const date = $('#f_date').value || localISODate(new Date());
  const note = $('#f_note').value.trim();
  if (!qty || qty <= 0) { toast('Bitte eine gültige Menge eingeben'); return; }
  if (!buy || buy <= 0) { toast('Bitte einen gültigen Kaufkurs eingeben'); return; }

  const pos = {
    id: uid(),
    type: draft.type,
    source: draft.source,
    name: draft.name,
    currency: draft.currency || 'EUR',
    cgId: draft.cgId || null,
    cgSymbol: draft.cgSymbol || null,
    tdSymbol: draft.tdSymbol || null,
    tdMic: draft.tdMic || null,
    tdExchange: draft.tdExchange || null,
    tdCountry: draft.tdCountry || null,
    manualPrice: draft.source === 'manual' ? num(draft.manualPrice) : null,
    manualPriceDate: draft.source === 'manual' ? draft.manualPriceDate : null,
    quantity: qty,
    buyPrice: buy,
    buyDate: date,
    note,
  };
  db.positions.push(pos);
  save();
  closeSheet();
  render();
  toast('Position hinzugefügt');
  if (pos.source !== 'manual') refreshQuotes({ silent: true });
}

/* ── Position bearbeiten / löschen ─────────────────────────────── */
function openItem(id) {
  const pos = db.positions.find((p) => p.id === id);
  if (!pos) return;
  const manualBlock = pos.source === 'manual' ? `
    <div class="row-2">
      <div class="field"><span>Aktueller Kurs (${esc(pos.currency)})</span>
        <input id="f_price" type="number" inputmode="decimal" step="any" value="${esc(pos.manualPrice ?? '')}"></div>
      <div class="field"><span>Stand vom</span>
        <input id="f_pdate" type="date" value="${esc(pos.manualPriceDate || localISODate(new Date()))}"></div>
    </div>` : `
    <p class="field-hint">Kursquelle: ${pos.source === 'coingecko' ? 'CoinGecko (automatisch)' : 'Twelve Data · ' + esc(pos.tdSymbol) + (pos.tdExchange ? ' · ' + esc(pos.tdExchange) : '')}</p>`;

  openSheet(pos.name, `
    <p class="dlg-t">${TYPE_ICON[pos.type]} ${esc(TYPE_LABELS[pos.type])}</p>
    ${manualBlock}
    ${amountsFieldsHTML(pos)}
    <button class="btn btn-danger btn-block" id="btnDeletePos" type="button">Position löschen</button>
  `, () => {
    const qty = num($('#f_qty').value);
    const buy = num($('#f_buy').value);
    const date = $('#f_date').value || pos.buyDate;
    const note = $('#f_note').value.trim();
    if (!qty || qty <= 0) { toast('Bitte eine gültige Menge eingeben'); return; }
    if (!buy || buy <= 0) { toast('Bitte einen gültigen Kaufkurs eingeben'); return; }
    pos.quantity = qty; pos.buyPrice = buy; pos.buyDate = date; pos.note = note;
    if (pos.source === 'manual') {
      const price = num($('#f_price').value);
      if (price > 0) { pos.manualPrice = price; pos.manualPriceDate = $('#f_pdate').value || localISODate(new Date()); }
    }
    save(); closeSheet(); render(); toast('Position aktualisiert');
  }, 'Speichern');

  $('#btnDeletePos').onclick = () => {
    askSheet('Position löschen?', `„${pos.name}" wird endgültig entfernt.`, 'Löschen', () => {
      db.positions = db.positions.filter((p) => p.id !== id);
      delete quoteCache[id];
      save(); closeSheet(); render(); toast('Gelöscht');
    }, () => openItem(id), true);
  };
}

/* ── Einstellungen ──────────────────────────────────────────────── */
function openSettings() {
  openSheet('Einstellungen', `
    <div class="settings-group">
      <h3>Darstellung</h3>
      <div class="settings-row">
        <span class="st-label">Theme</span>
        <div class="theme-switch">
          <button data-theme-btn="dark" type="button" class="${db.theme === 'dark' ? 'on' : ''}">Dunkel</button>
          <button data-theme-btn="light" type="button" class="${db.theme === 'light' ? 'on' : ''}">Hell</button>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <h3>Kursdaten</h3>
      <p class="field-hint">Für automatische Kurse von US-Aktien/ETFs wird ein kostenloser
        <a href="https://twelvedata.com/pricing" target="_blank" rel="noopener">Twelve-Data-API-Key</a>
        benötigt (ohne Kreditkarte, 800 Anfragen/Tag). Krypto-Kurse (CoinGecko) funktionieren ohne Key.
        Deutsche/europäische Werte und die meisten Fonds pflegst du manuell.</p>
      <div class="field"><span>Twelve-Data API-Key</span>
        <input id="f_tdkey" type="text" autocomplete="off" value="${esc(db.tdApiKey || '')}" placeholder="dein API-Key"></div>
    </div>

    <div class="settings-group">
      <h3>Daten</h3>
      <button class="btn btn-block" id="btnExport" type="button">Backup exportieren</button>
      <button class="btn btn-block" id="btnImport" type="button">Backup importieren</button>
      <input type="file" id="fileImport" accept="application/json,.json" class="hidden">
    </div>

    <div class="settings-group">
      <h3>App</h3>
      <div class="settings-row"><span class="st-label">Version</span><span class="st-val">${esc(APP_VERSION)}</span></div>
      <button class="btn btn-block" id="btnCheckUpdate" type="button">Nach Update suchen</button>
    </div>
  `, null);
  $('#sheetCancel').textContent = 'Fertig';

  $$('[data-theme-btn]').forEach((b) => { b.onclick = () => { applyTheme(b.dataset.themeBtn); save(); openSettings(); }; });
  $('#f_tdkey').onchange = () => { db.tdApiKey = $('#f_tdkey').value.trim(); save(); };
  $('#btnExport').onclick = exportBackup;
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = (e) => importBackup(e.target.files[0]);
  $('#btnCheckUpdate').onclick = async () => {
    if (!('serviceWorker' in navigator)) { toast('Kein Service Worker verfügbar'); return; }
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) { try { await reg.update(); } catch (e) { /* offline o.ä. */ } }
    const changed = await applyIfNewer(true);
    if (!changed) toast('Du hast die neueste Version');
  };
}

/* ── Backup ─────────────────────────────────────────────────────── */
function exportBackup() {
  db.lastBackup = new Date().toISOString();
  save();
  const payload = Object.assign({
    meta: { app: 'Portfolio Tracker', appVersion: APP_VERSION, format: db.v, exported: db.lastBackup },
  }, db);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `portfolio-${new Date().toISOString().slice(0, 10)}.json`;
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
        `Das Backup${stand} enthält ${d.positions.length} Positionen. Deine jetzigen Daten werden dabei ersetzt.`,
        'Laden', () => {
          db = normalize(d);
          quoteCache = {}; lastRefresh = null;
          applyTheme(db.theme);
          save(); closeSheet(); render(); toast('Backup geladen');
          refreshQuotes({ silent: true });
        }, openSettings);
    } catch (e) { infoSheet('Import fehlgeschlagen', e.message, openSettings); }
  };
  r.readAsText(file);
}

/* ── Zurück-Taste ───────────────────────────────────────────────
   Ohne Zutun beendet ein einziger Druck auf Zurück die installierte App —
   viel zu leicht aus Versehen. Deshalb liegt ein zusätzlicher Verlaufseintrag
   („Wächter") über der App: Zurück landet dann bei uns statt beim System. */
let guardUp = false;
let leaving = false;

function pushGuard() {
  if (guardUp) return;
  guardUp = true;
  try { history.pushState({ g: 1 }, ''); } catch (e) { guardUp = false; }
}
function armBack() { pushGuard(); }

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
      document.addEventListener('pointerdown', pushGuard, { once: true });
      return;
    }
    if (!$('#sheet').classList.contains('hidden')) { $('#sheetCancel').click(); pushGuard(); return; }
    if (view !== 'home') { nav('home'); pushGuard(); return; }

    askSheet('App verlassen?', 'Möchtest Du die App wirklich schließen?', 'Verlassen', leaveApp);
  });
}

/* ── Update-Erkennung ───────────────────────────────────────────── */
async function cachedVersion() {
  if (!('caches' in window)) return null;
  for (const k of await caches.keys()) {
    if (!k.startsWith('pf-')) continue;
    const c = await caches.open(k);
    const res = (await c.match('./app.js')) || (await c.match('app.js'));
    if (!res) continue;
    const m = (await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/);
    if (m) return m[1];
  }
  return null;
}

let reloading = false;
async function applyIfNewer(announce) {
  if (reloading) return false;
  const cv = await cachedVersion();
  if (!cv || cv === APP_VERSION) return false;
  if (sessionStorage.getItem('pf-reload') === cv) return false;
  if (!$('#sheet').classList.contains('hidden')) {
    toast(`Version ${cv} bereit — App neu starten`);
    return true;
  }
  reloading = true;
  sessionStorage.setItem('pf-reload', cv);
  if (announce) toast(`Version ${cv} wird geladen …`);
  setTimeout(() => location.reload(), announce ? 700 : 0);
  return true;
}

function wireUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const watch = (w) => {
    if (!w) return;
    if (w.state === 'activated') { applyIfNewer(false); return; }
    w.addEventListener('statechange', () => { if (w.state === 'activated') applyIfNewer(false); });
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

/* ── Verdrahtung ────────────────────────────────────────────────── */
function wire() {
  document.body.addEventListener('click', (e) => {
    const n = e.target.closest('[data-nav]'); if (n) { nav(n.dataset.nav); return; }
    const r = e.target.closest('.pos-item[data-id]'); if (r) { openItem(r.dataset.id); return; }
  });
  $('#btnNew').onclick = newItem;
  $('#btnSettings').onclick = openSettings;
  $('#homeEmptyAdd').onclick = newItem;
  $('#sheetCancel').onclick = closeSheet;
  $('#scrim').onclick = closeSheet;
  $('#sheetSave').onclick = () => sheetSaveFn && sheetSaveFn();
}

/* ── Start ──────────────────────────────────────────────────────── */
load();
applyTheme(db.theme);
wire();
wireBack();
nav('home');

if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
if (db.positions.some((p) => p.source !== 'manual')) refreshQuotes({ silent: true });

wireUpdates();
