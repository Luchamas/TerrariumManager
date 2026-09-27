// SQLite storage for Terrarium Manager.
// Uses Node's built-in `node:sqlite` (bundled with Electron), so there are no
// native modules to compile. Money is stored as integer cents to avoid
// floating-point rounding; phone numbers as digits only.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

const SCHEMA_VERSION = 8;

// What became of a terrarium. `personal` (Acervo pessoal) stays on the shelf and can be sold,
// but is left out of the catalog. `sold`, `donated` and `lost` have left the shelf: `sold_on`
// is the day it left, `buyer_id` who got it (a buyer or a gift's recipient) and `sale_notes` why.
const STATUSES = ['available', 'personal', 'sold', 'donated', 'lost'];
const LEFT_SHELF = ['sold', 'donated', 'lost'];

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

  // Jars are bought in lots (several of the same jar from one purchase), and each terrarium
  // can say which lot its jar came from. How many jars are left is never stored: it's the
  // lot's quantity minus the terrariums made from it.
  // Terrariums also get more outcomes than sold: kept in the personal collection, given away,
  // or lost. SQLite can't change a CHECK constraint, so the table is rebuilt (with foreign
  // keys off, see migrate(), or dropping it would delete every photo).
  6: `
    CREATE TABLE jar_lots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      collection      TEXT,               -- e.g. Coleção 2, 5° Lote
      model           TEXT    NOT NULL,   -- e.g. Frasco boca larga
      capacity_ml     INTEGER,
      lid             TEXT,
      glass           TEXT,
      dimensions      TEXT,
      supplier        TEXT,
      bought_on       TEXT,               -- YYYY-MM-DD
      quantity        INTEGER NOT NULL CHECK (quantity > 0),
      unit_cost_cents INTEGER,            -- one jar
      lid_cost_cents  INTEGER,            -- one lid, when bought separately
      shipping_cents  INTEGER,            -- shipping for one jar
      price_cents     INTEGER,            -- suggested price of a terrarium in this jar
      description     TEXT,               -- suggested description for the catalog
      notes           TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE terrariums_new (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL,
      size             TEXT,
      container        TEXT,
      lot_id           INTEGER REFERENCES jar_lots(id) ON DELETE SET NULL,
      plants           TEXT,
      made_on          TEXT,              -- YYYY-MM-DD
      cost_cents       INTEGER,           -- what the materials cost you
      price_cents      INTEGER,           -- asking price
      description      TEXT,
      notes            TEXT,
      status           TEXT    NOT NULL DEFAULT 'available'
                               CHECK (status IN ('available', 'personal', 'sold', 'donated', 'lost')),
      sold_on          TEXT,              -- YYYY-MM-DD it left the shelf
      sold_price_cents INTEGER,
      buyer_id         INTEGER REFERENCES buyers(id) ON DELETE SET NULL,
      sale_notes       TEXT,
      photo_version    TEXT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO terrariums_new (
      id, name, size, container, plants, made_on, cost_cents, price_cents, description, notes,
      status, sold_on, sold_price_cents, buyer_id, sale_notes, photo_version, created_at, updated_at
    )
    SELECT
      id, name, size, container, plants, made_on, cost_cents, price_cents, description, notes,
      status, sold_on, sold_price_cents, buyer_id, sale_notes, photo_version, created_at, updated_at
    FROM terrariums;
    DROP TABLE terrariums;
    ALTER TABLE terrariums_new RENAME TO terrariums;

    CREATE INDEX idx_terrariums_status  ON terrariums(status);
    CREATE INDEX idx_terrariums_sold_on ON terrariums(sold_on);
    CREATE INDEX idx_terrariums_buyer   ON terrariums(buyer_id);
    CREATE INDEX idx_terrariums_lot     ON terrariums(lot_id);
  `,

  // Buyers get an Instagram, and a sale (or gift) records where it came from (`channel`, e.g.
  // Instagram, a fair, friends). The spreadsheet import used to keep both in the notes, as
  // "Instagram: …" and "Origem: …." lines: they move to the new fields.
  7: (db) => {
    db.exec(`
      ALTER TABLE buyers ADD COLUMN instagram TEXT;
      ALTER TABLE terrariums ADD COLUMN channel TEXT;
    `);
    moveNoteLine(db, 'buyers', 'notes', 'instagram', /^Instagram: (.+)$/);
    moveNoteLine(db, 'terrariums', 'sale_notes', 'channel', /^Origem: (.+?)\.?$/);
  },

  // A sale (or gift) records when it was delivered, which the spreadsheet import used to keep
  // in the notes as an "Entregue em dd/mm/aaaa." line.
  8: (db) => {
    db.exec('ALTER TABLE terrariums ADD COLUMN delivered_on TEXT; -- YYYY-MM-DD');
    moveNoteLine(db, 'terrariums', 'sale_notes', 'delivered_on', /^Entregue em (\d{2})\/(\d{2})\/(\d{4})\.?$/,
      (m) => `${m[3]}-${m[2]}-${m[1]}`);
  },
};

