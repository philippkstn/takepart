<p align="center"><img src="apps/web/public/favicon.svg" width="72" height="72" alt=""></p>

<h1 align="center">TakePart</h1>

<p align="center">Interaktive Vorträge mit Live-Beteiligung – selbst gehostet.<br>
<a href="README.md">English</a> · <strong>Deutsch</strong></p>

---

Das Publikum macht mit einem 6-stelligen Code oder per QR-Code mit – ohne Konto, ohne App. Du steuerst alles im Steuerpult (Laptop oder Handy), eine eigene Beamer-Ansicht zeigt die Ergebnisse live.

**Live:** https://takepart.philipp-kasten.de

| Aktivität             | Kurz                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------- |
| Textfolie             | Titel, Text und – auf der Titelfolie – Beitritts-Code und QR-Code                      |
| Auswahl               | eine oder mehrere Antworten, Balken mit Anzahl und Prozent                             |
| Offene Antworten      | Freitext, einzeln groß einblendbar                                                     |
| Skala                 | 1–5 / 1–7 / 1–10 mit Durchschnitt und Verteilung                                       |
| Wortwolke             | 1–3 Begriffe pro Person                                                                |
| Ranking               | Optionen in Reihenfolge antippen, Auswertung nach Borda                                |
| Quizfrage             | Zeitlimit, Punkte für Tempo, Rangliste                                                 |
| Brainstorming         | Ideen sammeln, Publikum votet                                                          |
| Pinnwand              | gemeinsame Notizen in Spalten                                                          |
| Feedback              | Sterne + Kommentar                                                                     |
| Fragen (Q&A)          | mit Namen, Upvotes, Freigabe, einzeln groß einblenden                                  |
| Satz vervollständigen | Satzanfang vorgeben, alle tippen ein Wort, du blendest ein und hängst das häufigste an |

**Der ganze Vortrag läuft in TakePart:** Folien als PDF importieren (Export aus PowerPoint, Keynote oder Google Slides) und interaktive Folien dazwischen setzen. Sprechernotizen und Aufbau-Animationen (Elemente erscheinen Klick für Klick) kommen mit, wenn du die `.pptx` dazugibst. Eine Referentenansicht zeigt Notizen, nächste Folie, Timer und Uhrzeit; Laserpointer und Stift zeichnen auf den geteilten Bildschirm; nach dem Vortrag teilst du Folien und zusammengefasste Ergebnisse per Link.

**Zeitplan und Phasen:** Jede Folie bekommt auf Wunsch eine geplante Dauer, und das Steuerpult zeigt, ob du vor oder hinter dem Plan liegst. Workshop-Folien können eine Phasenfolge haben (z. B. „15 Min. Gespräch – 15 Min. Rollenwechsel – 10 Min. allein Karten schreiben“), die als Countdown auf Beamer und allen Teilnehmer-Geräten läuft – mit aktueller Phase, „Phase 2 von 3“, Vorschau auf die nächste und einem Hinweis bei jedem Wechsel; auf Wunsch startet sie beim Öffnen der Folie von selbst.

Dazu: optionales Branding pro Präsentation (Logo, Akzent- und Diagrammfarbe), mehrere Konten mit Anmeldung per Passkey und/oder Passwort (jedes Konto sieht nur seine eigenen Präsentationen), automatische Gruppeneinteilung (zufällig, nach Größe oder Anzahl, gemischt nach Rollen) mit Breakout-Unterstützung (jede Gruppe sammelt eigene Karten und meldet sich fertig, ein Sammelruf holt alle zurück ins Plenum), ein Archiv jeder Durchführung mit CSV-Export und druckfertigem Fotoprotokoll (PDF), Import/Export ganzer Präsentationen samt Durchführungen und ein Demo-Foliensatz mit allen Funktionen.

## Schnellstart (Docker)

Du brauchst Docker mit Compose.

```bash
curl -O https://raw.githubusercontent.com/philippkstn/takepart/main/docker-compose.yml
docker compose up -d
docker compose logs app | grep Setup-Token
```

