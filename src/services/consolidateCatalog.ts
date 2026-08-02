import type { CatalogDatabase } from "../db/connection.js";
import { normalizeBrand, normalizeName } from "../domain/normalize.js";
import {
  productMatchKey,
  type ConsolidateSummary,
  type SellerProductEntry,
} from "../domain/types.js";
import { ProductRepository } from "../repositories/productRepository.js";
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

  return (
    typeof candidate.Id === "string" &&
    candidate.Id.trim().length > 0 &&
    typeof candidate.SellerName === "string" &&
    candidate.SellerName.trim().length > 0 &&
    typeof candidate.Name === "string" &&
    candidate.Name.trim().length > 0 &&
    brandOk &&
    categoryOk
  );
}

/**
 * Consolidate seller catalog entries into the marketplace product catalog.
 *
 * - Duplicate product (same normalized Name + Brand): do not insert Product;
 *   only ensure the seller link exists.
 * - New product: insert Product, then link the seller.
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

      const key = productMatchKey(
        normalizeName(raw.Name),
        normalizeBrand(raw.Brand)
      );

      let product = matchIndex.get(key);

      if (!product) {
        if (options.dryRun) {
          // Synthetic id for dry-run accounting only; nothing is persisted.
          product = {
            Id: -1 - summary.productsCreated,
            Name: raw.Name,
            Brand: raw.Brand,
            Category: raw.Category,
          };
        } else {
          product = productRepo.insert(
            raw.Name,
            raw.Brand ?? "",
            raw.Category ?? ""
          );
        }
        matchIndex.set(key, product);
        summary.productsCreated += 1;
      } else {
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
