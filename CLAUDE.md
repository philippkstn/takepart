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

## Design

Schlicht und klar: eine Schrift (Figtree, lokal über `@fontsource`), neutrale Flächen, feine Rahmen, kaum Schatten, kleine Rundungen. Keine Verläufe, kein Lila, kein Glas, keine Emojis, keine farbigen Balken am linken Rand, keine Versal-Kicker in Farbe. Farben als Tokens in `apps/web/src/index.css` (hell + dunkel). Ohne Branding: Tinte für Primär-Buttons, Blau `#2563C9` für Auswahl und Diagramme (mit dem dataviz-Validator geprüft). Animationen 120–600 ms, `prefers-reduced-motion` respektieren (CSS + `MotionConfig reducedMotion="user"`). Text trägt nie die Diagrammfarbe. Keine externen CDNs.

## Branding

Optional pro Präsentation (`presentations.brand_id`, Tabelle `brands`): Name, Akzentfarbe, Diagrammfarbe, Logo. `lib/brand.ts` (`brandStyle`) setzt daraus `--accent`, `--primary`, `--chart` usw. auf Bühne und Teilnehmer-Ansicht. Logos liegen in der DB und kommen über `/api/brands/:id/logo?v=…` (versioniert, gecacht), nie in den Live-Ansichten selbst. Rot als Diagrammfarbe vermeiden (wirkt wie „schlecht“) – dann die Zweitfarbe der Marke für Balken nehmen.

## Deployment

Push auf `main` → `.github/workflows/deploy.yml` → `deploy/uberspace/deploy.sh` auf den Uberspace. Details in `docs/deployment.md`.
