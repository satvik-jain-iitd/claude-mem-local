import { describe, it, expect } from 'bun:test';
import { RateLimitStore, shouldAbortForQuota } from '../../src/services/worker/RateLimitStore.js';

// M2b (#2): the observer never pauses or aborts because of the Claude quota.
// The guard reports "not held" for every window, whatever the utilization.

const NOW = 1_700_000_000_000;
const FUTURE = NOW + 3 * 24 * 3600_000;

describe('quota guard is off (M2b, #2)', () => {
  it('does not hold when the weekly window is at 98 percent', () => {
    const store = new RateLimitStore();
    store.set({ rateLimitType: 'seven_day', utilization: 0.98, status: 'allowed', resetsAt: FUTURE });
    expect(shouldAbortForQuota('cli', store, NOW)).toEqual({ abort: false });
  });

  it('does not hold at the 5-hour 95 percent and weekly 93 percent thresholds', () => {
    const store = new RateLimitStore();
    store.set({ rateLimitType: 'five_hour', utilization: 0.95, status: 'allowed', resetsAt: NOW + 60_000 });
    store.set({ rateLimitType: 'seven_day', utilization: 0.93, status: 'allowed', resetsAt: FUTURE });
    expect(shouldAbortForQuota('subscription', store, NOW)).toEqual({ abort: false });
  });

  it('does not hold on a provider rejection either', () => {
    const store = new RateLimitStore();
    store.set({ rateLimitType: 'seven_day', utilization: 1, status: 'rejected', resetsAt: FUTURE });
    expect(shouldAbortForQuota('cli', store, NOW)).toEqual({ abort: false });
  });
});
