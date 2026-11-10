import { SettingsDefaultsManager } from './SettingsDefaultsManager.js';

/** Live observer inputs are disposable, not a durable job queue (Claude and paid providers only). */
export const LIVE_OBSERVER_MAX_AGE_MS = 5 * 60_000;
export const LIVE_OBSERVER_MAX_SESSION_MESSAGES = 128;
export const LIVE_OBSERVER_MAX_TOTAL_MESSAGES = 1_024;

/**
 * A local provider (Ollama or any openai-compatible local endpoint) runs at
 * its own speed and costs nothing, so no event is dropped by policy: no age
 * drop, no caps, no paid-send budget. Read on each call so a settings change applies at once.
 */
export function isLocalObserverProvider(): boolean {
  const provider = SettingsDefaultsManager.get('CLAUDE_MEM_PROVIDER');
  return provider === 'openai-compatible' || provider === 'ollama';
}

export function isLiveObserverEvent(kind: string): kind is 'observation' | 'file_edit' | 'summarize' {
  return kind === 'observation' || kind === 'file_edit' || kind === 'summarize';
}

export function isExpiredObserverEvent(capturedAt: number, now = Date.now()): boolean {
  if (!Number.isFinite(capturedAt)) return true;
  if (isLocalObserverProvider()) return false;
  return now - capturedAt >= LIVE_OBSERVER_MAX_AGE_MS;
}
