import { describe, expect, it } from 'bun:test';
import { generateBoardHTML } from '../missioncontrol/src/ui';

function extractInlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  if (!match) throw new Error('Expected inline script block in generated board HTML');
  return match[1];
}

describe('Mission Control multimedia attachment UI', () => {
  // Regression: ISSUE-QA-001 — multimedia card UI missing and attachment-button quoting broke page boot
  // Found by /qa on 2026-03-24
  // Report: .gstack/qa-reports/qa-report-missioncontrol-local-2026-03-24.md
  it('renders the attachment section in the card modal', () => {
    const html = generateBoardHTML();
    expect(html).toContain('Images for agent context');
    expect(html).toContain('Included when this card runs.');
    expect(html).toContain('modal-attachments-input');
    expect(html).toContain('modal-attachments-strip');
    expect(html).toContain('openAttachmentPreview(this.dataset.attachmentId)');
    expect(html).toContain('removeAttachment(this.dataset.attachmentId)');
  });

  it('generates syntactically valid client-side script for the attachment UI', () => {
    const script = extractInlineScript(generateBoardHTML());
    expect(() => new Function(script)).not.toThrow();
  });
});
