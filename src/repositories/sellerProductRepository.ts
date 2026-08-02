import type { CatalogDatabase } from "../db/connection.js";

export class SellerProductRepository {
  constructor(private readonly db: CatalogDatabase) {}

  /**
   * Insert a seller↔product link if it does not already exist.
   * Returns true when a new row was created.
   */
  linkIfAbsent(
    sellerName: string,
    productId: number,
    sellerProductId: string
  ): boolean {
    const result = this.db
      .prepare(
        `
        INSERT OR IGNORE INTO SellerProduct (SellerName, ProductId, SellerProductId)
        VALUES (?, ?, ?)
        `
      )
      .run(sellerName, productId, sellerProductId);

    return result.changes > 0;
  }

  count(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM SellerProduct`)
      .get() as { count: number };
    return row.count;
  }
}
