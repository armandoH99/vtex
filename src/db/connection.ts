import Database from "better-sqlite3";
import { migrate } from "./migrate.js";

export type CatalogDatabase = Database.Database;

export function openCatalogDatabase(dbPath: string): CatalogDatabase {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}
