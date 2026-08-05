import type { CatalogDatabase } from "../db/connection.js";
import {
  normalizeBrand,
  normalizeGtin,
  normalizeName,
} from "../domain/normalize.js";
import {
  productMatchKey,
  type ConsolidateSummary,
  type Product,
  type SellerProductEntry,
} from "../domain/types.js";
import {
  ProductRepository,
  type ProductMatchIndex,
} from "../repositories/productRepository.js";
import { SellerProductRepository } from "../repositories/sellerProductRepository.js";

export interface ConsolidateOptions {
  dryRun?: boolean;
}

function isValidEntry(entry: unknown): entry is SellerProductEntry {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const candidate = entry as Record<string, unknown>;
  const brandOk =
    candidate.Brand === null ||
    candidate.Brand === undefined ||
    typeof candidate.Brand === "string";
  const categoryOk =
    candidate.Category === null ||
    candidate.Category === undefined ||
    typeof candidate.Category === "string";
  const gtinOk =
    candidate.GTIN === null ||
    candidate.GTIN === undefined ||
    typeof candidate.GTIN === "string";

  return (
    typeof candidate.Id === "string" &&
    candidate.Id.trim().length > 0 &&
    typeof candidate.SellerName === "string" &&
    candidate.SellerName.trim().length > 0 &&
    typeof candidate.Name === "string" &&
    candidate.Name.trim().length > 0 &&
    brandOk &&
    categoryOk &&
    gtinOk
  );
}

/**
 * Resolve an existing catalog product for a seller entry.
 *
 * Priority:
 * 1. Exact GTIN match (unique commercial identity)
 * 2. Composite normalized Name + Brand + GTIN
 * 3. Legacy Name + Brand match when the catalog row has no GTIN yet
 *    (incoming GTIN can still attach to that product on create path only
 *    via the composite key; we treat it as the same commercial item)
 */
function findMatchingProduct(
  entry: SellerProductEntry,
  matchIndex: ProductMatchIndex
): Product | undefined {
  const gtin = normalizeGtin(entry.GTIN);
  const name = normalizeName(entry.Name);
  const brand = normalizeBrand(entry.Brand);

  if (gtin) {
    const byGtin = matchIndex.byGtin.get(gtin);
    if (byGtin) {
      return byGtin;
    }
  }

  const compositeKey = productMatchKey(name, brand, gtin);
  const byComposite = matchIndex.byNameBrandGtin.get(compositeKey);
  if (byComposite) {
    return byComposite;
  }

  // Same name+brand already in catalog without a GTIN: treat as the same product
  // so GTIN strengthens identity without splitting legacy rows.
  if (gtin) {
    const legacyKey = productMatchKey(name, brand, "");
    return matchIndex.byNameBrandGtin.get(legacyKey);
  }

  return undefined;
}

function rememberProduct(
  matchIndex: ProductMatchIndex,
  product: Product,
  name: string,
  brand: string,
  gtin: string
): void {
  const key = productMatchKey(name, brand, gtin);
  if (!matchIndex.byNameBrandGtin.has(key)) {
    matchIndex.byNameBrandGtin.set(key, product);
  }
  if (gtin && !matchIndex.byGtin.has(gtin)) {
    matchIndex.byGtin.set(gtin, product);
  }
}

/**
 * Consolidate seller catalog entries into the marketplace product catalog.
 *
 * Matching uses GTIN (when present) together with normalized Name + Brand so
 * name/brand alone cannot falsely collapse distinct commercial items.
 *
 * - Duplicate product: do not insert Product; only ensure the seller link exists.
 * - New product: insert Product (including GTIN), then link the seller.
 */
export function consolidateCatalog(
  db: CatalogDatabase,
  entries: unknown[],
  options: ConsolidateOptions = {}
): ConsolidateSummary {
  const productRepo = new ProductRepository(db);
  const sellerProductRepo = new SellerProductRepository(db);
  const matchIndex = productRepo.buildMatchIndex();

  const summary: ConsolidateSummary = {
    totalEntries: entries.length,
    productsCreated: 0,
    productsMatched: 0,
    linksCreated: 0,
    linksSkipped: 0,
    invalidEntries: 0,
  };

  const run = db.transaction(() => {
    for (const raw of entries) {
      if (!isValidEntry(raw)) {
        summary.invalidEntries += 1;
        continue;
      }

      const gtin = normalizeGtin(raw.GTIN);
      const normalizedName = normalizeName(raw.Name);
      const normalizedBrand = normalizeBrand(raw.Brand);
      const storedGtin = gtin.length > 0 ? gtin : null;

      let product = findMatchingProduct(raw, matchIndex);

      if (!product) {
        if (options.dryRun) {
          // Synthetic id for dry-run accounting only; nothing is persisted.
          product = {
            Id: -1 - summary.productsCreated,
            Name: raw.Name,
            Brand: raw.Brand,
            Category: raw.Category,
            GTIN: storedGtin,
          };
        } else {
          product = productRepo.insert(
            raw.Name,
            raw.Brand ?? "",
            raw.Category ?? "",
            storedGtin
          );
        }
        rememberProduct(
          matchIndex,
          product,
          normalizedName,
          normalizedBrand,
          gtin
        );
        summary.productsCreated += 1;
      } else {
        // Legacy catalog rows may lack GTIN; enrich when a seller provides one.
        if (
          storedGtin &&
          !normalizeGtin(product.GTIN) &&
          !options.dryRun
        ) {
          productRepo.setGtinIfEmpty(product.Id, storedGtin);
          product = { ...product, GTIN: storedGtin };
        }
        rememberProduct(
          matchIndex,
          product,
          normalizedName,
          normalizedBrand,
          normalizeGtin(product.GTIN) || gtin
        );
        summary.productsMatched += 1;
      }

      if (options.dryRun) {
        // Approximate: assume the link would be created for each valid entry.
        summary.linksCreated += 1;
        continue;
      }

      const linked = sellerProductRepo.linkIfAbsent(
        raw.SellerName,
        product.Id,
        raw.Id
      );

      if (linked) {
        summary.linksCreated += 1;
      } else {
        summary.linksSkipped += 1;
      }
    }
  });

  run();
  return summary;
}
