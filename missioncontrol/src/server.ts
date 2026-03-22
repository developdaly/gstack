/**
 * gstack missioncontrol server — persistent Kanban board daemon
 *
 * Architecture:
 *   Bun.serve HTTP on 0.0.0.0 → serves board UI and REST API
 *   Auth: HMAC-signed HttpOnly cookie (browser) + Bearer token (CLI)
 *   No idle timeout — board stays alive for phone access
 *
 * State:
 *   Server state: <project-root>/.gstack/missioncontrol-server.json
 *   Board state:  <project-root>/.gstack/missioncontrol.json
 *   Log files:    <project-root>/.gstack/missioncontrol-logs/
 *   Port:         random 10000-60000 (or MC_PORT env for debug override)
 */

import { resolveConfig, ensureStateDir, readVersionHash, type MCConfig } from './config';
import { loadState, saveState, createCard, moveCard, updateCard, deleteCard, getCard, getPendingCards, COLUMNS } from './state';
import { generateBoardHTML } from './ui';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Config ─────────────────────────────────────────────────────
const config = resolveConfig();
ensureStateDir(config);

// ─── Base Path (for reverse proxy deployments) ──────────────────
const MC_BASE_PATH = (process.env.MC_BASE_PATH || '').replace(/\/+$/, '');

// ─── Auth ───────────────────────────────────────────────────────
const MC_PASSWORD = process.env.MISSION_CONTROL_PASSWORD || '';
const COOKIE_SECRET = crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'mc_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

const AUTH_TOKEN = crypto.randomUUID(); // For CLI → server communication

function signToken(payload: string): string {
  const hmac = crypto.createHmac('sha256', COOKIE_SECRET);
  hmac.update(payload);
  return `${payload}.${hmac.digest('hex')}`;
}

function verifyToken(token: string): boolean {
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;
  const payload = token.substring(0, lastDot);
  return signToken(payload) === token;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get('cookie') || '';
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=');
  }
  return cookies;
}

function isAuthenticated(req: Request): boolean {
  if (!MC_PASSWORD) return true; // No password = no auth required
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  return token ? verifyToken(token) : false;
}

function isCliAuthenticated(req: Request): boolean {
  const header = req.headers.get('authorization');
  return header === `Bearer ${AUTH_TOKEN}`;
}

