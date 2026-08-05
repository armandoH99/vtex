/**
 * Normalize product text for duplicate detection.
 *
 * Goals (aligned with intentional ambiguities in the dataset):
 * - case / whitespace differences should not create duplicates
 * - quote variants (`"`, `''`, curly quotes) should collapse
 * - accented characters should match unaccented ones (`Câmera` ≈ `Camera`)
 * - punctuation noise around the same product title should not split matches
 */
export function normalizeText(value: string | null | undefined): string {
  if (value == null) {
    return "";
  }

  let text = value.normalize("NFD").replace(/\p{M}/gu, "");

  text = text
    .replace(/[\u2018\u2019\u201A\u201B`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/''+/g, '"')
    .replace(/"+/g, '"')
    .replace(/'+/g, "'");

  text = text.toLowerCase().trim().replace(/\s+/g, " ");

  // Drop remaining punctuation so "55\"" and "55" / "12.9''" and "12.9" align.
  text = text.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  return text;
}

export function normalizeName(name: string | null | undefined): string {
  return normalizeText(name);
}

export function normalizeBrand(brand: string | null | undefined): string {
  return normalizeText(brand);
}

/**
 * Normalize GTIN / EAN / UPC codes for matching.
 * Keeps digits only so formatting differences ("789...", "789-...") collapse.
 */
export function normalizeGtin(value: string | null | undefined): string {
  if (value == null) {
    return "";
  }

  return String(value).trim().replace(/\D/g, "");
}
