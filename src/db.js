// SQLite storage for Terrarium Manager.
// Uses Node's built-in `node:sqlite` (bundled with Electron), so there are no
// native modules to compile. Money is stored as integer cents to avoid
// floating-point rounding; phone numbers as digits only.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

const SCHEMA_VERSION = 5;

const MIGRATIONS = {
  1: `
    CREATE TABLE terrariums (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL,
      kind             TEXT,
      container        TEXT,
      plants           TEXT,
      made_on          TEXT,              -- YYYY-MM-DD
      cost_cents       INTEGER,           -- what the materials cost you
      price_cents      INTEGER,           -- asking price
      notes            TEXT,
      status           TEXT    NOT NULL DEFAULT 'available'
                               CHECK (status IN ('available', 'sold')),
      sold_on          TEXT,              -- YYYY-MM-DD
      sold_price_cents INTEGER,
      buyer            TEXT,
      sale_notes       TEXT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_terrariums_status  ON terrariums(status);
    CREATE INDEX idx_terrariums_sold_on ON terrariums(sold_on);

    CREATE TABLE photos (
      terrarium_id INTEGER PRIMARY KEY REFERENCES terrariums(id) ON DELETE CASCADE,
      mime         TEXT NOT NULL,
      data         BLOB NOT NULL,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `,

  // Buyers get their own table (name + phone), and each sale points at one.
  // Names typed on earlier sales become buyers, merging different capitalisations.
  2: `
    CREATE TABLE buyers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      phone      TEXT,                    -- digits only, e.g. 11987654321
      notes      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE terrariums ADD COLUMN buyer_id INTEGER REFERENCES buyers(id) ON DELETE SET NULL;

    INSERT INTO buyers (name)
      SELECT trim(buyer) FROM terrariums
      WHERE trim(coalesce(buyer, '')) <> ''
      GROUP BY lower(trim(buyer))
      ORDER BY min(sold_on);

    UPDATE terrariums
      SET buyer_id = (SELECT id FROM buyers WHERE lower(buyers.name) = lower(trim(terrariums.buyer)))
      WHERE trim(coalesce(buyer, '')) <> '';

    ALTER TABLE terrariums DROP COLUMN buyer;
    CREATE INDEX idx_terrariums_buyer ON terrariums(buyer_id);
  `,

  // A description written for clients (shown in the catalog), separate from private notes.
  3: `
    ALTER TABLE terrariums ADD COLUMN description TEXT;
  `,

  // Terrariums are described by size (e.g. Pequeno, Médio, Grande) instead of type.
  4: `
    ALTER TABLE terrariums ADD COLUMN size TEXT;
    ALTER TABLE terrariums DROP COLUMN kind;
  `,

  // Listing the terrariums no longer touches the photos table. It needed each photo's date,
  // which is stored after the photo's bytes, and SQLite reads through everything stored
  // before a column to reach it: every list read every photo in full. The date now lives on
  // the terrarium as `photo_version`. Thumbnails (the small copies shown in the app) get
  // their own table, so adding one never rewrites the photo.
  5: `
    ALTER TABLE terrariums ADD COLUMN photo_version TEXT; -- changes whenever the photo does; NULL without one
    UPDATE terrariums SET photo_version = (SELECT updated_at FROM photos WHERE terrarium_id = terrariums.id);

    CREATE TABLE thumbnails (
      terrarium_id INTEGER PRIMARY KEY REFERENCES photos(terrarium_id) ON DELETE CASCADE,
      data         BLOB NOT NULL          -- JPEG
    );
  `,
};

// Columns the renderer is allowed to write. Anything else is ignored.
// The sale's buyer is given as `buyer_name` + `buyer_phone` and resolved to `buyer_id`.
const EDITABLE = [
  'name', 'size', 'container', 'plants', 'made_on', 'cost_cents', 'price_cents', 'description', 'notes',
  'status', 'sold_on', 'sold_price_cents', 'buyer_id', 'sale_notes',
];

const LIST_COLUMNS = `
  t.id, t.name, t.size, t.container, t.plants, t.made_on, t.cost_cents, t.price_cents,
  t.description, t.notes, t.status, t.sold_on, t.sold_price_cents, t.sale_notes,
  t.buyer_id, b.name AS buyer, b.phone AS buyer_phone,
  t.created_at, t.updated_at, t.photo_version
`;
const LIST_FROM = `
  FROM terrariums t
  LEFT JOIN buyers b ON b.id = t.buyer_id
`;

class Store {
  // `makeThumbnail(bytes)` returns a small JPEG of a photo, or null if it can't.
  constructor(file, { backupDir, makeThumbnail } = {}) {
    this.file = file;
    this.backupDir = backupDir;
    this.makeThumbnail = makeThumbnail;
    this.open();
  }

