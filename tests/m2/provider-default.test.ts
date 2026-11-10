import { describe, it, expect } from 'bun:test';
import { SettingsDefaultsManager } from '../../src/shared/SettingsDefaultsManager';

// M2 slice (a), issue #2: the observer runs on a local Ollama endpoint by default, never on Claude.
describe('M2 provider default', () => {
  it('provider is openai-compatible', () => {
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_PROVIDER')).toBe('openai-compatible');
  });

  it('preset is ollama', () => {
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_OPENAI_COMPAT_PRESET')).toBe('ollama');
  });
});
