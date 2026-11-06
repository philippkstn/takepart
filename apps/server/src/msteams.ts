import { createHash } from 'node:crypto';
import { deflateRawSync, deflateSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { requireHost } from './auth.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';

/**
 * Microsoft Teams: TakePart als Meeting-App (Seitenleiste + Meeting-Bühne).
 *
 * Abschaltbar über `TEAMS_APP` (Standard aus). Aus heißt: keine Einbettung
 * erlaubt (`frame-ancestors 'none'` wie überall), kein App-Paket, Teams-Seiten
 * zeigen nur einen Hinweis. Bereits in Teams installierte Apps laden dann
 * nichts mehr – das ist der Rückzug.
 *
 * Die Bühne zeigt die normale Beamer-Ansicht über den Anzeige-Link; jede Person
 * im Meeting lädt sie selbst (Teams-Modus „Collaborative“). Keine Anmeldung im
 * iframe nötig – der Anzeige-Link ist die Zugriffskontrolle wie beim Beamer.
 */

/** Seiten, die Teams einbetten darf (nur mit TEAMS_APP) */
const TEAMS_PAGE = /^\/teams(\/|\?|$)/;

/** Teams-Clients (neu, Web, Desktop) laut Microsoft-Doku zu Tab-Anforderungen */
export const TEAMS_FRAME_ANCESTORS = ['https://teams.microsoft.com', 'https://*.teams.microsoft.com', 'https://*.cloud.microsoft'];

/** Wert für `frame-ancestors` je Pfad: nur Teams-Seiten und nur, wenn eingeschaltet */
export function frameAncestors(url: string, enabled: boolean): string {
  return enabled && TEAMS_PAGE.test(url) ? TEAMS_FRAME_ANCESTORS.join(' ') : "'none'";
}

/** Feste App-ID je Instanz (aus APP_ORIGIN) – erneutes Hochladen ersetzt die App statt sie zu verdoppeln */
export function teamsAppId(origin: string): string {
  const h = createHash('sha256').update(`takepart-teams:${new URL(origin).origin}`).digest('hex');
  // Form einer UUID v4 (Version- und Variant-Bits gesetzt)
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Version des App-Pakets – erhöhen, wenn sich das Manifest ändert (Teams verlangt das beim Aktualisieren) */
export const TEAMS_APP_VERSION = '1.0.0';

export function teamsManifest(config: Pick<Config, 'APP_ORIGIN' | 'IMPRINT_URL' | 'PRIVACY_URL'>) {
  const origin = new URL(config.APP_ORIGIN).origin;
  const host = new URL(origin).host;
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/teams/v1.19/MicrosoftTeams.schema.json',
    manifestVersion: '1.19',
    version: TEAMS_APP_VERSION,
    id: teamsAppId(origin),
    developer: {
      name: 'TakePart',
      websiteUrl: origin,
      privacyUrl: config.PRIVACY_URL ?? origin,
      termsOfUseUrl: config.IMPRINT_URL ?? origin,
    },
    icons: { color: 'color.png', outline: 'outline.png' },
    name: { short: 'TakePart', full: 'TakePart – interaktive Vorträge' },
    description: {
      short: 'Folien und Live-Ergebnisse von TakePart auf der Meeting-Bühne zeigen.',
      full:
        'Zeigt die Beamer-Ansicht einer laufenden TakePart-Präsentation direkt auf der Teams-Meeting-Bühne: ' +
        'Folien, Abstimmungsergebnisse, Fragen und Countdown erscheinen gestochen scharf in jedem Meeting-Fenster ' +
        'statt als Bildschirmfreigabe. Eingerichtet wird die App mit dem Anzeige-Link aus dem Steuerpult.',
    },
    accentColor: '#E0532F',
    configurableTabs: [
      {
        configurationUrl: `${origin}/teams/einrichten`,
        canUpdateConfiguration: true,
        scopes: ['team', 'groupChat'],
        context: ['meetingSidePanel', 'meetingStage'],
      },
    ],
    permissions: ['identity'],
    validDomains: [host],
    authorization: {
      permissions: {
        resourceSpecific: [
          { name: 'MeetingStage.Write.Chat', type: 'Delegated' },
          { name: 'ChannelMeetingStage.Write.Group', type: 'Delegated' },
        ],
      },
    },
  };
}

export function teamsRoutes(app: FastifyInstance, db: Db, config: Config) {
  /** App-Paket zum Hochladen in Teams (Manifest + Icons), passend zu dieser Instanz */
  app.get('/api/teams/app.zip', { preHandler: requireHost(db) }, async (_request, reply) => {
    if (!config.TEAMS_APP) return reply.code(404).send({ error: 'Teams-App ist auf diesem Server nicht eingeschaltet' });
    const zip = zipStore([
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(teamsManifest(config), null, 2)) },
      { name: 'color.png', data: colorIcon() },
      { name: 'outline.png', data: outlineIcon() },
    ]);
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename="takepart-teams.zip"')
      .header('Cache-Control', 'no-store')
      .send(zip);
  });
}

