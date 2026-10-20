# TakePart – Hinweise für Claude Code

Interaktive Vorträge (Abstimmungen, Q&A, Pinnwand, Quiz, Satz-Spiel) für bis zu ~300 gleichzeitige Teilnehmende. Sprache in UI, Doku und Commit-Messages: **Deutsch**.

## Struktur (npm-Workspaces)

- `packages/shared` – Folientypen + Zod-Schemas (`slides.ts`), Antwort-Validierung (`responses.ts`), Auswertungen und Quiz-Punkte (`results.ts`), Live-Zustand, Host-Befehle und Ansichtstypen (`state.ts`), Wörter zählen/Satz bauen (`words.ts`). Wird als TypeScript-Quelle importiert (kein Build).
- `apps/server` – Fastify 5. `live.ts` (WebSocket-Hub, gebündelte Broadcasts), `snapshot.ts` + `views.ts` (aus DB-Zustand die drei Ansichten bauen), `runs.ts` (Host-Befehle), `participants.ts`, `presentations.ts`, `auth.ts` (Passkeys + Passwort, Konten), `users.ts` (Kontoverwaltung für Admins), `access.ts` (Eigentümer-Prüfung), `transfer.ts` (Import/Export `.takepart`), `migrations.ts`.
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
2. **Migrationen nur anhängen** (`apps/server/src/migrations.ts`), nie bestehende ändern. MariaDB 10.11: kein `utf8mb4_0900_*`, JSON-Spalten kommen als Text (`json()` aus `db.ts`). Zeiten immer UTC: jede Verbindung setzt `time_zone = '+00:00'` (`createPool`), der Uberspace-Server läuft auf CEST.
3. **Live-Zustand gehört in die Datenbank** (`runs.state`), nicht in den Speicher – ein Neustart mitten im Vortrag darf nichts verlieren. Im Speicher nur Verbindungen, Passkey-Challenges, Broadcast-Timer.
4. Jede Änderung, die Ansichten betrifft, ruft `live.notify(runId)`. Ansichten werden serverseitig vollständig gebaut; Clients schicken nur REST-Befehle.
5. Quizlösungen erreichen Teilnehmende und Beamer erst nach dem Auflösen (`publicSlide`).
6. **Konten:** Präsentationen und Brandings gehören einem Konto (`user_id`). Jede Host-Route mit ID prüft per `requireOwner` (`access.ts`), Listen filtern nach `accountOf(request).id`. Öffentliche Token-Routen (Beitritt, Beamer, Freigabe, Bilder, Logo) bleiben ohne Konto.
7. Neue Folientypen: Schema in `slides.ts`, ggf. Antwort in `responses.ts` + Auswertung in `results.ts`, Formular in `SlideForm.tsx`, Teilnehmer-Ansicht in `Activities.tsx`, Bühne in `Stage.tsx`, Steuerung in `ControlPage.tsx`, CSV in `export.ts`. Neue Tabellen/Spalten mit Durchführungsdaten auch in `transfer.ts` (Export, Import mit ID-Umschreibung).

## Slides-Engine

