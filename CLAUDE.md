# TakePart – Hinweise für Claude Code

Interaktive Vorträge (Abstimmungen, Q&A, Pinnwand, Quiz, Satz-Spiel) für bis zu ~300 gleichzeitige Teilnehmende. Sprache in UI, Doku und Commit-Messages: **Deutsch**.

## Struktur (npm-Workspaces)

- `packages/shared` – Folientypen + Zod-Schemas (`slides.ts`), Antwort-Validierung (`responses.ts`), Auswertungen und Quiz-Punkte (`results.ts`), Live-Zustand, Host-Befehle und Ansichtstypen (`state.ts`), Wörter zählen/Satz bauen (`words.ts`). Wird als TypeScript-Quelle importiert (kein Build).
- `apps/server` – Fastify 5. `live.ts` (WebSocket-Hub, gebündelte Broadcasts), `snapshot.ts` + `views.ts` (aus DB-Zustand die drei Ansichten bauen), `runs.ts` (Host-Befehle), `participants.ts`, `presentations.ts`, `auth.ts` (Passkeys), `migrations.ts`.
- `apps/web` – React 19 + Vite. `components/Stage.tsx` ist die Beamer-Bühne (auch Vorschau im Editor/Steuerpult), `components/participant/Activities.tsx` die Teilnehmer-Ansichten.

## Befehle

```bash
npm run db:up && npm run db:migrate
npm run dev          # API :3000, Web :5180
npm run typecheck && npm run lint && npm test
npm run build
```

## Regeln

1. **Keine nativen Node-Module im Server.** Er wird mit esbuild gebündelt und läuft auf Uberspace 7 (CentOS 7, glibc 2.17) ohne `npm ci`.
2. **Migrationen nur anhängen** (`apps/server/src/migrations.ts`), nie bestehende ändern. MariaDB 10.11: kein `utf8mb4_0900_*`, JSON-Spalten kommen als Text (`json()` aus `db.ts`).
3. **Live-Zustand gehört in die Datenbank** (`runs.state`), nicht in den Speicher – ein Neustart mitten im Vortrag darf nichts verlieren. Im Speicher nur Verbindungen, Passkey-Challenges, Broadcast-Timer.
4. Jede Änderung, die Ansichten betrifft, ruft `live.notify(runId)`. Ansichten werden serverseitig vollständig gebaut; Clients schicken nur REST-Befehle.
5. Quizlösungen erreichen Teilnehmende und Beamer erst nach dem Auflösen (`publicSlide`).
6. Neue Folientypen: Schema in `slides.ts`, ggf. Antwort in `responses.ts` + Auswertung in `results.ts`, Formular in `SlideForm.tsx`, Teilnehmer-Ansicht in `Activities.tsx`, Bühne in `Stage.tsx`, Steuerung in `ControlPage.tsx`, CSV in `export.ts`.

## Slides-Engine

