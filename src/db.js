// Camada de dados com duas opções:
// - Postgres (produção / Render): usada quando DATABASE_URL está definida.
// - Arquivo JSON (desenvolvimento local): data/db.json, sem instalar nada.
const fs = require("fs");
const path = require("path");

const CATEGORIES = ["roupas", "beleza", "eletronicos", "casa", "outros"];
const COUNTRIES = ["us", "ca"];

function cleanItem(input) {
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const category = CATEGORIES.includes(input.category) ? input.category : "outros";
  return {
    name: str(input.name, 120),
    model: str(input.model, 120),
    variant: str(input.variant, 80),
    category,
    note: str(input.note, 200),
    official_store: str(input.official_store, 60),
    image_url: typeof input.image_url === "string" && /^https?:\/\//i.test(input.image_url.trim()) ? input.image_url.trim().slice(0, 1000) : "",
  };
}

function cleanPriceRow(row) {
  const store = typeof row.store === "string" ? row.store.trim().slice(0, 60) : "";
  const n = row.price === "" || row.price == null ? null : Number(row.price);
  const price = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  const url = typeof row.url === "string" && /^https?:\/\//i.test(row.url.trim()) ? row.url.trim().slice(0, 1000) : "";
  return { store, price, url };
}

/* ---------------- JSON (local) ---------------- */
function jsonStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let state = { nextId: 1, items: [], prices: [], settings: {} };
  if (fs.existsSync(file)) state = JSON.parse(fs.readFileSync(file, "utf8"));
  const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 2));
  const now = () => new Date().toISOString();

  return {
    kind: "json",
    async init() {},
    async listItems() {
      return state.items
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(it => ({
          ...it,
          prices: Object.fromEntries(COUNTRIES.map(c => [c, state.prices.filter(p => p.item_id === it.id && p.country === c)])),
        }));
    },
    async getItem(id) {
      return state.items.find(i => i.id === id) || null;
    },
    async createItem(data) {
      const item = { id: state.nextId++, ...cleanItem(data), created_at: now(), prices_checked_at: null };
      state.items.push(item);
      save();
      return item;
    },
    async updateItem(id, data) {
      const item = state.items.find(i => i.id === id);
      if (!item) return null;
      Object.assign(item, cleanItem({ ...item, ...data }));
      save();
      return item;
    },
    async deleteItem(id) {
      state.items = state.items.filter(i => i.id !== id);
      state.prices = state.prices.filter(p => p.item_id !== id);
      save();
    },
    async upsertPrice(itemId, country, row, source) {
      const r = cleanPriceRow(row);
      if (!r.store) return;
      const existing = state.prices.find(p => p.item_id === itemId && p.country === country && p.store === r.store);
      if (existing) {
        if (existing.price !== r.price) existing.previous_price = existing.price;
        Object.assign(existing, { price: r.price, url: r.url || existing.url, source, updated_at: now() });
      } else {
        state.prices.push({ item_id: itemId, country, ...r, previous_price: null, source, updated_at: now() });
      }
      save();
    },
    async deletePrice(itemId, country, store) {
      state.prices = state.prices.filter(p => !(p.item_id === itemId && p.country === country && p.store === store));
      save();
    },
    async markChecked(itemId) {
      const item = state.items.find(i => i.id === itemId);
      if (item) { item.prices_checked_at = now(); save(); }
    },
    async markSearched(itemId, found) {
      const item = state.items.find(i => i.id === itemId);
      if (item) { item.searched_at = now(); item.search_found = found; save(); }
    },
    async getSetting(key) {
      return state.settings[key] ?? null;
    },
    async setSetting(key, value) {
      state.settings[key] = value;
      save();
    },
  };
}

