import { describe, it, expect } from 'bun:test';
import { SettingsDefaultsManager } from '../../src/shared/SettingsDefaultsManager';

// M2 (issue #2): a silent fall back to paid Claude must be off by default.
describe('M2 local defaults', () => {
  it('quota fallback provider is off, never paid Claude', () => {
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER')).toBe('off');
  });
});
