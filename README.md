<p align="center"><img src="apps/web/public/favicon.svg" width="72" height="72" alt=""></p>

<h1 align="center">TakePart</h1>

<p align="center">Interactive presentations with live audience participation – self-hosted.<br>
<strong>English</strong> · <a href="README.de.md">Deutsch</a></p>

---

Your audience joins with a 6-digit code or QR code – no account, no app. You run the show from a control panel (laptop or phone) while a separate presenter view shows the results live. The interface is in German.

| Activity | What it does |
|---|---|
| Text slide | Title, text and – on the title slide – join code and QR code |
| Multiple choice | Single or multiple answers, live bar chart |
| Open answers | Free text, show single answers full screen |
| Scale | 1–5 / 1–7 / 1–10 with average and distribution |
| Word cloud | 1–3 terms per person |
| Ranking | Tap options in order, Borda count |
| Quiz | Timer, points for speed, leaderboard |
| Brainstorming | Collect ideas, audience upvotes |
| Pinboard | Shared sticky notes in columns |
| Feedback | Star rating plus comment |
| Q&A | Named questions, upvotes, moderation, show one question full screen |
| Complete the sentence | Everyone types the most likely next word; you reveal the answers and append the most popular one |

**Run the whole talk in TakePart:** import your slides as PDF (export from PowerPoint, Keynote or Google Slides) and place interactive slides between them. Speaker notes and build animations (elements appearing click by click) come along from the `.pptx` if you add it. A presenter view shows notes, the next slide, a timer and the clock; a laser pointer and pen draw on the shared screen; afterwards you can share the slides and aggregated results with the audience via a link.

Plus: optional branding per presentation (logo, accent and chart colour), passkey login for the presenter, an archive of every session with CSV export, and a demo deck that shows every feature.

## Quick start (Docker)

You need Docker with Compose.

```bash
curl -O https://raw.githubusercontent.com/philippkstn/takepart/main/docker-compose.yml
docker compose up -d
docker compose logs app | grep Setup-Token
```

1. Open **http://localhost:8080/login** and enter the setup token from the log.
2. Create your passkey (fingerprint, face or device PIN). That's your login from now on.
3. Click **“Demo-Präsentation laden”** to load a demo deck with every feature, then **“Live starten”**.

The setup token is only needed once and changes on every restart until the first passkey exists.

> **Running it on the internet?** Passkeys require HTTPS. Put TakePart behind a reverse proxy with TLS (e.g. Caddy or Traefik) and set `APP_ORIGIN` to the public address – see [Configuration](#configuration).

### Importing slides

In the editor, click **“PDF importieren”** and choose the PDF export of your deck. Optionally add the same deck as `.pptx` – TakePart reads the speaker notes and entrance animations from it (hidden slides are skipped, just like in PowerPoint's PDF export). Pages are rendered in your browser and uploaded as images. Elements that appear later are covered with their sampled background colour and revealed per click (fade, appear, fly in, zoom); exit, emphasis and motion-path effects, slide transitions and videos are not carried over. Overlapping elements can leave a visible patch – switch animations off for that slide in the editor, where a stepper previews every click. Under “Folien auf Handys zeigen” you decide whether the audience can follow the slides on their phones.

### Presenting

- **Presenter view (control panel):** current slide with laser pointer and pen, next slide, speaker notes (resizable sidebar, adjustable font size; the next-slide preview collapses to its title when space runs short), elapsed time against a target duration, clock; step through slides and animations, black or white screen, show/hide results, approve questions, append words. Works on a phone.
- **Presenter view:** “Beamer öffnen” opens a read-only link for the screen you share. `F` toggles full screen; when you're logged in in the same browser, the keys work like in PowerPoint: → ↓ PageDown Space Enter N next, ← ↑ PageUp Backspace P back, `B`/`.` black screen, `W`/`,` white screen, Home/End, number + Enter jumps to a slide. Presenter remotes (clickers) work the same way, including their blank-screen button. Keep that window visible while sharing – browsers stop painting covered windows.
- **Audience:** opens your address and enters the code, or scans the QR code on the title slide.
- **After the talk:** “Folien freigeben” creates a link with the slides and aggregated results (no names, free texts or questions). Participants see it on their phones; it can be printed or saved as PDF.

## Configuration

Set these as environment variables (with Compose, e.g. in a `.env` file next to `docker-compose.yml`).

| Variable | Default | Purpose |
|---|---|---|
| `APP_ORIGIN` | `http://localhost:8080` | Public address in the browser. Passkeys are bound to it. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | see compose file | MariaDB/MySQL connection. **Change `DB_PASSWORD`.** |
| `TRUST_PROXY_HOPS` | `0` (compose) | Number of proxies in front of TakePart: none `0`, reverse proxy `1`, reverse proxy + Cloudflare `2`. Too high lets clients fake their IP. |
| `SETUP_TOKEN` | generated | Fixed token for the first passkey instead of the generated one. |
| `IMPRINT_URL`, `PRIVACY_URL` | – | Legal links in the footer (shown only if set). |
| `SOURCE_URL` | this repository | Source code link in the footer. If you run a modified version, link your code (AGPL). |
| `TAKEPART_PORT` | `8080` | Host port in `docker-compose.yml`. |

Example `.env` for a public instance:

```env
APP_ORIGIN=https://takepart.example.org
DB_PASSWORD=a-long-random-password
TRUST_PROXY_HOPS=1
IMPRINT_URL=https://example.org/imprint
PRIVACY_URL=https://example.org/privacy
```

The reverse proxy must pass WebSockets through (Caddy and Traefik do by default). Example Caddyfile:

```
takepart.example.org {
  reverse_proxy localhost:8080
}
```

**Backup:** `docker compose exec db mariadb-dump -u takepart -p takepart > takepart.sql`

## Development

```bash
npm install
npm run db:up                                   # MariaDB 10.11 in Docker (port 3307)
cp apps/server/.env.example apps/server/.env
npm run db:migrate
npm run dev                                     # API :3000 + web http://localhost:5180
git config core.hooksPath .githooks             # run checks before every push to main
npm run check                                   # typecheck, lint, tests
```

Stack: React 19 + Vite (`apps/web`), Fastify 5 + WebSockets + MariaDB (`apps/server`, bundled into a single file with esbuild), shared Zod schemas and logic (`packages/shared`).

The reference instance runs at **https://takepart.philipp-kasten.de** (Uberspace, auto-deploy from `main`, see [docs/deployment.md](docs/deployment.md), German). Docker images are published to `ghcr.io/philippkstn/takepart` for version tags.

## License

TakePart is free software under the [GNU Affero General Public License v3.0](LICENSE) or later. If you modify TakePart and offer it as a web service, you must make your modified source code available to its users.