- Import im **Browser** (`apps/web/src/lib/importDeck.ts`): pdf.js rendert PDF-Seiten (intent `print`, damit es auch im Hintergrund-Tab läuft), JSZip liest Sprechernotizen und Eingangsanimationen (`p:timing`, Positionen aus `a:xfrm`) aus der PPTX (ausgeblendete Folien überspringen). Auf dem Server läuft keine PDF-/Office-Software. pdf.js-Hilfsdateien kopiert `apps/web/scripts/copy-pdfjs.mjs` nach `public/pdfjs` (nicht eingecheckt); die CSP erlaubt dafür `'wasm-unsafe-eval'`.
- Folienbilder liegen in `assets` (Blob). Zugriff öffentlich über die zufällige `public_id` – sie ist die Zugriffskontrolle (wie der Anzeige-Link). Folientyp `image` entsteht nur per Import (`CREATABLE_SLIDE_TYPES`), das Bild einer Folie ist nicht austauschbar. Duplizieren kopiert die Bilder mit neuen Kennungen.
- **Animationen** (`imageConfig.builds`): Folienbild = Endzustand; noch nicht aufgedeckte Elemente deckt `BuildLayer` mit beim Import gemessenen Farben ab. Früher aufgedeckte Abdeckungen liegen oben (z-Reihenfolge ist entscheidend). Nur Eingangseffekte. `RunState.build[slideId]` zählt Klicks; `step` deckt erst auf, dann nächste Folie, zurück landet im Endzustand. Handy zeigt Abdeckungen ohne Animation, Freigabe-Link den Endzustand.
- **Schwarz-/Weißbild** (`RunState.blank`) liegt auf dem Beamer über allem, auch über Zeichnungen; jedes Blättern beendet es. Tastenbelegung zentral in `lib/presenterKeys.ts` (Steuerpult und Beamer).
- Referentenansicht: rechte Leiste `PresenterSidebar.tsx` – Breite (`PanelResizer`), Notiz-Schriftgröße und Vorschau-Schalter liegen per `usePref` (`lib/prefs.ts`) im localStorage des Browsers; reine Ansichtssache, nie in der DB.
- Einstiegsseiten (Teilnahme, Anmeldung) und Teilnehmer-Seiten ohne Branding: Hauptknöpfe in TakePart-Orange (`.takepart-scope`, #cc4521 statt Logo-#e0532f wegen Kontrast).
- **Sprechernotizen** (`slides.notes`) erscheinen nur im Editor und in der Host-Ansicht – nie im `Slide`-Typ, nie bei Beamer oder Publikum.
- Bühne ist immer **16:9** (Beamer letterboxt). Laserpointer/Zeichnen nutzen auf die Bühne normierte Koordinaten und laufen direkt über den Host-WebSocket (`live.ts`, `inkEvent`) – die einzige bewusste Ausnahme von „Live-Zustand liegt in der DB“: flüchtig, gelöscht bei Folienwechsel.
- Freigabe (`/h/:token`, `handoutData` in `runs.ts`) enthält nur Folien und zusammengefasste Ergebnisse – keine Namen, Freitexte, Fragen, Kommentare, Ranglisten.

## Design

Schlicht und klar: eine Schrift (Figtree, lokal über `@fontsource`), neutrale Flächen, feine Rahmen, kaum Schatten, kleine Rundungen. Keine Verläufe, kein Lila, kein Glas, keine Emojis, keine farbigen Balken am linken Rand, keine Versal-Kicker in Farbe. Farben als Tokens in `apps/web/src/index.css` (hell + dunkel). Ohne Branding: Tinte für Primär-Buttons, Blau `#2563C9` für Auswahl und Diagramme (mit dem dataviz-Validator geprüft). Animationen 120–600 ms, `prefers-reduced-motion` respektieren (CSS + `MotionConfig reducedMotion="user"`). Text trägt nie die Diagrammfarbe. Keine externen CDNs.

## Branding

Optional pro Präsentation (`presentations.brand_id`, Tabelle `brands`): Name, Akzentfarbe, Diagrammfarbe, Logo. `lib/brand.ts` (`brandStyle`) setzt daraus `--accent`, `--primary`, `--chart` usw. auf Bühne und Teilnehmer-Ansicht. Logos liegen in der DB und kommen über `/api/brands/:id/logo?v=…` (versioniert, gecacht), nie in den Live-Ansichten selbst. Rot als Diagrammfarbe vermeiden (wirkt wie „schlecht“) – dann die Zweitfarbe der Marke für Balken nehmen.

## Docker

`Dockerfile` (zweistufig: Build auf `$BUILDPLATFORM`, Laufzeit kopiert nur `server.mjs`, `migrate.mjs`, `web/` – kein node_modules, Benutzer `node`), `docker/entrypoint.sh` (Migrationen mit Wartezeit, dann Server), `docker-compose.yml` (App + MariaDB, für Nutzer:innen). Die Dev-Datenbank liegt in `docker-compose.dev.yml`. Images: `.github/workflows/docker.yml`, nur bei Tags `v*`. Ohne `SETUP_TOKEN` erzeugt der Server beim ersten Start selbst einen und schreibt ihn ins Log. Impressum/Datenschutz/Quellcode-Links kommen über `/api/config` aus der Konfiguration – nie fest im Code.

## Deployment

Push auf `main` → `.github/workflows/deploy.yml` → `deploy/uberspace/deploy.sh` auf den Uberspace. Details in `docs/deployment.md`.

**Actions-Minuten sparen:** Prüfungen nur lokal (`npm run check`, läuft automatisch im pre-push-Hook, `git config core.hooksPath .githooks`). Die Action baut und liefert nur aus. Commits bündeln statt viele Einzel-Pushes; Doku-Änderungen lösen keinen Lauf aus.
