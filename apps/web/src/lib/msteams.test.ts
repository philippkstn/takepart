import { describe, expect, it } from 'vitest';
import { displayTokenFrom, teamsTabUrl } from './msteams.ts';

const origin = 'https://takepart.example.org';
const token = 'Abc_def-0123456789ABCDEFGHijklmn';

describe('Anzeige-Link für die Teams-App', () => {
  it('nimmt Link dieser Instanz oder den Token selbst', () => {
    expect(displayTokenFrom(`${origin}/d/${token}`, origin)).toBe(token);
    expect(displayTokenFrom(`  ${origin}/d/${token}/ `, origin)).toBe(token);
    expect(displayTokenFrom(token, origin)).toBe(token);
  });

  it('lehnt fremde Server, andere Seiten und Unsinn ab', () => {
    expect(displayTokenFrom(`https://evil.example/d/${token}`, origin)).toBeNull();
    expect(displayTokenFrom(`${origin}/h/${token}`, origin)).toBeNull();
    expect(displayTokenFrom(`${origin}/123456`, origin)).toBeNull();
    expect(displayTokenFrom('123456', origin)).toBeNull();
    expect(displayTokenFrom('', origin)).toBeNull();
  });

  it('baut die Tab-Adresse', () => {
    expect(teamsTabUrl(origin, token)).toBe(`${origin}/teams/tab/${token}`);
  });
});
