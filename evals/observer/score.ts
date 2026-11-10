// Deterministic scorer for a local model's observation against Claude's golden observation.
// No model is called here. Input is two JSON files of rows: [{ "id": string, "text": string }].
// Usage: bun evals/observer/score.ts --golden <golden.json> --candidates <candidates.json>

import { readFileSync } from "node:fs";

export type Row = { id: string; text: string };

export type RowScore = {
  id: string;
  coverage: number; // share of golden field names present in the candidate
  numbers: number; // share of golden number tokens found exactly in the candidate
  xml: boolean; // candidate is well-formed XML
  missing: boolean; // no candidate row with this id
  missingFields: string[];
  missingNumbers: string[];
};

export type Summary = {
  rows: number;
  missing: number;
  meanCoverage: number;
  meanNumbers: number;
  xmlValidRate: number;
};

const TAG_NAME = /<\/?([A-Za-z_][\w.:-]*)/g;
const NUMBER = /\d+(?:[.,]\d+)*/g;

function fieldNames(text: string): Set<string> {
  return new Set([...text.matchAll(TAG_NAME)].map((m) => m[1]));
}

function numberTokens(text: string): Set<string> {
  return new Set(text.match(NUMBER) ?? []);
}

// ponytail: small well-formedness check, not a full XML parser.
// Ceiling: no DTD, no entity expansion beyond the five predefined ones,
// and an attribute value that contains ">" will be misread. Upgrade to a real parser if that matters.
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)([^<>]*?)(\/?)>/g;
const BAD_AMP = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

export function isWellFormedXml(text: string): boolean {
  const stack: string[] = [];
  let roots = 0;
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const gap = text.slice(last, m.index);
    if (gap.includes("<") || BAD_AMP.test(gap)) return false;
    if (stack.length === 0 && gap.trim() !== "") return false;
    last = m.index + m[0].length;
    if (!m[1] && !m[2]) continue; // comment, CDATA or processing instruction
    const [, slash, name, , selfClose] = m;
    if (slash) {
      if (stack.pop() !== name) return false;
    } else {
      if (stack.length === 0) roots++;
      if (!selfClose) stack.push(name);
    }
  }
  const rest = text.slice(last);
  return (
    stack.length === 0 &&
    roots === 1 &&
    !rest.includes("<") &&
    !BAD_AMP.test(rest) &&
    rest.trim() === ""
  );
}

export function scoreRow(golden: string, candidate: string): Omit<RowScore, "id" | "missing"> {
  const goldFields = [...fieldNames(golden)];
  const candFields = fieldNames(candidate);
  const missingFields = goldFields.filter((f) => !candFields.has(f));

  const goldNums = [...numberTokens(golden)];
  const candNums = numberTokens(candidate);
  const missingNumbers = goldNums.filter((n) => !candNums.has(n));

  return {
    coverage: goldFields.length === 0 ? 1 : (goldFields.length - missingFields.length) / goldFields.length,
    numbers: goldNums.length === 0 ? 1 : (goldNums.length - missingNumbers.length) / goldNums.length,
    xml: isWellFormedXml(candidate),
    missingFields,
    missingNumbers,
  };
}

export function scoreRows(golden: Row[], candidates: Row[]): { rows: RowScore[]; summary: Summary } {
  const byId = new Map(candidates.map((c) => [c.id, c.text]));
  const rows: RowScore[] = golden.map((g) => {
    const cand = byId.get(g.id);
    if (cand === undefined) {
      return { id: g.id, coverage: 0, numbers: 0, xml: false, missing: true, missingFields: [...fieldNames(g.text)], missingNumbers: [...numberTokens(g.text)] };
    }
    return { id: g.id, missing: false, ...scoreRow(g.text, cand) };
  });
  const n = rows.length || 1;
  const sum = (f: (r: RowScore) => number) => rows.reduce((acc, r) => acc + f(r), 0) / n;
  return {
    rows,
    summary: {
      rows: rows.length,
      missing: rows.filter((r) => r.missing).length,
      meanCoverage: sum((r) => r.coverage),
      meanNumbers: sum((r) => r.numbers),
      xmlValidRate: sum((r) => (r.xml ? 1 : 0)),
    },
  };
}

function readRows(path: string): Row[] {
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data) || !data.every((r) => r && typeof r.id === "string" && typeof r.text === "string")) {
    throw new Error(`${path}: expected a JSON array of {id, text} rows`);
  }
  return data as Row[];
}

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${name} <path>`);
  return process.argv[i + 1];
}

if (import.meta.main) {
  const { rows, summary } = scoreRows(readRows(arg("--golden")), readRows(arg("--candidates")));
  for (const r of rows) {
    const flag = r.missing ? "MISSING" : `coverage=${r.coverage.toFixed(2)} numbers=${r.numbers.toFixed(2)} xml=${r.xml ? "yes" : "no"}`;
    console.log(`${r.id}\t${flag}`);
  }
  console.log(
    `SUMMARY rows=${summary.rows} missing=${summary.missing} coverage=${summary.meanCoverage.toFixed(3)} numbers=${summary.meanNumbers.toFixed(3)} xml_valid=${summary.xmlValidRate.toFixed(3)}`,
  );
}
