// Copia a lista do computador (data/db.json) para o banco Postgres (Neon).
// Uso: DATABASE_URL="postgres://..." node scripts/migrate-to-postgres.js
// Pode rodar de novo sem duplicar: itens e preços com o mesmo id/loja são substituídos.
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const url = process.env.DATABASE_URL;
if (!url) { console.error("Defina DATABASE_URL."); process.exit(1); }

(async () => {
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "db.json"), "utf8"));
  process.env.DATABASE_URL = url;
  const { db } = require("../src/db");
  await db.init(); // cria as tabelas
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const q = (t, p) => pool.query(t, p);

  for (const it of state.items) {
    await q(
      `INSERT INTO items (id, name, model, category, note, official_store, image_url, variant, created_at, prices_checked_at, searched_at, search_found)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET name=$2, model=$3, category=$4, note=$5, official_store=$6, image_url=$7, variant=$8,
         created_at=$9, prices_checked_at=$10, searched_at=$11, search_found=$12`,
      [it.id, it.name, it.model || "", it.category || "outros", it.note || "", it.official_store || "", it.image_url || "", it.variant || "",
        it.created_at, it.prices_checked_at || null, it.searched_at || null, it.search_found ?? null]
    );
  }
  for (const it of state.items) if (it.bought_at) await q(`UPDATE items SET bought_at = $2 WHERE id = $1`, [it.id, it.bought_at]);
  for (const p of state.prices) {
    await q(
      `INSERT INTO prices (item_id, country, store, price, previous_price, url, source, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (item_id, country, store) DO UPDATE SET price=$4, previous_price=$5, url=$6, source=$7, updated_at=$8`,
      [p.item_id, p.country, p.store, p.price, p.previous_price, p.url || "", p.source || "manual", p.updated_at]
    );
  }
  for (const [k, v] of Object.entries(state.settings || {})) {
    await q(`INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, JSON.stringify(v)]);
  }
  // Próximo item novo continua a numeração.
  await q(`SELECT setval(pg_get_serial_sequence('items','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM items), 1))`);
  console.log(`Copiados: ${state.items.length} itens, ${state.prices.length} preços.`);
  await pool.end();
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
