import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.ts';
import { exec, one, query, type Db } from './db.ts';

/**
 * Anmeldung des Hosts per Passkey. Es gibt genau einen Host (dich); jeder
 * registrierte Passkey gehört ihm.
 *
 * Den ersten Passkey registriert nur, wer den SETUP_TOKEN aus der .env kennt.
 * Weitere Passkeys (z. B. Handy fürs Steuerpult) nur im eingeloggten Zustand.
 */

export const SESSION_COOKIE = 'slides_host';
const SESSION_DAYS = 30;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const USER_ID = new TextEncoder().encode('slides-host');

/** Challenges liegen im Speicher: ein Prozess, kurze Lebensdauer. */
const challenges = new Map<string, { challenge: string; kind: 'register' | 'login'; expires: number }>();

function rememberChallenge(kind: 'register' | 'login', challenge: string): string {
  const now = Date.now();
  for (const [id, c] of challenges) if (c.expires < now) challenges.delete(id);
  const id = randomBytes(16).toString('base64url');
  challenges.set(id, { challenge, kind, expires: now + CHALLENGE_TTL_MS });
  return id;
}

function takeChallenge(kind: 'register' | 'login', id: string): string | null {
  const c = challenges.get(id);
  challenges.delete(id);
  if (!c || c.kind !== kind || c.expires < Date.now()) return null;
  return c.challenge;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function isHost(db: Db, request: FastifyRequest): Promise<boolean> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return false;
  const row = await one<{ ok: number }>(db, 'SELECT 1 AS ok FROM host_sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)', [
    sha256(token),
  ]);
  return !!row;
}

export function requireHost(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await isHost(db, request))) {
      return reply.code(401).send({ error: 'Bitte zuerst anmelden' });
    }
  };
}

interface CredentialRow {
  id: string;
  public_key: Buffer;
  counter: number;
  transports: string | null;
  label: string;
  created_at: Date;
  last_used_at: Date | null;
}

