# Deployment (Uberspace)

Ziel: ein Uberspace-7-Konto (`<user>@<host>.uberspace.de`), Domain z. B. `slides.example.de`.

## Aufbau auf dem Server

```
~/slides/
  releases/<sha>/        server/server.mjs, server/migrate.mjs, web/, deploy/, REVISION
  current -> releases/<sha>
  shared/.env            Konfiguration (Rechte 600)
  incoming/              Upload-Ablage der GitHub Action
~/etc/services.d/slides.ini   supervisord-Dienst "slides"
```

- Ein Node-Prozess liefert Web-App, API und WebSockets aus.
- `uberspace web backend set <domain> --http --port <PORT>` leitet die ganze Subdomain an den Prozess – kein Apache, keine `.htaccess`.
- Datenbank: MariaDB `<user>_slides`, Zugangsdaten aus `~/.my.cnf`.
- Auf dem Server wird nichts gebaut oder installiert: CentOS 7 hat glibc 2.17, native npm-Module würden dort nicht laden. **Deshalb keine Abhängigkeiten mit nativen Addons im Server.**

## Einmalige Einrichtung

1. Skripte hochladen und ausführen:
   ```bash
   scp -r deploy/uberspace <user>@<host>.uberspace.de:slides-setup
   ssh <user>@<host>.uberspace.de 'DOMAIN=<domain> bash ~/slides-setup/setup.sh'
   ```
   Legt Verzeichnisse, Datenbank, `.env` (freier Port, Setup-Token), Domain, Web-Backend und Dienst an. Idempotent.
2. **DNS**: A/AAAA-Einträge für die Domain auf die IPs setzen, die `uberspace web domain add` ausgibt. Das Let's-Encrypt-Zertifikat kommt automatisch, sobald der Name auflöst. Bei Cloudflare als DNS: WebSockets laufen auch über den Proxy (orange Wolke); kommt kein Zertifikat, den Proxy kurz deaktivieren.
3. **Deploy-Schlüssel**: eigener ed25519-Schlüssel nur für dieses Repo, öffentlicher Teil in `~/.ssh/authorized_keys` auf dem Uberspace (Kommentar `github-actions@takepart`).
4. **GitHub-Umgebung `production`** mit Secrets `DEPLOY_HOST`, `DEPLOY_USER`, `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS` (`ssh-keyscan <host>.uberspace.de`).
5. Erster Login: `https://<domain>/login`, Setup-Token mit `ssh <user>@<host>.uberspace.de 'grep SETUP_TOKEN ~/slides/shared/.env'` holen, Passkey anlegen. Danach die Zeile `SETUP_TOKEN` aus der `.env` löschen und `supervisorctl restart slides`.

## Ablauf eines Deployments

Lokal prüft der pre-push-Hook Typecheck, Lint und Tests. Push auf `main` → GitHub Action: Build → `release.tgz` → `scp` → `deploy.sh`:
entpacken → `node migrate.mjs` → Symlink `current` umschalten → `supervisorctl restart slides` → Health-Check auf `http://localhost:<PORT>/api/health` → bei Fehler automatisch zurück auf die vorige Version. Fünf Versionen bleiben liegen.

Teilnehmende verbinden sich nach einem Neustart automatisch neu; der Live-Zustand liegt in der Datenbank. Ein Deployment mitten im Vortrag kostet also nur eine Sekunde Reconnect – trotzdem besser nicht.

Manuell erneut ausrollen: Actions → Deploy → „Run workflow“.

## Im Vortrag

- Beamer-Fenster (`/d/…`) in einem eigenen Fenster öffnen und im Meeting **dieses Fenster** teilen; Steuerpult in einem anderen Fenster oder auf dem Handy.
- Das geteilte Beamer-Fenster nicht vollständig verdecken (am besten eigener Bildschirm): Chrome und Safari zeichnen verdeckte Fenster nicht neu, dann sieht das Publikum ein stehendes Bild.
- Keine Deployments während eines Vortrags – Teilnehmende verbinden sich zwar automatisch neu, aber es ruckelt kurz.

## Betrieb

```bash
ssh <user>@<host>.uberspace.de
supervisorctl status slides
supervisorctl tail -f slides stderr     # Logs
curl -s localhost:$(sed -n 's/^PORT=//p' ~/slides/shared/.env)/api/health
readlink ~/slides/current               # aktive Version
```

Zurückrollen von Hand: `ln -sfn ~/slides/releases/<alte-sha> ~/slides/current && supervisorctl restart slides`.

Backup: `mysqldump <user>_slides > slides-$(date +%F).sql` (Uberspace sichert zusätzlich täglich).
