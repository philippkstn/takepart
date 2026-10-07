<p align="center"><img src="apps/web/public/favicon.svg" width="72" height="72" alt=""></p>

<h1 align="center">TakePart</h1>

<p align="center">Interaktive Vorträge mit Live-Beteiligung – selbst gehostet.<br>
<a href="README.md">English</a> · <strong>Deutsch</strong></p>

---

Das Publikum macht mit einem 6-stelligen Code oder per QR-Code mit – ohne Konto, ohne App. Du steuerst alles im Steuerpult (Laptop oder Handy), eine eigene Beamer-Ansicht zeigt die Ergebnisse live.

**Live:** https://takepart.philipp-kasten.de

| Aktivität | Kurz |
|---|---|
| Textfolie | Titel, Text und – auf der Titelfolie – Beitritts-Code und QR-Code |
| Auswahl | eine oder mehrere Antworten, Balken mit Anzahl und Prozent |
| Offene Antworten | Freitext, einzeln groß einblendbar |
| Skala | 1–5 / 1–7 / 1–10 mit Durchschnitt und Verteilung |
| Wortwolke | 1–3 Begriffe pro Person |
| Ranking | Optionen in Reihenfolge antippen, Auswertung nach Borda |
| Quizfrage | Zeitlimit, Punkte für Tempo, Rangliste |
| Brainstorming | Ideen sammeln, Publikum votet |
| Pinnwand | gemeinsame Notizen in Spalten |
| Feedback | Sterne + Kommentar |
| Fragen (Q&A) | mit Namen, Upvotes, Freigabe, einzeln groß einblenden |
| Satz vervollständigen | Satzanfang vorgeben, alle tippen ein Wort, du blendest ein und hängst das häufigste an |

**Der ganze Vortrag läuft in TakePart:** Folien als PDF importieren (Export aus PowerPoint, Keynote oder Google Slides) und interaktive Folien dazwischen setzen. Sprechernotizen kommen mit, wenn du die `.pptx` dazugibst. Eine Referentenansicht zeigt Notizen, nächste Folie, Timer und Uhrzeit; Laserpointer und Stift zeichnen auf den geteilten Bildschirm; nach dem Vortrag teilst du Folien und zusammengefasste Ergebnisse per Link.

Dazu: optionales Branding pro Präsentation (Logo, Akzent- und Diagrammfarbe), Passkey-Login für dich, ein Archiv jeder Durchführung mit CSV-Export und ein Demo-Foliensatz mit allen Funktionen.

## Schnellstart (Docker)

Du brauchst Docker mit Compose.

```bash
curl -O https://raw.githubusercontent.com/philippkstn/takepart/main/docker-compose.yml
docker compose up -d
docker compose logs app | grep Setup-Token
```

1. **http://localhost:8080/login** öffnen und den Setup-Token aus dem Log eingeben.
2. Passkey anlegen (Fingerabdruck, Gesicht oder Geräte-PIN) – das ist ab jetzt dein Login.
3. **„Demo-Präsentation laden“** klicken, dann **„Live starten“**.

Der Setup-Token wird nur einmal gebraucht und ändert sich bei jedem Neustart, bis der erste Passkey existiert.

> **Im Internet betreiben?** Passkeys brauchen HTTPS. TakePart hinter einen Reverse-Proxy mit TLS stellen (z. B. Caddy oder Traefik) und `APP_ORIGIN` auf die öffentliche Adresse setzen – siehe [Konfiguration](#konfiguration).

### Folien importieren

Im Editor **„PDF importieren“** klicken und den PDF-Export deiner Präsentation wählen. Optional dieselbe Präsentation als `.pptx` dazu – TakePart liest daraus nur die Sprechernotizen (ausgeblendete Folien werden übersprungen, wie beim PDF-Export von PowerPoint). Die Seiten werden im Browser gerendert und als Bilder hochgeladen; Animationen und Videos werden nicht übernommen. Unter „Folien auf Handys zeigen“ legst du fest, ob das Publikum auf dem Handy mitlesen kann.

### Im Vortrag

- **Referentenansicht (Steuerpult):** aktuelle Folie mit Laserpointer und Stift, nächste Folie, Sprechernotizen, Vortragszeit gegen eine Ziel-Dauer, Uhrzeit; Folien wechseln, Ergebnisse zeigen/verbergen, Fragen freigeben, Wörter anhängen – auch am Handy.
- **Beamer:** „Beamer öffnen“ öffnet einen nur lesenden Link für den geteilten Bildschirm. `F` = Vollbild; bist du im selben Browser angemeldet, blättern Pfeiltasten und Presenter-Fernbedienung. Das Fenster beim Teilen nicht verdecken – Browser zeichnen verdeckte Fenster nicht neu.
- **Publikum:** ruft deine Adresse auf und gibt den Code ein oder scannt den QR-Code auf der Titelfolie.
- **Nach dem Vortrag:** „Folien freigeben“ erzeugt einen Link mit Folien und zusammengefassten Ergebnissen (ohne Namen, Freitexte oder Fragen). Teilnehmende sehen ihn auf dem Handy; er lässt sich drucken oder als PDF speichern.

## Konfiguration

Als Umgebungsvariablen setzen (in Compose z. B. über eine `.env`-Datei neben der `docker-compose.yml`).

| Variable | Standard | Zweck |
|---|---|---|
| `APP_ORIGIN` | `http://localhost:8080` | Öffentliche Adresse im Browser. Passkeys sind daran gebunden. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | siehe Compose-Datei | MariaDB/MySQL-Verbindung. **`DB_PASSWORD` ändern.** |
| `TRUST_PROXY_HOPS` | `0` (Compose) | Anzahl Proxys vor TakePart: keiner `0`, Reverse-Proxy `1`, Reverse-Proxy + Cloudflare `2`. Zu hoch erlaubt gefälschte IPs. |
| `SETUP_TOKEN` | wird erzeugt | Fester Token für den ersten Passkey statt des erzeugten. |
| `IMPRINT_URL`, `PRIVACY_URL` | – | Impressum und Datenschutz in der Fußzeile (nur wenn gesetzt). |
| `SOURCE_URL` | dieses Repo | Quellcode-Link in der Fußzeile. Wer eine veränderte Version betreibt, verlinkt den eigenen Code (AGPL). |
| `TAKEPART_PORT` | `8080` | Port auf dem Host in der `docker-compose.yml`. |

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
