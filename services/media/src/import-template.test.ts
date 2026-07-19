import { describe, expect, it } from "vitest";
import { compileTemplate, parseFilename } from "./import-template";

describe("compileTemplate / parseFilename", () => {
  it("parses the default {date}_{code}_{n} template", () => {
    const compiled = compileTemplate("{date}_{code}_{n}");
    expect(parseFilename(compiled, "2026-03-05_AK_012")).toEqual({
      date: "2026-03-05",
      code: "AK",
      n: "012",
    });
  });

  it("accepts a compact YYYYMMDD date", () => {
    const compiled = compileTemplate("{date}_{code}_{n}");
    expect(parseFilename(compiled, "20260305_AK_012")).toEqual({
      date: "2026-03-05",
      code: "AK",
      n: "012",
    });
  });

  it("supports a template with a different token order and literal text", () => {
    const compiled = compileTemplate("VC_{code}-{n}_{date}");
    expect(parseFilename(compiled, "VC_JD-7_2026-03-05")).toEqual({
      code: "JD",
      n: "7",
      date: "2026-03-05",
    });
  });

  it("supports a template using only some tokens", () => {
    const compiled = compileTemplate("{code}_{n}");
    expect(parseFilename(compiled, "AK_042")).toEqual({ code: "AK", n: "042" });
  });

  it("returns null for a non-matching filename — caller still imports it", () => {
    const compiled = compileTemplate("{date}_{code}_{n}");
    expect(parseFilename(compiled, "random-holiday-photo")).toBeNull();
  });

  it("escapes regex-special characters in the template's literal parts", () => {
    const compiled = compileTemplate("IMG.{n}");
    expect(parseFilename(compiled, "IMG.042")).toEqual({ n: "042" });
    expect(parseFilename(compiled, "IMGX042")).toBeNull();
  });
});
