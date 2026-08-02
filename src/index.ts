#!/usr/bin/env node
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openCatalogDatabase } from "./db/connection.js";
import { consolidateCatalog } from "./services/consolidateCatalog.js";

interface CliArgs {
  db: string;
  input: string;
  dryRun: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Catalog Consolidation — import seller products into the marketplace catalog.

Usage:
  npm run consolidate -- --db <path> --input <path> [--dry-run]

Options:
  --db <path>       Path to catalog SQLite database (default: data/catalog.db)
  --input <path>    Path to seller products JSON array (default: data/ProductEntry.json)
  --dry-run         Run matching/accounting on a temporary DB copy (no writes to --db)
  --help            Show this help
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    db: "data/catalog.db",
    input: "data/ProductEntry.json",
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--db") {
      args.db = argv[++i] ?? args.db;
    } else if (arg === "--input") {
      args.input = argv[++i] ?? args.input;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const dbPath = resolve(args.db);
  const inputPath = resolve(args.input);

  const raw = readFileSync(inputPath, "utf8");
  const entries = JSON.parse(raw) as unknown;
  if (!Array.isArray(entries)) {
    throw new Error("Input file must contain a JSON array of seller products");
  }

  let workingDbPath = dbPath;
  let tempDir: string | undefined;

  if (args.dryRun) {
    tempDir = mkdtempSync(join(tmpdir(), "catalog-consolidate-"));
    workingDbPath = join(tempDir, "catalog.db");
    copyFileSync(dbPath, workingDbPath);
    console.log("Running in dry-run mode on a temporary DB copy (source DB untouched).");
  }

  const db = openCatalogDatabase(workingDbPath);

  try {
    // Dry-run uses a temp DB copy, so we can execute the real write path there
    // and still leave the source database untouched.
    const summary = consolidateCatalog(db, entries, { dryRun: false });
    console.log("Consolidation finished.");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    db.close();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Unexpected error during consolidation"
  );
  process.exitCode = 1;
}