// ---------------------------------------------------------------------------
// Icons: aus der Geometrie von favicon.svg (32er-Raster, drei Balken) gerechnet.
// Farbig 192×192 vollflächig (Teams rundet selbst ab), Umriss 32×32 weiß auf transparent.

const BARS: [x: number, y: number, w: number, h: number][] = [
  [8, 17, 4, 7],
  [14, 10, 4, 14],
  [20, 13, 4, 11],
];
const BAR_RADIUS = 2;

/** Liegt der Punkt (im 32er-Raster) auf einem Balken mit runden Enden? */
function onBar(px: number, py: number): boolean {
  for (const [x, y, w, h] of BARS) {
    if (px < x || px > x + w || py < y || py > y + h) continue;
    const cx = Math.min(Math.max(px, x + BAR_RADIUS), x + w - BAR_RADIUS);
    const cy = Math.min(Math.max(py, y + BAR_RADIUS), y + h - BAR_RADIUS);
    if ((px - cx) ** 2 + (py - cy) ** 2 <= BAR_RADIUS ** 2) return true;
  }
  return false;
}

/** Deckung der Balken je Pixel (4×4-Überabtastung für glatte Kanten) */
function coverage(size: number, px: number, py: number): number {
  const scale = 32 / size;
  let hits = 0;
  for (let sy = 0; sy < 4; sy++)
    for (let sx = 0; sx < 4; sx++) if (onBar((px + (sx + 0.5) / 4) * scale, (py + (sy + 0.5) / 4) * scale)) hits++;
  return hits / 16;
}

export function colorIcon(): Buffer {
  const size = 192;
  const bg = [0xe0, 0x53, 0x2f];
  return png(size, (x, y) => {
    const a = coverage(size, x, y);
    return [...bg.map((c) => Math.round(c + (255 - c) * a)), 255] as [number, number, number, number];
  });
}

export function outlineIcon(): Buffer {
  const size = 32;
  return png(size, (x, y) => [255, 255, 255, Math.round(255 * coverage(size, x, y))]);
}

// ---------------------------------------------------------------------------
// Kleine Kodierer ohne Abhängigkeiten (kein natives Modul, siehe CLAUDE.md)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function png(size: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // Filter: keiner
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), row + 1 + x * 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 Bit, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ZIP mit Deflate, ohne Verzeichnisse – genügt für das Teams-App-Paket */
export function zipStore(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  // DOS-Zeitstempel 1.1.2020 00:00 – fest, damit gleiche Inhalte gleiche Pakete ergeben
  const dosTime = 0;
  const dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const packed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // benötigte Version
    local.writeUInt16LE(0x0800, 6); // UTF-8-Namen
    local.writeUInt16LE(8, 8); // Deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // erstellt mit
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
