import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError, z } from 'zod';
import { authRoutes, isHost } from './auth.ts';
import { brandRoutes } from './brands.ts';
import type { Config } from './config.ts';
import { one, type Db } from './db.ts';
import { LiveHub } from './live.ts';
import { participantByToken, participantRoutes } from './participants.ts';
import { presentationRoutes } from './presentations.ts';
import { runRoutes } from './runs.ts';

function contentSecurityPolicy(origin: string): string {
  // Ältere Safari-Versionen zählen wss: nicht zu 'self' – deshalb explizit.
  const ws = origin.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${ws}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export async function buildApp(config: Config, db: Db): Promise<{ app: FastifyInstance; live: LiveHub }> {
  const app = Fastify({
    logger: { level: config.NODE_ENV === 'test' ? 'warn' : 'info' },
    // Nur so vielen Proxys glauben, wie wirklich davor sitzen. `true` würde den
    // ersten – vom Client frei wählbaren – Eintrag aus X-Forwarded-For nehmen.
    trustProxy: (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
    bodyLimit: 64 * 1024,
  });
  const live = new LiveHub(db, app.log);
  const csp = contentSecurityPolicy(config.APP_ORIGIN);
  app.addHook('onClose', async () => live.close());

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 4 * 1024 } });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (!request.url.startsWith('/api/')) reply.header('Content-Security-Policy', csp);
    return payload;
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues[0]?.message ?? 'Ungültige Eingabe' });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) request.log.error({ err }, 'Unerwarteter Fehler');
    return reply.code(status).send({ error: status >= 500 ? 'Da ist etwas schiefgegangen' : (err as Error).message });
  });

  app.get('/api/health', async () => {
    await one(db, 'SELECT 1');
    return { status: 'ok', release: config.RELEASE };
  });

  authRoutes(app, db, config);
  presentationRoutes(app, db, live);
  brandRoutes(app, db, live);
  runRoutes(app, db, live);
  participantRoutes(app, db, live);

  /**
   * Live-Verbindung. Drei Rollen:
   *   participant  ?token=<Teilnehmer-Token>
   *   display      ?display=<Anzeige-Token>  (Beamer, nur lesen)
   *   host         ?run=<id>                 (Cookie-Anmeldung)
   */
  app.get('/ws', { websocket: true }, async (socket, request) => {
    const q = z
      .object({ token: z.string().optional(), display: z.string().optional(), run: z.coerce.number().int().optional() })
      .safeParse(request.query);
    const reject = (code: number, reason: string) => socket.close(code, reason);
    if (!q.success) return reject(4000, 'Ungültige Anfrage');

    if (q.data.token) {
      const p = await participantByToken(db, q.data.token);
      if (!p) return reject(4001, 'Unbekannt oder beendet');
      if (!live.attach(p.runId, { ws: socket, role: 'participant', participantId: p.id, alive: true }))
        reject(1013, 'Zu viele Verbindungen');
      return;
    }
    if (q.data.display) {
      const run = await one<{ id: number }>(db, 'SELECT id FROM runs WHERE display_token = ?', [q.data.display]);
      if (!run) return reject(4001, 'Anzeige-Link ungültig');
      if (!live.attach(run.id, { ws: socket, role: 'display', alive: true })) reject(1013, 'Zu viele Verbindungen');
      return;
    }
    if (q.data.run) {
      // Cookie-Anmeldung über WebSocket nur von der eigenen Seite (Schutz vor Cross-Site-WebSocket-Hijacking).
      if (request.headers.origin !== config.APP_ORIGIN) return reject(4003, 'Herkunft nicht erlaubt');
      if (!(await isHost(db, request))) return reject(4001, 'Nicht angemeldet');
      const run = await one<{ id: number }>(db, 'SELECT id FROM runs WHERE id = ?', [q.data.run]);
      if (!run) return reject(4004, 'Nicht gefunden');
      if (!live.attach(run.id, { ws: socket, role: 'host', alive: true })) reject(1013, 'Zu viele Verbindungen');
      return;
    }
    reject(4000, 'Ungültige Anfrage');
  });

  const staticDir = config.STATIC_DIR;
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      setHeaders(res, path) {
        // Gebaute Dateien tragen einen Hash im Namen und ändern sich nie.
        const value = path.includes(join(staticDir, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache';
        res.header('Cache-Control', value);
      },
    });
    // Single-Page-App: alle unbekannten Pfade außerhalb von /api liefern index.html.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/') || request.url === '/ws') {
        return reply.code(404).send({ error: 'Nicht gefunden' });
      }
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }

  return { app, live };
}
