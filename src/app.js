// O site (API + páginas). server.js usa este arquivo tanto no computador quanto na Vercel.
require("dotenv").config();
const path = require("path");
const express = require("express");
const { db, COUNTRIES, cleanPriceRow } = require("./db");
const { refreshItem, refreshFx, refreshAll, serpapiLeft } = require("./prices");
const auto = require("./auto");

// Prepara o banco uma vez (na Vercel, a cada "acordada" da função). Todo pedido da API espera isso terminar.
// Se a conexão falhar (acontece às vezes quando o Neon está "acordando"), tenta de novo, e o próximo pedido tenta outra vez.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function start() {
  for (let i = 1; ; i++) {
    try { await db.init(); break; }
    catch (err) { if (i >= 3) throw err; console.warn(`Banco: tentativa ${i} falhou (${err.message}), tentando de novo...`); await sleep(500 * i); }
  }
  if (!(await db.getSetting("fx"))) await refreshFx().catch(err => console.warn("Câmbio:", err.message));
}
let readyP = null;
const ready = () => (readyP ||= start().catch(err => { readyP = null; throw err; }));
ready().catch(() => {}); // já começa a preparar; erro aqui é tratado no próximo pedido

const app = express();
app.use(express.static(path.join(__dirname, "..", "public"))); // páginas abrem mesmo se o banco demorar
app.use((req, res, next) => ready().then(() => next(), next));
app.use(express.json({ limit: "100kb" }));

// Chave de acesso: se APP_KEY estiver definida, a API só responde para quem abriu o site pelo link com ?k=CHAVE.
// (O navegador guarda a chave e manda em todo pedido. Assim basta clicar no link no celular, sem digitar senha.)
const KEY = process.env.APP_KEY;
if (KEY) {
  app.use("/api", (req, res, next) => {
    if (req.get("x-app-key") === KEY || req.query.k === KEY) return next();
    res.status(401).json({ error: "Acesso negado. Abra o site pelo link completo (com ?k=...)." });
  });
}



const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(500).json({ error: "Erro no servidor. Tente de novo." });
});
const idParam = req => Number.parseInt(req.params.id, 10);

app.get("/healthz", (req, res) => res.send("ok"));

// Câmbio (grátis, open.er-api.com): renova se faltar o real ou se for de outro dia.
async function freshFx() {
  const fx = await db.getSetting("fx");
  if (fx && fx.usdToBrl && auto.dayKey(fx.updatedAt) === auto.today()) return fx;
  return refreshFx().catch(() => fx);
}

app.get("/api/items", wrap(async (req, res) => {
  const items = await db.listItems();
  res.json({
    items,
    fx: await freshFx(),
    autoPrices: Boolean(process.env.SERPAPI_KEY),
    auto: auto.status(items),
    serpapiLeft: await serpapiLeft(),
  });
}));

app.post("/api/items", wrap(async (req, res) => {
  if (!req.body || !String(req.body.name || "").trim()) return res.status(400).json({ error: "Escreva o nome do produto." });
  res.status(201).json(await db.createItem(req.body));
}));

app.put("/api/items/:id", wrap(async (req, res) => {
  const item = await db.updateItem(idParam(req), req.body || {});
  if (!item) return res.status(404).json({ error: "Item não encontrado." });
  res.json(item);
}));

// Marcar como comprado (fica salvo no banco: vale para todos os aparelhos).
app.put("/api/items/:id/bought", wrap(async (req, res) => {
  const item = await db.setBought(idParam(req), Boolean(req.body && req.body.bought));
  if (!item) return res.status(404).json({ error: "Item não encontrado." });
  res.json(item);
}));

app.delete("/api/items/:id", wrap(async (req, res) => {
  await db.deleteItem(idParam(req));
  res.status(204).end();
}));

// Edição manual: substitui a lista de preços de um país pelo que veio do formulário.
app.put("/api/items/:id/prices/:country", wrap(async (req, res) => {
  const id = idParam(req), country = req.params.country;
  if (!COUNTRIES.includes(country)) return res.status(400).json({ error: "País inválido." });
  if (!(await db.getItem(id))) return res.status(404).json({ error: "Item não encontrado." });
  const rows = (Array.isArray(req.body && req.body.rows) ? req.body.rows : []).map(cleanPriceRow).filter(r => r.store);
  const items = await db.listItems();
  const current = (items.find(i => i.id === id) || { prices: {} }).prices[country] || [];
  for (const old of current) if (!rows.some(r => r.store === old.store)) await db.deletePrice(id, country, old.store);
  for (const r of rows) await db.upsertPrice(id, country, r, "manual");
  await db.markChecked(id);
  res.json({ ok: true });
}));

// Atualização pelo botão: confere os links de graça e só usa a SerpApi se precisar. ?full=1 força a busca completa.
app.post("/api/items/:id/refresh", wrap(async (req, res) => {
  const item = await db.getItem(idParam(req));
  if (!item) return res.status(404).json({ error: "Item não encontrado." });
  const full = req.query.full === "1";
  if (full && !process.env.SERPAPI_KEY) return res.status(400).json({ error: "Busca completa desligada: configure SERPAPI_KEY." });
  await refreshFx().catch(() => {});
  res.json(await refreshItem(item, { full }));
}));

// Atualização automática ao abrir o site: só a partir de AUTO_REFRESH_FROM e no máximo 1 vez por dia por item.
// Quem decide é o servidor, então abrir o site várias vezes (ou em dois aparelhos) não gasta de novo.
app.post("/api/items/:id/auto-refresh", wrap(async (req, res) => {
  const item = await db.getItem(idParam(req));
  if (!item) return res.status(404).json({ error: "Item não encontrado." });
  const why = auto.skipReason(item);
  if (why) return res.json({ id: item.id, skipped: why });
  await db.markChecked(item.id); // reserva o item para hoje antes de começar (evita rodar 2x ao mesmo tempo)
  const fx = await db.getSetting("fx");
  if (!fx || auto.dayKey(fx.updatedAt) !== auto.today()) await refreshFx().catch(() => {});
  res.json(await refreshItem(item, { auto: true }));
}));

app.post("/api/refresh", wrap(async (req, res) => {
  res.json(await refreshAll());
}));

app.post("/api/fx/refresh", wrap(async (req, res) => {
  res.json(await refreshFx());
}));

module.exports = { app, ready };
