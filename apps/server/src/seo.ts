import { ABOUT, featureLine } from '@slides/shared';
import type { FastifyInstance } from 'fastify';
import type { Config } from './config.ts';

/**
 * Auffindbarkeit (Suchmaschinen und KI-Suchen). Indexiert wird nur die
 * Startseite; alle Token-Links (Teilnahme, Beamer, Freigabe, Fotoprotokoll),
 * Admin und API tragen `X-Robots-Tag: noindex`. Die Domain kommt immer aus
 * `APP_ORIGIN` – TakePart wird von vielen selbst betrieben.
 */

/** Dateien, die Suchmaschinen sehen dürfen (Icons, Manifest, gebaute Dateien). */
const PUBLIC_FILE = /^\/(?:assets\/[^/]+|[\w.-]+\.(?:png|svg|ico|webmanifest|txt|xml))$/;

/** Darf diese Antwort in einen Suchindex? Alles andere bekommt `noindex`. */
export function isIndexable(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path === '/' || PUBLIC_FILE.test(path);
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Ursprung ohne Schrägstrich am Ende, z. B. `https://takepart.example.org` */
const originOf = (config: Pick<Config, 'APP_ORIGIN'>) => new URL(config.APP_ORIGIN).origin;

export function robotsTxt(config: Pick<Config, 'APP_ORIGIN'>): string {
  // Token-Seiten bewusst NICHT sperren: Crawler müssen sie abrufen dürfen, um das
  // `noindex` zu sehen – sonst landet ein irgendwo verlinkter Link als bloße URL im Index.
  return ['User-agent: *', 'Disallow: /api/', 'Disallow: /ws', '', `Sitemap: ${originOf(config)}/sitemap.xml`, ''].join('\n');
}

export function sitemapXml(config: Pick<Config, 'APP_ORIGIN'>): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <url><loc>${escapeHtml(originOf(config))}/</loc></url>`,
    '</urlset>',
    '',
  ].join('\n');
}

type LinkConfig = Pick<Config, 'APP_ORIGIN' | 'SOURCE_URL' | 'IMPRINT_URL' | 'PRIVACY_URL'>;

/** Kurzbeschreibung für Sprachmodelle (https://llmstxt.org) */
export function llmsTxt(config: LinkConfig): string {
  const origin = originOf(config);
  const links = [
    `- [Mit Code teilnehmen](${origin}/): Startseite dieser Instanz, Teilnahme mit sechsstelligem Code`,
    `- [Quellcode](${config.SOURCE_URL}): Installation, Docker-Image und Dokumentation`,
    config.IMPRINT_URL && `- [Impressum](${config.IMPRINT_URL})`,
    config.PRIVACY_URL && `- [Datenschutz](${config.PRIVACY_URL})`,
  ].filter(Boolean);
  return [
    `# ${ABOUT.name}`,
    '',
    `> ${ABOUT.description}`,
    '',
    '## Funktionen',
    '',
    ...ABOUT.features.map((f) => `- ${featureLine(f)}`),
    '',
    '## Betrieb',
    '',
    `- ${ABOUT.presenters}`,
    `- ${ABOUT.selfHosting}`,
    '- Vortragende melden sich mit Passkey oder Passwort an; Teilnehmende brauchen kein Konto.',
    '- Keine externen Dienste, kein Tracking.',
    '',
    '## Links',
    '',
    ...links,
    '',
  ].join('\n');
}

