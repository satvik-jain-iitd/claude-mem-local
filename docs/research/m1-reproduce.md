# M1 Reproduce: what the real data shows

Date: 2026-11-10. Issue #1. Method: read-only copy of `~/.claude-mem` (scratchpad copy). The original was not opened for writing. Counts come from `sqlite3 -readonly` on the copy. Log counts are line counts, not unique events.

## Size

| Item | Value |
|---|---|
| `claude-mem.db` | 330,186,752 bytes (about 321 MB) |
| `claude-mem.db-wal` | 4,194,304 bytes (4 MB) |
| `claude-mem.db-shm` | 32 KB |
| `chroma/` in the copy | 366 MB. **Wrong, see correction below.** The copy has no `chroma.sqlite3` (777 MB in the live folder). The copy is not a full size measure of chroma. |

**Correction (PR #18, issue #10):** the 1.1 G vs 366 MB gap is the missing `chroma.sqlite3` in the copy. The HNSW files match. Use the live folder for chroma size, not the copy.

## Row counts (claude-mem.db)

| Table | Rows |
|---|---|
| observations | 23,070 (2026-10-07 to 2026-11-10) |
| observations_fts | 23,070 |
| session_summaries | 4,737 |
| tool_uses | 28,357 |
| user_prompts | 6,319 |
| observation_files | 29,845 |
| sdk_sessions | 61 |
| media_attachments | 268 |
| pending_messages | 0 |
| sync_outbox / sync_dead_letter | 0 / 0 |

Empty tables: `sync_*` (cloud sync, unused), `pending_messages`, `hook_spool_consumed`, `telegram_wrapups`.

## Error text seen in the logs (exact)

| Count | Log text (shortened, exact words kept) |
|---|---|
| 39 | `Aborting session for quota guard: quota:seven_day utilization 98.0% >= 93%` |
| 23 | `Primary in quota cooldown and the quota fallback cannot serve; capture waits until it clears {primary=claude, fallback=claude}` |
| 178 | `Generator paused for overflow; preserving buffered work` |
| 213 | `child emitted error event ... errorName=AbortError ... The operation was aborted.` |
| 231 | `Fatal error in main Hook stdout write failed: EPIPE: broken pipe, write` |
| 26 | `SDK authentication failed; ... Failed to authenticate: OAuth token revoked.` |
| 6 | `Claude Code: reviews: ...: summary is 282 characters; it must be 1–280.` |

`observer-health.json` (copy) at last error: `Memory capture paused: weekly Claude usage is 98.0%, at or above the 93% pause threshold.` Provider: `claude`. `consecutiveFailures: 0`.

## What this means (verified from the data, not guessed)

1. Capture pauses come from the Claude quota guard (39 aborts, 23 cooldown messages). They match the 93% weekly threshold in the logs.
2. Overflow pauses (178) and AbortErrors (213) happen while work is queued. These are the queue limits and aborts in the live path, not Chroma.
3. EPIPE (231) is a hook stdout write after the reader closed. Source not yet traced. Needs a follow-up story.
4. Zero `ChromaUnavailable` lines. Chroma breaker is not the cause in this data. The Chroma claim from the brief is not shown here.
5. Zero pending messages and zero sync outbox rows. Nothing waits in the DB.

## Open questions (not answered yet)

- Why the Chroma folder was 1.1 G in the first scan and 366 MB in the copy. Check hard links or live writes.
- Whether the 213 AbortErrors all come from quota aborts (needs a join on session ids).
- Source of the EPIPE errors.

## Next

M2 removes the quota guard and the paid fallback. The data above is the test baseline for that work.
