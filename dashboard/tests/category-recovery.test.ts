import { describe, expect, it } from 'vitest';
import { intendedNullableColor, toggleWasAccepted } from '../src/lib/category-recovery.js';

describe('dashboard category mutation recovery', () => {
  it('preserves a null color while displaying the fallback', () => {
    expect(intendedNullableColor(null, '#94A3B8', '#94A3B8')).toBeNull();
    expect(intendedNullableColor(null, '#FF0000', '#94A3B8')).toBe('#FF0000');
    expect(intendedNullableColor('#94A3B8', '#94A3B8', '#94A3B8')).toBe('#94A3B8');
  });

  it('accepts an unknown toggle only when authority has the intended value', () => {
    const authority = [{ id: 7, ignoredFromStats: true }];
    expect(toggleWasAccepted(authority, 7, true)).toBe(true);
    expect(toggleWasAccepted(authority, 7, false)).toBe(false);
  });
});
