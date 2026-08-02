# VTEX Catalog Consolidation

Take-home assessment for the VTEX AI Coding Interview: consolidate seller product catalogs into a marketplace SQLite catalog **without duplicating products**, while recording which sellers offer each item.

## Challenge summary

A store is becoming a marketplace. It already has a product catalog (`catalog.db`) and must ingest products from many sellers. The same physical item may appear with slight naming variations across sellers. The system must:

1. Accept a file of seller products (`ProductEntry.json`)
2. Insert **new** products into `Product`
3. On **duplicates**, skip inserting into `Product` and only link the seller in `SellerProduct`

> Demonstrating mastery of the problem matters more than a production-scale design. Ambiguities are intentional.

## Quick start

```bash
# Requirements: Node.js 20+
npm install

# Restore a clean working DB from the provided original (safe to re-run)
npm run reset-db

# Import seller products
npm run consolidate

# Or explicitly:
npm run consolidate -- --db data/catalog.db --input data/ProductEntry.json

# Preview against a temporary copy (source DB untouched)
npm run consolidate -- --dry-run

# Tests
npm test
```

### CLI options

| Flag | Description |
|------|-------------|
| `--db <path>` | Catalog SQLite path (default: `data/catalog.db`) |
| `--input <path>` | Seller products JSON array (default: `data/ProductEntry.json`) |
| `--dry-run` | Run on a temp copy; leaves `--db` unchanged |
| `--help` | Show usage |

## Project structure

```
data/
  catalog.db.original   # untouched copy of the provided SQLite DB
  catalog.db            # working DB (gitignored; recreate via cp)
  ProductEntry.json     # seller catalog input
src/
  index.ts              # CLI entrypoint
  db/connection.ts      # open DB + run migrations
  db/migrate.ts         # SellerProductId TEXT + unique indexes
  domain/normalize.ts   # string normalization for matching
  domain/types.ts       # shared types
  repositories/         # Product / SellerProduct data access
  services/consolidateCatalog.ts
tests/
  normalize.test.ts
  consolidateCatalog.test.ts
```

## Provided data

### `catalog.db` (original schema)

| Table | Columns |
|-------|---------|
| `Product` | `Id INTEGER PK`, `Name TEXT NOT NULL`, `Brand TEXT`, `Category TEXT` |
| `SellerProduct` | `Id INTEGER PK`, `SellerName TEXT`, `ProductId INTEGER FK → Product`, `SellerProductId INTEGER NOT NULL` |

- ~975 products preloaded
- `SellerProduct` starts empty

### `ProductEntry.json`