- Import im **Browser** (`apps/web/src/lib/importDeck.ts`): pdf.js rendert PDF-Seiten (intent `print`, damit es auch im Hintergrund-Tab läuft), JSZip liest Sprechernotizen und Eingangsanimationen (`p:timing`, Positionen aus `a:xfrm`) aus der PPTX (ausgeblendete Folien überspringen). Auf dem Server läuft keine PDF-/Office-Software. pdf.js-Hilfsdateien kopiert `apps/web/scripts/copy-pdfjs.mjs` nach `public/pdfjs` (nicht eingecheckt); die CSP erlaubt dafür `'wasm-unsafe-eval'`.
- Folienbilder liegen in `assets` (Blob). Zugriff öffentlich über die zufällige `public_id` – sie ist die Zugriffskontrolle (wie der Anzeige-Link). Folientyp `image` entsteht nur per Import (`CREATABLE_SLIDE_TYPES`), das Bild einer Folie ist nicht austauschbar. Duplizieren kopiert die Bilder mit neuen Kennungen.
- **Animationen** (`imageConfig.builds`): Folienbild = Endzustand; noch nicht aufgedeckte Elemente deckt `BuildLayer` mit beim Import gemessenen Farben ab. Früher aufgedeckte Abdeckungen liegen oben (z-Reihenfolge ist entscheidend). Nur Eingangseffekte. `RunState.build[slideId]` zählt Klicks; `step` deckt erst auf, dann nächste Folie, zurück landet im Endzustand. Teilnehmer-Geräte spielen die Animationen mit (nur sichtbarer Tab, nur vorwärts), Freigabe-Link zeigt den Endzustand.
- **Schwarz-/Weißbild** (`RunState.blank`) liegt auf dem Beamer über allem, auch über Zeichnungen; jedes Blättern beendet es. Tastenbelegung zentral in `lib/presenterKeys.ts` (Steuerpult und Beamer).
- **Pausenmodus** (`RunState.pause` = `{ endsAt, seconds, question }`, Serverzeit; Logik in `apps/server/src/pause.ts`): Befehle `pause-start`/`pause-extend`/`pause-end`, Taste `Z`; jedes Blättern beendet die Pause (wie das Schwarzbild), der Start beendet ein Schwarzbild. `PauseScreen` liegt auf der Bühne über Folie und Zeichnungen, nur das Schwarzbild darüber. Rückmeldungen (`POST /api/p/pause`: bereit, Energie 1–5) stehen in `RunState.pauseVotes` je Teilnehmer-ID – bewusst ohne Tabelle, nur für die laufende Pause, beim Start geleert, beim Ende verworfen; Schreiben unter `withRunLock`. Beamer bekommt nur Zahlen (`DisplayPause`), das Steuerpult `pauseStats`, jedes Handy nur die eigene Rückmeldung. Töne/Hinweise über `useCountdownMoments` wie beim Countdown.
- Referentenansicht: rechte Leiste `PresenterSidebar.tsx` – Breite (`PanelResizer`), Notiz-Schriftgröße und Vorschau-Schalter liegen per `usePref` (`lib/prefs.ts`) im localStorage des Browsers; reine Ansichtssache, nie in der DB.
- Einstiegsseiten (Teilnahme, Anmeldung) und Teilnehmer-Seiten ohne Branding: Hauptknöpfe in TakePart-Orange (`.takepart-scope`, #cc4521 statt Logo-#e0532f wegen Kontrast).
- **Sprechernotizen** (`slides.notes`) erscheinen nur im Editor und in der Host-Ansicht – nie im `Slide`-Typ, nie bei Beamer oder Publikum.
- Bühne ist immer **16:9** (Beamer letterboxt). Laserpointer/Zeichnen nutzen auf die Bühne normierte Koordinaten und laufen direkt über den Host-WebSocket (`live.ts`, `inkEvent`) – die einzige bewusste Ausnahme von „Live-Zustand liegt in der DB“: flüchtig, gelöscht bei Folienwechsel.
- Freigabe (`/h/:token`, `handoutData` in `runs.ts`) enthält nur Folien und zusammengefasste Ergebnisse – keine Namen, Freitexte, Fragen, Kommentare, Ranglisten. Das geteilte Fotoprotokoll (`/p/:token`) ist davon getrennt und enthält mehr (siehe „Nach dem Workshop“).

## Kartenwand (Workshops)

- Folientyp `board` mit `mode`: `collect` (Karten sammeln), `cluster` (Wand/Mindmap), `place` (Bahnen mit Feldern – Spalten, Prozess, 2×2-Matrix), `dots` (Klebepunkte), `rate` (1–2 Kriterien, bei zweien Matrix), `table` (Top-N mit Verantwortlichen). Folien mit gleichem `config.board` teilen Karten und Gruppen – verknüpft über den Namen, nie über Folien-IDs (Duplizieren!).
- Karten sind `posts` (Moderation ergänzt mit `participant_id NULL`), Gruppen `board_groups` (je Durchführung + Wand), Platzierungen/Tabellenzeilen `board_places` (je Folie, `target` = `c<postId>`/`g<groupId>`). Punkte und Bewertungen sind `responses`; erlaubte Einträge prüft die Route (`targetsOf`), nicht `validateResponse`. Server-Logik in `apps/server/src/board.ts`.
- Rechte der Teilnehmenden je Folie: `host` | `own` | `all` (`config.rights`, live überschreibbar über `RunState.boardRights`); erlaubte Befehle in `PARTICIPANT_BOARD_OPS`.
- `anytime` auf Sammel-Folien = Parkplatz: Karten von jeder Folie aus. `RunState.countdown` = Timer auf Beamer und Handys.
- Freigabe enthält nur Gruppen mit Zählungen, Feldern, Punkten, Einschätzungen und Tabellenfeldern – nie Kartentexte (die nur im Archiv/CSV/Fotoprotokoll).
- Bei „eigene Karten“ dürfen Teilnehmende ihre Karten ändern und selbst angelegte Gruppen umbenennen (`board_groups.participant_id`, `BoardView.ownGroups`).

## Gruppen bilden & Fotoprotokoll

- Folientyp `teams`: Name (NameGate) und optional eine Kennzeichnung (Antwort `{ tag }`). Einteilung in `RunState.teams[slideId]` (Teilnehmer-IDs je Gruppe), Befehle `teams-make|fill|move|clear` laufen in der `/command`-Route (brauchen DB), Algorithmus pure in `packages/shared/src/teams.ts`. Teilnehmende sehen ihre Gruppe aus der letzten Einteilung bis zur aktuellen Folie (`participantTeam`). Nie in der Freigabe.
- **Breakout** (`packages/shared/src/breakout.ts`, `apps/server/src/breakout.ts`, `components/board/Breakout.tsx`, `components/participant/Breakout.tsx`): Sammel-Folie mit `perTeam` + Einteilung davor (`breakoutAssignment`, letzte Einteilung bis zu dieser Folie) → jede neue Karte bekommt `posts.team` (Index der Gruppe, beim Anlegen fest gespeichert). Teilnehmende sehen eigene Karten plus sichtbare Karten ihrer Gruppe (`teamVisibleCards`, nur lesend), nie fremde Gruppen; sie bekommen nur `BoardView.myTeam`, Beamer/Steuerpult `BoardView.breakout`. Fertig-Meldungen in `RunState.teamDone[slideId]` (Teilnehmende über `/api/p/team-done`, Moderation über `team-done`). Sammelruf `RunState.callback` (Host-Befehl `callback`; die Minuten starten zusätzlich den normalen `countdown` – keine eigene Timer-Logik), läuft nach `until` von selbst ab, Handys schließen ihn lokal. Folgeschritte (Clustern, Punkte …) arbeiten mit allen Karten der Wand und zeigen die Herkunft als „G2“.
- Fotoprotokoll `/admin/runs/:id/protokoll` (`ProtocolPage.tsx`): druckoptimiert (A4 quer), PDF über den Druckdialog – keine PDF-Software auf dem Server.
- Beamer: zu lange Ergebnisse scrollen automatisch (`lib/autoScroll.tsx`, `ScrollingResults` mit `key={slide.id}`).

## Moderationswerkzeuge (Handzeichen, Zufall, Anwesenheit)

- Reine Logik in `packages/shared/src/moderation.ts`, Server in `apps/server/src/moderation.ts` (Route `POST /api/p/signal`, Befehle `signals-clear`, `pick-*`, Ansichtsteile), Web: `participant/SignalBar.tsx`, `admin/ModerationTools.tsx`, `components/PickOverlay.tsx`.
- **Handzeichen** (`SIGNAL_KINDS`, erweiterbar): `RunState.signals[kind][participantId] = Zeitpunkt`, eins pro Person und Art. Ablauf nach 3 Minuten ohne Timer: Server filtert beim Lesen und räumt beim Schreiben auf, Steuerpult und Handy bekommen Ablaufzeitpunkte und zählen selbst herunter. Nur Host-Ansicht (Zähler) und eigene Signale auf dem Handy – nie Beamer, nie Namen.
- **Zufallsauswahl**: `RunState.picker` (`drawn`, `current`, `shown`); gezogen wird auf dem Server (`crypto.randomInt`) aus Personen mit Namen, ohne Wiederholung bis `pick-reset`; Gruppenfilter über `teamsAt` (letzte Einteilung bis zur aktuellen Folie). Folienwechsel blendet den Namen auf dem Beamer aus (`picked` in der DisplayView), das Handy der gezogenen Person zeigt „Du bist dran!“.
- **Anwesenheit**: `HostView.presence` nur mit Namen + verbunden/getrennt (keine IDs); die verbundenen IDs kennt nur `live.ts` und reicht sie an `hostView` weiter (einmal je Broadcast gebaut).
## Bausteine, Probelauf, Online

- **Übungsbausteine** sind Daten in `packages/shared/src/blocks.ts` (`BUILTIN_BLOCKS`, Wand-Name per `uniqueBoardName` eindeutig). Der Server kennt sie nicht: Editor (`components/admin/BlockPicker.tsx`, Reiter „Bausteine“) schickt eine Folienliste an `POST /api/presentations/:id/slides/batch` (max. 30, `parseConfig`, kein `image`, eine Transaktion hinter `afterId`). Eigene Bausteine: Tabelle `blocks` je Konto (`apps/server/src/blocks.ts`). Neue Bausteine müssen den Test in `prep.test.ts` bestehen.
- **Probelauf** = `runs.rehearsal = 1`: läuft neben einer echten Durchführung (je Art höchstens eine offene), nie im Archiv-Zähler, `liveRun` oder Export (`transfer.ts`). Testteilnehmende sind `participants.fake = 1` und zählen in `participants` mit; `apps/server/src/rehearsal.ts` (`POST/DELETE /api/runs/:id/rehearsal/fake`) erzeugt Zufallsantworten über `fakeResponse` (shared/rehearsal.ts) und prüft sie mit `validateResponse`.
- **Beamer-Sichtbarkeit**: Das Beamer-Fenster schickt `{type:'visibility', hidden}` über seinen WebSocket (`displayMessage`); `live.ts` merkt das flüchtig an der Verbindung, `HostView.displays` zeigt es im Steuerpult. „Einladung“ kopiert `Macht mit: <origin>/<code> – Code …`.
## Ablaufplan und Phasen-Countdown

- Je Folie (jeder Typ) optional: `planned_minutes`, `phases` (JSON `[{label, minutes}]`, max. 8, Label ≤ 60), `auto_countdown` – eigene Spalten an `slides` (Migration `008_schedule`), **nicht** im typabhängigen `config` und nie im `Slide`-Typ. Server: `apps/server/src/schedule.ts` (`loadSchedule`), Logik/Schemas rein in `packages/shared/src/schedule.ts`. GET `/api/presentations/:id` liefert `schedule` (wie `notes`), PATCH `/api/slides/:id` nimmt `plannedMinutes`/`phases`/`autoCountdown`. Duplizieren und `transfer.ts` (optionale Felder, Format-Version bleibt 1) übernehmen sie.
- Phasen-Countdown: `RunState.countdown = {endsAt, seconds, phases?: {label, seconds}[]}`. Die aktuelle Phase wird **nie gespeichert**, sondern überall mit `currentPhase(countdown, serverNow)` aus Startzeit (`endsAt - seconds`) abgeleitet – kein Server-Timer. Hinweise (`useCountdownMoments`) entstehen aus dem Wechsel der abgeleiteten Phase bei jedem Takt und bei `visibilitychange` – ein verdeckter Tab zeigt beim Zurückkehren sofort den richtigen Stand.
- Befehle: `countdown-slide` (Phasen, sonst Soll-Dauer der Folie), `countdown-extend` (+Sekunden für die aktuelle Phase). Auto-Start in `applyCommand` (optionaler 6. Parameter `schedule`) nur, wenn die Folie wirklich wechselt; Verlassen stoppt nichts.
- Teilnehmende: `PhaseBanner` unter der Kopfzeile, auf jeder Folie (Phase, Restzeit, „Phase 2 von 3“, „Danach: …“); beim Wechsel `CountdownAlert` mit Vibration und – nach Freigabe durch eine Berührung – Gongschlag. Steuerpult: `SchedulePanel.tsx` (`PlanStatus` Soll/Ist als Text, „Phasen starten“). Geplante Minuten einer Folie = Soll-Dauer, sonst Summe der Phasen.
## Nach dem Workshop

- **Protokollnotizen** der Moderation: Tabelle `run_notes` (je Durchführung + Folie), `PUT /api/runs/:id/notes/:slideId` (`notes.ts`), live im Steuerpult (`LiveRunNote`) und nach dem Ende im Archiv/Fotoprotokoll (`RunNoteEditor`). Getrennt von den Sprechernotizen (`slides.notes`), nie in Beamer- oder Teilnehmer-Ansichten (deshalb kein `live.notify`). `runResults` liefert sie je Folie (`note`); Folien mit Notiz erscheinen im Protokoll. Export/Import (`transfer.ts`, optionales Feld `notes` je Durchführung) und CSV nehmen sie mit.
- **Fotoprotokoll teilen** (`/p/:token`, `protocol.ts`, Spalten `runs.protocol_token`/`protocol_names`): anders als die Freigabe enthält es bewusst Kartentexte, Freitexte, Fragen, Gruppen, Notizen der Moderation und – außer bei „Namen weglassen“ – Namen (Gruppeneinteilung, Q&A). Nie: interne IDs (`publicProtocol` nummeriert Folien, Karten, Gruppen und Kartenschlüssel neu), Tokens, Codes, ausgeblendete/nicht freigegebene Beiträge. Zurückziehen setzt den Token auf `NULL` → 404. Die Darstellung teilen Admin- und Share-Seite (`components/protocol/ProtocolView.tsx`).
- **Folgetermin** (`followup.ts`, `POST /api/runs/:id/followup`): neue Präsentation im eigenen Konto mit Branding; Inhalt aus der reinen Funktion `followupSlides` (Titel, Rückblick, je Top-Thema der Ergebnistabellen Textfolie + Skala, höchstens 10, am Ende Q&A).
- **Vergleich** (`compare.ts`, `/admin/p/:id/vergleich`): nur beendete Durchführungen; ähnliche Gruppen/lose Karten gruppiert der Browser mit `groupSimilar` (`packages/shared/src/similar.ts`: Normalisierung, Stoppwörter, grobe Endungen, Token-Jaccard ≥ 0,5, Union-Find, mindestens zwei Durchführungen).

## Design

Schlicht und klar: eine Schrift (Figtree, lokal über `@fontsource`), neutrale Flächen, feine Rahmen, kaum Schatten, kleine Rundungen. Keine Verläufe, kein Lila, kein Glas, keine Emojis, keine farbigen Balken am linken Rand, keine Versal-Kicker in Farbe. Farben als Tokens in `apps/web/src/index.css` (hell + dunkel). Ohne Branding: Tinte für Primär-Buttons, Blau `#2563C9` für Auswahl und Diagramme (mit dem dataviz-Validator geprüft). Animationen 120–600 ms, `prefers-reduced-motion` respektieren (CSS + `MotionConfig reducedMotion="user"`). Text trägt nie die Diagrammfarbe. Keine externen CDNs.

## Branding

Optional pro Präsentation (`presentations.brand_id`, Tabelle `brands`): Name, Akzentfarbe, Diagrammfarbe, Logo. `lib/brand.ts` (`brandStyle`) setzt daraus `--accent`, `--primary`, `--chart` usw. auf Bühne und Teilnehmer-Ansicht. Logos liegen in der DB und kommen über `/api/brands/:id/logo?v=…` (versioniert, gecacht), nie in den Live-Ansichten selbst. Rot als Diagrammfarbe vermeiden (wirkt wie „schlecht“) – dann die Zweitfarbe der Marke für Balken nehmen.

## Docker

`Dockerfile` (zweistufig: Build auf `$BUILDPLATFORM`, Laufzeit kopiert nur `server.mjs`, `migrate.mjs`, `web/` – kein node_modules, Benutzer `node`), `docker/entrypoint.sh` (Migrationen mit Wartezeit, dann Server), `docker-compose.yml` (App + MariaDB, für Nutzer:innen). Die Dev-Datenbank liegt in `docker-compose.dev.yml`. Images: `.github/workflows/docker.yml`, nur bei Tags `v*`. Ohne `SETUP_TOKEN` erzeugt der Server beim ersten Start selbst einen und schreibt ihn ins Log. Impressum/Datenschutz/Quellcode-Links kommen über `/api/config` aus der Konfiguration – nie fest im Code.

## Deployment

Push auf `main` → `.github/workflows/deploy.yml` → `deploy/uberspace/deploy.sh` auf den Uberspace. Details in `docs/deployment.md`.

**Actions-Minuten sparen:** Prüfungen nur lokal (`npm run check`, läuft automatisch im pre-push-Hook, `git config core.hooksPath .githooks`). Die Action baut und liefert nur aus. Commits bündeln statt viele Einzel-Pushes; Doku-Änderungen lösen keinen Lauf aus.
