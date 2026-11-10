import { describe, expect, it } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import { SearchOrchestrator } from '../../src/services/worker/search/SearchOrchestrator.js';
import { SettingsDefaultsManager } from '../../src/shared/SettingsDefaultsManager.js';

describe('M4: FTS-only search when Chroma is off', () => {
  it('Chroma is off by default', () => {
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_CHROMA_ENABLED')).toBe('false');
  });

  it('with Chroma off, a search returns FTS hits and does not throw', async () => {
    const store = new SessionStore(':memory:');
    try {
      const sessionId = store.createSDKSession('host-session', 'project', 'prompt');
      store.updateMemorySessionId(sessionId, 'observer-session');
      store.storeObservation('observer-session', 'project', {
        type: 'discovery', title: 'Zebra cache invalidation finding', subtitle: null,
        narrative: 'Cache keys were stale after a deploy', facts: [], concepts: [],
        files_read: [], files_modified: [],
      }, 1, 0, Date.now());
      const orchestrator = new SearchOrchestrator(new SessionSearch(store.db), store, null);
      const result = await orchestrator.search({ query: 'zebra', project: 'project' });
      expect(result.results.observations.length).toBeGreaterThan(0);
      expect(result.results.observations[0].title).toContain('Zebra');
    } finally {
      store.close();
    }
  });
});