Source: [ProductEntry.json](https://engineering-hiring-process.s3.us-east-1.amazonaws.com/ProductEntry.json)

```json
{
  "Id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
  "SellerName": "MegaStore",
  "Name": "Smartphone Galaxy S23",
  "Brand": "Samsung",
  "Category": "Electronics"
}
```

- 269 entries, 20 sellers
- `Id` is a **UUID string** (seller-side product id)

## Decisions & intentional ambiguities

The assessment leaves several choices open. Below is what this solution assumes and why.

### 1. `SellerProductId` type mismatch → migrate to `TEXT`

The DB column is `INTEGER`, but input ids are UUIDs. Casting UUIDs to integers is lossy/invalid.

**Decision:** migrate `SellerProduct.SellerProductId` from `INTEGER` to `TEXT` (idempotent, on open). The challenge explicitly allows DB changes.

Also added:

- `UNIQUE (SellerName, ProductId)` — one link per seller per catalog product
- `UNIQUE (SellerName, SellerProductId)` — one link per seller-side sku
- Index on `Product (Name, Brand)` for inspection/debugging

### 2. What makes two products “the same”?

**Decision:** match on **normalized `Name` + `Brand`**.

`Category` is **not** part of identity. The dataset itself shows the same item under `Photo` vs `Photography`. Treating category as identity would incorrectly create duplicates.

### 3. “Slight variations”

Normalization (`src/domain/normalize.ts`):

- trim, lowercase, collapse whitespace
- strip combining accents (`Câmera` → `camera`)
- unify quote characters (`"`, `''`, curly quotes)
- remove remaining punctuation so `55"` and `55` / `12.9''` and `12.9` align

This is deterministic and easy to explain in the live interview. It is **not** fuzzy/ML matching (trade-off documented below).

### 4. Re-runs / idempotency

`INSERT OR IGNORE` against the unique indexes means re-importing the same file does not create duplicate links or explode the catalog.

### 5. Null brands in the seller file

A few entries ship `Brand: null`. The catalog schema already allows nullable `Brand`/`Category`, so those rows are accepted and matched with an empty normalized brand—not rejected.

### 6. SQL-looking fixture data

The input includes a brand like `TestBrand'; SELECT 1; --`. All writes use **parameterized** statements (`better-sqlite3` bound parameters). That value is stored as plain text, never concatenated into SQL.

### 7. Mastery over scale

Single CLI process, in-memory match index, one SQLite transaction. Clear domain boundaries (`normalize` → repositories → service → CLI). No HTTP API, queues, or microservices.

## Consolidation algorithm

```
open DB → migrate schema
load all Products → build Map[normalize(Name)+normalize(Brand) → Product]
for each seller entry (in one transaction):
  if invalid → count + skip
  key = normalize(Name) + normalize(Brand)
  if key missing:
    INSERT Product (original Name/Brand/Category from seller file)
    add to map
  else:
    count as matched (do NOT insert Product)
  INSERT OR IGNORE SellerProduct(SellerName, ProductId, SellerProductId=Id)
print summary
```

When a new product is created, we keep the **seller’s original spelling** for `Name`/`Brand`/`Category` (marketplace can refine canonical attributes later).

## Reference run (provided files)

Clean import (`cp data/catalog.db.original data/catalog.db` then `npm run consolidate`):

| Metric | First run | Second run |
|--------|-----------|------------|
| `totalEntries` | 269 | 269 |
| `productsMatched` | 265 | 269 |
| `productsCreated` | 4 | 0 |
| `linksCreated` | 257 | 0 |
| `linksSkipped` | 12 | 269 |
| `invalidEntries` | 0 | 0 |
| `Product` rows | 979 | 979 |
| `SellerProduct` rows | 257 | 257 |

`linksSkipped` on the first run is expected: the fixture reuses some seller `Id`s and repeats the same seller+product pair. Unique indexes keep the catalog clean. Null `Brand` values in the JSON are accepted (schema allows nullable brand).

Verify manually:

```bash
sqlite3 data/catalog.db "SELECT COUNT(*) FROM Product;"
sqlite3 data/catalog.db "SELECT COUNT(*) FROM SellerProduct;"
sqlite3 data/catalog.db "SELECT p.Name, sp.SellerName FROM SellerProduct sp JOIN Product p ON p.Id = sp.ProductId LIMIT 10;"
```

## Trade-offs / future evolution

| Topic | Current choice | Possible next step |
|-------|----------------|--------------------|
| Matching | Deterministic normalization | Token similarity / embeddings for harder variants |
| Canonical fields | First seller spelling wins for new rows | Separate “offer” attributes vs marketplace canonical product |
| Seller offers | Link only (name/brand/category) | Price, stock, seller-specific title on `SellerProduct` |
| Scale | Single SQLite file + CLI | Streaming ingest, batch jobs, Postgres |
| Identity | Name + Brand | External GTINs/EANs when available |

## Interview notes (sync phase)

### Hypotheses I would verbalize

- Seller `Id` is their SKU, not the marketplace product id
- Marketplace identity ≈ “same commercial product”, approximated by name + brand
- Category drift is noise for identity
- Schema bug (`INTEGER` vs UUID) is intentional, not something to ignore

### How AI was used

AI is allowed and encouraged. In this repo it helped scaffold structure, tests, and docs. Critical validation was done against the **real DB + JSON** (schema inspection, overlap analysis, edge cases like accents/quotes/SQL-looking brands). Be ready to explain every decision above without the assistant.

### Tips from the guideline doc

- Justify decisions and trade-offs
- Assume hypotheses out loud; ask to validate requirements
- Show awareness of limitations and how you’d evolve the design
- Live coding may extend this solution — keep the code easy to navigate

## Submission

1. Push this project to a **public** GitHub/GitLab repository
2. Reply to the assessment email with the repository URL
3. Deadline: **48 hours** from receipt of the challenge email

## License / confidentiality

Assessment materials are confidential per VTEX’s guideline document. This solution is intended for the hiring process only.
