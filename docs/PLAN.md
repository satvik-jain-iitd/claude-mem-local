# Plan: claude-mem-local

## Goal

Make a fork of claude-mem that runs fully on this Mac or on the Oracle box.
It is free, local and unlimited. It has no cloud, no paywall and no telemetry.
Summaries come from small local models (Ollama, 1B to 4B).

## Why

The stock tool stops saving memories when the Claude quota runs low.
Some paths can fall back to paid Claude without notice.
Slow local models can lose events. Vector search can stop after errors.

## Milestones

| ID | Name | What it does |
|---|---|---|
| M0 | Bootstrap | Repo, source import, licence notices, plan, radar log, ShipQuick link. |
| M1 | Reproduce | Read the logs and a copy of the DB. Report the real error text, DB size and counts. Guess nothing. |
| M2 | De-gate | Make local the default. Remove the quota pause, upsells, telemetry, auto-update and cloud sync. Prove zero outbound calls with the network blocked. |
| M3 | Never drop | Use a durable SQLite queue. Save the raw event first, then add the summary. Repair bad XML once. |
| M4 | Vector | Keep FTS5 always on. Use sqlite-vec or a flat table. Chroma is optional and off. Bench at 100k and 1M. |
| M5 | Oracle and models | Run a headless worker on the Oracle ARM box. Test gemma3:1b, then 2B to 3B, then 4B. Log speed and accuracy. |
| M6 | Install and migrate | One installer replaces the stock plugin. Import the old DB after a backup. Keep the MCP tool names. |

## Rules for this repo

- Apache-2.0. Keep `LICENSE` as is. Keep `NOTICE` and add our line.
- Mark every change to upstream files with a modification notice (Apache section 4).
- Radar first: check `docs/research/repo-radar.md` before new code.
- Every new behaviour has a test that failed first (TDD).
- The Oracle box CPU runs no model above 4B. Speed estimates start at one third of the published number.
- Heavy training runs on Colab or Kaggle, never on the Mac.
- Pushes use the dev account `klickbae8yt-star`. The review account merges.

## Open items

- M0: ShipQuick roadmap wiring (`adopt.sh`) was blocked by the auto-mode classifier. Needs owner or peer OK.
- M0: GitHub issues for M1 to M6 are not created yet.
