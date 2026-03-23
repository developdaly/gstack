import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { MCConfig } from './config';

// Fixed pipeline columns from AGENTS.md
export const COLUMNS = [
  { id: "backlog", name: "Backlog", skill: null },
  { id: "office-hours", name: "Office Hours", skill: "/office-hours" },
  { id: "ceo-review", name: "CEO Review", skill: "/plan-ceo-review" },
  { id: "eng-review", name: "Eng Review", skill: "/plan-eng-review" },
  { id: "design-review", name: "Design Review", skill: "/plan-design-review" },
  { id: "design", name: "Design", skill: "/design-consultation" },
  { id: "implementation", name: "Implementation", skill: null },
  { id: "code-review", name: "Code Review", skill: "/review" },
  { id: "debug", name: "Debug", skill: "/debug" },
  { id: "qa", name: "QA", skill: "/qa" },
  { id: "ship", name: "Ship", skill: "/ship" },
  { id: "docs", name: "Docs", skill: "/document-release" },
  { id: "retro", name: "Retro", skill: "/retro" },
  { id: "done", name: "Done", skill: null },
] as const;

export type ColumnId = typeof COLUMNS[number]["id"];
export type CardStatus = "idle" | "pending" | "running" | "complete" | "failed";

export type ActivityType = "created" | "moved" | "skill_start" | "skill_complete" | "skill_failed" | "comment";

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  timestamp: string;
  text: string;
  column?: string;
  skill?: string;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  column: ColumnId;
  createdAt: string;
  movedAt: string;
  skillTriggered: string | null;
  status: CardStatus;
  logFile: string | null;
  designDocs: string[];
  tags: string[];
  modelRef: string | null;
  activity: ActivityEntry[];
  sessionId: string | null;
  sessionKey: string | null;
  sessionFile: string | null;
}

export interface BoardState {
  version: 1;
  cards: Card[];
}

const DEFAULT_STATE: BoardState = {
  version: 1,
  cards: [],
};

function normalizeActivityEntry(raw: any): ActivityEntry {
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    type: raw?.type || 'comment',
    timestamp: typeof raw?.timestamp === 'string' && raw.timestamp ? raw.timestamp : new Date().toISOString(),
    text: typeof raw?.text === 'string' ? raw.text : '',
    ...(raw?.column ? { column: String(raw.column) } : {}),
    ...(raw?.skill ? { skill: String(raw.skill) } : {}),
  } as ActivityEntry;
}

function normalizeCard(raw: any): Card {
  const now = new Date().toISOString();
  const column = COLUMNS.some((col) => col.id === raw?.column) ? raw.column : 'backlog';
  const status: CardStatus =
    raw?.status === 'pending' ||
    raw?.status === 'running' ||
    raw?.status === 'complete' ||
    raw?.status === 'failed'
      ? raw.status
      : 'idle';

  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    title: typeof raw?.title === 'string' ? raw.title : 'Untitled',
    description: typeof raw?.description === 'string' ? raw.description : '',
    column,
    createdAt: typeof raw?.createdAt === 'string' && raw.createdAt ? raw.createdAt : now,
    movedAt: typeof raw?.movedAt === 'string' && raw.movedAt ? raw.movedAt : now,
    skillTriggered:
      typeof raw?.skillTriggered === 'string' && raw.skillTriggered ? raw.skillTriggered : null,
    status,
    logFile: typeof raw?.logFile === 'string' && raw.logFile ? raw.logFile : null,
    designDocs: Array.isArray(raw?.designDocs) ? raw.designDocs.map(String) : [],
    tags: Array.isArray(raw?.tags) ? raw.tags.map(String) : [],
    modelRef: typeof raw?.modelRef === 'string' && raw.modelRef.trim() ? raw.modelRef.trim() : null,
    activity: Array.isArray(raw?.activity) ? raw.activity.map(normalizeActivityEntry) : [],
    sessionId: typeof raw?.sessionId === 'string' && raw.sessionId ? raw.sessionId : null,
    sessionKey: typeof raw?.sessionKey === 'string' && raw.sessionKey ? raw.sessionKey : null,
    sessionFile: typeof raw?.sessionFile === 'string' && raw.sessionFile ? raw.sessionFile : null,
  };
}

/**
 * Read the board state from disk. Returns a default empty state if the file
 * is missing or unreadable.
 */
