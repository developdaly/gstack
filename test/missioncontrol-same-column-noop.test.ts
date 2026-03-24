import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MCConfig } from '../missioncontrol/src/config';
import { createCard, loadState, moveCard } from '../missioncontrol/src/state';
import { generateBoardHTML } from '../missioncontrol/src/ui';

const tempDirs: string[] = [];

function makeConfig(): MCConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-same-column-noop-'));
  tempDirs.push(root);
  const stateDir = path.join(root, '.gstack');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(stateDir, 'missioncontrol-logs'), { recursive: true });
  return {
    projectDir: root,
    stateDir,
    serverStateFile: path.join(stateDir, 'missioncontrol-server.json'),
    boardStateFile: path.join(stateDir, 'missioncontrol.json'),
    logsDir: path.join(stateDir, 'missioncontrol-logs'),
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Mission Control same-column moves', () => {
  it('treats a same-column move as a no-op in state', () => {
    const config = makeConfig();
    const card = createCard(config, 'No-op card');

    const firstMove = moveCard(config, card.id, 'office-hours');
    expect(firstMove.changed).toBe(true);
    expect(firstMove.skill).toBe('/office-hours');

    const beforeNoop = loadState(config).cards[0]!;
    const activityCount = beforeNoop.activity.length;
    const movedAt = beforeNoop.movedAt;
    const status = beforeNoop.status;
    const skillTriggered = beforeNoop.skillTriggered;
    const logFile = beforeNoop.logFile;

    const noopMove = moveCard(config, card.id, 'office-hours');
    expect(noopMove.changed).toBe(false);
    expect(noopMove.skill).toBeNull();

    const afterNoop = loadState(config).cards[0]!;
    expect(afterNoop.column).toBe('office-hours');
    expect(afterNoop.movedAt).toBe(movedAt);
    expect(afterNoop.status).toBe(status);
    expect(afterNoop.skillTriggered).toBe(skillTriggered);
    expect(afterNoop.logFile).toBe(logFile);
    expect(afterNoop.activity.length).toBe(activityCount);
    expect(afterNoop.activity.map((entry) => entry.text)).not.toContain('Moved from office-hours to Office Hours');
  });

  it('still performs real cross-column moves', () => {
    const config = makeConfig();
    const card = createCard(config, 'Real move card');

    const result = moveCard(config, card.id, 'eng-review');
    expect(result.changed).toBe(true);
    expect(result.skill).toBe('/plan-eng-review');

    const movedCard = loadState(config).cards[0]!;
    expect(movedCard.column).toBe('eng-review');
    expect(movedCard.status).toBe('pending');
    expect(movedCard.skillTriggered).toBe('/plan-eng-review');
    expect(movedCard.logFile).toContain(`${card.id}-`);
    expect(movedCard.activity.map((entry) => entry.text)).toContain('Moved from backlog to Eng Review');
  });
});

describe('Mission Control same-column move UI guard', () => {
  it('renders client-side guards that skip same-column move requests', () => {
    const html = generateBoardHTML();
    expect(html).toContain('findColumnForCard(cardId) !== colId');
    expect(html).toContain('if (findColumnForCard(cardId) === columnId)');
  });
});
