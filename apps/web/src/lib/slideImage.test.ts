import { describe, expect, it } from 'vitest';
import { wantsHires } from './slideImage.ts';

describe('Beamer: hochauflösende Folien', () => {
  it('nur auf großen Bildschirmen', () => {
    expect(wantsHires(1920, 1, undefined)).toBe(false);
    expect(wantsHires(2560, 1, undefined)).toBe(true);
    expect(wantsHires(1512, 2, undefined)).toBe(true);
  });
  it('nicht bei langsamer Verbindung oder Datensparmodus', () => {
    expect(wantsHires(3840, 1, { effectiveType: '4g', downlink: 10 })).toBe(true);
    expect(wantsHires(3840, 1, { effectiveType: '4g', downlink: 1.5 })).toBe(false);
    expect(wantsHires(3840, 1, { effectiveType: '3g' })).toBe(false);
    expect(wantsHires(3840, 1, { saveData: true })).toBe(false);
  });
});