// Moves the first line of `notesColumn` matching `pattern` into `column` (its first group, or
// what `convert` makes of the match), leaving the other lines as the notes. Used by upgrades
// only: table and column names are fixed.
function moveNoteLine(db, table, notesColumn, column, pattern, convert = (m) => m[1].trim()) {
  const rows = db.prepare(`SELECT id, ${notesColumn} AS notes FROM ${table} WHERE ${notesColumn} IS NOT NULL`).all();
  const save = db.prepare(`UPDATE ${table} SET ${column} = ?, ${notesColumn} = ? WHERE id = ?`);
  for (const { id, notes } of rows) {
    const lines = notes.split('\n');
    const at = lines.findIndex((line) => pattern.test(line));
    if (at < 0) continue;
    const value = convert(pattern.exec(lines[at]));
    lines.splice(at, 1);
    save.run(value, lines.join('\n').trim() || null, id);
  }
}

// Columns the renderer is allowed to write. Anything else is ignored.
// The sale's buyer is given as `buyer_name` + `buyer_phone` + `buyer_instagram` and resolved to `buyer_id`.
const EDITABLE = [
  'name', 'size', 'container', 'lot_id', 'plants', 'made_on', 'cost_cents', 'price_cents', 'description', 'notes',
  'status', 'sold_on', 'sold_price_cents', 'buyer_id', 'channel', 'delivered_on', 'sale_notes',
];

const LOT_EDITABLE = [
  'collection', 'model', 'capacity_ml', 'lid', 'glass', 'dimensions', 'supplier', 'bought_on', 'quantity',
  'unit_cost_cents', 'lid_cost_cents', 'shipping_cents', 'price_cents', 'description', 'notes',
];

const LIST_COLUMNS = `
  t.id, t.name, t.size, t.container, t.lot_id, t.plants, t.made_on, t.cost_cents, t.price_cents,
  t.description, t.notes, t.status, t.sold_on, t.sold_price_cents, t.channel, t.delivered_on, t.sale_notes,
  t.buyer_id, b.name AS buyer, b.phone AS buyer_phone, b.instagram AS buyer_instagram,
  t.created_at, t.updated_at, t.photo_version
`;

