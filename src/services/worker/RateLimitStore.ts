/**
 * Rate limit store — captures `rate_limit` system events emitted by
 * `@anthropic-ai/claude-agent-sdk`'s `query()` stream.
 *
 * The SDK reports the live Claude subscription quota state as a top-level
 * `rate_limit_event` message (`SDKRateLimitEvent` in sdk.d.ts). Older builds
 * surfaced it as a `system` message with subtype `rate_limit`; both shapes
 * are accepted by extractRateLimitInfo. The `rate_limit_info` payload:
 *
 *   {
 *     status: "allowed" | "allowed_warning" | "rejected",
 *     resetsAt?: number,                              // epoch ms
 *     rateLimitType?: "five_hour" | "seven_day"
 *                   | "seven_day_opus" | "seven_day_sonnet"
 *                   | "seven_day_overage_included" | "overage",
 *     utilization?: number,                           // 0..1
 *     overageStatus?: "allowed" | "allowed_warning" | "rejected",
 *     overageResetsAt?: number,
 *     isUsingOverage?: boolean,
 *     surpassedThreshold?: number,
 *     unifiedWindows?: {                              // not in sdk.d.ts
 *       [window]: { utilization?: number, resetsAt?: number },
 *     },
 *   }
 *
 * `rateLimitType` names only the binding window. The CLI also reports the
 * account-wide windows' live figures in `unifiedWindows`, so set() refreshes
 * those buckets too; otherwise a window that stops being the binding one keeps
 * its last snapshot until the worker restarts (#4076).
 *
 * Pattern adapted from meridian's proxy/rateLimitStore.ts (last-write-wins
 * per `rateLimitType` bucket, in-memory only). State resets on worker
 * restart — that's fine, the SDK pushes a fresh event on the next request.
 *
 * Quota-aware abort logic gates the worker from continuing to consume a
 * subscription bucket once it crosses a per-window threshold. API-key
 * users are exempt because they authorized per-call spend.
 */

import type { ObserverQuotaReason } from '../../shared/observer-health.js';

export type RateLimitWindow =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  /**
   * A per-model weekly bucket: Claude Code 2.1.286 labels it the "Fable
   * limit" and applies it only to requests on the models of its
   * overage-included allowlist. The CLI reads its figure from response
   * headers that every response of an account with the bucket carries,
   * whatever model the request used, so the figure (and any warning the CLI
   * derives from it) is not evidence that the observer draws on it. Above 1
   * it is usage that legitimately ran past the cap, not a refusal. Only the
   * provider refusing the observer's own request stops the observer on it:
   * Claude Code also reports `rejected` here once the bucket is spent while it
   * keeps serving requests on the normal allowance (#5182), so a `rejected`
   * that arrives with a served response is not a refusal.
   */
  | 'seven_day_overage_included'
  /**
   * Extra usage. An account without extra usage enabled reports this bucket
   * `rejected` (status or overageStatus) on every response, and so does one
   * whose extra usage is spent while the normal allowance still serves it
   * (#5182). Like `seven_day_overage_included`, a rejection here stops the
   * observer only when its own request was refused.
   */
  | 'overage';

export interface RateLimitInfo {
  status?: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  rateLimitType?: RateLimitWindow;
  utilization?: number;
  overageStatus?: 'allowed' | 'allowed_warning' | 'rejected';
  overageResetsAt?: number;
  isUsingOverage?: boolean;
  surpassedThreshold?: number;
  unifiedWindows?: Partial<Record<RateLimitWindow, UnifiedWindowSnapshot>>;
}

export interface UnifiedWindowSnapshot {
  utilization?: number;
  resetsAt?: number;
}

// The account-wide windows: every request draws on them, whatever its model.
// Per-model buckets are left out: their figures describe one model's usage,
// which the observer draws on only when it runs that model, so they are
// recorded only when an event names one as its `rateLimitType`. A user deep
// into their weekly Fable limit must not pause a Haiku observer (#4132).
// `overage` is left out too: its guard also depends on isUsingOverage and
// overageStatus, which a unified snapshot does not carry.
const UNIFIED_WINDOWS: readonly RateLimitWindow[] = ['five_hour', 'seven_day'];

export interface RateLimitEntry extends RateLimitInfo {
  observedAt: number;
  /**
   * Not part of the SDK payload: the Claude config-dir profile whose
   * credentials produced the snapshot (resolveConfigDirProfileKey). Quota is
   * per account, so a snapshot from one profile must not gate spawns billed to
   * another after CLAUDE_MEM_CLAUDE_CONFIG_DIR changes. Absent = unscoped.
   */
  profile?: string;
}

/** A stored entry as the health surface shows it. */
export interface RateLimitHealthEntry extends RateLimitEntry {
  /** Set when the window's reset has passed: the reading no longer applies. */
  expired?: true;
}