export function loadState(config: MCConfig): BoardState {
  try {
    const raw = fs.readFileSync(config.boardStateFile, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BoardState>;
    return {
      version: 1,
      cards: Array.isArray(parsed?.cards) ? parsed.cards.map(normalizeCard) : [],
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { ...DEFAULT_STATE, cards: [] };
    }
    throw err;
  }
}

/**
 * Write the board state to disk atomically (tmp file + rename) with mode 0o600.
 */
export function saveState(config: MCConfig, state: BoardState): void {
  const tmpFile = `${config.boardStateFile}.tmp`;
  const json = JSON.stringify(state, null, 2);
  fs.writeFileSync(tmpFile, json, { mode: 0o600 });
  fs.renameSync(tmpFile, config.boardStateFile);
}

/**
 * Append an activity entry to a card (in-memory). Caller must saveState().
 */
function pushActivity(
  card: Card,
  type: ActivityType,
  text: string,
  extra?: { column?: string; skill?: string },
): void {
  if (!card.activity) card.activity = [];
  card.activity.push({
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    text,
    ...extra,
  });
}

/**
 * Add an activity entry to a persisted card by ID.
 */
export function addActivity(
  config: MCConfig,
  cardId: string,
  type: ActivityType,
  text: string,
  extra?: { column?: string; skill?: string },
): Card {
  const state = loadState(config);
  const idx = state.cards.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new Error(`Card not found: ${cardId}`);
  const card = state.cards[idx];
  pushActivity(card, type, text, extra);
  saveState(config, state);
  return card;
}

/**
 * Create a new card in the backlog and persist it.
 */
export function createCard(
  config: MCConfig,
  title: string,
  description: string = '',
  tags: string[] = [],
): Card {
  const now = new Date().toISOString();
  const card: Card = {
    id: crypto.randomUUID(),
    title,
    description,
    column: 'backlog',
    createdAt: now,
    movedAt: now,
    skillTriggered: null,
    status: 'idle',
    logFile: null,
    designDocs: [],
    tags,
    modelRef: null,
    activity: [],
    sessionId: null,
    sessionKey: null,
    sessionFile: null,
  };

  pushActivity(card, 'created', 'Card created');

  const state = loadState(config);
  state.cards.push(card);
  saveState(config, state);

  return card;
}

/**
 * Move a card to a target column. If the column has an associated skill,
 * sets status to "pending", records the skill, and creates a log file path.
 * Returns the updated card and the skill name (or null).
 */
export function moveCard(
  config: MCConfig,
  cardId: string,
  targetColumn: ColumnId,
): { card: Card; skill: string | null } {
  const state = loadState(config);
  const idx = state.cards.findIndex((c) => c.id === cardId);
  if (idx === -1) {
    throw new Error(`Card not found: ${cardId}`);
  }

  const columnDef = COLUMNS.find((col) => col.id === targetColumn);
  if (!columnDef) {
    throw new Error(`Unknown column: ${targetColumn}`);
  }

  const skill = columnDef.skill ?? null;
  const now = new Date().toISOString();
  const card = state.cards[idx];

  const fromColumn = card.column;
  card.column = targetColumn;
  card.movedAt = now;

  const colName = columnDef.name;
  pushActivity(card, 'moved', `Moved from ${fromColumn} to ${colName}`, { column: targetColumn });

  if (skill) {
    card.status = 'pending';
    card.skillTriggered = skill;
    const timestamp = now.replace(/[:.]/g, '-');
    card.logFile = path.join(config.logsDir, `${cardId}-${timestamp}.log`);
  } else {
    card.status = 'idle';
    card.skillTriggered = null;
  }

  saveState(config, state);

  return { card, skill };
}

/**
 * Update select fields on an existing card.
 */
export function updateCard(
  config: MCConfig,
  cardId: string,
  updates: Partial<Pick<Card, 'title' | 'description' | 'tags' | 'modelRef' | 'status' | 'logFile' | 'designDocs' | 'skillTriggered' | 'sessionId' | 'sessionKey' | 'sessionFile'>>,
): Card {
  const state = loadState(config);
  const idx = state.cards.findIndex((c) => c.id === cardId);
  if (idx === -1) {
    throw new Error(`Card not found: ${cardId}`);
  }

  const card = state.cards[idx];
  Object.assign(card, updates);
  saveState(config, state);

  return card;
}

/**
 * Delete a card by ID.
 */
export function deleteCard(config: MCConfig, cardId: string): void {
  const state = loadState(config);
  const idx = state.cards.findIndex((c) => c.id === cardId);
  if (idx === -1) {
    throw new Error(`Card not found: ${cardId}`);
  }

  state.cards.splice(idx, 1);
  saveState(config, state);
}

/**
 * Look up a single card by ID. Returns null if not found.
 */
export function getCard(config: MCConfig, cardId: string): Card | null {
  const state = loadState(config);
  return state.cards.find((c) => c.id === cardId) ?? null;
}

/**
 * Return all cards with status "pending".
 */
export function getPendingCards(config: MCConfig): Card[] {
  const state = loadState(config);
  return state.cards.filter((c) => c.status === 'pending');
}
