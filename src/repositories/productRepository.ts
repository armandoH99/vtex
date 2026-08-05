import type { CatalogDatabase } from "../db/connection.js";
import {
  normalizeBrand,
  normalizeGtin,
  normalizeName,
} from "../domain/normalize.js";
import { productMatchKey, type Product } from "../domain/types.js";

export interface ProductMatchIndex {
  /** Strong identity when GTIN is present. */
  byGtin: Map<string, Product>;
  /** Composite identity: normalized name + brand + GTIN. */
  byNameBrandGtin: Map<string, Product>;
}

export class ProductRepository {
  constructor(private readonly db: CatalogDatabase) {}

  findAll(): Product[] {
    return this.db
      .prepare(`SELECT Id, Name, Brand, Category, GTIN FROM Product`)
      .all() as Product[];
  }

  /**
   * Build lookup maps for consolidation matching.
   * First product wins if the catalog already contains near-duplicates.
   */
  buildMatchIndex(): ProductMatchIndex {
    const byGtin = new Map<string, Product>();
    const byNameBrandGtin = new Map<string, Product>();

    for (const product of this.findAll()) {
      const gtin = normalizeGtin(product.GTIN);
      const key = productMatchKey(
        normalizeName(product.Name),
        normalizeBrand(product.Brand),
        gtin
      );

      if (!byNameBrandGtin.has(key)) {
        byNameBrandGtin.set(key, product);
      }

      if (gtin && !byGtin.has(gtin)) {
        byGtin.set(gtin, product);
      }
    }

    return { byGtin, byNameBrandGtin };
  }

  insert(
    name: string,
    brand: string | null,
    category: string | null,
    gtin: string | null
  ): Product {
    const result = this.db
      .prepare(
        `INSERT INTO Product (Name, Brand, Category, GTIN) VALUES (?, ?, ?, ?)`
      )
      .run(name, brand, category, gtin);

    return {
      Id: Number(result.lastInsertRowid),
      Name: name,
      Brand: brand,
      Category: category,
      GTIN: gtin,
    };
  }

  /** Fill GTIN on a legacy row that was matched by name+brand only. */
  setGtinIfEmpty(productId: number, gtin: string): boolean {
    const result = this.db
      .prepare(
        `
        UPDATE Product
        SET GTIN = ?
        WHERE Id = ?
          AND (GTIN IS NULL OR GTIN = '')
        `
      )
      .run(gtin, productId);

    return result.changes > 0;
  }
}