1. **http://localhost:8080/login** öffnen und den Setup-Token aus dem Log eingeben.
2. Benutzernamen wählen und Passkey (Fingerabdruck, Gesicht oder Geräte-PIN) oder Passwort anlegen – das ist dein Admin-Konto. Das jeweils andere kannst du später in den Einstellungen ergänzen.
3. **„Demo-Präsentation laden“** klicken, dann **„Live starten“**.

Der Setup-Token wird nur einmal gebraucht und ändert sich bei jedem Neustart, bis das erste Konto existiert. Weitere Konten legst du als Admin unter **Einstellungen → Konten** an (mit Startpasswort; Passkeys fügt jede Person selbst hinzu).

> **Im Internet betreiben?** Passkeys brauchen HTTPS (Passwörter gehen auch ohne – dann aber unverschlüsselt, also nur im lokalen Netz). TakePart hinter einen Reverse-Proxy mit TLS stellen (z. B. Caddy oder Traefik) und `APP_ORIGIN` auf die öffentliche Adresse setzen – siehe [Konfiguration](#konfiguration).

### Folien importieren

Im Editor **„PDF importieren“** klicken und den PDF-Export deiner Präsentation wählen. Optional dieselbe Präsentation als `.pptx` dazu – TakePart liest daraus Sprechernotizen und Eingangsanimationen (ausgeblendete Folien werden übersprungen, wie beim PDF-Export von PowerPoint). Die Seiten werden im Browser gerendert und als Bilder hochgeladen. Später erscheinende Elemente werden in der gemessenen Hintergrundfarbe abgedeckt und pro Klick aufgedeckt (Verblassen, Erscheinen, Hineinfliegen, Zoom); Ausgangs-, Betonungs- und Pfadeffekte, Folienübergänge und Videos werden nicht übernommen. Überlappen sich Elemente, kann eine Fläche sichtbar bleiben – dann im Editor für diese Folie abschalten; dort zeigt ein Stepper jeden Klick. Unter „Folien auf Handys zeigen“ legst du fest, ob das Publikum auf dem Handy mitlesen kann.

### Im Vortrag

- **Referentenansicht (Steuerpult):** aktuelle Folie mit Laserpointer und Stift, nächste Folie, Sprechernotizen (Seitenleiste in der Breite ziehbar, Schriftgröße einstellbar; reicht der Platz nicht, schrumpft die Vorschau auf den Titel), Vortragszeit gegen eine Ziel-Dauer, Uhrzeit; durch Folien und Animationen blättern, Schwarz-/Weißbild, Ergebnisse zeigen/verbergen, Fragen freigeben, Wörter anhängen – auch am Handy.
- **Beamer:** „Beamer öffnen“ öffnet einen nur lesenden Link für den geteilten Bildschirm. `F` = Vollbild; bist du im selben Browser angemeldet, gelten die Tasten wie in PowerPoint: → ↓ Bild↓ Leertaste Enter N weiter, ← ↑ Bild↑ Rücktaste P zurück, `B`/`.` Schwarzbild, `W`/`,` Weißbild, Pos1/Ende, Nummer + Enter springt zur Folie. Presenter (Clicker) funktionieren genauso, auch ihre „Bildschirm aus“-Taste. Das Fenster beim Teilen nicht verdecken – Browser zeichnen verdeckte Fenster nicht neu.
- **Pausenmodus:** von jeder Folie aus starten (5–30 Minuten oder frei, Taste `Z`): Beamer zeigt Restzeit, „Weiter um … Uhr“, Beitritts-Code für Nachzügler und einen kurzen Rückblick; auf den Handys „Ich bin wieder da“ und eine optionale Energie-Frage (1–5), deren Ergebnis das Steuerpult zeigt. Hinweis eine Minute vor Ende, Verlängern um 5 Minuten, Blättern beendet die Pause.
- **Stimmung im Raum:** Teilnehmende geben jederzeit dezent ein Handzeichen („Zu schnell“, „Frage“, „Pause bitte“); das Steuerpult zeigt Zähler je Art (der Beamer nie), jedes Zeichen erlischt nach drei Minuten, ein Klick quittiert eine Art. Die Teilnehmerzahl klappt eine Liste auf, wer gerade verbunden ist. „Ziehen“ lost eine Person mit Namen aus – ohne Wiederholung, auf Wunsch nur aus einer Gruppe –, zeigt den Namen bei Bedarf auf dem Beamer und meldet ihr „Du bist dran!“ auf dem Handy.
- **Publikum:** ruft deine Adresse auf und gibt den Code ein oder scannt den QR-Code auf der Titelfolie.
- **Sichern und umziehen:** In der Präsentationsliste lädt der Pfeil nach unten eine `.takepart`-Datei mit Folien, Notizen, Bildern, Branding und allen Durchführungen (inklusive Namen und Antworten – vertraulich behandeln). „Importieren“ legt daraus eine neue Präsentation im eigenen Konto an; importierte Durchführungen sind beendet und im Archiv.
- **Nach dem Vortrag:** „Folien freigeben“ erzeugt einen Link mit Folien und zusammengefassten Ergebnissen (ohne Namen, Freitexte oder Fragen). Teilnehmende sehen ihn auf dem Handy; er lässt sich drucken oder als PDF speichern.

## Konfiguration

Als Umgebungsvariablen setzen (in Compose z. B. über eine `.env`-Datei neben der `docker-compose.yml`).

| Variable                                                  | Standard                | Zweck                                                                                                                      |
| --------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`                                              | `http://localhost:8080` | Öffentliche Adresse im Browser. Passkeys sind daran gebunden.                                                              |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | siehe Compose-Datei     | MariaDB/MySQL-Verbindung. **`DB_PASSWORD` ändern.**                                                                        |
| `TRUST_PROXY_HOPS`                                        | `0` (Compose)           | Anzahl Proxys vor TakePart: keiner `0`, Reverse-Proxy `1`, Reverse-Proxy + Cloudflare `2`. Zu hoch erlaubt gefälschte IPs. |
| `SETUP_TOKEN`                                             | wird erzeugt            | Fester Token für das erste Konto statt des erzeugten.                                                                      |
| `IMPRINT_URL`, `PRIVACY_URL`                              | –                       | Impressum und Datenschutz in der Fußzeile (nur wenn gesetzt).                                                              |
| `SOURCE_URL`                                              | dieses Repo             | Quellcode-Link in der Fußzeile. Wer eine veränderte Version betreibt, verlinkt den eigenen Code (AGPL).                    |
| `TAKEPART_PORT`                                           | `8080`                  | Port auf dem Host in der `docker-compose.yml`.                                                                             |

Beispiel-`.env` für eine öffentliche Instanz:

```env
APP_ORIGIN=https://takepart.example.org
DB_PASSWORD=ein-langes-zufaelliges-passwort
TRUST_PROXY_HOPS=1
IMPRINT_URL=https://example.org/impressum
PRIVACY_URL=https://example.org/datenschutz
```

Der Reverse-Proxy muss WebSockets durchreichen (Caddy und Traefik tun das von selbst). Beispiel-Caddyfile:

```
takepart.example.org {
  reverse_proxy localhost:8080
}
```

**Backup:** `docker compose exec db mariadb-dump -u takepart -p takepart > takepart.sql`

## Entwicklung

```bash
npm install
npm run db:up                                   # MariaDB 10.11 in Docker (Port 3307)
cp apps/server/.env.example apps/server/.env
npm run db:migrate
npm run dev                                     # API :3000 + Web http://localhost:5180
git config core.hooksPath .githooks             # prüft vor jedem Push auf main
npm run check                                   # Typecheck, Lint, Tests
```

Technik: React 19 + Vite (`apps/web`), Fastify 5 + WebSockets + MariaDB (`apps/server`, mit esbuild zu einer Datei gebündelt), gemeinsame Zod-Schemas und Logik (`packages/shared`).

Betrieb der Referenz-Instanz (Uberspace, Auto-Deployment von `main`): [docs/deployment.md](docs/deployment.md). Docker-Images erscheinen bei Versions-Tags auf `ghcr.io/philippkstn/takepart`.

## Lizenz

TakePart ist freie Software unter der [GNU Affero General Public License v3.0](LICENSE) (oder einer späteren Version). Wer TakePart verändert und als Webdienst anbietet, muss den geänderten Quellcode den Nutzenden zur Verfügung stellen.