const LOT_COLUMNS = `
  l.id, l.collection, l.model, l.capacity_ml, l.lid, l.glass, l.dimensions, l.supplier, l.bought_on,
  l.quantity, l.unit_cost_cents, l.lid_cost_cents, l.shipping_cents, l.price_cents, l.description, l.notes,
  (SELECT count(*) FROM terrariums t WHERE t.lot_id = l.id) AS used,
  l.created_at, l.updated_at
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
    if (version >= SCHEMA_VERSION) return;
    // Some upgrades rebuild a table (drop it and put a new copy in its place). With foreign
    // keys on, dropping `terrariums` would delete every photo along with it. The setting
    // can't change inside a transaction, so it's switched off around all the upgrades, and
    // each upgrade checks that every reference still points at a row before it's kept.
    this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      while (version < SCHEMA_VERSION) {
        const next = version + 1;
        this.transaction(() => {
          // An upgrade is SQL, or a function when it also has to rework the data.
          if (typeof MIGRATIONS[next] === 'function') MIGRATIONS[next](this.db);
          else this.db.exec(MIGRATIONS[next]);
          if (this.db.prepare('PRAGMA foreign_key_check').all().length) {
            throw new Error(`A atualização ${next} do banco de dados deixou referências quebradas.`);
          }
          this.db.exec(`PRAGMA user_version = ${next}`);
        });
        version = next;
      }
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON');
    }
  }

  // Runs `fn` so that everything it saves is kept, or nothing is. A transaction started
  // inside another one simply joins it (the spreadsheet import saves everything at once).
  transaction(fn) {
    if (this.inTransaction) return fn();
    this.db.exec('BEGIN');
    this.inTransaction = true;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.inTransaction = false;
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
      const row = outcomeFields(clean(this.withBuyer(data)));
      if (!row.name) throw new Error('O terrário precisa de um nome.');
      this.checkLot(row.lot_id, null);
      const cols = Object.keys(row);
      const result = this.db
        .prepare(`INSERT INTO terrariums (${cols.join(', ')}) VALUES (${cols.map((c) => ':' + c).join(', ')})`)
        .run(row);
      return this.get(Number(result.lastInsertRowid));
    });
  }

  update(id, data) {
    return this.transaction(() => {
      const row = outcomeFields(clean(this.withBuyer(data)));
      if ('name' in row && !row.name) throw new Error('O terrário precisa de um nome.');
      if ('lot_id' in row) this.checkLot(row.lot_id, id);
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

  // Takes a terrarium off the shelf: sold, given away (`donated`) or `lost` (died or broke).
  // A gift has a recipient but no price; a loss has neither.
  settle(id, outcome) {
    const status = outcome.status ?? 'sold';
    if (!LEFT_SHELF.includes(status)) throw new Error('Situação desconhecida.');
    return this.update(id, {
      status,
      sold_on: outcome.sold_on,
      sold_price_cents: outcome.sold_price_cents,
      ...(status === 'lost'
        ? { buyer_id: null }
        : { buyer_name: outcome.buyer_name, buyer_phone: outcome.buyer_phone, buyer_instagram: outcome.buyer_instagram }),
      channel: outcome.channel,
      delivered_on: outcome.delivered_on,
      sale_notes: outcome.sale_notes,
    });
  }

  // Each jar makes one terrarium: a lot with no jars left can't be picked, unless this
  // terrarium already uses it.
  checkLot(lotId, terrariumId) {
    if (lotId == null) return;
    const lot = this.getLot(lotId);
    if (!lot) throw new Error('Esse lote de frascos não existe mais.');
    const current = terrariumId == null
      ? null
      : this.db.prepare('SELECT lot_id FROM terrariums WHERE id = ?').get(terrariumId)?.lot_id;
    if (current !== lotId && lot.used >= lot.quantity) {
      throw new Error(`Não sobrou nenhum “${lot.model}” desse lote no estoque.`);
    }
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

  // ---- jar lots ---------------------------------------------------------

  listLots() {
    return this.db.prepare(`SELECT ${LOT_COLUMNS} FROM jar_lots l ORDER BY l.id DESC`).all();
  }

  getLot(id) {
    return this.db.prepare(`SELECT ${LOT_COLUMNS} FROM jar_lots l WHERE l.id = ?`).get(id);
  }

  // The jars of one purchase, one lot per kind of jar.
  createLots(items) {
    if (!items?.length) throw new Error('Adicione pelo menos um frasco à compra.');
    return this.transaction(() => items.map((item) => {
      const row = clean(item, LOT_EDITABLE);
      checkLotRow(row);
      const cols = Object.keys(row);
      const result = this.db
        .prepare(`INSERT INTO jar_lots (${cols.join(', ')}) VALUES (${cols.map((c) => ':' + c).join(', ')})`)
        .run(row);
      return this.getLot(Number(result.lastInsertRowid));
    }));
  }

  updateLot(id, data) {
    return this.transaction(() => {
      const row = clean(data, LOT_EDITABLE);
      checkLotRow(row);
      const used = this.getLot(id)?.used ?? 0;
      if ('quantity' in row && row.quantity < used) {
        throw new Error(`${used} frascos deste lote já viraram terrários: a quantidade não pode ser menor que ${used}.`);
      }
      const cols = Object.keys(row);
      if (cols.length) {
        this.db
          .prepare(`UPDATE jar_lots SET ${cols.map((c) => `${c} = :${c}`).join(', ')}, updated_at = datetime('now') WHERE id = :id`)
          .run({ ...row, id });
      }
      return this.getLot(id);
    });
  }

  // Terrariums made from the lot keep their Recipiente text and just lose the link.
  removeLot(id) {
    this.db.prepare('DELETE FROM jar_lots WHERE id = ?').run(id);
  }

  // ---- buyers -----------------------------------------------------------

  listBuyers() {
    return this.db.prepare('SELECT id, name, phone, instagram, notes, created_at FROM buyers ORDER BY name COLLATE NOCASE').all();
  }

  updateBuyer(id, data) {
    const name = tidyName(data.name);
    if (!name) throw new Error('O comprador precisa de um nome.');
    const clash = this.findBuyer(name);
    if (clash && clash.id !== id) throw new Error(`Já existe um comprador chamado “${clash.name}”.`);
    this.db.prepare(`
      UPDATE buyers SET name = ?, phone = ?, instagram = ?, notes = ?, updated_at = datetime('now') WHERE id = ?
    `).run(name, digits(data.phone), tidyInstagram(data.instagram), data.notes?.trim() || null, id);
  }

  removeBuyer(id) {
    this.db.prepare('DELETE FROM buyers WHERE id = ?').run(id);
  }

  // Same person whatever the capitalisation or extra spaces.
  findBuyer(name) {
    const key = foldName(name);
    return this.db.prepare('SELECT id, name, phone, instagram FROM buyers').all().find((b) => foldName(b.name) === key);
  }

  // Turns `buyer_name` / `buyer_phone` / `buyer_instagram` into a `buyer_id`, creating the
  // buyer if they're new. A phone or Instagram typed for an existing buyer replaces theirs.
  withBuyer(data) {
    if (!('buyer_name' in data)) return data;
    const { buyer_name, buyer_phone, buyer_instagram, ...rest } = data;
    const name = tidyName(buyer_name);
    const phone = digits(buyer_phone);
    const instagram = tidyInstagram(buyer_instagram);
    if (!name) {
      if (phone || instagram) throw new Error('Informe o nome do comprador.');
      return { ...rest, buyer_id: null };
    }
    const existing = this.findBuyer(name);
    if (existing) {
      if (phone && phone !== existing.phone) {
        this.db.prepare("UPDATE buyers SET phone = ?, updated_at = datetime('now') WHERE id = ?").run(phone, existing.id);
      }
      if (instagram && instagram !== existing.instagram) {
        this.db.prepare("UPDATE buyers SET instagram = ?, updated_at = datetime('now') WHERE id = ?").run(instagram, existing.id);
      }
      return { ...rest, buyer_id: existing.id };
    }
    const result = this.db.prepare('INSERT INTO buyers (name, phone, instagram) VALUES (?, ?, ?)').run(name, phone, instagram);
    return { ...rest, buyer_id: Number(result.lastInsertRowid) };
  }

  // Drops buyers left with no purchases and nothing else on file (e.g. a misspelled name
  // that was corrected). Buyers with a phone, an Instagram or notes are kept.
  pruneBuyers() {
    this.db.exec(`
      DELETE FROM buyers
      WHERE phone IS NULL AND instagram IS NULL AND notes IS NULL
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

