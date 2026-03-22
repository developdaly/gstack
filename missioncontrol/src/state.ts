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
}

export interface BoardState {
  version: 1;
  cards: Card[];
}

const DEFAULT_STATE: BoardState = {
  version: 1,
  cards: [],
};

/**
 * Read the board state from disk. Returns a default empty state if the file
 * is missing or unreadable.
 */
export function loadState(config: MCConfig): BoardState {
  try {
    const raw = fs.readFileSync(config.boardStateFile, 'utf-8');
    return JSON.parse(raw) as BoardState;
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
  };

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

  card.column = targetColumn;
  card.movedAt = now;

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
  updates: Partial<Pick<Card, 'title' | 'description' | 'tags' | 'status' | 'logFile' | 'designDocs'>>,
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
