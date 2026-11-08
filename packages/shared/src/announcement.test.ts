import { describe, expect, it } from 'vitest';
import { activeAnnouncement, ANNOUNCEMENT_MS, hostCommand } from './state.ts';

describe('Rundruf', () => {
  it('prüft den Befehl', () => {
    expect(hostCommand.parse({ action: 'announce', text: '  Bitte zurück in Raum 2 ' })).toEqual({
      action: 'announce',
      text: 'Bitte zurück in Raum 2',
    });
    expect(hostCommand.safeParse({ action: 'announce', text: null }).success).toBe(true);
    expect(hostCommand.safeParse({ action: 'announce', text: '   ' }).success).toBe(false);
    expect(hostCommand.safeParse({ action: 'announce', text: 'x'.repeat(301) }).success).toBe(false);
  });

  it('läuft nach 30 Minuten ab', () => {
    const a = { text: 'Hallo', at: 1000 };
    expect(activeAnnouncement(a, 1000 + ANNOUNCEMENT_MS - 1)).toBe(a);
    expect(activeAnnouncement(a, 1000 + ANNOUNCEMENT_MS)).toBeNull();
    expect(activeAnnouncement(null, 0)).toBeNull();
  });
});
