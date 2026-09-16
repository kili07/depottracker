# Portfolio Tracker

Ein eigener, schlanker getquin-Klon für dein Handy: Aktien, ETFs, Fonds und
Krypto an einem Ort erfassen und den Depotwert im Blick behalten.

## Was die App kann

- Positionen anlegen: Aktie, ETF, Fonds oder Krypto, mit Menge, Kaufkurs,
  Kaufdatum und optionaler Notiz.
- **Krypto**: Kurse laufen automatisch live über [CoinGecko](https://www.coingecko.com)
  (kostenlos, kein Konto nötig).
- **US-Aktien/ETFs**: Kurse laufen automatisch live über [Twelve Data](https://twelvedata.com),
  sobald du in den Einstellungen einen kostenlosen API-Key hinterlegt hast.
- **Deutsche/europäische Aktien, ETFs und die meisten Fonds**: Dafür gibt es
  keine zuverlässige kostenlose Live-API ohne eigenes Backend (das wurde
  bewusst so entschieden, siehe unten) — diese Kurse trägst du manuell ein
  und aktualisierst sie bei Bedarf über die Position. Die App weist ab 14
  Tagen darauf hin, wenn ein manueller Kurs alt wird.
- Übersicht mit Gesamtwert, Gewinn/Verlust und Aufteilung nach Anlageklasse.
- Alle Daten liegen nur auf deinem Gerät (`localStorage`) — Backup-Export/
  -Import als JSON-Datei in den Einstellungen.
- Installierbar als App auf dem Homescreen, danach offline nutzbar (nur die
  Kursabfragen selbst brauchen Internet).

### Warum manuell für deutsche/europäische Werte?

Die kostenlosen Tarife der gängigen Kurs-APIs (Twelve Data, Finnhub,
Financial Modeling Prep) sind auf US-Börsen beschränkt — europäische Börsen
und klassische deutsche Investmentfonds gibt es dort erst in kostenpflichtigen
Tarifen. Die einzige Quelle mit guter Abdeckung (Yahoo Finance) blockt
Anfragen direkt aus dem Browser. Ein eigener Server könnte das umgehen,
widerspricht aber dem Ziel dieser App: keine eigene Infrastruktur, keine
laufenden Kosten, funktioniert in fünf Jahren noch genauso.

## Installation auf dem Handy

1. Repo auf [github.com/new](https://github.com/new) anlegen (**Public** —
   GitHub Pages ist bei privaten Repos kostenpflichtig).
2. Über „uploading an existing file" den **Inhalt** dieses Ordners hochladen
   (nicht den Ordner selbst — `index.html` muss im Wurzelverzeichnis liegen).
3. *Settings → Pages → Deploy from a branch → `main` → `/ (root)`* → Save.
4. Nach ein bis zwei Minuten ist die App unter
   `https://<dein-github-name>.github.io/<repo-name>/` erreichbar.
5. Auf dem Handy in Chrome/Safari öffnen → Menü → **Zum Startbildschirm
   hinzufügen**. Danach startet sie wie eine normale App.

## Twelve-Data-API-Key einrichten (optional, für US-Live-Kurse)

1. Kostenlos registrieren auf [twelvedata.com/pricing](https://twelvedata.com/pricing)
   (keine Kreditkarte nötig).
2. Den API-Key kopieren.
3. In der App: Einstellungen (Zahnrad oben rechts) → Feld „Twelve-Data
   API-Key" → einfügen.

Ohne Key funktionieren Krypto-Kurse trotzdem, und Aktien/ETF/Fonds-Positionen
lassen sich weiterhin manuell anlegen und pflegen.

## Lokal testen

```
python3 -m http.server 8123
```

Dann `http://localhost:8123` im Browser öffnen.

## Daten sichern

In den Einstellungen: **Backup exportieren** lädt eine JSON-Datei mit allen
Positionen herunter. **Backup importieren** spielt sie zurück (ersetzt die
aktuellen Daten). Da alles nur lokal auf dem Gerät liegt, ist das die einzige
Möglichkeit, Daten geräteübergreifend mitzunehmen oder vor „Browserdaten
löschen" zu schützen.
