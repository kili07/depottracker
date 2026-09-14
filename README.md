# Depot

Depotübersicht fürs Handy: Aktien, ETFs, Fonds, Krypto, Anleihen und Cash in
einer Ansicht. Läuft offline, installiert sich als App auf den Startbildschirm
und braucht kein Konto. Alle Daten bleiben auf dem Gerät.

Keine Frameworks, kein Build, keine Abhängigkeiten — fünf Dateien und ein paar
Icons. Herunterladen, hochladen, fertig.

---

## Was sie kann

**Übersicht**
Depotwert, Tagesveränderung und Gesamtergebnis auf einen Blick. Darunter der
Depotverlauf als Liniendiagramm, die Aufteilung nach Anlageklasse als Ring —
wahlweise mit Zielquoten und der Abweichung davon — und die größten Gewinner
und Verlierer.

**Depot**
Alle Positionen, nach Anlageklasse gruppiert oder nach Klasse gefiltert,
sortierbar nach Wert, Gewinn, Name oder Tagesveränderung. Jede Zeile zeigt
Wert, Ergebnis in Prozent und das Gewicht im Depot als Balken.

**Kurse**
Alle Positionen untereinander zum Durchtippen — oder per Knopfdruck abrufen.

**Journal**
Jede Buchung mit Datum, Stückzahl, Kurs und Gebühren, nach Monat gruppiert.
Oben die Jahressumme der Ausschüttungen und der realisierten Gewinne.

**Buchungen**
Käufe, Verkäufe und Ausschüttungen. Der Ø-Einstand wird beim Kauf
fortgeschrieben, beim Verkauf der realisierte Gewinn festgehalten. Wer ein
Verrechnungskonto als Cash-Position führt, kann es bei jeder Buchung
mitlaufen lassen.

---

## Wie sie rechnet

Die App fängt beim **heutigen Bestand** an. Beim Anlegen einer Position gibst
Du Stückzahl und Ø-Einstand ein — das wird als Buchung „Anfangsbestand"
festgehalten. Alles Weitere buchst Du ab dann laufend.

Bestand, Einstand, realisierter Gewinn und Ausschüttungen werden **immer aus
den Buchungen neu gerechnet**, nie fortgeschrieben. Deshalb lässt sich jede
Buchung gefahrlos löschen: die Position rechnet sich anschließend selbst neu.

Der Depotverlauf entsteht ab dem Tag der Einrichtung — je Tag ein Wert.
Rückwirkend lässt er sich nicht befüllen, die Kurse von gestern gibt es nicht
mehr.

Positionen in Fremdwährung werden über den Devisenkurs in Euro umgerechnet.
Fehlt der Kurs, rechnet die App 1:1 und markiert die Zeile mit `FX?` — das ist
ehrlicher als eine Position, die plötzlich null wert ist.

---

## Kurse abrufen

Der Kursabruf ist der **einzige** Teil, der ins Netz geht. Er steckt komplett
in `quotes.js`, damit sich mit einem Blick prüfen lässt, was hinausgeht.

Hinaus gehen ausschließlich **Wertpapierkennungen**: Symbol, Börsenplatz,
Währung, Krypto-Kennung. Niemals Stückzahlen, Einstände, Depotwerte oder
sonst etwas aus den Daten — das Modul bekommt den Datensatz gar nicht zu
sehen.

| Was | Woher | Schlüssel |
|---|---|---|
| Aktien, ETFs, Fonds, Anleihen | twelvedata.com | kostenlos, selbst anlegen |
| Krypto | coingecko.com | keiner nötig |
| Devisenkurse | frankfurter.dev | keiner nötig |

**Schlüssel einrichten:** auf twelvedata.com kostenlos registrieren, den
API-Key kopieren, in der App unter *Einstellungen → Kursquelle & Schlüssel*
einfügen. Der kostenlose Zugang erlaubt rund 800 Abrufe am Tag und acht je
Minute — für ein Depot mit zwei Dutzend Positionen reichlich.

Ohne Schlüssel funktionieren Krypto und Devisen trotzdem, und alle anderen
Kurse lassen sich in der Ansicht *Kurse* von Hand eintragen. Die
**Wertpapiersuche funktioniert auch ohne Schlüssel** — eine Position anzulegen
geht also sofort.

---

## Backup

Die Daten liegen ausschließlich im Speicher dieses Browsers. „Browserdaten
löschen", ein Gerätewechsel oder ein zu voller Speicher nehmen sie mit —
ohne Vorwarnung.

*Einstellungen → Backup speichern* legt eine JSON-Datei mit dem vollständigen
Datensatz ab. *Backup laden* spielt sie zurück. Die App erinnert von sich aus,
wenn das letzte Backup über 30 Tage her ist.

---

## Installieren

Auf dem Handy in Chrome öffnen → ⋮ → **Zum Startbildschirm hinzufügen**. Danach
startet sie wie eine normale App, im Vollbild und offline.

## Lokal testen

```
python3 -m http.server 8123
```

Dann `http://localhost:8123` aufrufen.

Beim Entwickeln stört der Offline-Cache: vor dem Neuladen einmal

```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
```

in der Konsole ausführen, sonst kommt die alte Fassung zurück.

---

## Dateien

| | |
|---|---|
| `index.html` | Gerüst, alle Ansichten als `<section>` |
| `style.css` | Tokens → Themes → Komponenten |
| `app.js` | Datenmodell, Berechnung, Ansichten, Formulare |
| `quotes.js` | Kursabruf — der einzige Teil mit Netzwerkzugriff |
| `sw.js` | Service Worker, Offline-Cache |
| `manifest.webmanifest` | macht sie installierbar |

Bei jeder Änderung an einer Datei `CACHE` in `sw.js` und `APP_VERSION` in
`app.js` hochzählen — sonst liefert der Service Worker die alte Fassung weiter.
Die laufende Version steht in den Einstellungen.
