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
import {
  loadState,
  createCard,
  moveCard,
  updateCard,
  deleteCard,
  getCard,
  addActivity,
  COLUMNS,
  type Card,
} from './state';
import { generateBoardHTML } from './ui';
import { mergeSessionEntry, resolveSessionTranscriptPath, resolveStorePath, updateSessionStore } from '/openclaw/packages/moltbot/node_modules/openclaw/src/config/sessions.ts';
import { normalizeAgentId } from '/openclaw/packages/moltbot/node_modules/openclaw/src/routing/session-key.ts';
import { loadGatewayModelCatalog, type GatewayModelChoice } from '/openclaw/packages/moltbot/node_modules/openclaw/src/gateway/server-model-catalog.ts';
import { loadConfig } from '/openclaw/packages/moltbot/node_modules/openclaw/src/config/config.js';
import { applyModelOverrideToSessionEntry } from '/openclaw/packages/moltbot/node_modules/openclaw/src/sessions/model-overrides.ts';
import { resolveAllowedModelRef, resolveDefaultModelForAgent } from '/openclaw/packages/moltbot/node_modules/openclaw/src/agents/model-selection.ts';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Config ─────────────────────────────────────────────────────
const config = resolveConfig();
ensureStateDir(config);

// ─── Base Path (for reverse proxy deployments) ──────────────────
const MC_BASE_PATH = (process.env.MC_BASE_PATH || '').replace(/\/+$/, '');

// ─── OpenClaw Durable Sessions ─────────────────────────────────
const OPENCLAW_AGENT_ID = normalizeAgentId(process.env.MC_OPENCLAW_AGENT_ID || 'main');
const OPENCLAW_SESSION_STORE = resolveStorePath(undefined, { agentId: OPENCLAW_AGENT_ID });
const AGENT_TIMEOUT_SECONDS = String(parseInt(process.env.MC_AGENT_TIMEOUT_SECONDS || '1800', 10) || 1800);

type ActiveRun = {
  runId: string;
  proc: Bun.Subprocess;
};

const ACTIVE_RUNS = new Map<string, ActiveRun>();

type ModelOption = {
  ref: string;
  label: string;
  provider: string;
  providerLabel: string;
  model: string;
  name: string;
};

type CardModelView = {
  modelState: 'default' | 'selected' | 'unavailable';
  modelLabel: string | null;
  modelBadgeLabel: string | null;
};

let modelOptionsCache:
  | {
      expiresAt: number;
      options: ModelOption[];
      byRef: Map<string, ModelOption>;
      defaultRef: string;
    }
  | null = null;

function formatProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'github-copilot') return 'GitHub Copilot';
  if (normalized === 'openai-codex') return 'OpenAI Codex';
  if (normalized === 'anthropic') return 'Anthropic';
  if (normalized === 'google') return 'Google';
  if (normalized === 'openai') return 'OpenAI';
  return provider
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function getModelOptions(): Promise<{
  options: ModelOption[];
  byRef: Map<string, ModelOption>;
  defaultRef: string;
}> {
  const now = Date.now();
  if (modelOptionsCache && modelOptionsCache.expiresAt > now) {
    return modelOptionsCache;
  }

  const cfg = loadConfig();
  const defaultModel = resolveDefaultModelForAgent({ cfg, agentId: OPENCLAW_AGENT_ID });
  const defaultRef = `${defaultModel.provider}/${defaultModel.model}`;
  const catalog = await loadGatewayModelCatalog();
  const available: GatewayModelChoice[] = [];
  for (const entry of catalog) {
    const resolved = resolveAllowedModelRef({
      cfg,
      catalog,
      raw: `${entry.provider}/${entry.id}`,
      defaultProvider: defaultModel.provider,
      defaultModel: defaultModel.model,
    });
    if (!('ref' in resolved)) continue;
    available.push(entry);
  }

  const nameCounts = new Map<string, number>();
  for (const entry of available) {
    const name = (entry.name || entry.id).trim();
    const key = name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }

  const options = available.map((entry) => {
    const name = (entry.name || entry.id).trim();
    const providerLabel = formatProviderLabel(entry.provider);
    const useProviderSuffix = (nameCounts.get(name.toLowerCase()) || 0) > 1 || entry.provider === 'github-copilot';
    const label = useProviderSuffix ? `${name} · ${providerLabel}` : name;
    return {
      ref: `${entry.provider}/${entry.id}`,
      label,
      provider: entry.provider,
      providerLabel,
      model: entry.id,
      name,
    } satisfies ModelOption;
  });

  const byRef = new Map(options.map((option) => [option.ref.toLowerCase(), option]));
  modelOptionsCache = {
    expiresAt: now + 30_000,
    options,
    byRef,
    defaultRef,
  };
  return modelOptionsCache;
}