export function authRoutes(app: FastifyInstance, db: Db, config: Config) {
  const origin = config.APP_ORIGIN;
  const rpID = config.rpId;

  async function startSession(reply: FastifyReply) {
    const token = randomBytes(32).toString('base64url');
    await exec(db, 'INSERT INTO host_sessions (token_hash, expires_at) VALUES (?, UTC_TIMESTAMP(3) + INTERVAL ? DAY)', [
      sha256(token),
      SESSION_DAYS,
    ]);
    await exec(db, 'DELETE FROM host_sessions WHERE expires_at < UTC_TIMESTAMP(3)');
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: SESSION_DAYS * 24 * 3600,
    });
  }

  const countCredentials = async () => (await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM credentials'))?.n ?? 0;

  /** Ohne Anmeldung nur mit Setup-Token – und nur, solange noch kein Passkey existiert. */
  async function setupDenied(setupToken: string | undefined): Promise<string | null> {
    if ((await countCredentials()) > 0) return 'Bitte mit deinem Passkey anmelden';
    if (!config.SETUP_TOKEN || !setupToken || !safeEqual(sha256(setupToken), sha256(config.SETUP_TOKEN))) {
      return 'Setup-Token ist falsch';
    }
    return null;
  }

  app.get('/api/auth/status', async (request) => ({
    loggedIn: await isHost(db, request),
    hasPasskey: (await countCredentials()) > 0,
    setupPossible: !!config.SETUP_TOKEN,
  }));

  app.post('/api/auth/register/options', async (request, reply) => {
    const body = z.object({ setupToken: z.string().optional(), label: z.string().trim().max(100).optional() }).parse(request.body ?? {});
    const loggedIn = await isHost(db, request);
    const denied = loggedIn ? null : await setupDenied(body.setupToken);
    if (denied) return reply.code(403).send({ error: denied });
    const existing = await query<{ id: string; transports: string | null }>(db, 'SELECT id, transports FROM credentials');
    const options = await generateRegistrationOptions({
      rpName: 'TakePart',
      rpID,
      userName: 'host',
      userDisplayName: 'Vortragende*r',
      userID: USER_ID,
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports ? c.transports.split(',') : undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    return { options, challengeId: rememberChallenge('register', options.challenge) };
  });

  app.post('/api/auth/register/verify', async (request, reply) => {
    const body = z
      .object({
        challengeId: z.string(),
        response: z.custom<RegistrationResponseJSON>((v) => typeof v === 'object' && v !== null),
        label: z.string().trim().max(100).default(''),
        setupToken: z.string().optional(),
      })
      .parse(request.body);
    const loggedIn = await isHost(db, request);
    const denied = loggedIn ? null : await setupDenied(body.setupToken);
    if (denied) return reply.code(403).send({ error: denied });
    const expectedChallenge = takeChallenge('register', body.challengeId);
    if (!expectedChallenge) return reply.code(400).send({ error: 'Vorgang abgelaufen, bitte erneut versuchen' });

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (err) {
      request.log.warn({ err }, 'Passkey-Registrierung abgelehnt');
      return reply.code(400).send({ error: 'Passkey konnte nicht geprüft werden' });
    }
    if (!verification.verified) return reply.code(400).send({ error: 'Passkey konnte nicht geprüft werden' });

    const { credential } = verification.registrationInfo;
    const label = body.label || `Passkey vom ${new Date().toLocaleDateString('de-DE')}`;
    await exec(db, 'INSERT INTO credentials (id, public_key, counter, transports, label) VALUES (?, ?, ?, ?, ?)', [
      credential.id,
      Buffer.from(credential.publicKey),
      credential.counter,
      credential.transports?.join(',') ?? null,
      label,
    ]);
    if (!loggedIn) await startSession(reply);
    return { ok: true };
  });

  app.post('/api/auth/login/options', async () => {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    return { options, challengeId: rememberChallenge('login', options.challenge) };
  });

  app.post('/api/auth/login/verify', async (request, reply) => {
    const body = z
      .object({
        challengeId: z.string(),
        response: z.custom<AuthenticationResponseJSON>((v) => typeof v === 'object' && v !== null),
      })
      .parse(request.body);
    const expectedChallenge = takeChallenge('login', body.challengeId);
    if (!expectedChallenge) return reply.code(400).send({ error: 'Vorgang abgelaufen, bitte erneut versuchen' });

    const row = await one<CredentialRow>(db, 'SELECT * FROM credentials WHERE id = ?', [body.response.id]);
    if (!row) return reply.code(401).send({ error: 'Dieser Passkey ist hier nicht registriert' });

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
        credential: {
          id: row.id,
          publicKey: new Uint8Array(row.public_key),
          counter: Number(row.counter),
          transports: row.transports ? row.transports.split(',') : undefined,
        },
      });
    } catch (err) {
      request.log.warn({ err }, 'Passkey-Anmeldung abgelehnt');
      return reply.code(401).send({ error: 'Anmeldung fehlgeschlagen' });
    }
    if (!verification.verified) return reply.code(401).send({ error: 'Anmeldung fehlgeschlagen' });

    await exec(db, 'UPDATE credentials SET counter = ?, last_used_at = UTC_TIMESTAMP(3) WHERE id = ?', [
      verification.authenticationInfo.newCounter,
      row.id,
    ]);
    await startSession(reply);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await exec(db, 'DELETE FROM host_sessions WHERE token_hash = ?', [sha256(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/passkeys', { preHandler: requireHost(db) }, async () => {
    const rows = await query<CredentialRow>(db, 'SELECT id, label, created_at, last_used_at FROM credentials ORDER BY created_at');
    return rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
  });

  app.delete('/api/auth/passkeys/:id', { preHandler: requireHost(db) }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    if ((await countCredentials()) <= 1) {
      return reply.code(400).send({ error: 'Der letzte Passkey kann nicht gelöscht werden' });
    }
    await exec(db, 'DELETE FROM credentials WHERE id = ?', [id]);
    return { ok: true };
  });
}
