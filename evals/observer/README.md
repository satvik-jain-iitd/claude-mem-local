# Observer eval harness

This harness scores a small local model's observation against Claude's observation for the same input.
It calls no model. It only reads two JSON files and prints scores.

## What it scores

- **coverage**: share of the field names in the golden text that the candidate also has.
- **numbers**: share of the number tokens in the golden text that appear exactly in the candidate.
- **xml**: the candidate is well-formed XML.

Missing candidate rows count as zero.

## Input format

Both files are a JSON array of rows:

```json
[{ "id": "row-1", "text": "<observation>...</observation>" }]
```

## Run it

```bash
bun evals/observer/score.ts --golden <golden.json> --candidates <candidates.json>
```

Tests: `bun test evals/observer/score.test.ts`

## Run it on the Oracle box with a local model

1. The model must have 4B parameters or fewer. The box cannot finish bigger models. Models of 1B or less work best.
2. Generate the candidate file on the box only. Never run a model on the Mac.
3. Copy only the candidate JSON back to the Mac, then score it with the command above.
4. Record the run in `docs/research/experiments.md`: model, input size, speed, and the summary line.

## Speed rule

Published speeds (tokens per second) come from GPU machines. The box runs at about one third of that.
Start every speed estimate at one third of the published number. Replace it only with a real measured run on the box.

## Golden data

The golden rows are the owner's own Claude observations. They stay on the Mac in a read-only copy.
Never commit them. The export is handled by a different slice.