/* ---------------- Postgres (Render) ---------------- */
function pgStore(url) {
  const { Pool } = require("pg");
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
  const q = (text, params) => pool.query(text, params);

  return {
    kind: "postgres",
    async init() {
      await q(`
        CREATE TABLE IF NOT EXISTS items (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          model TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'outros',
          note TEXT NOT NULL DEFAULT '',
          official_store TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          prices_checked_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS prices (
          item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          country TEXT NOT NULL,
          store TEXT NOT NULL,
          price NUMERIC(10,2),
          previous_price NUMERIC(10,2),
          url TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (item_id, country, store)
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value JSONB
        );
        ALTER TABLE items ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
        ALTER TABLE items ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT '';
        ALTER TABLE items ADD COLUMN IF NOT EXISTS searched_at TIMESTAMPTZ;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS search_found INTEGER;
      `);
    },
    async listItems() {
      const items = (await q(`SELECT * FROM items ORDER BY created_at DESC`)).rows;
      const prices = (await q(`SELECT * FROM prices`)).rows.map(p => ({
        ...p,
        price: p.price == null ? null : Number(p.price),
        previous_price: p.previous_price == null ? null : Number(p.previous_price),
      }));
      return items.map(it => ({
        ...it,
        prices: Object.fromEntries(COUNTRIES.map(c => [c, prices.filter(p => p.item_id === it.id && p.country === c)])),
      }));
    },
    async getItem(id) {
      return (await q(`SELECT * FROM items WHERE id = $1`, [id])).rows[0] || null;
    },
    async createItem(data) {
      const d = cleanItem(data);
      return (await q(
        `INSERT INTO items (name, model, category, note, official_store, image_url, variant) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [d.name, d.model, d.category, d.note, d.official_store, d.image_url, d.variant]
      )).rows[0];
    },
    async updateItem(id, data) {
      const current = await this.getItem(id);
      if (!current) return null;
      const d = cleanItem({ ...current, ...data });
      return (await q(
        `UPDATE items SET name=$2, model=$3, category=$4, note=$5, official_store=$6, image_url=$7, variant=$8 WHERE id=$1 RETURNING *`,
        [id, d.name, d.model, d.category, d.note, d.official_store, d.image_url, d.variant]
      )).rows[0];
    },
    async deleteItem(id) {
      await q(`DELETE FROM items WHERE id = $1`, [id]);
    },
    async upsertPrice(itemId, country, row, source) {
      const r = cleanPriceRow(row);
      if (!r.store) return;
      await q(
        `INSERT INTO prices (item_id, country, store, price, url, source, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())
         ON CONFLICT (item_id, country, store) DO UPDATE SET
           previous_price = CASE WHEN prices.price IS DISTINCT FROM EXCLUDED.price THEN prices.price ELSE prices.previous_price END,
           price = EXCLUDED.price,
           url = CASE WHEN EXCLUDED.url = '' THEN prices.url ELSE EXCLUDED.url END,
           source = EXCLUDED.source,
           updated_at = now()`,
        [itemId, country, r.store, r.price, r.url, source]
      );
    },
    async deletePrice(itemId, country, store) {
      await q(`DELETE FROM prices WHERE item_id=$1 AND country=$2 AND store=$3`, [itemId, country, store]);
    },
    async markChecked(itemId) {
      await q(`UPDATE items SET prices_checked_at = now() WHERE id = $1`, [itemId]);
    },
    async markSearched(itemId, found) {
      await q(`UPDATE items SET searched_at = now(), search_found = $2 WHERE id = $1`, [itemId, found]);
    },
    async getSetting(key) {
      const row = (await q(`SELECT value FROM settings WHERE key = $1`, [key])).rows[0];
      return row ? row.value : null;
    },
    async setSetting(key, value) {
      await q(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, JSON.stringify(value)]
      );
    },
  };
}

const db = process.env.DATABASE_URL
  ? pgStore(process.env.DATABASE_URL)
  : jsonStore(path.join(__dirname, "..", "data", "db.json"));

module.exports = { db, CATEGORIES, COUNTRIES, cleanPriceRow };
