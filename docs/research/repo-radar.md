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

## Run: M5 observer eval harness (issue #15)
- Need: score a local model's observation against Claude's observation (field coverage, exact numbers, valid XML), no model call.
- Query: `gh search repos "claude code memory" --limit 5` (and `"claude-mem eval"`, `"llm observation summary eval harness"`, both returned no results).
- Verdict: no repo found that scores observer outputs. Built a small deterministic scorer from scratch in `evals/observer/score.ts`, stdlib only.
## Run M2c-A: 2026-11-10 (issue #2, cml-dev)

Need (one line): stop runtime use of the cmem.ai gateway, pro promo and sync-health upsell in the local fork.

Query: `gh search repos "claude-mem cmem gateway" --limit 5` (returned no repos).

Verdict: no third-party repo for this need. The change is a removal inside the fork, so it is built in place (flags off, no new code), not adopted from outside.