function decorateCardWithModelView(card: Card, modelIndex?: Map<string, ModelOption>): Card & CardModelView {
  const rawRef = card.modelRef?.trim();
  if (!rawRef) {
    return {
      ...card,
      modelState: 'default',
      modelLabel: null,
      modelBadgeLabel: null,
    };
  }

  if (!modelIndex) {
    return {
      ...card,
      modelState: 'selected',
      modelLabel: rawRef,
      modelBadgeLabel: `Model: ${rawRef}`,
    };
  }

  const option = modelIndex.get(rawRef.toLowerCase()) || null;
  if (!option) {
    return {
      ...card,
      modelState: 'unavailable',
      modelLabel: null,
      modelBadgeLabel: 'Model unavailable',
    };
  }

  return {
    ...card,
    modelState: 'selected',
    modelLabel: option.label,
    modelBadgeLabel: `Model: ${option.label}`,
  };
}

async function applyCardModelToSession(card: Card): Promise<void> {
  if (!card.sessionKey || !card.sessionId) return;

  const cfg = loadConfig();
  const configured = resolveDefaultModelForAgent({ cfg, agentId: OPENCLAW_AGENT_ID });
  const modelOptions = await getModelOptions();

  await updateSessionStore(OPENCLAW_SESSION_STORE, (store) => {
    const existing = store[card.sessionKey] || mergeSessionEntry(undefined, {
      sessionId: card.sessionId || crypto.randomUUID(),
      updatedAt: Date.now(),
      sessionFile: card.sessionFile || resolveSessionTranscriptPath(card.sessionId || crypto.randomUUID(), OPENCLAW_AGENT_ID),
      label: `missioncontrol:${card.id}`,
      displayName: `Mission Control — ${card.title}`,
      subject: card.title,
      origin: {
        label: 'Mission Control',
        provider: 'missioncontrol',
        surface: 'kanban',
      },
      lastChannel: 'webchat',
    });
    const entry = mergeSessionEntry(existing, {
      sessionId: card.sessionId,
      updatedAt: Date.now(),
      sessionFile: card.sessionFile || resolveSessionTranscriptPath(card.sessionId, OPENCLAW_AGENT_ID),
      label: `missioncontrol:${card.id}`,
      displayName: `Mission Control — ${card.title}`,
      subject: card.title,
    });

    if (!card.modelRef) {
      applyModelOverrideToSessionEntry({
        entry,
        selection: {
          provider: configured.provider,
          model: configured.model,
          isDefault: true,
        },
      });
    } else {
      const option = modelOptions.byRef.get(card.modelRef.toLowerCase());
      if (!option) {
        throw new Error(`Saved model is not available: ${card.modelRef}`);
      }
      applyModelOverrideToSessionEntry({
        entry,
        selection: {
          provider: option.provider,
          model: option.model,
          isDefault: option.ref === modelOptions.defaultRef,
        },
      });
    }

    store[card.sessionKey] = entry;
    return entry;
  });
}

function getColumnName(columnId: string): string {
  return COLUMNS.find((column) => column.id === columnId)?.name || columnId;
}

function shortId(value: string | null | undefined): string {
  if (!value) return 'unknown';
  return value.length > 8 ? value.slice(0, 8) : value;
}

function buildCardSessionKey(card: Card): string {
  return `agent:${OPENCLAW_AGENT_ID}:missioncontrol:card:${card.id.toLowerCase()}`;
}

function appendLog(logFile: string, text: string): void {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, text, { encoding: 'utf-8', mode: 0o600 });
}

async function pipeStreamToLog(
  stream: ReadableStream<Uint8Array> | null | undefined,
  logFile: string,
  prefix = '',
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      appendLog(logFile, `${prefix}${decoder.decode(value, { stream: true })}`);
    }
    const tail = decoder.decode();
    if (tail) appendLog(logFile, `${prefix}${tail}`);
  } catch (err: any) {
    appendLog(logFile, `\n[missioncontrol] log stream error: ${err.message}\n`);
  }
}

