import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api } from './api.ts';

export interface Account {
  id: number;
  username: string;
  isAdmin: boolean;
  hasPassword: boolean;
}

export interface AuthStatus {
  loggedIn: boolean;
  account: Account | null;
  /** Noch kein Konto: Ersteinrichtung mit Setup-Token */
  setupNeeded: boolean;
  setupPossible: boolean;
}

export const authStatus = () => api<AuthStatus>('/api/auth/status');

/** Muss zur Prüfung in apps/server/src/password.ts passen */
export const MIN_PASSWORD_LENGTH = 10;

export const loginWithPassword = (username: string, password: string) => api('/api/auth/password/login', { body: { username, password } });

export const setupWithPassword = (username: string, password: string, setupToken: string) =>
  api('/api/auth/setup/password', { body: { username, password, setupToken } });

export async function loginWithPasskey() {
  const { options, challengeId } = await api<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>(
    '/api/auth/login/options',
    { body: {} },
  );
  const response = await startAuthentication({ optionsJSON: options });
  await api('/api/auth/login/verify', { body: { challengeId, response } });
}

/** Passkey für das angemeldete Konto – oder bei der Ersteinrichtung (Setup-Token + Benutzername) für das erste Konto. */
export async function registerPasskey(label: string, setup?: { setupToken: string; username: string }) {
  const setupToken = setup?.setupToken;
  const { options, challengeId } = await api<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }>(
    '/api/auth/register/options',
    { body: { setupToken, username: setup?.username } },
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