  open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    // WAL with synchronous=NORMAL waits for the disk far less often when saving, which
    // matters on slow drives. The database stays consistent even if the power goes out.
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  migrate() {
    let version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 0 && version < SCHEMA_VERSION && this.backupDir) {
      // Keep a copy of the data as it was before the upgrade.
      fs.mkdirSync(this.backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.backupTo(path.join(this.backupDir, `before-upgrade-v${version}-${stamp}.db`));
    }
    while (version < SCHEMA_VERSION) {
      const next = version + 1;
      this.transaction(() => {
        this.db.exec(MIGRATIONS[next]);
        this.db.exec(`PRAGMA user_version = ${next}`);
      });
      version = next;
    }
  }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- terrariums -------------------------------------------------------

  list() {
    return this.db.prepare(`SELECT ${LIST_COLUMNS} ${LIST_FROM} ORDER BY t.id DESC`).all();
  }

  get(id) {
    return this.db.prepare(`SELECT ${LIST_COLUMNS} ${LIST_FROM} WHERE t.id = ?`).get(id);
  }

  create(data) {
    return this.transaction(() => {
      const row = clean(this.withBuyer(data));
      if (!row.name) throw new Error('O terrário precisa de um nome.');
      const cols = Object.keys(row);
      const result = this.db
        .prepare(`INSERT INTO terrariums (${cols.join(', ')}) VALUES (${cols.map((c) => ':' + c).join(', ')})`)
        .run(row);
      return this.get(Number(result.lastInsertRowid));
    });
  }

  update(id, data) {
    return this.transaction(() => {
      const row = clean(this.withBuyer(data));
      if ('name' in row && !row.name) throw new Error('O terrário precisa de um nome.');
      const cols = Object.keys(row);
      if (cols.length) {
        this.db
          .prepare(`UPDATE terrariums SET ${cols.map((c) => `${c} = :${c}`).join(', ')}, updated_at = datetime('now') WHERE id = :id`)
          .run({ ...row, id });
      }
      this.pruneBuyers();
      return this.get(id);
    });
  }

  sell(id, sale) {
    return this.update(id, {
      status: 'sold',
      sold_on: sale.sold_on,
      sold_price_cents: sale.sold_price_cents,
      buyer_name: sale.buyer_name,
      buyer_phone: sale.buyer_phone,
      sale_notes: sale.sale_notes,
    });
  }

  unsell(id) {
    return this.update(id, {
      status: 'available', sold_on: null, sold_price_cents: null, buyer_id: null, sale_notes: null,
    });
  }