// Columns holding whole numbers: money in cents, ids, millilitres and quantities.
const INTEGER_COLUMN = /(_cents|_id|_ml)$|^quantity$/;

function clean(data, columns = EDITABLE) {
  const row = {};
  for (const key of columns) {
    if (!(key in data)) continue;
    let value = data[key];
    if (typeof value === 'string') value = value.trim();
    if (value === '' || value === undefined) value = null;
    if (INTEGER_COLUMN.test(key) && value !== null) {
      value = Math.round(Number(value));
      if (!Number.isFinite(value)) value = null;
    }
    row[key] = value;
  }
  return row;
}

// Keeps a terrarium's sale fields in line with its status: nothing on the shelf has a sale,
// only a sale has a price, and a loss has no recipient, came from nowhere and wasn't delivered.
function outcomeFields(row) {
  if (!('status' in row)) return row;
  if (!STATUSES.includes(row.status)) throw new Error('Situação desconhecida.');
  if (!LEFT_SHELF.includes(row.status)) {
    return { ...row, sold_on: null, sold_price_cents: null, buyer_id: null, channel: null, delivered_on: null, sale_notes: null };
  }
  if (row.status === 'donated') return { ...row, sold_price_cents: null };
  if (row.status === 'lost') return { ...row, sold_price_cents: null, buyer_id: null, channel: null, delivered_on: null };
  return row;
}

function checkLotRow(row) {
  if ('model' in row && !row.model) throw new Error('Informe o modelo do frasco.');
  if ('quantity' in row && !(row.quantity > 0)) {
    throw new Error(`Informe quantos “${row.model ?? 'frascos'}” foram comprados.`);
  }
}

const tidyName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ');
const foldName = (name) => tidyName(name).toLocaleLowerCase('pt-BR');
const digits = (phone) => String(phone ?? '').replace(/\D/g, '') || null;

// "@beltaparo" or a pasted profile link like "instagram.com/beltaparo/" → "beltaparo";
// "@ana / @bia" → "ana / bia". A name is kept as typed.
function tidyInstagram(value) {
  let text = tidyName(value);
  const link = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([\w.]+)/i.exec(text);
  if (link) text = link[1];
  return text.split(/\s*[/,;]\s*/).map((part) => part.replace(/^@/, '')).filter(Boolean).join(' / ') || null;
}

module.exports = { Store };
