import { describe, it, expect } from 'bun:test';
import { stripBasePath } from '../missioncontrol/src/base-path';

describe('stripBasePath', () => {
  // Regression: ISSUE-QA-001 — Mission Control base-path routes 404ed under /missioncontrol
  // Found by /qa on 2026-03-23
  // Report: .gstack/qa-reports/qa-report-missioncontrol-2026-03-23.md
  it('leaves raw paths untouched when no base path is configured', () => {
    expect(stripBasePath('/api/state', '')).toBe('/api/state');
    expect(stripBasePath('/', '')).toBe('/');
  });

  it('maps the base path itself back to root', () => {
    expect(stripBasePath('/missioncontrol', '/missioncontrol')).toBe('/');
  });

  it('strips the configured base path prefix from nested routes', () => {
    expect(stripBasePath('/missioncontrol/api/state', '/missioncontrol')).toBe('/api/state');
    expect(stripBasePath('/missioncontrol/auth/login', '/missioncontrol')).toBe('/auth/login');
  });

  it('does not mutate unrelated paths', () => {
    expect(stripBasePath('/api/state', '/missioncontrol')).toBe('/api/state');
    expect(stripBasePath('/elsewhere', '/missioncontrol')).toBe('/elsewhere');
  });

  it('normalizes a trailing slash on the configured base path', () => {
    expect(stripBasePath('/missioncontrol/api/info', '/missioncontrol/')).toBe('/api/info');
  });
});
