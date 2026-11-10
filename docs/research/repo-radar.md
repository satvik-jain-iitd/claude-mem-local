# Repo radar log

Rule: before new code, run the radar (CLAUDE.md section 2, rule 0). Append only. Never delete a row.

## Run 1: 2026-11-10 (M0 bootstrap, cml-dev)

Need (one line): fully local Claude Code memory plugin, local Ollama summaries, SQLite vector search, no cloud.

| Step | Command or query | Result |
|---|---|---|
| Scout | `python3 ~/Documents/AGI/plugins/radar/scripts/scout.py --need "..."` | "no repos found" |
| GitHub topic search | `gh search repos "topic:claude-code memory ollama"` | Top 10 were general tools (rea, ECC, ollama, open-webui, Graphify). None is a Claude memory plugin. |
| GitHub text search | `gh search repos "claude-mem local ollama"` | 0 results |

Verdict: no repo fits the need as a memory plugin. The base to build on is the existing Apache-2.0
project `thedotmack/claude-mem` (v15.15.0, source copied here). So the work is fork and patch
(adopt and borrow), not a new build from scratch.

Reference: `thedotmack/claude-mem` (Apache-2.0). Source copied at M0 (commit to follow).

## Run note: M4 part 1, Chroma off by default (2026-11-10)

- Need: make Chroma opt-in so search runs from FTS5 only, with no Chroma dependency.
- Query: `gh search repos "sqlite fts5 local memory search without vector database" --limit 5` returned no repos. Second query `gh search repos "chroma off fts5 search default" --limit 5` returned 0.
- Verdict: reuse the in-repo code. The orchestrator already falls back to SQLite when no Chroma strategy exists. Only the default setting needs to change (src/shared/SettingsDefaultsManager.ts). No new code from outside.
