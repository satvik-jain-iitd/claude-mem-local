# Abort join: AbortError vs quota abort (issue #11)

Read-only check on the copied logs. No model ran. The live `~/.claude-mem` was not touched.

Source: `scratchpad/m1/claude-mem-copy/logs/*.log` (33 files, 2026-10-12 to 2026-11-10).

## Counts (verified)

| Item | Count |
|---|---|
| `errorName=AbortError` lines | 213 |
| `Aborting session for quota guard` lines | 39 |
| AbortError lines with a sessionDbId | 213 of 213 |
| Quota-linked AbortError | **0** |
| Not quota-linked AbortError | **213** |

## Join rule

- Each AbortError line and each quota line is read with its own timestamp and `sessionDbId`.
- An AbortError is quota-linked when a quota line with the same `sessionDbId` has a timestamp 0 to 120 seconds before it.
- Otherwise it is not quota-linked.
- Times come from the line prefix. All files use the same local format.

## Why the join gives zero (verified)

- There are 237 same-session pairs (abort and quota line share a sessionDbId), at any gap.
- Of those, 0 fall within 120 seconds in either direction.
- The closest pair is about 3,528 seconds apart (session 41, 2026-10-27). The next closest is about 3,917 seconds (session 41, same day).
- So the quota guard and the AbortError do not happen close together in these logs.

## Top 5 nearby lines for the 213 unlinked aborts (verified counts, guess on cause)

Window: plus or minus 10 seconds, any session, the abort lines themselves excluded. Numbers are stripped to a template. One line can be counted for more than one abort when aborts are close together.

| Count | Template |
|---|---|
| 68 | `[WARN ] [SDK_SPAWN] [session-N] Claude process exited {code=N, signal=null, pid=N}` |
| 67 | `[WARN ] [SESSION] [session-N] Generator paused for transport; preserving buffered work {pendingCount=N}` |
| 65 | `[WARN ] [SDK   ] [session-N] Observer prompt went unanswered; preserving the claimed batch and stopping this generation {waitedMs=N, claimed=N}` |
| 16 | `[WARN ] [PROCESS] PID N did not exit after Nms, sending SIGKILL to process group {pid=N, pgid=N, timeoutMs=N}` |
| 16 | `[WARN ] [PROCESS] [session-N] Session parked waiting for an agent slot for over Ns {parkedForMs=N}` |

## Claims and status

| Claim | Status |
|---|---|
| 213 AbortError lines, 39 quota lines | verified (grep plus script) |
| No AbortError is within 120 s after a same-session quota line | verified (script, 0 pairs) |
| Quota guard is not the cause of these aborts | guess. The join only shows no close timing. A quota abort may still cause a later abort that the 120 s window misses. |
| The AbortErrors come from the child process exiting or the transport pausing | guess. Co-occurrence within 10 s is not proof of cause. |
| Observer prompt timeouts or SIGKILL cleanups are the main other abort path | guess. Needs a per-session timeline to confirm. |

## Next step

- Build a per-session timeline (all lines for one sessionDbId, in order) for the top session ids (26, 25, 33) to test the guesses above.
- Try wider windows (for example 10 minutes) to see if quota aborts lead to AbortErrors later. Record the result here.
