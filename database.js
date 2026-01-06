const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "fliss.sqlite");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function ensureUsersTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT,
      company TEXT,
      agencies TEXT
    )
  `);

  // Migration: add missing columns if the table existed from an older version
  const cols = await all(`PRAGMA table_info(users)`);
  const names = new Set(cols.map(c => c.name));

  if (!names.has("password_hash")) await run(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
  if (!names.has("role")) await run(`ALTER TABLE users ADD COLUMN role TEXT`);
  if (!names.has("company")) await run(`ALTER TABLE users ADD COLUMN company TEXT`);
  if (!names.has("agencies")) await run(`ALTER TABLE users ADD COLUMN agencies TEXT`);
}

async function ensureSalesTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      company TEXT,
      agency TEXT,
      seller TEXT,
      total_cents INTEGER,
      payload_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration safety for older schemas
  const cols = await all(`PRAGMA table_info(sales)`);
  const names = new Set(cols.map(c => c.name));

  if (!names.has("company")) await run(`ALTER TABLE sales ADD COLUMN company TEXT`);
  if (!names.has("agency")) await run(`ALTER TABLE sales ADD COLUMN agency TEXT`);
  if (!names.has("seller")) await run(`ALTER TABLE sales ADD COLUMN seller TEXT`);
  if (!names.has("total_cents")) await run(`ALTER TABLE sales ADD COLUMN total_cents INTEGER`);
  if (!names.has("payload_json")) await run(`ALTER TABLE sales ADD COLUMN payload_json TEXT`);
  if (!names.has("created_at")) await run(`ALTER TABLE sales ADD COLUMN created_at TEXT`);
}

async function initDB() {
  await ensureUsersTable();
  await ensureSalesTable();
}

module.exports = { db, run, get, all, initDB, DB_PATH };
