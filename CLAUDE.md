# CLAUDE.md – Projektregeln

## Grundlage
- Lies vor jeder Aufgabe `SPEC.md`. Sie ist die einzige Wahrheit zu Umfang und Entscheiden.
- Weicht etwas von der SPEC ab oder ist unklar: nachfragen, nicht raten. Nach einem Entscheid die SPEC aktualisieren.
- Nach jedem abgeschlossenen Meilenstein den Status in SPEC §8 nachführen.

## Arbeitsweise
- Pro Meilenstein zuerst einen Plan vorlegen und auf Freigabe warten.
- Kleine, thematische Commits im Conventional-Commits-Format (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- Neue Dependencies nur mit kurzer Begründung. Der Stack in SPEC §5 ist fix.
- Am Ende jeder Aufgabe kurz zusammenfassen: was gemacht wurde, was getestet ist, was auf dem iPhone zu prüfen ist.

## Befehle
- `npm run dev` – Entwicklungsserver
- `npm run build` – Typecheck und Produktionsbuild
- `npm run test` – Vitest

## Harte Regeln
- Keine Requests ausser zu den Zielen in SPEC §6. Keine KI- oder API-Aufrufe mit Key.
- Sonnenstand, Achsen-Logik und Score immer mit Tests.
- Das IndexedDB-Schema nie ohne Migration ändern. Spot-IDs sind stabil.
- Pflicht-Attributionen der Datenquellen müssen in der App sichtbar bleiben.

## Konventionen
- Code, Bezeichner und Kommentare auf Englisch. UI-Texte auf Deutsch.
- Winkel in Grad, Azimut ab Nord im Uhrzeigersinn (0° = N, 90° = O). SunCalc 2.x liefert bereits diese Konvention (nicht 1.x verwenden).
- Mobile-first für iPhone Safari: Touch-Ziele ≥ 44 px, Bedienung im Daumenbereich unten, Dark Mode, Safe Areas.
- Struktur:
  - `src/lib/` – reine Logik (Geometrie, Licht, Score), testbar ohne DOM
  - `src/ui/` – Ansichten
  - `src/db/` – IndexedDB
  - `public/` – statische Assets (Icons)
