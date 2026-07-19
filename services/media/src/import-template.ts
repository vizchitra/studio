/**
 * Compiles a bulk-import filename template (e.g. "{date}_{code}_{n}",
 * issue #45) into a matcher against a filename (extension already
 * stripped). Conventions differ by photographer and year, so the
 * template is configurable per import batch rather than hardcoded here —
 * this module only knows the recognized token set, not any one
 * convention.
 */

const TOKEN_PATTERNS: Record<string, string> = {
  // YYYYMMDD or YYYY-MM-DD — normalized to YYYY-MM-DD in the result.
  date: "(\\d{4})-?(\\d{2})-?(\\d{2})",
  code: "([A-Za-z]+)",
  n: "(\\d+)",
};

const TOKEN_ORDER = ["date", "code", "n"] as const;
type Token = (typeof TOKEN_ORDER)[number];

export interface CompiledTemplate {
  regex: RegExp;
  tokens: Token[];
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileTemplate(template: string): CompiledTemplate {
  const tokens: Token[] = [];
  let pattern = "^";
  let cursor = 0;
  const tokenRegex = /\{(date|code|n)\}/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(template))) {
    pattern += escapeRegExp(template.slice(cursor, match.index));
    const token = match[1] as Token;
    pattern += TOKEN_PATTERNS[token];
    tokens.push(token);
    cursor = tokenRegex.lastIndex;
  }
  pattern += escapeRegExp(template.slice(cursor)) + "$";

  return { regex: new RegExp(pattern), tokens };
}

export interface ParsedFilename {
  date?: string; // YYYY-MM-DD
  code?: string;
  n?: string;
}

// Matches `basename` (no extension) against the compiled template. Returns
// null on no match — the caller still imports the file, just without
// derived metadata (issue #45: "non-matching filenames still import").
export function parseFilename(compiled: CompiledTemplate, basename: string): ParsedFilename | null {
  const match = compiled.regex.exec(basename);
  if (!match) return null;

  const result: ParsedFilename = {};
  let groupIndex = 1;
  for (const token of compiled.tokens) {
    if (token === "date") {
      result.date = `${match[groupIndex]}-${match[groupIndex + 1]}-${match[groupIndex + 2]}`;
      groupIndex += 3;
    } else {
      result[token] = match[groupIndex];
      groupIndex += 1;
    }
  }
  return result;
}