function buildStagePrompt(params: {
  card: Card;
  skill: string;
  columnName: string;
  firstTurn: boolean;
}): string {
  const { card, skill, columnName, firstTurn } = params;
  const lines = [
    `Mission Control durable card session update.`,
    firstTurn
      ? `This is the first OpenClaw turn for this Mission Control card. Treat this session as the durable work thread for the card going forward.`
      : `Resume the existing Mission Control work thread for this card. Continue from prior work in this same session instead of starting over.`,
    `Card title: ${card.title}`,
    `Card ID: ${card.id}`,
    `Current stage: ${columnName}`,
    `Requested skill/stage mode: ${skill}`,
  ];

  if (card.description?.trim()) {
    lines.push(`Card description:\n${card.description.trim()}`);
  }

  if ((card.tags || []).length > 0) {
    lines.push(`Tags: ${(card.tags || []).join(', ')}`);
  }

  lines.push(
    `Task: advance this card in the ${columnName} stage and leave the thread in a resumable state for the next stage move.`,
  );

  return lines.join('\n\n');
}

async function ensureCardSession(config: MCConfig, card: Card): Promise<Card> {
  const sessionId = card.sessionId || crypto.randomUUID();
  const sessionKey = card.sessionKey || buildCardSessionKey(card);
  const sessionFile = card.sessionFile || resolveSessionTranscriptPath(sessionId, OPENCLAW_AGENT_ID);

  await updateSessionStore(OPENCLAW_SESSION_STORE, (store) => {
    store[sessionKey] = mergeSessionEntry(store[sessionKey], {
      sessionId,
      updatedAt: Date.now(),
      sessionFile,
      label: `missioncontrol:${card.id}`,
      displayName: `Mission Control — ${card.title}`,
      subject: card.title,
      origin: {
        label: 'Mission Control',
        provider: 'missioncontrol',
        surface: 'kanban',
      },
      lastChannel: 'webchat',
    });
    return store[sessionKey];
  });

  const linkedCard = updateCard(config, card.id, {
    sessionId,
    sessionKey,
    sessionFile,
  });

  if (!card.sessionId || !card.sessionKey) {
    addActivity(
      config,
      card.id,
      'comment',
      `Linked durable OpenClaw session ${shortId(sessionId)} (${sessionKey})`,
    );
  }

  return linkedCard;
}

function cancelActiveRun(cardId: string, reason?: string): void {
  const active = ACTIVE_RUNS.get(cardId);
  if (!active) return;
  ACTIVE_RUNS.delete(cardId);
  try {
    active.proc.kill();
  } catch {}
  const card = getCard(config, cardId);
  if (card?.logFile) {
    appendLog(card.logFile, `\n[missioncontrol] Cancelled active run${reason ? `: ${reason}` : ''}\n`);
  }
}

