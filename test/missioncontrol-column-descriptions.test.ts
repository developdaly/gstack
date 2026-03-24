import { describe, expect, it } from 'bun:test';
import { generateBoardHTML, MISSION_CONTROL_COLUMNS } from '../missioncontrol/src/ui';

describe('Mission Control column descriptions', () => {
  it('defines complete display metadata for every board column', () => {
    expect(MISSION_CONTROL_COLUMNS).toHaveLength(14);

    const coreFlowIds = MISSION_CONTROL_COLUMNS.filter((column) => column.isCoreFlow).map((column) => column.id);
    expect(coreFlowIds).toEqual([
      'office-hours',
      'eng-review',
      'implementation',
      'code-review',
      'qa',
      'ship',
    ]);

    for (const column of MISSION_CONTROL_COLUMNS) {
      expect(column.id.length).toBeGreaterThan(0);
      expect(column.name.length).toBeGreaterThan(0);
      expect(column.summary.length).toBeGreaterThan(0);
      expect(column.detail.length).toBeGreaterThan(0);
      if (column.id === 'backlog' || column.id === 'done') {
        expect(column.outcome).toBeNull();
      } else {
        expect(column.outcome).toBeTruthy();
      }
    }
  });

  it('ships visible summary/outcome markup and native disclosure markup in the board HTML', () => {
    const html = generateBoardHTML('/missioncontrol');

    expect(html).toContain('column-summary');
    expect(html).toContain('column-outcome');
    expect(html).toContain('column-header--core');
    expect(html).toContain('column-core-pill');
    expect(html).toContain('column-details');
    expect(html).toContain('column-details-label-more');
    expect(html).toContain('column-detail-body');
    expect(html).toContain('const COLUMNS = ');
    expect(html).toContain('Start here. Reframe the problem before anyone writes code.');
    expect(html).toContain('Write the code for the chosen plan.');
    expect(html).toContain('Finished work that is ready to archive visually.');
    expect(html).toContain('Produces:');
    expect(html).toContain('Design Doc');
    expect(html).toContain('QA Report');
    expect(html).toContain('More');
    expect(html).toContain('Less');
  });
});
