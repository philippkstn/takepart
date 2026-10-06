# TakePart

Interaktive Vorträge für großes Online-Publikum – selbst gehostet.

**Live:** https://takepart.philipp-kasten.de

## Was es kann

| Aktivität | Kurz |
|---|---|
| Textfolie | Titel, Text, auf Wunsch Beitritts-Code und QR-Code groß |
| Auswahl | eine oder mehrere Antworten, Balken mit Anzahl und Prozent |
| Offene Antworten | Freitext, einzeln groß einblendbar |
| Skala | 1–5 / 1–7 / 1–10 mit Durchschnitt und Verteilung |
| Wortwolke | 1–3 Begriffe pro Person |
| Ranking | Optionen antippen in Reihenfolge, Auswertung nach Borda |
| Quizfrage | Zeitlimit, 500 + bis zu 500 Punkte für Tempo, Rangliste |
| Brainstorming | Ideen sammeln, Publikum votet |
| Pinnwand | gemeinsame Notizen in Spalten |
| Feedback | Sterne + Kommentar |
| Fragen (Q&A) | mit Namen, Upvotes, Freigabe durch dich, einzeln groß einblenden |
| Satz vervollständigen | Satzanfang vorgeben, alle tippen ein Wort, du blendest ein und hängst das häufigste an |

Drei Ansichten pro Durchführung:

- **Teilnehmende** (`/123456` oder Code auf der Startseite) – ohne Anmeldung, ohne Namen (außer Q&A und Quiz)
- **Steuerpult** (`/admin/live/:id`) – Folien wechseln, Ergebnisse zeigen/verbergen, Fragen freigeben, Wörter anhängen; auch am Handy
- **Beamer** (`/d/:token`) – geheimer Anzeige-Link, nur lesend. Bist du im selben Browser angemeldet, blättern Pfeiltasten/Presenter-Fernbedienung. `F` = Vollbild.

Optional bekommt jede Präsentation ein **Branding** (Logo, Akzent- und Diagrammfarbe, verwaltet unter Einstellungen) – oder bleibt neutral.

Präsentationen werden vorbereitet und beliebig oft live gestartet; jede Durchführung bleibt mit Ergebnissen im Archiv (CSV-Export).

## Technik

- `apps/web` – React 19, Vite, React Router, TanStack Query, motion, plain CSS
- `apps/server` – Fastify 5, WebSockets, MariaDB (mysql2), Passkeys (SimpleWebAuthn); mit esbuild zu **einer Datei** gebündelt
- `packages/shared` – Zod-Schemas, Auswertungen, Satz-/Quiz-Logik (mit Tests)

## Lokal entwickeln

```bash
npm install
npm run db:up                                   # MariaDB 10.11 in Docker (Port 3307)
cp apps/server/.env.example apps/server/.env    # einmalig
npm run db:migrate
npm run dev                                     # API :3000 + Web http://localhost:5180
```

Erster Login: `/login` → Setup-Token aus `apps/server/.env` (`SETUP_TOKEN`) → Passkey anlegen.

```bash
git config core.hooksPath .githooks   # einmalig: prüft vor jedem Push auf main
npm run check                          # Typecheck, Lint, Tests
npm run build
```

## Deployment

Geprüft wird lokal (pre-push-Hook), jeder Push auf `main` wird dann gebaut und auf den Uberspace ausgeliefert (`.github/workflows/deploy.yml`).
Einrichtung und Betrieb: [docs/deployment.md](docs/deployment.md).

## Lizenz

TakePart ist freie Software unter der [GNU Affero General Public License v3.0](LICENSE) (oder einer späteren Version). Wer TakePart verändert und als Webdienst anbietet, muss den geänderten Quellcode den Nutzenden zur Verfügung stellen.