async function startCardSessionRun(params: {
  config: MCConfig;
  card: Card;
  skill: string;
}): Promise<void> {
  const { config, skill } = params;
  const firstTurn = !params.card.sessionId;
  let card = await ensureCardSession(config, params.card);
  await applyCardModelToSession(card);
  const columnName = getColumnName(card.column);
  const logFile =
    card.logFile || path.join(config.logsDir, `${card.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

  cancelActiveRun(card.id, `stage moved to ${columnName}`);

  card = updateCard(config, card.id, {
    status: 'running',
    skillTriggered: skill,
    logFile,
  });
  addActivity(
    config,
    card.id,
    'skill_start',
    `${firstTurn ? 'Started' : 'Resumed'} ${columnName} in durable OpenClaw session ${shortId(card.sessionId)}`,
    { column: card.column, skill },
  );

  appendLog(
    logFile,
    `\n=== Mission Control stage run ===\n` +
      `[started] ${new Date().toISOString()}\n` +
      `[card] ${card.title} (${card.id})\n` +
      `[stage] ${columnName}\n` +
      `[skill] ${skill}\n` +
      `[sessionId] ${card.sessionId}\n` +
      `[sessionKey] ${card.sessionKey}\n\n`,
  );

  const prompt = buildStagePrompt({
    card,
    skill,
    columnName,
    firstTurn,
  });

  const proc = Bun.spawn(
    ['openclaw', 'agent', '--session-id', String(card.sessionId), '--message', prompt, '--timeout', AGENT_TIMEOUT_SECONDS],
    {
      cwd: config.projectDir,
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  const runId = crypto.randomUUID();
  ACTIVE_RUNS.set(card.id, { runId, proc });

  void pipeStreamToLog(proc.stdout, logFile);
  void pipeStreamToLog(proc.stderr, logFile, '[stderr] ');

  void proc.exited
    .then((exitCode) => {
      const active = ACTIVE_RUNS.get(card.id);
      if (!active || active.runId !== runId) {
        return;
      }
      ACTIVE_RUNS.delete(card.id);

      const status = exitCode === 0 ? 'complete' : 'failed';
      const activityType = exitCode === 0 ? 'skill_complete' : 'skill_failed';
      const activityText =
        exitCode === 0
          ? `${columnName} completed in durable session ${shortId(card.sessionId)}`
          : `${columnName} failed in durable session ${shortId(card.sessionId)} (exit ${exitCode})`;

      appendLog(logFile, `\n[missioncontrol] Process exited with code ${exitCode}\n`);
      updateCard(config, card.id, { status });
      addActivity(config, card.id, activityType, activityText, {
        column: card.column,
        skill,
      });
    })
    .catch((err: any) => {
      const active = ACTIVE_RUNS.get(card.id);
      if (!active || active.runId !== runId) {
        return;
      }
      ACTIVE_RUNS.delete(card.id);
      appendLog(logFile, `\n[missioncontrol] Execution error: ${err.message}\n`);
      updateCard(config, card.id, { status: 'failed' });
      addActivity(config, card.id, 'skill_failed', `${columnName} failed: ${err.message}`, {
        column: card.column,
        skill,
      });
    });
}

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
  const secure = process.env.NODE_ENV === 'production' || MC_BASE_PATH ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}${secure}`;
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
        if (closed) {
          clearInterval(interval);
          return;
        }
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
        try {
          controller.close();
        } catch {}
      }, 300_000);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ─── API Handler ────────────────────────────────────────────────
async function handleApiRoute(url: URL, req: Request, config: MCConfig): Promise<Response> {
  // GET /api/state — return columns + cards
  if (url.pathname === '/api/state' && req.method === 'GET') {
    const state = loadState(config);
    let modelIndex: Map<string, ModelOption> | undefined;
    try {
      modelIndex = (await getModelOptions()).byRef;
    } catch {}
    return Response.json({
      columns: COLUMNS,
      cards: state.cards.map((card) => decorateCardWithModelView(card, modelIndex)),
    });
  }

  // GET /api/models — configured model options for the card modal
  if (url.pathname === '/api/models' && req.method === 'GET') {
    try {
      const modelOptions = await getModelOptions();
      return Response.json({
        defaultRef: modelOptions.defaultRef,
        options: modelOptions.options,
      });
    } catch (err: any) {
      return Response.json({ error: err.message || 'Failed to load model options' }, { status: 503 });
    }
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
      if (result.skill) {
        startCardSessionRun({
          config,
          card: result.card,
          skill: result.skill,
        }).catch((err: any) => {
          console.error(`[missioncontrol] Card session run failed: ${err.message}`);
          updateCard(config, cardId, { status: 'failed' });
          addActivity(config, cardId, 'skill_failed', `Failed to start durable session: ${err.message}`, {
            column: body.column,
            skill: result.skill || undefined,
          });
        });
      } else {
        cancelActiveRun(cardId, `card moved to ${getColumnName(body.column)}`);
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
      const existing = getCard(config, cardId);
      if (!existing) {
        return Response.json({ error: 'Card not found' }, { status: 404 });
      }

      const updates: Partial<Pick<Card, 'title' | 'description' | 'tags' | 'modelRef'>> = {};
      if ('title' in body) updates.title = typeof body.title === 'string' ? body.title : existing.title;
      if ('description' in body) {
        updates.description = typeof body.description === 'string' ? body.description : existing.description;
      }
      if ('tags' in body) {
        updates.tags = Array.isArray(body.tags) ? body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean) : existing.tags;
      }
      if ('modelRef' in body) {
        const rawModel = body.modelRef == null ? '' : String(body.modelRef).trim();
        if (!rawModel || rawModel.toLowerCase() === 'default') {
          updates.modelRef = null;
        } else {
          const cfg = loadConfig();
          const catalog = await loadGatewayModelCatalog();
          const configured = resolveDefaultModelForAgent({ cfg, agentId: OPENCLAW_AGENT_ID });
          const resolved = resolveAllowedModelRef({
            cfg,
            catalog,
            raw: rawModel,
            defaultProvider: configured.provider,
            defaultModel: configured.model,
          });
          if (!('ref' in resolved)) {
            return Response.json({ error: resolved.error }, { status: 400 });
          }
          const canonicalRef = `${resolved.ref.provider}/${resolved.ref.model}`;
          updates.modelRef = canonicalRef === `${configured.provider}/${configured.model}` ? null : canonicalRef;
        }
      }

      const card = updateCard(config, cardId, updates);
      if ('modelRef' in updates) {
        await applyCardModelToSession(card);
      }

      let modelIndex: Map<string, ModelOption> | undefined;
      try {
        modelIndex = (await getModelOptions()).byRef;
      } catch {}
      return Response.json(decorateCardWithModelView(card, modelIndex));
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  // DELETE /api/cards/:id
  const deleteMatch = url.pathname.match(/^\/api\/cards\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const cardId = deleteMatch[1];
    try {
      cancelActiveRun(cardId, 'card deleted');
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
          Connection: 'keep-alive',
        },
      });
    }
    return createLogStream(card.logFile);
  }

  // GET /api/cards/:id/activity — return activity trail
  const activityGetMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/activity$/);
  if (activityGetMatch && req.method === 'GET') {
    const cardId = activityGetMatch[1];
    const card = getCard(config, cardId);
    if (!card) return Response.json({ error: 'Card not found' }, { status: 404 });
    return Response.json(card.activity || []);
  }

  // POST /api/cards/:id/activity — add activity entry
  const activityPostMatch = url.pathname.match(/^\/api\/cards\/([^/]+)\/activity$/);
  if (activityPostMatch && req.method === 'POST') {
    const cardId = activityPostMatch[1];
    const body = await req.json();
    const type = body.type || 'comment';
    const text = body.text || '';
    if (!text) return Response.json({ error: 'text required' }, { status: 400 });
    try {
      const card = addActivity(config, cardId, type, text, {
        column: body.column,
        skill: body.skill,
      });
      return Response.json(card.activity);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 404 });
    }
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
    } catch {
      continue;
    }
  }
  throw new Error(`No available port after ${MAX_RETRIES} attempts in range ${MIN_PORT}-${MAX_PORT}`);
}

