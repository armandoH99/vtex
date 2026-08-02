import type { CatalogDatabase } from "../db/connection.js";
import { normalizeBrand, normalizeName } from "../domain/normalize.js";
import { productMatchKey, type Product } from "../domain/types.js";

export class ProductRepository {
  constructor(private readonly db: CatalogDatabase) {}

  findAll(): Product[] {
    return this.db
      .prepare(`SELECT Id, Name, Brand, Category FROM Product`)
      .all() as Product[];
  }

  /**
   * Build a lookup map keyed by normalized (name + brand).
   * First product wins if the catalog already contains near-duplicates.
   */
  buildMatchIndex(): Map<string, Product> {
    const index = new Map<string, Product>();
    for (const product of this.findAll()) {
      const key = productMatchKey(
        normalizeName(product.Name),
        normalizeBrand(product.Brand)
      );
      if (!index.has(key)) {
        index.set(key, product);
      }
    }
    return index;
  }

  insert(
    name: string,
    brand: string | null,
    category: string | null
  ): Product {
    const result = this.db
      .prepare(
        `INSERT INTO Product (Name, Brand, Category) VALUES (?, ?, ?)`
      )
      .run(name, brand, category);

    return {
      Id: Number(result.lastInsertRowid),
      Name: name,
      Brand: brand,
      Category: category,
    };
  }
}
