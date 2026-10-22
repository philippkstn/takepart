import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { HEAD_MARK, isIndexable, llmsTxt, renderIndex, robotsTxt, seoRoutes, sitemapXml } from './seo.ts';

const config = {
  APP_ORIGIN: 'https://takepart.example.org',
  SOURCE_URL: 'https://example.org/code',
  IMPRINT_URL: undefined,
  PRIVACY_URL: 'https://example.org/datenschutz',
};

const template = `<!doctype html>
<html lang="de">
  <head>
    <meta
      name="description"
      content="alt"
    />
    <title>TakePart</title>
    ${HEAD_MARK}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

describe('Suchindex', () => {
  it('lässt nur Startseite und öffentliche Dateien zu', () => {
    for (const url of [
      '/',
      '/?ref=x',
      '/robots.txt',
      '/sitemap.xml',
      '/llms.txt',
      '/icon-512.png',
      '/favicon.svg',
      '/manifest.webmanifest',
      '/assets/index-abc123.js',
    ])
      expect(isIndexable(url), url).toBe(true);
  });

  it('hält Token-Links, Admin und API heraus', () => {
    for (const url of [
      '/123456',
      '/d/abcdef',
      '/h/abcdef',
      '/p/abcdef',
      '/login',
      '/admin',
      '/admin/live/3',
      '/api/config',
      '/api/handout/abc',
      '/api/assets/x.png',
      '/ws',
      '/index.html',
      '/unbekannt',
    ])
      expect(isIndexable(url), url).toBe(false);
  });
});

describe('robots.txt, sitemap.xml, llms.txt', () => {
  it('nimmt die Domain aus APP_ORIGIN', () => {
    expect(robotsTxt(config)).toContain('Sitemap: https://takepart.example.org/sitemap.xml');
    expect(sitemapXml(config)).toContain('<loc>https://takepart.example.org/</loc>');
    expect(sitemapXml({ APP_ORIGIN: 'https://x.example/' })).toContain('<loc>https://x.example/</loc>');
  });

  it('sperrt die Token-Seiten nicht, damit Crawler das noindex sehen', () => {
    const robots = robotsTxt(config);
    expect(robots).toContain('Disallow: /api/');
    expect(robots).not.toMatch(/Disallow: \/(d|h|p|admin)/);
  });

  it('llms.txt verlinkt Quellcode und nur konfigurierte Rechtsseiten', () => {
    const text = llmsTxt(config);
    expect(text).toMatch(/^# TakePart\n/);
    expect(text).toContain('(https://example.org/code)');
    expect(text).toContain('(https://example.org/datenschutz)');
    expect(text).not.toContain('Impressum');
    expect(text).toContain('(https://takepart.example.org/)');
  });
});

describe('ausgeliefertes HTML', () => {
  it('Startseite: Titel, canonical, Open Graph, JSON-LD und lesbarer Inhalt', () => {
    const html = renderIndex(template, config, true);
    expect(html).toContain('<title>TakePart – interaktive Vorträge und Workshops, Open Source</title>');
    expect(html).toContain('<link rel="canonical" href="https://takepart.example.org/" />');
    expect(html).toContain('<meta property="og:image" content="https://takepart.example.org/icon-512.png" />');
    expect(html).not.toContain('content="alt"');
    expect(html).not.toContain(HEAD_MARK);
    const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1];
    const data = JSON.parse(ld ?? '{}');
    expect(data).toMatchObject({
      '@type': 'WebApplication',
      inLanguage: 'de',
      isAccessibleForFree: true,
      url: 'https://takepart.example.org/',
    });
    expect(data.codeRepository).toBe('https://example.org/code');
    expect(html).toMatch(/<div id="root">.*<h1>Interaktive Vorträge und Workshops<\/h1>.*<\/div>/s);
    expect(html).not.toContain('noindex');
  });

  it('andere Seiten: noindex, kein Startseiten-Inhalt, kein canonical', () => {
    const html = renderIndex(template, config, false);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<title>TakePart</title>');
    expect(html).not.toContain('canonical');
  });

  it('maskiert Konfigurationswerte', () => {
    const html = renderIndex(template, { ...config, SOURCE_URL: 'https://example.org/"><script>$&' }, true);
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;$&amp;');
  });
});

describe('Routen', () => {
  it('liefert robots.txt, sitemap.xml und llms.txt mit passendem Typ', async () => {
    const app = Fastify();
    seoRoutes(app, config);
    const robots = await app.inject('/robots.txt');
    expect(robots.statusCode).toBe(200);
    expect(robots.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(robots.body).toContain('Sitemap: https://takepart.example.org/sitemap.xml');
    const sitemap = await app.inject('/sitemap.xml');
    expect(sitemap.headers['content-type']).toBe('application/xml; charset=utf-8');
    const llms = await app.inject('/llms.txt');
    expect(llms.body).toContain('## Funktionen');
    await app.close();
  });
});
