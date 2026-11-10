# EPIPE trace (issue #9)

Read-only analysis. No code in src/ changed.

## Counts (verified: grep on the copied logs)

The log line is:
`Fatal error in main Hook stdout write failed: EPIPE: broken pipe, write`

Exact-message count per day, all copied log files (sum = 231):

| Day | Lines |
|---|---|
| 2026-10-22 | 1 |
| 2026-10-24 | 2 |
| 2026-10-25 | 27 |
| 2026-10-26 | 16 |
| 2026-10-27 | 135 |
| 2026-10-28 | 36 |
| 2026-10-29 | 12 |
| 2026-10-30 | 1 |
| 2026-11-07 | 1 |

No hit on 11-08, 11-09, 11-10 or runner-errors.log.
Plain `grep -c EPIPE` gives a higher count on 10-25 (42) and 10-26 (1), because other lines also mention EPIPE. Those extra lines are not this message.

The fatal line has no hook name, platform or event. Each line is alone (no stack, no context).

## Code path (verified: read the code)

1. `src/shared/hook-io.ts:112-116` `HookStdoutError` wraps any stdout failure. Its message always starts with `Hook stdout write failed:`. This is the only place that prefix is made, so the log line is a `HookStdoutError`.
2. `src/shared/hook-io.ts:140-175` `emitModelContext` calls `process.stdout.write(...)`. The write callback (line 151 `fail`) and a `once('error')` listener both reject with `HookStdoutError`.
3. `src/cli/hook-command.ts:84-87` emits, then `await waitForModelContext()`. Line 147 rethrows `HookStdoutError` past the generic catch.
4. `src/cli/hook-entry.ts:31-37` and `src/services/worker-service.ts:2571-2576` both do the same thing:
   - if `isHookStdoutClosed(error)` then `logger.debug(...)` and `exit(0)`
   - else `logger.error('SYSTEM', 'Fatal error in main', ...)`
5. `src/shared/hook-io.ts:121-127` `isHookStdoutClosed` returns true only when:
   - `error instanceof HookStdoutError`, AND
   - `error.cause.code === 'EPIPE'`

The fatal log line appears only when step 5 returns false. The message proves the first test passed (it is a `HookStdoutError`). So the `cause.code === 'EPIPE'` test failed. This is the key finding.

Both bundles carry the same check: `plugin/scripts/hook-service.cjs` (`Ev`) and `plugin/scripts/worker-service.cjs` (`DIe`). Both use `instanceof` and `cause?.code==="EPIPE"`.

## Which hook writes to a closed pipe

Guess (confidence about 0.6). The hook process writes its JSON reply to stdout. The reader (the agent host, most likely Claude Code) had already closed the pipe. Likely reasons: the host hit its hook timeout, or the session ended before the hook finished. The logs do not name the hook, so this cannot be proven from the logs alone.

## Root cause

Guess (confidence about 0.6). The log text `EPIPE: broken pipe, write` is Bun's error style. The runtime here is Bun (`plugin/scripts/bun-runner.js` launches the hook bundle; Bun 1.3.9 is installed on this Mac). Under Bun, the stream error may carry `EPIPE` in the message but not in `code`. Then `cause?.code === 'EPIPE'` is false, the check misses, and every closed-pipe case is logged as a fatal error.

What I checked, and what I did not:
- Verified: Node 25 gives `code: 'EPIPE'`, `errno: -32`, `syscall: 'write'` on a closed pipe (probe in the scratchpad, `epipe-probe.mjs`).
- Not verified: the Bun error shape. My Bun probe was inconclusive. Bun exited 0 with no output on a closed-pipe write, and the write callback did not fire. So I could not read the `code` field under Bun.

Impact: low. Both paths exit 0, so no data is lost in the hook's real job. The cost is log noise, and the 231 fatal lines hide real fatal errors.

## Recommended fix

Make the check depend on what the error really carries, in the one shared function, so both callers get it (`src/shared/hook-io.ts:121-127`):

```ts
export function isHookStdoutClosed(error: unknown): boolean {
  if (!(error instanceof HookStdoutError)) return false;
  const cause = error.cause as { code?: unknown; errno?: unknown; message?: unknown } | undefined;
  return cause?.code === 'EPIPE' || cause?.errno === -32 || /\bEPIPE\b/.test(String(cause?.message ?? ''));
}
```

Add one check that fails if the logic breaks: a `HookStdoutError` whose cause has only the message `EPIPE: broken pipe, write` must return true.

Before the fix, one small run on the Mac (not a model, just the Bun probe) should confirm the shape of the Bun error on a closed pipe. Ponytail note: skipped a new error class; add a retry or a wider change only if the logs still show the fatal line after this guard.

Also check the other failure: `instanceof` across bundles. Both bundles define their own `HookStdoutError`. If a hook path ever loads the other bundle's class, `instanceof` also fails. Not verified; the logs do not show a mixed-bundle run.
