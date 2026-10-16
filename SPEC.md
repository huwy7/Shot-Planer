# SPEC – Shot-Planer Street

Stand: 2026-10-16. Quelle: Anforderungskatalog vom 2026-10-14, ergänzt um die Review-Punkte vom 2026-10-16.
Diese Datei ist die einzige Wahrheit zu Umfang und Entscheiden.

## 1. Ziel und Rahmen

Der Shot-Planer zeigt pro gespeichertem Street-Spot, wann in den nächsten Tagen gutes Licht auf
Strassenniveau zu erwarten ist. Er ersetzt das manuelle Kombinieren von Wetter-App, Sonnenstand-App und Karte.

| Punkt | Festlegung |
| --- | --- |
| Nutzer | Nur ich (Eigengebrauch), Street/Stadt |
| Geräte | iPhone und iPad, installierbar als PWA (Homescreen) |
| Hosting | GitHub Pages (`https://huwy7.github.io/Shot-Planer/`), rein statisch, kein eigener Server |
| Daten | Lokal im Browser je Gerät, kein Sync |
| Hinweise | Nur in der App, keine Push-Benachrichtigungen |
| Laufende Kosten | 0 CHF (kostenlose APIs ohne Key) |
| Startort Karte | Bern (46.948, 7.447), Zoom 14 |

**Nicht-Ziele (v1):** Landschaft, Nacht/Mond, Push, Geräte-Sync, Kalender, Bildverwaltung, Spot-Import aus Fotos.

## 2. Funktionale Anforderungen

Kern ist ein Score pro Spot und Zeitfenster, der Licht- und Wetterkriterien kombiniert und seine Begründung zeigt.

### Spots
- **F1** Spot per Pin auf der Karte anlegen: Name, Notiz, Koordinate.
- **F2** Strassenachse pro Spot festlegen. Standard: Linie auf der Karte ziehen (zwei Punkte → Peilung).
  Zusätzlich Grad-Eingabe zum Feinjustieren. Gespeichert als Achse 0–180° (eine Strasse hat zwei Richtungen).
  Ohne Achse ist F6 nicht möglich.
- **F3** Spots bearbeiten, löschen, als Liste und auf der Karte anzeigen.
- **F3a** Minimale sichtbare Sonnenhöhe pro Spot in Grad (Gebäudeschatten, Default 0°).
  Darunter gilt die Sonne am Spot als verdeckt. Ersetzt die freie Notiz, damit der Score es verwerten kann.

### Licht
- **F4** Golden Hour (Sonnenhöhe −4° bis +6°) und Blue Hour (−6° bis −4°) pro Tag und Spot, morgens und abends.
- **F5** Sonnenhöhe und daraus abgeleitete Schattenlänge (Faktor 1/tan(Höhe)) im Tagesverlauf.
- **F6** Zeitfenster relativ zur Strassenachse, Toleranz einstellbar (Default ±10°):
  - **Entlang:** Sonnenazimut parallel zur Achse (beide Richtungen) = Licht die Gasse entlang und Streiflicht
    auf den Fassaden. Angezeigt wird, aus welcher Richtung die Sonne kommt.
  - **Quer:** Sonnenazimut rechtwinklig zur Achse = Frontallicht auf die der Sonne zugewandte Fassadenseite,
    Schattenkante über die Gasse. Angezeigt wird die beleuchtete Seite.
  - Für beide muss die Sonne über der Spot-Mindesthöhe (F3a, mindestens 0°) und unter einer Maximalhöhe
    liegen (Default 20°, einstellbar), sonst fällt kein Licht in die Gasse.

### Wetter
- **F7** Bewölkung stündlich in drei Höhen (tief/mittel/hoch), eingeordnet als hart / wechselnd / weich.
- **F8** Nasse Strassen: Niederschlag in den letzten 1–3 h, aktuell trocken = Reflexions-Fenster.
- **F9** Nebel/Dunst über Sichtweite und Luftfeuchte.
- **F10** Aktiver Regen und Wind als eigene Kategorie (kein Malus, sondern Motiv).

### Bewertung und Ansicht
- **F11** Score 0–100 pro Spot und Stunde für die nächsten 3–5 Tage (Reichweite der Wetterprognose).
- **F12** Pro Spot die 3 besten Zeitfenster mit Ampel und Begründung
  (z. B. "Abendlicht entlang Gasse, aufgelockert"). Begründungen nennen nur Kriterien der aktiven Stufe.
- **F13** Übersicht: alle Spots, sortiert nach nächstem guten Fenster.
- **F14** Gewichtung der Kriterien in den Einstellungen anpassbar.
- **F15** Treffer festhalten: Spot + Zeitpunkt als "gut" / "schlecht" markieren, mit den damaligen
  Score-Eingaben gespeichert. Grundlage für die spätere Kalibrierung der Score-Regeln.

### Score-Logik
Ein Satz einfacher, sichtbarer Regeln statt Blackbox. Jede Regel liefert Teilpunkte und einen Begründungstext.
Die Regeln werden in M4 festgelegt und hier dokumentiert.

## 3. Nicht-funktionale Anforderungen

- **N1** Bedienbar auf iPhone (Hochformat) und iPad, Dark Mode, Safe Areas, Touch-Ziele ≥ 44 px.
- **N2** Score-Berechnung lokal unter 1 s für 20 Spots.
- **N3** Wetterdaten max. alle 60 min neu laden, sonst Cache. Alle Spots in einem Request (Open-Meteo erlaubt mehrere Koordinaten).
- **N4** JSON-Export und -Import der Spots als Backup (kein Sync, aber Schutz vor Datenverlust).
- **N5** Keine Tracker, keine Konten, keine Secrets im Repo.
- **N6** Pflicht-Attributionen (Open-Meteo CC BY 4.0, OpenStreetMap, swisstopo) sichtbar in der App.
- **N7** Beim Start `navigator.storage.persist()` anfragen.

