import { describe, expect, it } from "vitest";
import { normalizeBrand, normalizeName, normalizeText } from "../src/domain/normalize.js";

describe("normalizeText", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeText("  Smart  Phone  ")).toBe("smart phone");
  });

  it("strips accents so Portuguese variants match", () => {
    expect(normalizeName("Câmera Canon EOS R6")).toBe(normalizeName("Camera Canon EOS R6"));
  });

  it("normalizes quote variants around model sizes", () => {
    expect(normalizeName('Smart TV Samsung 55"')).toBe(normalizeName("Smart TV Samsung 55"));
    expect(normalizeName("Tablet iPad Pro 12.9''")).toBe(normalizeName("Tablet iPad Pro 12.9"));
  });

  it("treats nullish values as empty", () => {
    expect(normalizeBrand(null)).toBe("");
    expect(normalizeBrand(undefined)).toBe("");
  });

  it("keeps SQL-looking brand text as plain data after normalization", () => {
    expect(normalizeBrand("TestBrand'; SELECT 1; --")).toBe("testbrand select 1");
  });
});