/** JSON-LD; `<` maskiert, damit kein Text das Skript-Element beenden kann. */
function jsonLd(config: LinkConfig): string {
  const origin = originOf(config);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: ABOUT.name,
    alternateName: ABOUT.title,
    description: ABOUT.description,
    url: `${origin}/`,
    image: `${origin}${OG_IMAGE.path}`,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Interaktive Präsentation, Audience Response, Workshop-Moderation',
    operatingSystem: 'Web (Browser)',
    browserRequirements: 'Aktueller Browser mit JavaScript',
    inLanguage: 'de',
    isAccessibleForFree: true,
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    codeRepository: config.SOURCE_URL,
    featureList: ABOUT.features.map(featureLine),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Platzhalter in `apps/web/index.html`; im Vite-Entwicklungsserver ein unsichtbarer Kommentar. */
export const HEAD_MARK = '<!--#seo-->';
const ROOT = '<div id="root"></div>';

/** Vorschaubild geteilter Links (`apps/web/scripts/og-image.html` → `public/og-image.png`) */
export const OG_IMAGE = {
  path: '/og-image.png',
  width: 1200,
  height: 630,
  alt: 'TakePart: eine Live-Abstimmung mit Balken und Teilnahme-Code',
} as const;

/** Was ein geteilter Link in Messenger, Mail und sozialen Netzen als Vorschau zeigt */
export interface LinkPreview {
  title: string;
  description: string;
  /** Pfad der Seite, z. B. `/123456` */
  path: string;
}

const formatCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;
const JOIN_HINT = 'Link öffnen und mitmachen: abstimmen, Fragen stellen, Karten sammeln – ohne Konto, ohne App.';

/**
 * Welche Art Link ist das? Teilnahme-Links bekommen ihre Vorschau ohne Datenbank –
 * sonst ließen sich über die HTML-Seite (ohne Sperre wie bei `/api/join`) die Titel
 * laufender Präsentationen durchprobieren. Freigabe und Fotoprotokoll haben
 * zufällige Tokens; dort darf der Titel in die Vorschau.
 */
export function sharedLink(path: string): { kind: 'code'; code: string } | { kind: 'handout' | 'protocol'; token: string } | null {
  const clean = path.split(/[?#]/, 1)[0] ?? '';
  const code = /^\/(\d{6})$/.exec(clean);
  if (code) return { kind: 'code', code: code[1]! };
  const token = /^\/([hp])\/([\w-]{8,100})$/.exec(clean);
  if (token) return { kind: token[1] === 'h' ? 'handout' : 'protocol', token: token[2]! };
  return null;
}

/** Vorschau je Link-Art; `title` = Titel der Präsentation, falls bekannt und freigegeben */
export function linkPreview(path: string, link: ReturnType<typeof sharedLink>, title: string | null = null): LinkPreview {
  switch (link?.kind) {
    case 'code':
      return { title: `Mach mit – Code ${formatCode(link.code)}`, description: JOIN_HINT, path };
    case 'handout':
      return {
        title: title ? `Folien und Ergebnisse: ${title}` : 'Folien und Ergebnisse',
        description: 'Folien und zusammengefasste Ergebnisse aus dem Vortrag, geteilt mit TakePart.',
        path,
      };
    case 'protocol':
      return {
        title: title ? `Fotoprotokoll: ${title}` : 'Fotoprotokoll',
        description: 'Das Fotoprotokoll des Workshops: Ergebnisse, Karten und Notizen, geteilt mit TakePart.',
        path,
      };
    default:
      return { title: ABOUT.name, description: ABOUT.description, path };
  }
}

/** Open Graph und Twitter-Karte – auf jeder Seite, damit geteilte Links eine Vorschau haben */
function previewTags(origin: string, title: string, description: string, url: string): string[] {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const image = escapeHtml(`${origin}${OG_IMAGE.path}`);
  const alt = escapeHtml(OG_IMAGE.alt);
  return [
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${escapeHtml(ABOUT.name)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${alt}" />`,
    '<meta property="og:locale" content="de_DE" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:image:alt" content="${alt}" />`,
  ];
}

/**
 * Ausgeliefertes HTML. Startseite: Titel, canonical, Open Graph, JSON-LD und
 * lesbarer Inhalt im `#root`, den React beim Start ersetzt (Crawler ohne
 * JavaScript, Link-Vorschauen, KI-Suchen). Alle anderen Seiten: Vorschau für
 * geteilte Links (`page`) plus `noindex`, ohne canonical und ohne
 * Startseiten-Inhalt, damit er dort nicht aufblitzt.
 */
export function renderIndex(template: string, config: LinkConfig, page: 'home' | LinkPreview): string {
  const origin = originOf(config);
  if (page !== 'home') {
    const head = [
      '<meta name="robots" content="noindex, nofollow" />',
      ...previewTags(origin, page.title, page.description, `${origin}${page.path}`),
    ].join('\n    ');
    return template
      .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(page.title)}</title>`)
      .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/>/, () => `<meta name="description" content="${escapeHtml(page.description)}" />`)
      .replace(HEAD_MARK, () => head);
  }
  const url = `${origin}/`;
  const t = escapeHtml(ABOUT.title);
  const d = escapeHtml(ABOUT.description);
  const head = [
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    ...previewTags(origin, ABOUT.title, ABOUT.description, url),
    `<script type="application/ld+json">${jsonLd(config)}</script>`,
  ].join('\n    ');
  // Gleiche Klassen wie die Startseite: Der Text steht dort, wo React ihn gleich wieder zeigt.
  const item = (title: string, text: string) => `<li><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></li>`;
  const body = [
    '<div class="p-shell takepart-scope home-page">',
    '<header class="home-top"><span class="home-brand"><span class="display-font">TakePart</span></span>',
    '<a class="home-top-link" href="/login">Für Vortragende</a></header>',
    `<main class="home-hero"><div class="home-join"><h1 class="home-title">${escapeHtml(ABOUT.headline)}</h1><p class="home-lead">${escapeHtml(ABOUT.lead)}</p><p>${d}</p></div></main>`,
    `<section class="home-section"><h2>So läuft’s</h2><ol class="home-steps">${ABOUT.steps.map((s) => item(s.title, s.text)).join('')}</ol></section>`,
    `<section class="home-section"><h2>Funktionen</h2><ul class="home-features">${ABOUT.features.map((f) => item(f.title, f.text)).join('')}</ul></section>`,
    `<section class="home-section home-presenters"><h2>Für Vortragende</h2><div class="home-presenter-text"><p>${escapeHtml(ABOUT.presenters)}</p>`,
    `<p>${escapeHtml(ABOUT.selfHosting)} <a href="${escapeHtml(config.SOURCE_URL)}">Quellcode</a></p></div></section>`,
    '</div>',
  ].join('');
  // Ersetzungen als Funktion: `$` in Konfigurationswerten bleibt wörtlich
  return template
    .replace(/<title>[^<]*<\/title>/, () => `<title>${t}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/>/, () => `<meta name="description" content="${d}" />`)
    .replace(HEAD_MARK, () => head)
    .replace(ROOT, () => `<div id="root">${body}</div>`);
}

/** robots.txt, sitemap.xml und llms.txt – immer mit der eigenen Domain aus der Konfiguration. */
export function seoRoutes(app: FastifyInstance, config: LinkConfig): void {
  const files: [string, string, string][] = [
    ['/robots.txt', robotsTxt(config), 'text/plain; charset=utf-8'],
    ['/sitemap.xml', sitemapXml(config), 'application/xml; charset=utf-8'],
    ['/llms.txt', llmsTxt(config), 'text/plain; charset=utf-8'],
  ];
  for (const [path, body, type] of files) {
    app.get(path, (_request, reply) => reply.header('Cache-Control', 'public, max-age=3600').type(type).send(body));
  }
}
