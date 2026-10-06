import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api } from './api.ts';

export interface AuthStatus {
  loggedIn: boolean;
  hasPasskey: boolean;
  setupPossible: boolean;
}

export const authStatus = () => api<AuthStatus>('/api/auth/status');

export async function loginWithPasskey() {
  const { options, challengeId } = await api<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>(
    '/api/auth/login/options',
    { body: {} },
  );
  const response = await startAuthentication({ optionsJSON: options });
  await api('/api/auth/login/verify', { body: { challengeId, response } });
}

export async function registerPasskey(label: string, setupToken?: string) {
  const { options, challengeId } = await api<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }>(
    '/api/auth/register/options',
    { body: { setupToken } },
  );
  const response = await startRegistration({ optionsJSON: options });
  await api('/api/auth/register/verify', { body: { challengeId, response, label, setupToken } });
}

/** Browser-Fehlermeldungen von WebAuthn in verständliches Deutsch übersetzen. */
export function passkeyError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'NotAllowedError') return 'Abgebrochen oder Zeit abgelaufen';
    if (err.name === 'InvalidStateError') return 'Dieser Passkey ist bereits registriert';
    return err.message;
  }
  return 'Unbekannter Fehler';
}
