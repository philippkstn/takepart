import { ABOUT } from '@slides/shared';
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
    ...ABOUT.features.map((f) => `- ${f}`),
    '',
    '## Betrieb',
    '',
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
    image: `${origin}/icon-512.png`,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Interaktive Präsentation, Audience Response, Workshop-Moderation',
    operatingSystem: 'Web (Browser)',
    browserRequirements: 'Aktueller Browser mit JavaScript',
    inLanguage: 'de',
    isAccessibleForFree: true,
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    codeRepository: config.SOURCE_URL,
    featureList: [...ABOUT.features],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Platzhalter in `apps/web/index.html`; im Vite-Entwicklungsserver ein unsichtbarer Kommentar. */
export const HEAD_MARK = '<!--#seo-->';
const ROOT = '<div id="root"></div>';

/**
 * Ausgeliefertes HTML. Startseite: Titel, canonical, Open Graph, JSON-LD und
 * lesbarer Inhalt im `#root`, den React beim Start ersetzt (Crawler ohne
 * JavaScript, Link-Vorschauen, KI-Suchen). Alle anderen Seiten: unverändert
 * plus `noindex` – und ohne Startseiten-Inhalt, damit er dort nicht aufblitzt.
 */
export function renderIndex(template: string, config: LinkConfig, home: boolean): string {
  if (!home) return template.replace(HEAD_MARK, () => '<meta name="robots" content="noindex, nofollow" />');
  const origin = originOf(config);
  const url = `${origin}/`;
  const t = escapeHtml(ABOUT.title);
  const d = escapeHtml(ABOUT.description);
  const head = [
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${escapeHtml(ABOUT.name)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(origin)}/icon-512.png" />`,
    '<meta property="og:image:width" content="512" />',
    '<meta property="og:image:height" content="512" />',
    '<meta property="og:locale" content="de_DE" />',
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<script type="application/ld+json">${jsonLd(config)}</script>`,
  ].join('\n    ');
  // Gleiche Klassen wie die Startseite: Der Text steht dort, wo React ihn gleich wieder zeigt.
  const body = [
    '<div class="p-shell takepart-scope">',
    '<main class="p-main home"><div class="home-brand"><span class="display-font">TakePart</span></div></main>',
    `<section class="home-about"><h1>${escapeHtml(ABOUT.tagline)}</h1><p>${d}</p>`,
    `<ul>${ABOUT.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`,
    `<p>${escapeHtml(ABOUT.selfHosting)} <a href="${escapeHtml(config.SOURCE_URL)}">Quellcode</a></p></section>`,
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
