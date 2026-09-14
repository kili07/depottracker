'use strict';
/* ═══════════════════════════════════════════════════════════════
   quotes.js — Kursabruf

   Der EINZIGE Teil der App, der ins Netz geht. Bewusst eigene Datei: so
   lässt sich mit einem Blick prüfen, was hinausgeht, und der Rest der App
   bleibt nachweislich offline.

   WAS HINAUSGEHT: ausschließlich Wertpapier-Kennungen (Symbol, Börsenplatz,
   Krypto-Id) und Währungskürzel. Niemals Stückzahlen, Einstandskurse,
   Depotwerte, Namen oder sonst irgendetwas aus dem Datensatz. Das Modul
   bekommt keinen Zugriff auf `db` — es sieht nur, was ihm übergeben wird.

   Quellen (alle ohne Registrierung erreichbar, alle mit CORS):
     Aktien/ETF/Fonds  twelvedata.com   — Suche frei, Kurse mit eigenem
                                          kostenlosen Schlüssel
     Krypto            coingecko.com    — ohne Schlüssel
     Devisen           frankfurter.dev  — ohne Schlüssel
   ═══════════════════════════════════════════════════════════════ */

window.Quotes = (function () {

  const TD = 'https://api.twelvedata.com';
  const CG = 'https://api.coingecko.com/api/v3';
  const FX = 'https://api.frankfurter.dev/v1';

  const TIMEOUT = 12000;

  /** JSON holen, mit Zeitlimit und verständlicher Fehlermeldung. Ohne eigenes
      Zeitlimit hängt ein Abruf im Funkloch bis zum Timeout des Browsers —
      gefühlt ewig, und der Knopf dreht sich weiter. */
  function jget(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT);
    return fetch(url, { signal: ctl.signal, cache: 'no-store', referrerPolicy: 'no-referrer' })
      .then((r) => {
        if (r.status === 429) throw new Error('Zu viele Abrufe — kurz warten');
        if (!r.ok) throw new Error('Server antwortet mit ' + r.status);
        return r.json();
      })
      .catch((e) => {
        if (e.name === 'AbortError') throw new Error('Zeitüberschreitung');
        if (e instanceof TypeError) throw new Error('Keine Verbindung');
        throw e;
      })
      .finally(() => clearTimeout(t));
  }

  const enc = encodeURIComponent;

  /* ── Devisen ──────────────────────────────────────────────────
     Kurse kommen je nach Börsenplatz in USD, CHF, GBP oder GBp (Pence).
     Angezeigt wird alles in Euro, also braucht es Umrechnungskurse. */

  /** Liefert ein Objekt "1 EUR = x Fremdwährung". Die Umkehrung macht rate(). */
  function fetchFx() {
    const syms = 'USD,GBP,CHF,JPY,SEK,DKK,NOK,PLN,CZK,CAD,AUD,HKD';
    return jget(`${FX}/latest?base=EUR&symbols=${syms}`).then((d) => {
      if (!d || !d.rates) throw new Error('Devisenkurse unlesbar');
      return d.rates;
    });
  }

  /** Umrechnungsfaktor Fremdwährung → EUR. `rates` ist das Objekt aus fetchFx(). */
  function rate(cur, rates) {
    if (!cur) return 1;
    const c = String(cur).trim();
    if (c === 'EUR' || c === '€') return 1;
    /* GBp/GBX sind Pence, nicht Pfund — die Londoner Börse notiert ETFs so.
       Ohne diese Zeile ist die Position um den Faktor 100 zu wertvoll. */
    if (c === 'GBp' || c === 'GBX') {
      const g = rates && rates.GBP;
      return g ? 1 / g / 100 : 0;
    }
    const r = rates && rates[c.toUpperCase()];
    return r ? 1 / r : 0;      // 0 = unbekannt, der Aufrufer zeigt dann einen Hinweis
  }

  /* ── Suche ────────────────────────────────────────────────────
     Beide Suchen laufen ohne Schlüssel. Deshalb lässt sich eine Position
     bequem anlegen, auch bevor ein Twelve-Data-Schlüssel hinterlegt ist. */

  /** Aktien, ETFs und Fonds. Liefert höchstens `limit` Treffer, europäische
      Handelsplätze zuerst — ein deutsches Depot hält meist die XETRA-Gattung. */
  function searchSecurity(q, limit) {
    if (!q || q.trim().length < 2) return Promise.resolve([]);
    return jget(`${TD}/symbol_search?symbol=${enc(q.trim())}&outputsize=30`).then((d) => {
      const rows = (d && d.data) || [];
      const pref = { XETR: 0, XFRA: 1, XSTU: 2, XMUN: 2, XDUS: 2, XAMS: 3, XPAR: 3,
                     XMIL: 3, XSWX: 4, XLON: 5, XNAS: 6, XNYS: 6 };
      return rows
        .map((r) => ({
          sym: r.symbol,
          mic: r.mic_code || '',
          exch: r.exchange || '',
          name: r.instrument_name || r.symbol,
          cur: r.currency || 'EUR',
          type: r.instrument_type || '',
          country: r.country || '',
        }))
        .sort((a, b) => (pref[a.mic] == null ? 9 : pref[a.mic])
                      - (pref[b.mic] == null ? 9 : pref[b.mic]))
        .slice(0, limit || 12);
    });
  }

  /** Krypto über CoinGecko. Die `id` (z.B. "bitcoin") ist der Schlüssel für
      den Kursabruf, nicht das Kürzel — "eth" ist mehrfach vergeben. */
  function searchCrypto(q, limit) {
    if (!q || q.trim().length < 2) return Promise.resolve([]);
    return jget(`${CG}/search?query=${enc(q.trim())}`).then((d) => {
      const rows = (d && d.coins) || [];
      return rows.slice(0, limit || 12).map((c) => ({
        sym: (c.symbol || '').toUpperCase(),
        cgId: c.id,
        name: c.name,
        cur: 'EUR',                     // CoinGecko liefert direkt in Euro
        exch: 'CoinGecko',
        rank: c.market_cap_rank,
      }));
    });
  }

  /* ── Kursabruf ────────────────────────────────────────────── */

  /** Krypto: ein Abruf für beliebig viele Münzen. */
  function fetchCrypto(ids) {
    if (!ids.length) return Promise.resolve({});
    const url = `${CG}/simple/price?ids=${enc(ids.join(','))}`
              + '&vs_currencies=eur&include_24hr_change=true';
    return jget(url).then((d) => {
      const out = {};
      ids.forEach((id) => {
        const v = d && d[id];
        if (!v || typeof v.eur !== 'number') { out[id] = { err: 'Unbekannte Münze' }; return; }
        const ch = typeof v.eur_24h_change === 'number' ? v.eur_24h_change : null;
        out[id] = {
          price: v.eur,
          cur: 'EUR',
          // CoinGecko liefert die Veränderung in Prozent, nicht den Vortagskurs
          prev: ch == null ? null : v.eur / (1 + ch / 100),
        };
      });
      return out;
    });
  }

  /** Wertpapiere: Twelve Data erlaubt mehrere Symbole je Abruf, aber nur einen
      Börsenplatz. Also nach mic_code gruppieren — das spart bei einem Depot mit
      lauter XETRA-Werten den Großteil der Abrufe. Das Minutenkontingent des
      kostenlosen Zugangs zählt trotzdem je Symbol. */
  function fetchSecurities(items, key) {
    if (!items.length) return Promise.resolve({});
    if (!key) {
      const out = {};
      items.forEach((i) => { out[i.k] = { err: 'Kein Twelve-Data-Schlüssel' }; });
      return Promise.resolve(out);
    }
    const groups = {};
    items.forEach((i) => { (groups[i.mic || '-'] = groups[i.mic || '-'] || []).push(i); });

    const out = {};
    // Nacheinander, nicht parallel: der kostenlose Zugang riegelt bei
    // gleichzeitigen Abrufen mit 429 ab und dann ist die ganze Runde hin.
    return Object.keys(groups).reduce((chain, mic) => chain.then(() => {
      const grp = groups[mic];
      const syms = grp.map((i) => i.sym).join(',');
      let url = `${TD}/quote?symbol=${enc(syms)}&apikey=${enc(key)}`;
      if (mic !== '-') url += `&mic_code=${enc(mic)}`;
      return jget(url).then((d) => {
        if (d && d.status === 'error') throw new Error(tdMsg(d));
        // Ein einzelnes Symbol kommt flach zurück, mehrere als Objekt je Symbol
        const pick = (i) => (grp.length === 1 ? d : d && d[i.sym]);
        grp.forEach((i) => {
          const q = pick(i);
          if (!q || q.status === 'error') { out[i.k] = { err: (q && tdMsg(q)) || 'Kein Kurs' }; return; }
          const p = parseFloat(q.close);
          if (!isFinite(p)) { out[i.k] = { err: 'Kein Kurs' }; return; }
          const pc = parseFloat(q.previous_close);
          out[i.k] = {
            price: p,
            cur: q.currency || i.cur || 'EUR',
            prev: isFinite(pc) ? pc : null,
            name: q.name || '',
          };
        });
      }).catch((e) => {
        grp.forEach((i) => { out[i.k] = { err: e.message }; });
      });
    }), Promise.resolve()).then(() => out);
  }

  /** Die Fehlertexte von Twelve Data sind englisch und lang — für die drei
      Fälle, die in der Praxis vorkommen, eine kurze deutsche Fassung. */
  function tdMsg(d) {
    const m = String((d && d.message) || '');
    if (d && d.code === 401) return 'Schlüssel ungültig';
    if (d && d.code === 429) return 'Tages- oder Minutenlimit erreicht';
    if (/not found|no data/i.test(m)) return 'Symbol nicht gefunden';
    return m.slice(0, 80) || 'Abruf fehlgeschlagen';
  }

  /* ── Sammelabruf ──────────────────────────────────────────────
     `items`: [{k, sym, mic, cur, cgId}] — `k` ist ein beliebiger Schlüssel des
     Aufrufers (bei uns die Positions-Id), damit die Antwort zuordenbar bleibt,
     ohne dass dieses Modul die Position selbst kennen muss. */
  function fetchAll(items, opts) {
    opts = opts || {};
    const crypto = items.filter((i) => i.cgId);
    const secs = items.filter((i) => !i.cgId && i.sym);
    const ids = Array.from(new Set(crypto.map((i) => i.cgId)));

    return Promise.all([
      fetchCrypto(ids).catch((e) => ({ __err: e.message })),
      fetchSecurities(secs, opts.tdKey),
      opts.needFx ? fetchFx().catch(() => null) : Promise.resolve(null),
    ]).then(([cg, sec, fx]) => {
      const res = {};
      crypto.forEach((i) => {
        const v = cg.__err ? { err: cg.__err } : (cg[i.cgId] || { err: 'Kein Kurs' });
        res[i.k] = v;
      });
      secs.forEach((i) => { res[i.k] = sec[i.k] || { err: 'Kein Kurs' }; });
      return { quotes: res, fx: fx };
    });
  }

  return {
    fetchAll,
    fetchFx,
    rate,
    searchSecurity,
    searchCrypto,
  };
})();