function setAuthCookie(): string {
  const token = signToken(Date.now().toString());
  const secure = (process.env.NODE_ENV === 'production' || MC_BASE_PATH) ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}${secure}`;
}

// ─── Card type (mirrored from state for webhook) ─────────────────
interface Card {
  id: string;
  title: string;
  description?: string;
  column: string;
  tags?: string[];
  logFile?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Webhook ────────────────────────────────────────────────────
async function fireWebhook(config: MCConfig, card: Card, skill: string): Promise<void> {
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log(`[missioncontrol] No OPENCLAW_WEBHOOK_URL set, skipping webhook for ${skill}`);
    return;
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'card_moved',
      skill,
      card: {
        id: card.id,
        title: card.title,
        description: card.description,
        column: card.column,
        tags: card.tags,
      },
      logFile: card.logFile,
    }),
  });
}

// ─── SSE Log Stream ─────────────────────────────────────────────
function createLogStream(logFilePath: string): Response {
  let offset = 0;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Send existing content first
      try {
        const existing = fs.readFileSync(logFilePath, 'utf-8');
        if (existing) {
          controller.enqueue(`data: ${JSON.stringify(existing)}\n\n`);
          offset = existing.length;
        }
      } catch {}

      // Poll for new content every 500ms
      const interval = setInterval(() => {
        if (closed) { clearInterval(interval); return; }
        try {
          const content = fs.readFileSync(logFilePath, 'utf-8');
          if (content.length > offset) {
            const newContent = content.substring(offset);
            controller.enqueue(`data: ${JSON.stringify(newContent)}\n\n`);
            offset = content.length;
          }
        } catch {}
      }, 500);

      // Clean up after 5 minutes
      setTimeout(() => {
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch {}
      }, 300_000);
    },
    cancel() {
      closed = true;
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
}

// ─── API Handler ────────────────────────────────────────────────
async function handleApiRoute(url: URL, req: Request, config: MCConfig): Promise<Response> {
  // GET /api/state — return columns + cards
  if (url.pathname === '/api/state' && req.method === 'GET') {
    const state = loadState(config);
    return Response.json({ columns: COLUMNS, cards: state.cards });
  }

  // POST /api/cards — create card
  if (url.pathname === '/api/cards' && req.method === 'POST') {
    const body = await req.json();
    const card = createCard(config, body.title, body.description, body.tags);
    return Response.json(card, { status: 201 });
  }

  // POST /api/cards/:id/move — move card to column
  const moveMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/move$/);
  if (moveMatch && req.method === 'POST') {
    const cardId = moveMatch[1];
    const body = await req.json();
    try {
      const result = moveCard(config, cardId, body.column);
      // If skill is triggered, fire webhook
      if (result.skill) {
        fireWebhook(config, result.card, result.skill).catch(err => {
          console.error(`[missioncontrol] Webhook failed: ${err.message}`);
        });
      }
      return Response.json(result);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404 });
    }
  }

  // PATCH /api/cards/:id — update card
  const patchMatch = url.pathname.match(/^\/api\/cards\/([^/]+)$/);
  if (patchMatch && req.method === 'PATCH') {
    const cardId = patchMatch[1];
    const body = await req.json();
    try {
      const card = updateCard(config, cardId, body);
      return Response.json(card);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404 });
    }
  }

  // DELETE /api/cards/:id
  const deleteMatch = url.pathname.match(/^\/api\/cards\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const cardId = deleteMatch[1];
    try {
      deleteCard(config, cardId);
      return Response.json({ ok: true });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404 });
    }
  }

  // GET /api/cards/:id/log — full log contents
  const logMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/log$/);
  if (logMatch && req.method === 'GET') {
    const cardId = logMatch[1];
    const card = getCard(config, cardId);
    if (!card) return Response.json({ error: 'Card not found' }, { status: 404 });
    if (!card.logFile) return new Response('', { headers: { 'Content-Type': 'text/plain' } });
    try {
      const log = fs.readFileSync(card.logFile, 'utf-8');
      return new Response(log, { headers: { 'Content-Type': 'text/plain' } });
    } catch {
      return new Response('', { headers: { 'Content-Type': 'text/plain' } });
    }
  }

  // GET /api/cards/:id/log/stream — SSE log stream
  const streamMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/log\/stream$/);
  if (streamMatch && req.method === 'GET') {
    const cardId = streamMatch[1];
    const card = getCard(config, cardId);
    if (!card || !card.logFile) {
      return new Response('data: \n\n', {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });
    }
    return createLogStream(card.logFile);
  }

  return new Response('Not found', { status: 404 });
}

// ─── Port Finding ───────────────────────────────────────────────
async function findPort(): Promise<number> {
  const MC_PORT = parseInt(process.env.MC_PORT || '0', 10);
  if (MC_PORT) {
    try {
      const testServer = Bun.serve({ port: MC_PORT, fetch: () => new Response('ok') });
      testServer.stop();
      return MC_PORT;
    } catch {
      throw new Error(`Port ${MC_PORT} is in use`);
    }
  }

  const MIN_PORT = 10000;
  const MAX_PORT = 60000;
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const port = MIN_PORT + Math.floor(Math.random() * (MAX_PORT - MIN_PORT));
    try {
      const testServer = Bun.serve({ port, fetch: () => new Response('ok') });
      testServer.stop();
      return port;
    } catch { continue; }
  }
  throw new Error(`No available port after ${MAX_RETRIES} attempts in range ${MIN_PORT}-${MAX_PORT}`);
}

// ─── Shutdown ───────────────────────────────────────────────────
let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[missioncontrol] Shutting down...');
  try { fs.unlinkSync(config.serverStateFile); } catch {}
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Start ──────────────────────────────────────────────────────
async function start() {
  const port = await findPort();
  const startTime = Date.now();

  const server = Bun.serve({
    port,
    hostname: '0.0.0.0', // Allow non-localhost access (for Northflank)
    fetch: async (req) => {
      const url = new URL(req.url);

      // Health check — no auth
      if (url.pathname === '/health') {
        return Response.json({
          status: 'healthy',
          uptime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      // Login — no auth required
      if (url.pathname === '/auth/login' && req.method === 'POST') {
        const body = await req.json();
        if (!MC_PASSWORD || body.password === MC_PASSWORD) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': setAuthCookie(),
            }
          });
        }
        return Response.json({ error: 'Invalid password' }, { status: 401 });
      }

      // Auth check — no auth required
      if (url.pathname === '/auth/check') {
        return Response.json({ authenticated: isAuthenticated(req) });
      }

      // Board HTML — always served (JS handles login state)
      if (url.pathname === '/' && req.method === 'GET') {
        return new Response(generateBoardHTML(MC_BASE_PATH), {
          headers: { 'Content-Type': 'text/html' }
        });
      }

      // All /api/* routes require auth (cookie or bearer)
      if (url.pathname.startsWith('/api/')) {
        if (!isAuthenticated(req) && !isCliAuthenticated(req)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return handleApiRoute(url, req, config);
      }

      return new Response('Not found', { status: 404 });
    }
  });

  // Write server state file (atomic: write .tmp then rename)
  const state = {
    pid: process.pid,
    port,
    token: AUTH_TOKEN,
    startedAt: new Date().toISOString(),
    serverPath: path.resolve(import.meta.dir, 'server.ts'),
    binaryVersion: readVersionHash() || undefined,
  };
  const tmpFile = config.serverStateFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, config.serverStateFile);

  console.log(`[missioncontrol] Server running on http://0.0.0.0:${port} (PID: ${process.pid})`);
  console.log(`[missioncontrol] State file: ${config.serverStateFile}`);
  console.log(`[missioncontrol] Board file: ${config.boardStateFile}`);
  if (MC_PASSWORD) {
    console.log(`[missioncontrol] Password auth enabled`);
  } else {
    console.log(`[missioncontrol] No password set — open access`);
  }
}

start().catch(err => {
  console.error(`[missioncontrol] Failed to start: ${err.message}`);
  process.exit(1);
});