export type RateLimitBucketKey = RateLimitWindow | 'default';

export class RateLimitStore {
  private entries = new Map<RateLimitBucketKey, RateLimitEntry>();
  // Telemetry deduplication survives display-only unified-window refreshes.
  private rejections = new Map<RateLimitBucketKey, RateLimitInfo>();

  /**
   * Record a rate-limit info snapshot. Last-write-wins per bucket key.
   * Accepts both the literal `rate_limit_info` payload and a wrapping object;
   * callers should pass the inner info, tagged with `profile` when known.
   */
  set(info: Omit<RateLimitEntry, 'observedAt'> | undefined | null): boolean {
    if (!info || typeof info !== 'object') return false;
    // The raw per-window map is consumed below. Storing it too would leave a
    // nested copy on the entry that goes stale on /api/health.
    const { unifiedWindows, ...reported } = info;
    const key: RateLimitBucketKey = info.rateLimitType ?? 'default';
    const previousRejection = this.rejections.get(key);
    const observedAt = Date.now();
    const { windows: unified, malformed: malformedWindows } = readUnifiedWindows(unifiedWindows);

    // Other windows: refresh fields the unified snapshot actually reports.
    // Utilization establishes a new display state and drops stale status;
    // reset-only snapshots preserve an unchanged active rejection.
    for (const [window, snapshot] of unified) {
      if (window === key || malformedWindows.has(window)) continue;
      // State carries forward only within one account: another account's
      // reset time or rejection says nothing about this account's window.
      const cachedWindow = this.entries.get(window);
      const previousWindow = cachedWindow && !isOtherProfile(cachedWindow, info.profile)
        ? cachedWindow
        : undefined;
      // Carry the cached reset only while it is still ahead: an expired one
      // would make the guard skip this fresh reading as stale.
      const carriedResetsAt = isResetPending(previousWindow?.resetsAt, observedAt)
        ? previousWindow?.resetsAt
        : undefined;
      const resetsAt = snapshot.resetsAt ?? carriedResetsAt;
      const repeatsRejectedReset =
        snapshot.utilization === undefined &&
        previousWindow?.status === 'rejected' &&
        sameResetTime(resetsAt, previousWindow.resetsAt) &&
        isResetPending(resetsAt, observedAt);
      this.entries.set(window, {
        rateLimitType: window,
        ...snapshot,
        resetsAt,
        ...(repeatsRejectedReset ? { status: 'rejected' as const } : {}),
        // Siblings describe the same account as the event that carried them.
        ...(info.profile !== undefined ? { profile: info.profile } : {}),
        observedAt,
      });
      const rejectedWindow = this.rejections.get(window);
      if (
        rejectedWindow &&
        snapshot.resetsAt !== undefined &&
        !sameResetTime(snapshot.resetsAt, rejectedWindow.resetsAt)
      ) {
        this.rejections.delete(window);
      }
    }

    const own = info.rateLimitType ? unified.get(info.rateLimitType) : undefined;
    const merged: RateLimitEntry = {
      ...reported,
      utilization: info.utilization ?? own?.utilization,
      // Stored in epoch ms whatever unit the event used, so the rejection
      // de-dupe below and /api/health compare like with like.
      resetsAt: normalizeResetTimeMs(info.resetsAt) ?? own?.resetsAt,
      overageResetsAt: normalizeResetTimeMs(info.overageResetsAt),
      observedAt,
    };
    this.entries.set(key, merged);
    // Compare the merged entry, so a resetsAt that only arrives via
    // unifiedWindows still dedupes repeated rejections.
    const newRejection = isNewRejection(previousRejection, merged);
    if (merged.status === 'rejected') {
      this.rejections.set(key, merged);
    } else if (
      info.status !== undefined ||
      (previousRejection &&
        merged.resetsAt !== undefined &&
        !sameResetTime(merged.resetsAt, previousRejection.resetsAt))
    ) {
      this.rejections.delete(key);
    }
    return newRejection;
  }

  /** Snapshot a single bucket, or undefined if not yet seen. */
  get(type: RateLimitWindow | undefined): RateLimitEntry | undefined {
    if (!type) return this.entries.get('default');
    return this.entries.get(type);
  }

