import { describe, expect, it } from 'bun:test';
import vm from 'node:vm';
import { generateBoardHTML } from '../missioncontrol/src/ui';

describe('Mission Control inline script syntax', () => {
  it('generates browser script that parses successfully', () => {
    // Regression: ISSUE-QA-001 — Mission Control board script failed to boot
    // Found by /qa on 2026-03-24
    // Report: .gstack/qa-reports/qa-report-missioncontrol-local-2026-03-24.md
    const html = generateBoardHTML('');
    const match = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);

    expect(match).toBeTruthy();
    expect(() => new vm.Script(match![1])).not.toThrow();
  });
});
