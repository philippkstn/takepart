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
import { exec, isDuplicateKey, one, query, transaction, type Conn, type Db } from './db.ts';
import { insertDemoBrandsFor } from './demo.ts';
import { getDummyHash, hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from './password.ts';

/**
 * Anmeldung per Passkey oder Benutzername + Passwort. Es gibt mehrere Konten;
 * jedes hat eigene Passkeys, optional ein Passwort und sieht nur seine eigenen
 * Präsentationen und Brandings (siehe access.ts).
 *
 * Das erste Konto (Admin) legt nur an, wer den SETUP_TOKEN aus der .env kennt.
 * Weitere Konten legen Admins an (users.ts). Jedes Konto behält mindestens eine
 * Anmeldeart: der letzte Passkey geht nur mit Passwort weg und umgekehrt.
 */

export const SESSION_COOKIE = 'slides_host';
const SESSION_DAYS = 30;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Obergrenze, damit massenhaft angeforderte Challenges den Speicher nicht füllen */
const MAX_CHALLENGES = 500;
/** Login und Registrierung: wenige Versuche pro Minute und IP */
export const AUTH_LIMIT = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

export interface Account {
  id: number;
  username: string;
  isAdmin: boolean;
  hasPassword: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Angemeldetes Konto – gesetzt von requireHost */
    account?: Account;
  }
}

/** Für die erste Einrichtung: das Konto entsteht erst nach geprüftem Passkey. */
interface PendingAccount {
  username: string;
  handle: string;
}

/** Challenges liegen im Speicher: ein Prozess, kurze Lebensdauer. */
interface Challenge {
  challenge: string;
  kind: 'register' | 'login';
  expires: number;
  userId?: number;
  pending?: PendingAccount;
}
const challenges = new Map<string, Challenge>();

function rememberChallenge(entry: Omit<Challenge, 'expires'>): string {
  const now = Date.now();
  for (const [id, c] of challenges) if (c.expires < now) challenges.delete(id);
  // Älteste zuerst verwerfen (Map behält die Einfügereihenfolge)
  for (const id of challenges.keys()) {
    if (challenges.size < MAX_CHALLENGES) break;
    challenges.delete(id);
  }
  const id = randomBytes(16).toString('base64url');
  challenges.set(id, { ...entry, expires: now + CHALLENGE_TTL_MS });
  return id;
}