  /**
   * Latest snapshot per "interesting" window for health surface. A window
   * whose reset has passed is flagged `expired: true`: the guard already
   * ignores it, and without the flag /api/health showed a dead 93% reading
   * as live (#4068, #4114). The stored entries stay raw for set()'s de-dupe.
   */
  getMostRecentByWindow(now: number = Date.now()): {
    five_hour?: RateLimitHealthEntry;
    seven_day?: RateLimitHealthEntry;
    seven_day_opus?: RateLimitHealthEntry;
    seven_day_sonnet?: RateLimitHealthEntry;
    seven_day_overage_included?: RateLimitHealthEntry;
    overage?: RateLimitHealthEntry;
  } {
    const view = (window: RateLimitWindow): RateLimitHealthEntry | undefined => {
      const entry = this.entries.get(window);
      if (!entry) return undefined;
      const resetsAtMs = normalizeResetTimeMs(entry.resetsAt);
      return resetsAtMs !== undefined && resetsAtMs <= now ? { ...entry, expired: true } : entry;
    };
    return {
      five_hour: view('five_hour'),
      seven_day: view('seven_day'),
      seven_day_opus: view('seven_day_opus'),
      seven_day_sonnet: view('seven_day_sonnet'),
      seven_day_overage_included: view('seven_day_overage_included'),
      overage: view('overage'),
    };
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Tests only: put a bucket back exactly as it was before a case touched the
   * process-wide store — the saved entry, or no entry (and no rejection) at all.
   */
  restoreForTesting(key: RateLimitBucketKey, entry: RateLimitEntry | undefined): void {
    this.rejections.delete(key);
    if (entry) {
      this.entries.set(key, entry);
      if (entry.status === 'rejected') this.rejections.set(key, entry);
    } else {
      this.entries.delete(key);
    }
  }
}

function sameResetTime(left: number | undefined, right: number | undefined): boolean {
  return normalizeResetTimeMs(left) === normalizeResetTimeMs(right);
}

function isResetPending(resetsAt: number | undefined, now: number): boolean {
  const resetsAtMs = normalizeResetTimeMs(resetsAt);
  return resetsAtMs !== undefined && resetsAtMs > now;
}

/**
 * The finite fields of each window in UNIFIED_WINDOWS, plus the windows whose
 * entry is malformed: a field that is present but not a finite number (null
 * included). The CLI never writes one, so it is a corrupt snapshot. set()
 * never refreshes a SIBLING window from a malformed entry, since that would
 * replace a good reading with half of a bad one. The event's own window still
 * uses whichever half is finite, so a 0.97 reading keeps the quota guard armed.
 */
function readUnifiedWindows(raw: unknown): { windows: Map<RateLimitWindow, UnifiedWindowSnapshot>; malformed: Set<RateLimitWindow> } {
  const windows = new Map<RateLimitWindow, UnifiedWindowSnapshot>();
  const malformed = new Set<RateLimitWindow>();
  if (!raw || typeof raw !== 'object') return { windows, malformed };
  for (const window of UNIFIED_WINDOWS) {
    const entry = (raw as Record<string, unknown>)[window];
    if (!entry || typeof entry !== 'object') continue;
    const { utilization, resetsAt } = entry as Record<string, unknown>;
    if (!isAbsentOrFiniteNumber(utilization) || !isAbsentOrFiniteNumber(resetsAt)) malformed.add(window);
    const snapshot: UnifiedWindowSnapshot = {};
    if (isFiniteNumber(utilization)) snapshot.utilization = utilization;
    if (isFiniteNumber(resetsAt)) snapshot.resetsAt = normalizeResetTimeMs(resetsAt);
    if (snapshot.utilization !== undefined || snapshot.resetsAt !== undefined) windows.set(window, snapshot);
  }
  return { windows, malformed };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isAbsentOrFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

/** Process-wide singleton. */
export const globalRateLimitStore = new RateLimitStore();

/**
 * Pull the `rate_limit_info` payload out of an SDK stream message, or
 * undefined when the message is not a quota snapshot.
 *
 * The SDK emits `{ type: 'rate_limit_event', rate_limit_info }` — a top-level
 * message type in the SDKMessage union, NOT a `system` subtype. The original
 * guard (#2234) matched `type === 'system' && subtype === 'rate_limit'`, which
 * the SDK never sends, so the quota guard and every consumer of the store were
 * dead until this extractor replaced it. The legacy shape is still accepted in
 * case an older SDK build is on the path.
 */
export function extractRateLimitInfo(message: unknown): RateLimitInfo | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const m = message as { type?: unknown; subtype?: unknown; rate_limit_info?: unknown };
  const isRateLimitMessage =
    m.type === 'rate_limit_event' || (m.type === 'system' && m.subtype === 'rate_limit');
  if (!isRateLimitMessage) return undefined;
  const info = m.rate_limit_info;
  if (!info || typeof info !== 'object') return undefined;
  return info as RateLimitInfo;
}

/**
 * A snapshot is a NEW rejection when it says `rejected` and the previous
 * snapshot for the same window did not — or pointed at a different reset
 * time, which means the window was exhausted again after a reset without an
 * `allowed` snapshot in between. The SDK re-sends `rejected` on every request
 * while the wall is up, so this is what keeps `usage_limit_hit` at one event
 * per exhaustion instead of one per observer request.
 */
export function isNewRejection(
  previous: RateLimitInfo | undefined,
  next: RateLimitInfo,
): boolean {
  if (next.status !== 'rejected') return false;
  if (!previous || previous.status !== 'rejected') return true;
  return previous.resetsAt !== next.resetsAt;
}

/**
 * Whole minutes until the window resets, floored at 0. Claude Code has been
 * seen writing `resetsAt` as epoch seconds in transcripts while the SDK
 * documents epoch ms, so anything too small to be ms is treated as seconds.
 */
export function minutesUntilReset(resetsAt: number | undefined, now: number = Date.now()): number | undefined {
  const resetsAtMs = normalizeResetTimeMs(resetsAt);
  if (resetsAtMs === undefined) return undefined;
  return Math.max(0, Math.round((resetsAtMs - now) / 60_000));
}

function normalizeResetTimeMs(resetsAt: number | undefined): number | undefined {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return undefined;
  return resetsAt < 1e12 ? resetsAt * 1000 : resetsAt;
}

/**
 * PostHog properties for one `usage_limit_hit` event. Closed enums, a
 * boolean, and one integer — never the provider's message text.
 */
export function buildUsageLimitHitProps(
  info: RateLimitInfo,
  now: number = Date.now(),
): Record<string, unknown> {
  return {
    limit_window: info.rateLimitType ?? 'unknown',
    overage_status: info.overageStatus ?? 'unknown',
    is_using_overage: info.isUsingOverage === true,
    resets_in_minutes: minutesUntilReset(info.resetsAt, now),
  };
}

/**
 * Why the guard stopped the observer, for the health ledger and the cooldown
 * notice. `quota_exhausted` is the provider's own refusal; `quota_guard` is
 * claude-mem's precautionary stop (a utilization threshold, the reset
 * buffer), taken while the provider was still accepting requests. The
 * SessionStart banner must not call the second one a spent allowance.
 */
export interface QuotaPause {
  kind: 'quota_guard' | 'quota_exhausted';
  message: string;
  reason: ObserverQuotaReason;
}

export interface QuotaGuardOptions {
  /**
   * The provider answered the observer's current request: a response arrived
   * in this turn. A `rejected` status on a window in
   * SERVED_REQUEST_ADVISORY_WINDOWS is then information about a bucket the
   * observer is not drawing on, not a refusal (#5182). Leave unset when it is
   * not known; the rejection then stops the observer as before.
   */
  requestServed?: boolean;
}

export type QuotaDecision =
  | { abort: false; reason?: undefined; window?: undefined; pause?: undefined }
  | { abort: true; reason: string; window: RateLimitWindow; pause: QuotaPause };

/**
 * Decide whether to abort SDK consumption based on the latest rate-limit
 * snapshot and the active auth method.
 *
 * `profile` is the account the caller is billing. Snapshots tagged with a
 * different profile are ignored: they describe another account's quota. When
 * either side is untagged the snapshot applies, as before.
 *
 * - `api_key` (or any string starting with "API key"): never abort —
 *   per-call billing means the user already authorized the spend.
 * - `cli` / OAuth / subscription: per-window utilization thresholds plus a
 *   reset-grace buffer so we avoid burning the last few percent right
 *   before a window resets.
 *
 * A provider refusal on any window is checked before every local guard, so a
 * confirmed weekly exhaustion is reported as such even when the five-hour
 * window would also have paused on its threshold.
 */
export function shouldAbortForQuota(
  _authMethod: string,
  _store: RateLimitStore,
  _now: number = Date.now(),
  _profile?: string,
  _options: QuotaGuardOptions = {},
): QuotaDecision {
  // M2b (#2): the observer never stops because of the Claude quota. Utilization
  // thresholds, the reset buffer and provider rejections all report "not held".
  // The snapshot is still recorded in the store for telemetry and the ledger.
  return { abort: false };
}


/**
 * Rebuild the pause behind a `quota:<window>` abort. M2b (#2): the guard never
 * aborts, so no abort reason exists to explain. Always undefined.
 */
export function explainQuotaAbort(
  _reason: string | null | undefined,
  _store: RateLimitStore,
  _now: number = Date.now(),
  _profile?: string,
): QuotaPause | undefined {
  return undefined;
}

function isOtherProfile(entry: RateLimitEntry, profile: string | undefined): boolean {
  return profile !== undefined && entry.profile !== undefined && entry.profile !== profile;
}

/**
 * Detects API-key auth from a free-form auth-method label. Matches the
 * verbose strings produced by `getAuthMethodDescription()` (e.g.
 * "API key (from ~/.claude-mem/.env)") as well as concise tokens like
 * "api_key".
 */
export function isApiKeyAuth(authMethod: string): boolean {
  if (!authMethod) return false;
  const normalized = authMethod.toLowerCase();
  return normalized.startsWith('api key') || normalized === 'api_key';
}
