import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { consolidateCatalog } from "../src/services/consolidateCatalog.js";

const tempDirs: string[] = [];

function createTestDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), "catalog-test-"));
  tempDirs.push(dir);
  const db = new Database(join(dir, "test.db"));
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE Product (
      Id INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL,
      Brand TEXT,
      Category TEXT
    );
    CREATE TABLE SellerProduct (
      Id INTEGER PRIMARY KEY AUTOINCREMENT,
      SellerName TEXT NOT NULL,
      ProductId INTEGER NOT NULL
        CONSTRAINT FK_Product_Id REFERENCES Product (Id),
      SellerProductId INTEGER NOT NULL
    );
  `);
  migrate(db);
  return db;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("consolidateCatalog", () => {
  it("links an existing product without inserting a duplicate", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO Product (Name, Brand, Category) VALUES (?, ?, ?)`
    ).run("Smartphone Galaxy S23", "Samsung", "Electronics");

    const summary = consolidateCatalog(db, [
      {
        Id: "seller-sku-1",
        SellerName: "MegaStore",
        Name: "Smartphone Galaxy S23",
        Brand: "Samsung",
        Category: "Electronics",
      },
    ]);

    const products = db.prepare(`SELECT COUNT(*) AS c FROM Product`).get() as { c: number };
    const links = db.prepare(`SELECT * FROM SellerProduct`).all() as Array<{
      SellerName: string;
      ProductId: number;
      SellerProductId: string;
    }>;

    expect(summary.productsCreated).toBe(0);
    expect(summary.productsMatched).toBe(1);
    expect(summary.linksCreated).toBe(1);
    expect(products.c).toBe(1);
    expect(links).toHaveLength(1);
    expect(links[0]?.SellerName).toBe("MegaStore");
    expect(links[0]?.SellerProductId).toBe("seller-sku-1");
    db.close();
  });

  it("creates a new product when no match exists", () => {
    const db = createTestDb();

    const summary = consolidateCatalog(db, [
      {
        Id: "new-1",
        SellerName: "TechWorld",
        Name: "Brand New Gadget",
        Brand: "Acme",
        Category: "Gadgets",
      },
    ]);

    const product = db
      .prepare(`SELECT Name, Brand, Category FROM Product`)
      .get() as { Name: string; Brand: string; Category: string };

    expect(summary.productsCreated).toBe(1);
    expect(summary.linksCreated).toBe(1);
    expect(product.Name).toBe("Brand New Gadget");
    expect(product.Brand).toBe("Acme");
    db.close();
  });

  it("matches slight name variations via normalization", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO Product (Name, Brand, Category) VALUES (?, ?, ?)`
    ).run('Smart TV Samsung 55"', "Samsung", "Electronics");

    const summary = consolidateCatalog(db, [
      {
        Id: "tv-1",
        SellerName: "ElectroHub",
        Name: "Smart TV Samsung 55",
        Brand: "Samsung",
        Category: "Electronics",
      },
      {
        Id: "cam-1",
        SellerName: "PhotoShop",
        Name: "Câmera Canon EOS R6",
        Brand: "Canon",
        Category: "Photography",
      },
    ]);

    // First matches existing; second is new (no Canon in DB).
    expect(summary.productsMatched).toBe(1);
    expect(summary.productsCreated).toBe(1);
    expect(summary.linksCreated).toBe(2);

    const productCount = db.prepare(`SELECT COUNT(*) AS c FROM Product`).get() as {
      c: number;
    };
    expect(productCount.c).toBe(2);
    db.close();
  });

  it("is idempotent when the same seller link is imported twice", () => {
    const db = createTestDb();
    const entry = {
      Id: "sku-42",
      SellerName: "MegaStore",
      Name: "Mouse Logitech MX Master",
      Brand: "Logitech",
      Category: "Accessories",
    };

    const first = consolidateCatalog(db, [entry]);
    const second = consolidateCatalog(db, [entry]);

    expect(first.productsCreated).toBe(1);
    expect(first.linksCreated).toBe(1);
    expect(second.productsCreated).toBe(0);
    expect(second.productsMatched).toBe(1);
    expect(second.linksCreated).toBe(0);
    expect(second.linksSkipped).toBe(1);

    const links = db.prepare(`SELECT COUNT(*) AS c FROM SellerProduct`).get() as {
      c: number;
    };
    expect(links.c).toBe(1);
    db.close();
  });

  it("links multiple sellers to the same product", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO Product (Name, Brand, Category) VALUES (?, ?, ?)`
    ).run("Headphones Sony WH-1000XM5", "Sony", "Audio");

    const summary = consolidateCatalog(db, [
      {
        Id: "a",
        SellerName: "FurnitureWorld",
        Name: "Headphones Sony WH-1000XM5",
        Brand: "Sony",
        Category: "Audio",
      },
      {
        Id: "b",
        SellerName: "OfficeSupply",
        Name: "Headphones Sony WH-1000XM5",
        Brand: "Sony",
        Category: "Audio",
      },
    ]);

    expect(summary.productsCreated).toBe(0);
    expect(summary.productsMatched).toBe(2);
    expect(summary.linksCreated).toBe(2);

    const productCount = db.prepare(`SELECT COUNT(*) AS c FROM Product`).get() as {
      c: number;
    };
    const linkCount = db.prepare(`SELECT COUNT(*) AS c FROM SellerProduct`).get() as {
      c: number;
    };
    expect(productCount.c).toBe(1);
    expect(linkCount.c).toBe(2);
    db.close();
  });

  it("stores SQL-looking brand text safely via parameterized inserts", () => {
    const db = createTestDb();
    const maliciousBrand = "TestBrand'; SELECT 1; --";

    const summary = consolidateCatalog(db, [
      {
        Id: "inject-1",
        SellerName: "SecurityStore",
        Name: "Security Test Product",
        Brand: maliciousBrand,
        Category: "Electronics",
      },
    ]);

    expect(summary.productsCreated).toBe(1);
    expect(summary.invalidEntries).toBe(0);

    const product = db
      .prepare(`SELECT Brand FROM Product WHERE Name = ?`)
      .get("Security Test Product") as { Brand: string };

    expect(product.Brand).toBe(maliciousBrand);

    // Catalog tables must still exist (injection did not execute as SQL).
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('Product', 'SellerProduct')`
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual(["Product", "SellerProduct"]);
    db.close();
  });

  it("migrates SellerProductId from INTEGER to TEXT", () => {
    const db = createTestDb();
    const columns = db.prepare(`PRAGMA table_info('SellerProduct')`).all() as Array<{
      name: string;
      type: string;
    }>;
    const sellerProductId = columns.find((c) => c.name === "SellerProductId");
    expect(sellerProductId?.type.toUpperCase()).toBe("TEXT");
    db.close();
  });

  it("counts invalid entries without failing the batch", () => {
    const db = createTestDb();
    const summary = consolidateCatalog(db, [
      { Id: "", SellerName: "X", Name: "Y", Brand: "Z", Category: "C" },
      null,
      {
        Id: "ok",
        SellerName: "MegaStore",
        Name: "Valid Product",
        Brand: "Brand",
        Category: "Cat",
      },
    ]);

    expect(summary.invalidEntries).toBe(2);
    expect(summary.productsCreated).toBe(1);
    expect(summary.linksCreated).toBe(1);
    db.close();
  });

  it("accepts null brand/category (nullable in the catalog schema)", () => {
    const db = createTestDb();
    const summary = consolidateCatalog(db, [
      {
        Id: "null-brand-1",
        SellerName: "SportsHub",
        Name: "Cable Organizer Kit",
        Brand: null,
        Category: "Accessories",
      },
    ]);

    expect(summary.invalidEntries).toBe(0);
    expect(summary.productsCreated).toBe(1);
    expect(summary.linksCreated).toBe(1);

    const product = db
      .prepare(`SELECT Brand, Category FROM Product WHERE Name = ?`)
      .get("Cable Organizer Kit") as { Brand: string | null; Category: string };
    expect(product.Brand).toBe("");
    expect(product.Category).toBe("Accessories");
    db.close();
  });

  it("matches by GTIN even when the seller name spelling differs", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO Product (Name, Brand, Category, GTIN) VALUES (?, ?, ?, ?)`
    ).run("Smartphone Galaxy S23", "Samsung", "Electronics", "7891234567890");

    const summary = consolidateCatalog(db, [
      {
        Id: "gtin-match-1",
        SellerName: "MegaStore",
        Name: "Galaxy S23 Smartphone",
        Brand: "Samsung",
        Category: "Electronics",
        GTIN: "789-1234-567890",
      },
    ]);

    const products = db.prepare(`SELECT COUNT(*) AS c FROM Product`).get() as {
      c: number;
    };

    expect(summary.productsCreated).toBe(0);
    expect(summary.productsMatched).toBe(1);
    expect(summary.linksCreated).toBe(1);
    expect(products.c).toBe(1);
    db.close();
  });

  it("keeps same name+brand as distinct products when GTINs differ", () => {
    const db = createTestDb();

    const summary = consolidateCatalog(db, [
      {
        Id: "pack-1",
        SellerName: "MegaStore",
        Name: "Mineral Water 500ml",
        Brand: "AquaCo",
        Category: "Beverages",
        GTIN: "1111111111111",
      },
      {
        Id: "pack-2",
        SellerName: "TechWorld",
        Name: "Mineral Water 500ml",
        Brand: "AquaCo",
        Category: "Beverages",
        GTIN: "2222222222222",
      },
    ]);

    const products = db
      .prepare(`SELECT Name, Brand, GTIN FROM Product ORDER BY GTIN`)
      .all() as Array<{ Name: string; Brand: string; GTIN: string }>;

    expect(summary.productsCreated).toBe(2);
    expect(summary.productsMatched).toBe(0);
    expect(products).toHaveLength(2);
    expect(products.map((p) => p.GTIN)).toEqual([
      "1111111111111",
      "2222222222222",
    ]);
    db.close();
  });

  it("matches legacy name+brand rows when incoming entry adds a GTIN", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO Product (Name, Brand, Category) VALUES (?, ?, ?)`
    ).run("Mouse Logitech MX Master", "Logitech", "Accessories");

    const summary = consolidateCatalog(db, [
      {
        Id: "legacy-gtin-1",
        SellerName: "SuperMart",
        Name: "Mouse Logitech MX Master",
        Brand: "Logitech",
        Category: "Accessories",
        GTIN: "3333333333333",
      },
    ]);

    const products = db
      .prepare(`SELECT COUNT(*) AS c FROM Product`)
      .get() as { c: number };
    const product = db
      .prepare(`SELECT GTIN FROM Product WHERE Name = ?`)
      .get("Mouse Logitech MX Master") as { GTIN: string };

    expect(summary.productsCreated).toBe(0);
    expect(summary.productsMatched).toBe(1);
    expect(summary.linksCreated).toBe(1);
    expect(products.c).toBe(1);
    expect(product.GTIN).toBe("3333333333333");
    db.close();
  });

  it("stores GTIN on newly created products", () => {
    const db = createTestDb();

    consolidateCatalog(db, [
      {
        Id: "new-gtin-1",
        SellerName: "GadgetZone",
        Name: "Brand New Gadget",
        Brand: "Acme",
        Category: "Gadgets",
        GTIN: "4444444444444",
      },
    ]);

    const product = db
      .prepare(`SELECT Name, GTIN FROM Product`)
      .get() as { Name: string; GTIN: string };

    expect(product.Name).toBe("Brand New Gadget");
    expect(product.GTIN).toBe("4444444444444");
    db.close();
  });

  it("migrates Product.GTIN column onto legacy schemas", () => {
    const db = createTestDb();
    const columns = db.prepare(`PRAGMA table_info('Product')`).all() as Array<{
      name: string;
    }>;
    expect(columns.some((c) => c.name === "GTIN")).toBe(true);
    db.close();
  });
});
