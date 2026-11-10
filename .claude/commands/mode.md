---
description: Show the mode (manual, semi or auto) and print the line the owner types to change it
argument-hint: [manual|semi|auto]
---

Show the mode of this project, or help the owner change it. The three modes are in `docs/MODES.md`.

On a Mac with the `shipquick-mode` skill, the owner can type `/shipquick-mode <word>` instead of the `!` line. It sets the same file. An agent still never runs `set`.

**Only the owner sets the mode.** An agent must never run `set`, not for `/mode auto` and not for any other word. If an agent could set auto, it could then merge through `scripts/review_merge.sh`, and the gate would mean nothing.

1. Run `scripts/mode.sh get` (in a child project: `knowledge/shipquick_latest/scripts/mode.sh get`) and tell the owner the word. If it exits 3, the mode is not set: ask the owner to pick `manual`, `semi` or `auto`.
2. If the owner gave a word in `$ARGUMENTS` (`manual`, `semi` or `auto`), do not run anything to set it. Print the exact line for him to type, with the `!` in front, so it runs as his own shell input:
   - `! bash scripts/mode.sh set $ARGUMENTS`
   - in a child project: `! bash knowledge/shipquick_latest/scripts/mode.sh set $ARGUMENTS`
   Any other word: refuse and list the three.
3. After the owner has typed it, run `get` again. When it shows the new word, tell the peer session with SendMessage, in one line: "mode is now <word>". Every worktree reads the same file, so no other step is needed.
4. Auto mode lets an agent merge, but only with `scripts/review_merge.sh <pr>`.
