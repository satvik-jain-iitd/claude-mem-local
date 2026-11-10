import { afterEach, describe, expect, it, spyOn, mock } from 'bun:test';
import { SessionMessageBuffer } from '../../src/services/worker/SessionMessageBuffer.js';
import { paidSendBudgetForClaimedBatch } from '../../src/services/worker/paid-send-budget.js';
import { isExpiredObserverEvent, LIVE_OBSERVER_MAX_AGE_MS, LIVE_OBSERVER_MAX_SESSION_MESSAGES } from '../../src/shared/observer-work-policy.js';
import type { ActiveSession } from '../../src/services/worker-types.js';

const observation = (id: string) => ({ type: 'observation' as const, tool_name: 'Read', toolUseId: id });
const ENV_KEY = 'CLAUDE_MEM_PROVIDER';
const savedProvider = process.env[ENV_KEY];

afterEach(() => {
  mock.restore();
  if (savedProvider === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedProvider;
});

describe('M3: a local observer provider never drops an event by policy', () => {
  it('keeps an event 10 minutes old when the local provider is selected', () => {
    process.env[ENV_KEY] = 'openai-compatible';
    const now = Date.now();
    const clock = spyOn(Date, 'now').mockReturnValue(now);
    const buffer = new SessionMessageBuffer();
    expect(buffer.enqueue(1, observation('old'), now)).toBeGreaterThan(0);
    clock.mockReturnValue(now + 10 * 60_000);
    expect(buffer.getPendingCount(1)).toBe(1);
    expect(buffer.claimNextMatching(1, () => true)).not.toBeNull();
    expect(isExpiredObserverEvent(now - 10 * 60_000)).toBe(false);
  });

  it('still expires the same 10 minute old event when Claude is selected', () => {
    process.env[ENV_KEY] = 'claude';
    const now = Date.now();
    const clock = spyOn(Date, 'now').mockReturnValue(now);
    const buffer = new SessionMessageBuffer();
    expect(buffer.enqueue(1, observation('old'), now)).toBeGreaterThan(0);
    clock.mockReturnValue(now + 10 * 60_000);
    expect(buffer.getPendingCount(1)).toBe(0);
    expect(isExpiredObserverEvent(now - 10 * 60_000)).toBe(true);
  });

  it('skips the per-session cap for a local provider', () => {
    process.env[ENV_KEY] = 'ollama';
    const buffer = new SessionMessageBuffer();
    for (let i = 0; i <= LIVE_OBSERVER_MAX_SESSION_MESSAGES; i++) {
      expect(buffer.enqueue(1, observation(`${i}`))).toBeGreaterThan(0);
    }
    expect(buffer.getPendingCount(1)).toBe(LIVE_OBSERVER_MAX_SESSION_MESSAGES + 1);
  });

  it('has no paid-send budget, so a batch is never parked, for a local provider', () => {
    process.env[ENV_KEY] = 'openai-compatible';
    const session = { claimedMessageIds: [7] } as unknown as ActiveSession;
    expect(paidSendBudgetForClaimedBatch(session)).toBeUndefined();
  });

  it('keeps the 2-send paid budget for Claude', () => {
    process.env[ENV_KEY] = 'claude';
    const session = { claimedMessageIds: [7] } as unknown as ActiveSession;
    expect(paidSendBudgetForClaimedBatch(session)?.maxPaidSends).toBe(2);
  });

  it('uses the 30 s busy timeout for a local database and keeps 5 s otherwise', async () => {
    const { busyTimeoutMsForProvider } = await import('../../src/services/sqlite/connection.js');
    process.env[ENV_KEY] = 'openai-compatible';
    expect(busyTimeoutMsForProvider()).toBe(30_000);
    process.env[ENV_KEY] = 'claude';
    expect(busyTimeoutMsForProvider()).toBe(5_000);
    expect(LIVE_OBSERVER_MAX_AGE_MS).toBe(5 * 60_000);
  });
});
