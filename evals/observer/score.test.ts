import { describe, expect, test } from "bun:test";
import { scoreRow, scoreRows } from "./score.ts";

// Tiny invented fixtures. Not real data.
const GOLDEN_A = "<observation><title>Fix login</title><numbers>3 files, 42 lines</numbers></observation>";
const GOLDEN_B = "<observation><title>Add cache</title><numbers>7 hits</numbers></observation>";
const GOLDEN_C = "<observation><title>Rename</title></observation>";

describe("scoreRow", () => {
  test("perfect candidate scores 1 on every metric", () => {
    const s = scoreRow(GOLDEN_A, GOLDEN_A);
    expect(s.coverage).toBe(1);
    expect(s.numbers).toBe(1);
    expect(s.xml).toBe(true);
  });

  test("missing field and missing number lower the scores, broken XML is flagged", () => {
    // Candidate drops <numbers> and the numbers, and closes tags wrongly.
    const cand = "<observation><title>Add cache</observation>";
    const s = scoreRow(GOLDEN_B, cand);
    expect(s.coverage).toBeCloseTo(2 / 3, 5); // observation, title present; numbers missing
    expect(s.numbers).toBe(0); // "7" not present
    expect(s.xml).toBe(false);
  });

  test("well-formed candidate with a missing number still parses as XML", () => {
    const cand = "<observation><title>Rename</title></observation>";
    const s = scoreRow(GOLDEN_A, cand);
    expect(s.coverage).toBeCloseTo(2 / 3, 5); // observation, title present; numbers missing
    expect(s.numbers).toBe(0); // 3 and 42 not present
    expect(s.xml).toBe(true);
  });
});

describe("scoreRows", () => {
  test("missing candidate counts as zero and summary averages all golden rows", () => {
    const golden = [
      { id: "a", text: GOLDEN_A },
      { id: "c", text: GOLDEN_C },
    ];
    const candidates = [{ id: "a", text: GOLDEN_A }];
    const { rows, summary } = scoreRows(golden, candidates);
    expect(rows.length).toBe(2);
    expect(rows[1].missing).toBe(true);
    expect(summary.rows).toBe(2);
    expect(summary.missing).toBe(1);
    expect(summary.meanCoverage).toBeCloseTo(0.5, 5); // (1 + 0) / 2
    expect(summary.xmlValidRate).toBeCloseTo(0.5, 5); // (true + false) / 2
  });
});
