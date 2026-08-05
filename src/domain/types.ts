/** Product row as stored in the catalog database. */
export interface Product {
  Id: number;
  Name: string;
  Brand: string | null;
  Category: string | null;
  GTIN: string | null;
}

/** Seller ↔ product link row. */
export interface SellerProduct {
  Id: number;
  SellerName: string;
  ProductId: number;
  SellerProductId: string;
}

/**
 * One product offer coming from a seller catalog file.
 * `Id` is the seller's own product identifier (UUID in the provided dataset).
 * `GTIN` is the global trade item number when the seller provides one.
 */
export interface SellerProductEntry {
  Id: string;
  SellerName: string;
  Name: string;
  Brand: string | null;
  Category: string | null;
  GTIN?: string | null;
}

export interface ConsolidateSummary {
  totalEntries: number;
  productsCreated: number;
  productsMatched: number;
  linksCreated: number;
  linksSkipped: number;
  invalidEntries: number;
}

/** Composite identity: normalized name + brand + GTIN. */
export function productMatchKey(
  normalizedName: string,
  normalizedBrand: string,
  normalizedGtin: string
): string {
  return `${normalizedName}\0${normalizedBrand}\0${normalizedGtin}`;
}
