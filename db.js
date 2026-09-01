import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const db = new Database(process.env.DB_PATH || 'run.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS coin_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('earn','redeem','refund','adjustment')),
  description TEXT NOT NULL,
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_external_id ON coin_ledger(external_id) WHERE external_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS offer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_id INTEGER NOT NULL REFERENCES platforms(id),
  code TEXT NOT NULL UNIQUE,
  value_cents INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','assigned','cancelled')),
  assigned_user_id INTEGER REFERENCES users(id),
  assigned_at TEXT
);
CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  platform_id INTEGER NOT NULL REFERENCES platforms(id),
  coins_cost INTEGER NOT NULL,
  pin_id INTEGER REFERENCES pins(id),
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','sent','rejected')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  admin_note TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

for (let slot = 1; slot <= 5; slot += 1) {
  db.prepare('INSERT OR IGNORE INTO platforms(slot) VALUES (?)').run(slot);
}
function setDefault(key, value) {
  db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run(key, String(value));
}
setDefault('coins_per_dollar', process.env.COINS_PER_DOLLAR || 1000);
setDefault('redeem_threshold', process.env.REDEEM_THRESHOLD || 5000);

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const email = process.env.ADMIN_EMAIL.toLowerCase().trim();
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
  const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
  if (!existing) {
    db.prepare('INSERT INTO admins(email,password_hash) VALUES (?,?)').run(email, hash);
  } else {
    db.prepare('UPDATE admins SET password_hash=? WHERE email=?').run(hash, email);
  }
}

export default db;