function takeChallenge(kind: 'register' | 'login', id: string): Challenge | null {
  const c = challenges.get(id);
  challenges.delete(id);
  if (!c || c.kind !== kind || c.expires < Date.now()) return null;
  return c;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const usernameInput = z.string().trim().min(2, 'Der Benutzername braucht mindestens zwei Zeichen').max(100, 'Höchstens 100 Zeichen');
export const passwordInput = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen`)
  .max(200, 'Höchstens 200 Zeichen');

export const DUPLICATE_USERNAME = 'Dieser Benutzername ist schon vergeben';

interface AccountRow {
  id: number;
  username: string;
  is_admin: number;
  has_password: number;
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  username: r.username,
  isAdmin: !!r.is_admin,
  hasPassword: !!r.has_password,
});

export async function currentAccount(db: Db, request: FastifyRequest): Promise<Account | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = await one<AccountRow>(
    db,
    `SELECT u.id, u.username, u.is_admin, (u.password_hash IS NOT NULL) AS has_password
       FROM host_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)`,
    [sha256(token)],
  );
  return row ? toAccount(row) : null;
}

export function requireHost(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const account = await currentAccount(db, request);
    if (!account) return reply.code(401).send({ error: 'Bitte zuerst anmelden' });
    request.account = account;
  };
}

export function requireAdmin(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const account = await currentAccount(db, request);
    if (!account) return reply.code(401).send({ error: 'Bitte zuerst anmelden' });
    if (!account.isAdmin) return reply.code(403).send({ error: 'Nur für Admins' });
    request.account = account;
  };
}

/** Das angemeldete Konto in Routen hinter requireHost/requireAdmin */
export function accountOf(request: FastifyRequest): Account {
  if (!request.account) throw new Error('requireHost fehlt');
  return request.account;
}

/** Neues Konto samt Demo-Brandings anlegen. */
export async function createAccount(
  conn: Conn,
  input: { username: string; passwordHash: string | null; isAdmin: boolean; handle?: string },
): Promise<number> {
  const result = await exec(conn, 'INSERT INTO users (username, password_hash, webauthn_handle, is_admin) VALUES (?, ?, ?, ?)', [
    input.username,
    input.passwordHash,
    input.handle ?? randomBytes(16).toString('base64url'),
    input.isAdmin ? 1 : 0,
  ]);
  await insertDemoBrandsFor(conn, result.insertId);
  return result.insertId;
}

/** Alle Sitzungen eines Kontos beenden – außer der aktuellen. */
export async function endOtherSessions(db: Db, userId: number, request: FastifyRequest) {
  const current = request.cookies[SESSION_COOKIE];
  await exec(db, 'DELETE FROM host_sessions WHERE user_id = ? AND token_hash <> ?', [userId, current ? sha256(current) : '']);
}

interface CredentialRow {
  id: string;
  user_id: number;
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
  const host = { preHandler: requireHost(db) };
  // Vergleichs-Hash vorab berechnen, sonst dauert der erste Fehlversuch mit unbekanntem Namen länger
  void getDummyHash();

  async function startSession(reply: FastifyReply, userId: number) {
    const token = randomBytes(32).toString('base64url');
    await exec(db, 'INSERT INTO host_sessions (token_hash, user_id, expires_at) VALUES (?, ?, UTC_TIMESTAMP(3) + INTERVAL ? DAY)', [
      sha256(token),
      userId,
      SESSION_DAYS,
    ]);
    await exec(db, 'DELETE FROM host_sessions WHERE expires_at < UTC_TIMESTAMP(3)');
    await exec(db, 'UPDATE users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?', [userId]);
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: SESSION_DAYS * 24 * 3600,
    });
  }

  const countUsers = async () => Number((await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users'))?.n ?? 0);
  const countPasskeys = async (userId: number) =>
    Number((await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?', [userId]))?.n ?? 0);

  /** Ohne Anmeldung nur mit Setup-Token – und nur, solange es noch kein Konto gibt. */
  async function setupDenied(setupToken: string | undefined): Promise<string | null> {
    if ((await countUsers()) > 0) return 'Bitte zuerst anmelden';
    if (!config.SETUP_TOKEN || !setupToken || !safeEqual(sha256(setupToken), sha256(config.SETUP_TOKEN))) {
      return 'Setup-Token ist falsch';
    }
    return null;
  }

  app.get('/api/auth/status', async (request) => {
    const account = await currentAccount(db, request);
    return {
      loggedIn: !!account,
      account,
      setupNeeded: (await countUsers()) === 0,
      setupPossible: !!config.SETUP_TOKEN,
    };
  });

  /** Erste Einrichtung mit Passwort statt Passkey (z. B. ohne HTTPS, wo Passkeys nicht gehen). */
  app.post('/api/auth/setup/password', AUTH_LIMIT, async (request, reply) => {
    const body = z.object({ setupToken: z.string(), username: usernameInput, password: passwordInput }).parse(request.body);
    const denied = await setupDenied(body.setupToken);
    if (denied) return reply.code(403).send({ error: denied });
    const passwordHash = await hashPassword(body.password);
    const userId = await transaction(db, (conn) => createAccount(conn, { username: body.username, passwordHash, isAdmin: true }));
    await startSession(reply, userId);
    return { ok: true };
  });

  app.post('/api/auth/register/options', AUTH_LIMIT, async (request, reply) => {
    const body = z.object({ setupToken: z.string().optional(), username: z.string().optional() }).parse(request.body ?? {});
    const account = await currentAccount(db, request);
    let user: { id?: number; username: string; handle: string };
    if (account) {
      const row = await one<{ webauthn_handle: string }>(db, 'SELECT webauthn_handle FROM users WHERE id = ?', [account.id]);
      user = { id: account.id, username: account.username, handle: row!.webauthn_handle };
    } else {
      const denied = await setupDenied(body.setupToken);
      if (denied) return reply.code(403).send({ error: denied });
      user = { username: usernameInput.parse(body.username ?? ''), handle: randomBytes(16).toString('base64url') };
    }
    const existing = user.id
      ? await query<{ id: string; transports: string | null }>(db, 'SELECT id, transports FROM credentials WHERE user_id = ?', [user.id])
      : [];
    const options = await generateRegistrationOptions({
      rpName: 'TakePart',
      rpID,
      userName: user.username,
      userDisplayName: user.username,
      userID: Buffer.from(user.handle, 'base64url'),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports ? c.transports.split(',') : undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    const challengeId = rememberChallenge({
      kind: 'register',
      challenge: options.challenge,
      userId: user.id,
      pending: user.id ? undefined : { username: user.username, handle: user.handle },
    });
    return { options, challengeId };
  });

  app.post('/api/auth/register/verify', AUTH_LIMIT, async (request, reply) => {
    const body = z
      .object({
        challengeId: z.string(),
        response: z.custom<RegistrationResponseJSON>((v) => typeof v === 'object' && v !== null),
        label: z.string().trim().max(100).default(''),
        setupToken: z.string().optional(),
      })
      .parse(request.body);
    const account = await currentAccount(db, request);
    const challenge = takeChallenge('register', body.challengeId);
    if (!challenge) return reply.code(400).send({ error: 'Vorgang abgelaufen, bitte erneut versuchen' });
    // Die Challenge gehört entweder zum angemeldeten Konto oder zur Ersteinrichtung.
    if (account ? challenge.userId !== account.id : !challenge.pending) return reply.code(403).send({ error: 'Bitte zuerst anmelden' });
    if (!account) {
      const denied = await setupDenied(body.setupToken);
      if (denied) return reply.code(403).send({ error: denied });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        // Passkey allein reicht nicht – Fingerabdruck, Gesicht oder Geräte-PIN sind Pflicht.
        requireUserVerification: true,
      });
    } catch (err) {
      request.log.warn({ err }, 'Passkey-Registrierung abgelehnt');
      return reply.code(400).send({ error: 'Passkey konnte nicht geprüft werden' });
    }
    if (!verification.verified) return reply.code(400).send({ error: 'Passkey konnte nicht geprüft werden' });

    const { credential } = verification.registrationInfo;
    const label = body.label || `Passkey vom ${new Date().toLocaleDateString('de-DE')}`;
    let userId: number;
    try {
      userId = await transaction(db, async (conn) => {
        const id =
          account?.id ??
          (await createAccount(conn, {
            username: challenge.pending!.username,
            passwordHash: null,
            isAdmin: true,
            handle: challenge.pending!.handle,
          }));
        await exec(conn, 'INSERT INTO credentials (id, user_id, public_key, counter, transports, label) VALUES (?, ?, ?, ?, ?, ?)', [
          credential.id,
          id,
          Buffer.from(credential.publicKey),
          credential.counter,
          credential.transports?.join(',') ?? null,
          label,
        ]);
        return id;
      });
    } catch (err) {
      if (isDuplicateKey(err)) return reply.code(409).send({ error: 'Dieser Passkey ist bereits registriert' });
      throw err;
    }
    if (!account) await startSession(reply, userId);
    return { ok: true };
  });

  app.post('/api/auth/login/options', AUTH_LIMIT, async () => {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    return { options, challengeId: rememberChallenge({ kind: 'login', challenge: options.challenge }) };
  });

  app.post('/api/auth/login/verify', AUTH_LIMIT, async (request, reply) => {
    const body = z
      .object({
        challengeId: z.string(),
        response: z.custom<AuthenticationResponseJSON>((v) => typeof v === 'object' && v !== null),
      })
      .parse(request.body);
    const challenge = takeChallenge('login', body.challengeId);
    if (!challenge) return reply.code(400).send({ error: 'Vorgang abgelaufen, bitte erneut versuchen' });

    const row = await one<CredentialRow>(db, 'SELECT * FROM credentials WHERE id = ?', [body.response.id]);
    if (!row) return reply.code(401).send({ error: 'Dieser Passkey ist hier nicht registriert' });

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        // Passkey allein reicht nicht – Fingerabdruck, Gesicht oder Geräte-PIN sind Pflicht.
        requireUserVerification: true,
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
    await startSession(reply, row.user_id);
    return { ok: true };
  });

  app.post('/api/auth/password/login', AUTH_LIMIT, async (request, reply) => {
    const body = z.object({ username: z.string().trim().max(100), password: z.string().max(200) }).parse(request.body);
    // Groß-/Kleinschreibung egal: die Sortierung der Spalte vergleicht ohne Unterschied.
    const row = await one<{ id: number; password_hash: string | null }>(db, 'SELECT id, password_hash FROM users WHERE username = ?', [
      body.username,
    ]);
    // Auch ohne passendes Konto einen Hash prüfen, damit die Antwortzeit nichts verrät.
    const ok = await verifyPassword(body.password, row?.password_hash ?? (await getDummyHash()));
    if (!row?.password_hash || !ok) return reply.code(401).send({ error: 'Benutzername oder Passwort ist falsch' });
    await startSession(reply, row.id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await exec(db, 'DELETE FROM host_sessions WHERE token_hash = ?', [sha256(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ───────────── Eigenes Konto ─────────────

  app.patch('/api/account', host, async (request, reply) => {
    const account = accountOf(request);
    const body = z.object({ username: usernameInput }).parse(request.body);
    try {
      await exec(db, 'UPDATE users SET username = ? WHERE id = ?', [body.username, account.id]);
    } catch (err) {
      if (isDuplicateKey(err)) return reply.code(409).send({ error: DUPLICATE_USERNAME });
      throw err;
    }
    return { ok: true };
  });

  app.put('/api/account/password', host, async (request) => {
    const account = accountOf(request);
    const body = z.object({ password: passwordInput }).parse(request.body);
    await exec(db, 'UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(body.password), account.id]);
    // Wie beim Entfernen eines Passkeys: alle anderen Sitzungen beenden.
    await endOtherSessions(db, account.id, request);
    return { ok: true };
  });

  app.delete('/api/account/password', host, async (request, reply) => {
    const account = accountOf(request);
    if ((await countPasskeys(account.id)) === 0) {
      return reply.code(400).send({ error: 'Ohne Passkey kann das Passwort nicht entfernt werden' });
    }
    await exec(db, 'UPDATE users SET password_hash = NULL WHERE id = ?', [account.id]);
    return { ok: true };
  });

  app.get('/api/auth/passkeys', host, async (request) => {
    const rows = await query<CredentialRow>(
      db,
      'SELECT id, label, created_at, last_used_at FROM credentials WHERE user_id = ? ORDER BY created_at',
      [accountOf(request).id],
    );
    return rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
  });

  app.delete('/api/auth/passkeys/:id', host, async (request, reply) => {
    const account = accountOf(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    if ((await countPasskeys(account.id)) <= 1 && !account.hasPassword) {
      return reply.code(400).send({ error: 'Der letzte Passkey kann ohne Passwort nicht gelöscht werden' });
    }
    const result = await exec(db, 'DELETE FROM credentials WHERE id = ? AND user_id = ?', [id, account.id]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'Passkey nicht gefunden' });
    // Ein entfernter Passkey gehört oft zu einem verlorenen Gerät: alle anderen Sitzungen beenden.
    await endOtherSessions(db, account.id, request);
    return { ok: true };
  });
}
