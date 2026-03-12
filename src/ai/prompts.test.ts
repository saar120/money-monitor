import { describe, it, expect, vi } from 'vitest';

vi.mock('../shared/dates.js', () => ({
  todayInIsrael: () => '2026-03-12',
}));

const { buildPostScrapeAlertPrompt, buildMonthlySummaryAlertPrompt } = await import('./prompts.js');

describe('buildPostScrapeAlertPrompt', () => {
  it('returns a system prompt string mentioning financial concierge role', () => {
    const prompt = buildPostScrapeAlertPrompt();
    expect(prompt).toContain('financial');
    expect(prompt).toContain('[SILENT]');
    expect(prompt).toContain('Telegram');
  });
});

describe('buildMonthlySummaryAlertPrompt', () => {
  it('returns a system prompt string for monthly analysis', () => {
    const prompt = buildMonthlySummaryAlertPrompt();
    expect(prompt).toContain('monthly');
    expect(prompt).toContain('[SILENT]');
  });
});
