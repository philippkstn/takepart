import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { colorIcon, crc32, frameAncestors, outlineIcon, teamsAppId, teamsManifest, zipStore } from './msteams.ts';

const config = { APP_ORIGIN: 'https://takepart.example.org', IMPRINT_URL: undefined, PRIVACY_URL: 'https://example.org/datenschutz' };

/** Breite, Höhe und RGBA-Pixel eines (ungefilterten) PNG aus colorIcon()/outlineIcon() */
function decodePng(buf: Buffer) {
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    expect(buf.readUInt32BE(pos + 8 + len)).toBe(crc32(buf.subarray(pos + 4, pos + 8 + len)));
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const pixel = (x: number, y: number) => [...raw.subarray(y * (width * 4 + 1) + 1 + x * 4, y * (width * 4 + 1) + 5 + x * 4)];
  return { width, height, pixel };
}

describe('Teams-App: Einbetten', () => {
  it('erlaubt Teams nur auf den Teams-Seiten und nur eingeschaltet', () => {
    expect(frameAncestors('/teams/tab/abc', true)).toContain('https://teams.microsoft.com');
    expect(frameAncestors('/teams/einrichten', true)).toContain('https://*.cloud.microsoft');
    for (const url of ['/', '/d/abc', '/admin', '/teamsx', '/api/teams/app.zip', '/123456'])
      expect(frameAncestors(url, true), url).toBe("'none'");
    expect(frameAncestors('/teams/tab/abc', false)).toBe("'none'");
  });

  it('ist ohne Angabe ausgeschaltet und lässt sich mit 1/true einschalten', () => {
    const base = { DB_USER: 'u', DB_NAME: 'n' };
    expect(loadConfig(base).TEAMS_APP).toBe(false);
    expect(loadConfig({ ...base, TEAMS_APP: '0' }).TEAMS_APP).toBe(false);
    expect(loadConfig({ ...base, TEAMS_APP: '' }).TEAMS_APP).toBe(false);
    expect(loadConfig({ ...base, TEAMS_APP: '1' }).TEAMS_APP).toBe(true);
    expect(loadConfig({ ...base, TEAMS_APP: 'true' }).TEAMS_APP).toBe(true);
    expect(() => loadConfig({ ...base, TEAMS_APP: 'ja' })).toThrow(/TEAMS_APP/);
  });
});

describe('Teams-App: Manifest', () => {
  it('hat je Instanz eine feste App-ID im UUID-Format', () => {
    const id = teamsAppId('https://takepart.example.org');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(teamsAppId('https://takepart.example.org/')).toBe(id);
    expect(teamsAppId('https://andere.example.org')).not.toBe(id);
  });

  it('zeigt auf diese Instanz und bietet Seitenleiste + Bühne', () => {
    const m = teamsManifest(config);
    expect(m.validDomains).toEqual(['takepart.example.org']);
    expect(m.configurableTabs[0]!.configurationUrl).toBe('https://takepart.example.org/teams/einrichten');
    expect(m.configurableTabs[0]!.context).toEqual(['meetingSidePanel', 'meetingStage']);
    expect(m.authorization.permissions.resourceSpecific.map((p) => p.name)).toContain('MeetingStage.Write.Chat');
    expect(m.developer.privacyUrl).toBe('https://example.org/datenschutz');
    expect(m.developer.termsOfUseUrl).toBe('https://takepart.example.org');
    // Grenzen des Teams-Schemas
    expect(m.name.short.length).toBeLessThanOrEqual(30);
    expect(m.description.short.length).toBeLessThanOrEqual(80);
    expect(m.description.full.length).toBeLessThanOrEqual(4000);
  });
});

describe('Teams-App: Paket', () => {
  it('Icons haben die verlangten Größen; Umriss weiß auf transparent', () => {
    const color = decodePng(colorIcon());
    expect([color.width, color.height]).toEqual([192, 192]);
    expect(color.pixel(0, 0)).toEqual([0xe0, 0x53, 0x2f, 255]);
    expect(color.pixel(96, 120)).toEqual([255, 255, 255, 255]); // mittlerer Balken

    const outline = decodePng(outlineIcon());
    expect([outline.width, outline.height]).toEqual([32, 32]);
    expect(outline.pixel(0, 0)).toEqual([255, 255, 255, 0]);
    expect(outline.pixel(16, 20)).toEqual([255, 255, 255, 255]);
  });

  it('ZIP lässt sich lesen', async () => {
    const zip = await JSZip.loadAsync(
      zipStore([
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(teamsManifest(config))) },
        { name: 'color.png', data: colorIcon() },
      ]),
    );
    expect(Object.keys(zip.files).sort()).toEqual(['color.png', 'manifest.json']);
    expect(JSON.parse(await zip.file('manifest.json')!.async('string')).id).toBe(teamsAppId(config.APP_ORIGIN));
    expect(await zip.file('color.png')!.async('nodebuffer')).toEqual(colorIcon());
  });
});