**Risiko:** iOS kann Browser-Speicher von Websites nach längerer Nichtnutzung löschen. Als Homescreen-App
ist das weniger wahrscheinlich, aber N4 bleibt Pflicht.

## 4. Datenmodell

Gespeichert in IndexedDB. Schemaänderungen nur mit Migration (Versionsnummer der DB erhöhen).

- `spots`: `id` (UUID, stabil), `name`, `note`, `lat`, `lon`, `axisDeg` (0–180 oder leer), `minSunAltDeg`, `createdAt`, `updatedAt`
- `hits`: `id`, `spotId`, `time` (ISO), `rating` (`good` | `bad`), `inputs` (Score-Eingaben zum Zeitpunkt)
- `settings`: Toleranzen, Maximalhöhe, Gewichtungen
- `weatherCache`: Prognose je Koordinatensatz mit Abrufzeit

## 5. Stack (fix)

| Baustein | Lösung | Bemerkung |
| --- | --- | --- |
| Build | Vite + TypeScript, ohne UI-Framework | Klein halten; Wechsel nur per SPEC-Entscheid |
| PWA | vite-plugin-pwa (Manifest + Service Worker) | Homescreen-fähig auf iOS |
| Tests | Vitest | Pflicht für Geometrie, Licht, Score |
| Sonnenstand | SunCalc 2.x (lokal berechnet) | Kein Netz nötig; liefert Grad, Azimut ab Nord |
| Wetter | Open-Meteo Forecast-API, stündlich | Ohne Key; nicht-kommerziell; CC BY 4.0 |
| Karte | Leaflet, swisstopo-WMTS (Standard), OSM als Fallback | Attribution Pflicht |
| Speicher | IndexedDB (Wrapper `idb`) | Pro Gerät getrennt |
| Cache | Service Worker, letzte Prognose offline lesbar | |
| Deploy | GitHub Actions → GitHub Pages | Push auf `main` deployt |

## 6. Erlaubte Netzwerkziele zur Laufzeit

Nur: die eigene Pages-Domain, `api.open-meteo.com`, `wmts.geo.admin.ch`, `tile.openstreetmap.org`.

## 7. Priorisierung

| Stufe | Umfang |
| --- | --- |
| v1 | F1–F7, F11–F13, F15, N1–N7 |
| v1.1 | F8 nasse Strassen, F10 Regen/Wind |
| v1.2 | F9 Nebel/Dunst, F14 Gewichtung anpassbar |
| Später | Spots aus EXIF-GPS, Sync, Push, Mondphase, Kalibrierung aus F15-Daten |

## 8. Meilensteine und Status

| Meilenstein | Inhalt | Status |
| --- | --- | --- |
| M0 | Gerüst: Vite/TS, PWA, Vitest, Pages-Deploy, Attributionen, Winkel-Helfer | erledigt |
| M1 | Spots: Karte, Pin, Achse ziehen, Liste, IndexedDB, Export/Import (F1–F3a, N4, N7) | erledigt |
| M2 | Licht: Golden/Blue Hour, Höhe/Schatten, Achsen-Fenster (F4–F6) | erledigt |
| M3 | Wetter: Open-Meteo, Bewölkungsklassen, Cache (F7, N3) | offen |
| M4 | Score und Ansichten (F11–F13, F15) | offen |
| v1.1 | F8, F10 | offen |
| v1.2 | F9, F14 | offen |

## 9. Entscheide

- 2026-10-16 (M1): Spot-Position per Fadenkreuz in der Kartenmitte statt per Tipp (Finger verdeckt den Punkt).
  Standort-Knopf (GPS) zum Zentrieren. Standardkarte swisstopo grau, wählbar farbig oder OSM; Wahl wird gespeichert.
- 2026-10-16 (M1): swisstopo-Geodaten sind frei nutzbar mit Quellenangabe «© swisstopo»
  ([Bedingungen](https://www.swisstopo.admin.ch/en/conditions-geodata)).
- 2026-10-16 (M1): Export über das iOS-Teilen-Menü («In Dateien sichern»), Fallback Download.
  Import führt per ID zusammen, neueres `updatedAt` gewinnt, nichts wird gelöscht.
- 2026-10-16 (M1): `fake-indexeddb` als Dev-Dependency für DB-Tests.
- 2026-10-16 (M2): F6 korrigiert. «Rechtwinklig = Streiflicht» war physikalisch falsch; Streiflicht entsteht
  bei Sonne parallel zur Fassade, also parallel zur Achse. Quer = Frontallicht + Schattenkante.
- 2026-10-16 (M2): Tipp auf einen Spot öffnet das Licht-Detail (Tage heute + 4, Tageskurve, Fensterliste);
  «Bearbeiten» führt zum Formular. Ein gewähltes Fenster (sonst die aktuelle Sonne) wird als gelber Strahl
  vom Spot Richtung Sonne auf die Karte gezeichnet.
- 2026-10-16 (M2): Berechnung in Gerätezeit; Abtastung alle 2 min, Ränder per Bisektion auf ~10 s.
  Schattenfaktor nur für Achsen-Fenster und den höchsten Sonnenstand (nahe Horizont nichtssagend).

## 10. Offene Punkte

- Score-Regeln konkret (M4).
