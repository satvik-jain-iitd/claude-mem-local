import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { cmemGatewayRole, canCmemGatewayServe, keysForEndpoint, isKeyAllowedForEndpoint } from '../../src/shared/cmem-gateway';
import { proTrialLine } from '../../src/shared/pro-promo';
import { renderSyncHealthWarning } from '../../src/shared/sync-health';

// M2c part A (issue #2): no runtime use of the cmem.ai gateway, pro promo, or sync-health upsell.
const CMEM_ORIGIN = 'https://cmem.ai';
const CMEM_KEY = 'cm_pro_0123456789abcdef01234567';

describe('M2 issue #2: no cmem.ai gateway at runtime', () => {
  let cmemCalls: string[];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    cmemCalls = [];
    globalThis.fetch = mock(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as { url?: string }).url ?? String(input);
      if (url.includes('cmem.ai')) cmemCalls.push(url);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('default settings (openrouter base URL blank): no request to a cmem.ai host', () => {
    const defaults = { CLAUDE_MEM_PROVIDER: 'openrouter', CLAUDE_MEM_OPENROUTER_BASE_URL: '', CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: 'off' };
    expect(cmemGatewayRole(defaults)).toBeNull();
    expect(canCmemGatewayServe()).toBe(false);
    expect(cmemCalls.length).toBe(0);
  });

  it('a cm_pro_ key is never handed to any endpoint, even the cmem URL', () => {
    expect(keysForEndpoint(`${CMEM_ORIGIN}/api/inference/v1`, [CMEM_KEY])).toEqual([]);
    expect(isKeyAllowedForEndpoint(`${CMEM_ORIGIN}/api/inference/v1`, CMEM_KEY)).toBe(false);
    expect(cmemCalls.length).toBe(0);
  });

  it('a cmem base URL set by hand does not become the primary or fallback gateway', () => {
    const settings = { CLAUDE_MEM_PROVIDER: 'openrouter', CLAUDE_MEM_OPENROUTER_BASE_URL: `${CMEM_ORIGIN}/api/inference/v1`, CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: 'openrouter' };
    expect(cmemGatewayRole(settings)).toBeNull();
  });

  it('the pro promo line is empty for every plan', () => {
    expect(proTrialLine('session-start', '')).toBe('');
    expect(proTrialLine('context-banner', 'none')).toBe('');
  });

  it('the sync-health warning has no cmem.ai upsell', () => {
    const state = { state: 'auth_paused', code: 'subscription_inactive', consecutiveFailures: 1, failingSinceAt: null, message: null, updatedAt: new Date().toISOString() } as never;
    expect(renderSyncHealthWarning(state)).not.toContain('cmem.ai');
  });
});
