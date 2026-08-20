import { describe, expect, it } from 'vitest';
import {
  ALL_DESKTOP_ADVISOR_TOOL_NAMES,
  MOBILE_ADVISOR_DENIED_TOOL_NAMES,
  MOBILE_ADVISOR_READ_TOOL_NAMES,
  buildMobileReadOnlyAdvisorTools,
  classifyMobileAdvisorTool,
} from './mobile-advisor-tool-registry.js';

describe('mobile Advisor tool registry', () => {
  it('classifies every desktop Advisor tool explicitly and denies unknown tools', () => {
    expect(new Set([...MOBILE_ADVISOR_READ_TOOL_NAMES, ...MOBILE_ADVISOR_DENIED_TOOL_NAMES]))
      .toEqual(new Set(ALL_DESKTOP_ADVISOR_TOOL_NAMES));
    expect(MOBILE_ADVISOR_READ_TOOL_NAMES).not.toContain('categorize_transaction');
    expect(MOBILE_ADVISOR_DENIED_TOOL_NAMES).toEqual(expect.arrayContaining([
      'categorize_transaction', 'add_category', 'update_category_rules', 'save_memory',
      'update_memory', 'manage_asset', 'manage_holding', 'record_movement',
      'manage_liability', 'manage_budget', 'update_alert_settings', 'generate_table_image',
    ]));
    expect(classifyMobileAdvisorTool('future_desktop_mutation')).toBe('deny');
  });

  it('constructs only the explicitly approved read tools for mobile', () => {
    expect(buildMobileReadOnlyAdvisorTools(['food']).map((tool) => tool.name))
      .toEqual(MOBILE_ADVISOR_READ_TOOL_NAMES);
  });
});
