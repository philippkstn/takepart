import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.ts';

describe('Passwort-Hashes', () => {
  it('erkennen das richtige Passwort und lehnen falsche ab', async () => {
    const stored = await hashPassword('richtig-langes-passwort');
    expect(stored.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('richtig-langes-passwort', stored)).toBe(true);
    expect(await verifyPassword('falsches-passwort', stored)).toBe(false);
  });

  it('verwenden für gleiche Passwörter unterschiedliche Salze', async () => {
    expect(await hashPassword('gleich')).not.toBe(await hashPassword('gleich'));
  });

  it('lehnen kaputte Einträge ab', async () => {
    expect(await verifyPassword('egal', 'kein-hash')).toBe(false);
  });
});