// ─── Shutdown ───────────────────────────────────────────────────
let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[missioncontrol] Shutting down...');
  for (const [cardId] of ACTIVE_RUNS) {
    cancelActiveRun(cardId, 'server shutdown');
  }
  try {
    fs.unlinkSync(config.serverStateFile);
  } catch {}
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
      try {
        const url = new URL(req.url);

        // Health check — no auth
        if (url.pathname === '/health') {
          return Response.json({
            status: 'healthy',
            uptime: Math.floor((Date.now() - startTime) / 1000),
          });
        }

        // Public server info — no auth, no secrets
        if (url.pathname === '/api/info') {
          const state = loadState(config);
          const version = readVersionHash() || process.env.NORTHFLANK_GIT_COMMIT_SHA || 'dev';
          return Response.json({
            version: version.substring(0, 7),
            uptime: Math.floor((Date.now() - startTime) / 1000),
            runtime: `Bun ${Bun.version}`,
            cards: state.cards.length,
            executionMode: 'durable-openclaw-session',
            authRequired: !!MC_PASSWORD,
          });
        }

        // Login — no auth required
        if (url.pathname === '/auth/login' && req.method === 'POST') {
          let body: any;
          try {
            body = await req.json();
          } catch {
            return Response.json({ error: 'Invalid request body' }, { status: 400 });
          }
          if (!MC_PASSWORD || body.password === MC_PASSWORD) {
            return new Response(JSON.stringify({ ok: true }), {
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': setAuthCookie(),
              },
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
            headers: { 'Content-Type': 'text/html' },
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
      } catch (err: any) {
        console.error(`[missioncontrol] Unhandled error: ${err.message}`);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
      }
    },
  });

  void server;

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
  console.log(`[missioncontrol] OpenClaw session store: ${OPENCLAW_SESSION_STORE}`);
  if (MC_PASSWORD) {
    console.log(`[missioncontrol] Password auth enabled`);
  } else {
    console.log(`[missioncontrol] No password set — open access`);
  }
}

start().catch((err) => {
  console.error(`[missioncontrol] Failed to start: ${err.message}`);
  process.exit(1);
});
