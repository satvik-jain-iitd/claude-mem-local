import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isOpenAICompatAvailable } from '../../src/services/worker/OpenAICompatProvider';

// M2 slice (a), issue #2: a fresh install (no model set) must not count as a working local provider.
// It must not quietly fall through to paid Claude either (QUOTA_FALLBACK_PROVIDER default is off).
describe('M2 empty model', () => {
  it('openai-compatible with no model is not available on a fresh install', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cml-m2-'));
    const settingsPath = join(dir, 'settings.json');
    writeFileSync(settingsPath, '{}');
    expect(isOpenAICompatAvailable(settingsPath)).toBe(false);
  });
});