  remove(id) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM terrariums WHERE id = ?').run(id);
      this.pruneBuyers();
    });
  }

  // ---- buyers -----------------------------------------------------------

  listBuyers() {
    return this.db.prepare('SELECT id, name, phone, notes, created_at FROM buyers ORDER BY name COLLATE NOCASE').all();
  }

  updateBuyer(id, data) {
    const name = tidyName(data.name);
    if (!name) throw new Error('O comprador precisa de um nome.');
    const clash = this.findBuyer(name);
    if (clash && clash.id !== id) throw new Error(`Já existe um comprador chamado “${clash.name}”.`);
    this.db.prepare(`
      UPDATE buyers SET name = ?, phone = ?, notes = ?, updated_at = datetime('now') WHERE id = ?
    `).run(name, digits(data.phone), data.notes?.trim() || null, id);
  }

  removeBuyer(id) {
    this.db.prepare('DELETE FROM buyers WHERE id = ?').run(id);
  }

  // Same person whatever the capitalisation or extra spaces.
  findBuyer(name) {
    const key = foldName(name);
    return this.db.prepare('SELECT id, name, phone FROM buyers').all().find((b) => foldName(b.name) === key);
  }

  // Turns `buyer_name` / `buyer_phone` into a `buyer_id`, creating the buyer if they're new.
  // A phone typed for an existing buyer replaces the one on file.
  withBuyer(data) {
    if (!('buyer_name' in data)) return data;
    const { buyer_name, buyer_phone, ...rest } = data;
    const name = tidyName(buyer_name);
    const phone = digits(buyer_phone);
    if (!name) {
      if (phone) throw new Error('Informe o nome do comprador.');
      return { ...rest, buyer_id: null };
    }
    const existing = this.findBuyer(name);
    if (existing) {
      if (phone && phone !== existing.phone) {
        this.db.prepare("UPDATE buyers SET phone = ?, updated_at = datetime('now') WHERE id = ?").run(phone, existing.id);
      }
      return { ...rest, buyer_id: existing.id };
    }
    const result = this.db.prepare('INSERT INTO buyers (name, phone) VALUES (?, ?)').run(name, phone);
    return { ...rest, buyer_id: Number(result.lastInsertRowid) };
  }

  // Drops buyers left with no purchases and nothing else on file (e.g. a misspelled name
  // that was corrected). Buyers with a phone or notes are kept.
  pruneBuyers() {
    this.db.exec(`
      DELETE FROM buyers
      WHERE phone IS NULL AND notes IS NULL
        AND id NOT IN (SELECT buyer_id FROM terrariums WHERE buyer_id IS NOT NULL)
    `);
  }

  // ---- photos -----------------------------------------------------------

  getPhoto(id) {
    return this.db.prepare('SELECT mime, data FROM photos WHERE terrarium_id = ?').get(id);
  }

  // The small copy of a photo that the app shows. Photos saved before thumbnails existed
  // get theirs the first time they're shown; if one can't be made, the photo itself is used.
  getThumbnail(id) {
    const thumb = this.db.prepare('SELECT data FROM thumbnails WHERE terrarium_id = ?').get(id);
    if (thumb) return { mime: 'image/jpeg', data: thumb.data };
    const photo = this.getPhoto(id);
    const data = photo && this.thumbnailOf(photo.data);
    if (!data) return photo;
    this.db.prepare('INSERT OR REPLACE INTO thumbnails (terrarium_id, data) VALUES (?, ?)').run(id, data);
    return { mime: 'image/jpeg', data };
  }

  thumbnailOf(bytes) {
    try {
      return this.makeThumbnail?.(bytes) ?? null;
    } catch (err) {
      console.error('Could not make a thumbnail:', err);
      return null;
    }
  }

  setPhoto(id, bytes, mime = 'image/jpeg') {
    this.transaction(() => {
      if (!bytes) {
        this.db.prepare('DELETE FROM photos WHERE terrarium_id = ?').run(id); // its thumbnail goes too
      } else {
        this.db.prepare(`
          INSERT INTO photos (terrarium_id, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(terrarium_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at
        `).run(id, mime, bytes);
        this.db.prepare('DELETE FROM thumbnails WHERE terrarium_id = ?').run(id);
        const thumb = this.thumbnailOf(bytes);
        if (thumb) this.db.prepare('INSERT INTO thumbnails (terrarium_id, data) VALUES (?, ?)').run(id, thumb);
      }
      // Milliseconds, so a photo replaced twice in the same second still gets a new version.
      this.db.prepare(`
        UPDATE terrariums SET photo_version = CASE WHEN ? THEN strftime('%Y-%m-%d %H:%M:%f', 'now') END WHERE id = ?
      `).run(bytes ? 1 : 0, id);
    });
    return this.get(id);
  }

  // ---- settings ---------------------------------------------------------

  getSettings() {
    const out = {};
    for (const { key, value } of this.db.prepare('SELECT key, value FROM settings').all()) out[key] = value;
    return out;
  }

  setSetting(key, value) {
    this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value == null ? null : String(value));
  }

  // ---- backups ----------------------------------------------------------

  // Writes a consistent, compacted copy of the database to `target`. The app waits while it
  // runs, so it's only used where it must finish first (before upgrading the database).
  backupTo(target) {
    if (fs.existsSync(target)) fs.rmSync(target);
    this.db.prepare('VACUUM INTO ?').run(target);
  }

  // Writes a consistent copy of the database to `target`, copying in the background so the
  // app keeps responding while a large database is copied. The copy is written under a
  // temporary name and renamed at the end, so an interrupted backup never looks finished.
  async backupInBackground(target) {
    const partial = `${target}.partial`;
    fs.rmSync(partial, { force: true });
    await backup(this.db, partial, { rate: 256 });
    // The copy comes out in WAL mode like the live database; make it one self-contained file.
    const copy = new DatabaseSync(partial);
    copy.exec('PRAGMA journal_mode = DELETE');
    copy.close();
    fs.rmSync(target, { force: true });
    fs.renameSync(partial, target);
  }

  // Replaces the live database with `source`, keeping a safety copy of the old one.
  async restoreFrom(source, safetyCopy) {
    Store.validate(source);
    await this.backupInBackground(safetyCopy);
    this.close();
    // Leftover WAL files belong to the old database and must not be applied to the new one.
    for (const suffix of ['-wal', '-shm']) fs.rmSync(this.file + suffix, { force: true });
    fs.copyFileSync(source, this.file);
    this.open();
  }

  static validate(file) {
    let probe;
    try {
      probe = new DatabaseSync(file, { readOnly: true });
      probe.prepare('SELECT id, name, status FROM terrariums LIMIT 1').all();
    } catch {
      throw new Error('Esse arquivo não é um backup do Terrarium Manager.');
    } finally {
      probe?.close();
    }
  }
}

function clean(data) {
  const row = {};
  for (const key of EDITABLE) {
    if (!(key in data)) continue;
    let value = data[key];
    if (typeof value === 'string') value = value.trim();
    if (value === '' || value === undefined) value = null;
    if (key.endsWith('_cents') && value !== null) {
      value = Math.round(Number(value));
      if (!Number.isFinite(value)) value = null;
    }
    row[key] = value;
  }
  return row;
}

const tidyName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ');
const foldName = (name) => tidyName(name).toLocaleLowerCase('pt-BR');
const digits = (phone) => String(phone ?? '').replace(/\D/g, '') || null;

module.exports = { Store };
