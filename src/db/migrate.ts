import type Database from "better-sqlite3";

/**
 * Idempotent schema updates required for consolidation.
 *
 * The provided DB stores SellerProductId as INTEGER, but the seller catalog
 * uses UUID strings. Challenge allows DB changes when necessary.
 */
export function migrate(db: Database.Database): void {
  ensureSellerProductIdIsText(db);
  ensureProductGtinColumn(db);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_seller_product_seller_product
      ON SellerProduct (SellerName, ProductId);

    CREATE UNIQUE INDEX IF NOT EXISTS ux_seller_product_seller_external_id
      ON SellerProduct (SellerName, SellerProductId);

    CREATE INDEX IF NOT EXISTS ix_product_name_brand
      ON Product (Name, Brand);

    CREATE INDEX IF NOT EXISTS ix_product_name_brand_gtin
      ON Product (Name, Brand, GTIN);

    -- GTIN uniquely identifies a commercial product when present.
    CREATE UNIQUE INDEX IF NOT EXISTS ux_product_gtin
      ON Product (GTIN)
      WHERE GTIN IS NOT NULL AND GTIN != '';
  `);
}

function ensureProductGtinColumn(db: Database.Database): void {
  const columns = db
    .prepare(`PRAGMA table_info('Product')`)
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === "GTIN")) {
    return;
  }

  db.exec(`ALTER TABLE Product ADD COLUMN GTIN TEXT`);
}

function ensureSellerProductIdIsText(db: Database.Database): void {
  const columns = db
    .prepare(`PRAGMA table_info('SellerProduct')`)
    .all() as Array<{ name: string; type: string }>;

  const sellerProductId = columns.find((column) => column.name === "SellerProductId");
  if (!sellerProductId) {
    throw new Error("SellerProduct table is missing SellerProductId column");
  }

  if (sellerProductId.type.toUpperCase() === "TEXT") {
    return;
  }

  db.exec(`
    BEGIN;
    CREATE TABLE SellerProduct_new (
      Id INTEGER PRIMARY KEY AUTOINCREMENT,
      SellerName TEXT NOT NULL,
      ProductId INTEGER NOT NULL
        CONSTRAINT FK_Product_Id REFERENCES Product (Id),
      SellerProductId TEXT NOT NULL
    );
    INSERT INTO SellerProduct_new (Id, SellerName, ProductId, SellerProductId)
      SELECT Id, SellerName, ProductId, CAST(SellerProductId AS TEXT)
      FROM SellerProduct;
    DROP TABLE SellerProduct;
    ALTER TABLE SellerProduct_new RENAME TO SellerProduct;
    COMMIT;
  `);
}
