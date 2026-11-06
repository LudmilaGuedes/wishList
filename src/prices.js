// Busca de preços e câmbio.
// Preços: SerpApi (Google Shopping) — https://serpapi.com — precisa de SERPAPI_KEY.
// Câmbio: open.er-api.com (gratuito, sem chave).
const { db } = require("./db");
const { checkDirect } = require("./direct");

// Lojas acompanhadas em cada país. "match" é comparado com o nome da loja que o Google Shopping devolve
// (palavra inteira: "rei" não pega "Reitmans"). Incluir mais lojas não gasta consultas a mais.
// Lojas de esporte/neve: só as que têm loja física (Backcountry, Steep & Cheap etc. são só online).
const STORES = {
  us: [
    { label: "Amazon", match: ["amazon"] },
    { label: "Walmart", match: ["walmart"] },
    { label: "Target", match: ["target"] },
    { label: "Best Buy", match: ["best buy", "bestbuy"] },
    { label: "Sephora", match: ["sephora"] },
    { label: "Ulta", match: ["ulta"] },
    { label: "REI", match: ["rei"] },
    { label: "Dick's Sporting Goods", match: ["dick's", "dick’s", "dicks"] },
    { label: "Academy Sports", match: ["academy sports"] },
    { label: "Nordstrom", match: ["nordstrom"] },
  ],
  ca: [
    { label: "Amazon.ca", match: ["amazon"] },
    { label: "Walmart.ca", match: ["walmart"] },
    { label: "Best Buy CA", match: ["best buy", "bestbuy"] },
    { label: "Sephora CA", match: ["sephora"] },
    { label: "Shoppers Drug Mart", match: ["shoppers"] },
    { label: "Sport Chek", match: ["sport chek", "sportchek"] },
    { label: "Sporting Life", match: ["sporting life"] },
    { label: "MEC", match: ["mec"] },
    { label: "Altitude Sports", match: ["altitude sports"] },
  ],
};
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const storeMatches = (source, store) => store.match.some(m => new RegExp(`(^|[^a-z0-9])${escapeRe(m)}($|[^a-z0-9])`).test(norm(source)));
const MARKET = {
  // Preços dos EUA como se a busca fosse feita em Houston (Texas). Muda o preço de lojas como Walmart e Target.
  us: { gl: "us", google_domain: "google.com", location: "Houston, Texas, United States" },
  ca: { gl: "ca", google_domain: "google.ca" },
};

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const VARIANT_WORDS = ["charcoal", "mini", "travel", "set", "kit", "duo", "trio", "refill", "bundle", "gift", "pack", "sample", "jumbo", "lot",
  "deluxe", "xl", "pro", "max", "plus", "ultra", "insulated"];
// Sites de revenda / usados: nunca entram como loja.
const RESALE = /ebay|mercari|poshmark|depop|shein|temu|aliexpress|whatnot/i;
const STOPWORDS = new Set(["the", "and", "for", "with", "de", "da", "do", "com", "tm"]);
const tokens = s => norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !STOPWORDS.has(t));

// Códigos de modelo: letras seguidas de 3+ dígitos (NC351, NC601PU, WH1000...).
const codesIn = s => [...String(s || "").toUpperCase().matchAll(/\b([A-Z]{2,4}\d{3,}[A-Z0-9]*)\b/g)].map(m => m[1]);

// Tamanhos como "3.8 oz" ou "125 ml", para não confundir o tamanho mini com o normal.
const sizesIn = s => [...norm(s).replace(/,/g, ".").matchAll(/(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|oz|ml|g)\b/g)]
  .map(m => `${Number(m[1])}${m[2].includes("oz") ? "oz" : m[2]}`);

// O título do anúncio precisa conter a maior parte das palavras do nome do produto
// e, se o item tem tamanho, o anúncio não pode ser de outro tamanho.
function titleMatches(title, item) {
  const want = tokens(item.name);
  if (!want.length) return false;
  const have = new Set(tokens(title));
  // Singular/plural contam como a mesma palavra ("Pant" = "Pants").
  const stem = t => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
  const haveStems = new Set([...have].map(stem));
  const hits = want.filter(t => haveStems.has(stem(t))).length;
  if (hits / want.length < 0.7) return false;
  // Palavras que indicam outra versão do produto (kit, mini, carvão...). Só aceita se o item também tiver.
  const own = new Set(tokens(`${item.name} ${item.model}`));
  if (VARIANT_WORDS.some(w => have.has(w) && !own.has(w))) return false;
  // E o contrário: se o nome do item tem "Max", "Pro", "Deluxe"..., o anúncio também precisa ter.
  if (VARIANT_WORDS.some(w => want.includes(w) && !have.has(w))) return false;
  // Números do nome (o 7 de "7-in-1", o 11 de "11-in-1") precisam aparecer no anúncio.
  if (want.filter(t => /^\d+$/.test(t)).some(n => !have.has(n))) return false;
  // Códigos de modelo (ex.: NC351, NC601): se o anúncio tem um código, tem que ser o mesmo do item.
  const wantCodes = codesIn(`${item.name} ${item.model}`);
  const titleCodes = codesIn(title);
  if (wantCodes.length && titleCodes.length && !titleCodes.some(c => wantCodes.some(w => c.startsWith(w)))) return false;
  // Produto genérico de outra marca ("case for iPhone...", "compatible with...") não serve.
  const nt = norm(title);
  if (/\bcompatible\b/.test(nt) || new RegExp(`\\bfor (apple )?${want[0]}\\b`).test(nt)) return false;
  // Marca: se a loja oficial não faz parte do nome (ex.: Apple), o anúncio precisa citar a marca.
  const brand = tokens(item.official_store || "");
  // (aceita parte do nome da marca: "Ninja" vale para "SharkNinja")
  const brandIn = words => brand.some(b => [...words].some(w => w.length >= 3 && b.includes(w)));
  if (brand.length && !brandIn(want) && !brandIn(have)) return false;
  // Cor / tamanho escolhido: todas as palavras precisam estar no anúncio (ex.: "Burgundy").
  const variantWords = tokens(item.variant || "");
  if (variantWords.length && !variantWords.every(w => have.has(w))) return false;
  const wantSizes = sizesIn(item.model);
  const titleSizes = sizesIn(title);
  if (wantSizes.length && titleSizes.length && !titleSizes.some(s => wantSizes.includes(s))) return false;
  return true;
}

const USED = /\b(used|refurbished|renewed|pre-owned|open box|usado|recondicionado)\b/i;

async function searchShopping(query, country) {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY não configurada");
  const params = new URLSearchParams({ engine: "google_shopping", q: query, hl: "en", api_key: key, ...MARKET[country] });
  let res;
  try {
    res = await fetch(`https://serpapi.com/search.json?${params}`);
  } catch (err) {
    // Falha de conexão momentânea: tenta mais uma vez depois de 2 segundos.
    await new Promise(r => setTimeout(r, 2000));
    res = await fetch(`https://serpapi.com/search.json?${params}`);
  }
  if (!res.ok) throw new Error(`SerpApi respondeu ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`SerpApi: ${json.error}`);
  return json.shopping_results || [];
}

// A página do produto no Google lista as lojas que vendem aquele produto (é onde aparecem Sephora, Ulta etc.).
async function productStores(result) {
  if (!result || !result.serpapi_immersive_product_api) return [];
  const url = new URL(result.serpapi_immersive_product_api);
  url.searchParams.set("api_key", process.env.SERPAPI_KEY);
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  const stores = (json.product_results && json.product_results.stores) || [];
  // As lojas da página são do mesmo produto do anúncio escolhido; junta os dois títulos (o da loja às vezes não traz a cor).
  return stores.map(s => ({ source: s.name, title: `${result.title} | ${s.title || ""}`, extracted_price: s.extracted_price, link: s.link }));
}

const median = arr => { const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Busca na SerpApi (Google Shopping) nos dois países e grava o menor preço encontrado em cada loja.
// Gasta até 2 consultas por país (lista de resultados + página do produto).
async function searchItem(item, summary) {
  // Busca limpa: marca + nome + cor/tamanho, sem símbolos como ™ e ·
  const query = [item.official_store, item.name, item.variant, sizesIn(item.model).join(" ")]
    .filter(Boolean).join(" ").replace(/[™®©·•|/]/g, " ").replace(/\s+/g, " ").trim();
  let found = 0;

  for (const country of ["us", "ca"]) {
    let results;
    try {
      results = await searchShopping(query, country);
      summary.credits++;
      // Página do produto: prefere um anúncio vendido por várias lojas e que não seja de revenda.
      const candidates = results.filter(r => titleMatches(r.title, item) && r.serpapi_immersive_product_api && !RESALE.test(r.source || ""));
      const top = candidates.find(r => r.multiple_sources) || candidates[0];
      if (top) {
        summary.credits++;
        results = results.concat(await productStores(top).catch(() => []));
      }
    } catch (err) {
      summary.errors.push(`${country.toUpperCase()}: ${err.message}`);
      continue;
    }
    const matching = results.filter(r =>
      typeof r.extracted_price === "number" && r.extracted_price > 0 &&
      titleMatches(r.title, item) && !RESALE.test(r.source || "") &&
      !USED.test(r.title || "") && !r.second_hand_condition
    );
    // Descarta preços fora da curva (mais que o dobro ou menos que a metade da mediana):
    // normalmente pacotes, tamanho mini ou vendedores não oficiais.
    const mid = matching.length ? median(matching.map(r => r.extracted_price)) : 0;
    const sane = matching.filter(r => r.extracted_price <= mid * 2 && r.extracted_price >= mid * 0.5);

    const stores = [...STORES[country]];
    if (item.official_store) {
      stores.push({ label: `${item.official_store} (oficial)`, match: [norm(item.official_store)] });
    }
    for (const store of stores) {
      const offers = sane.filter(r => storeMatches(r.source, store));
      if (!offers.length) continue;
      const best = offers.reduce((a, b) => (b.extracted_price < a.extracted_price ? b : a));
      // Link direto da loja; um link do Google não substitui o link que já existe.
      const direct = [best.link, best.product_link].find(u => u && !/\/\/(www\.)?google\./i.test(u)) || "";
      await db.upsertPrice(item.id, country, { store: store.label, price: best.extracted_price, url: direct }, "auto");
      found++;
    }
  }
  summary.found += found;
  await db.markSearched(item.id, found);
}

// Atualiza um item gastando o mínimo de consultas:
// 1) confere de graça cada loja que já tem link (Apple, Clinique, Tarte, Ulta...);
// 2) só usa a SerpApi se o item nunca foi pesquisado, ou se alguma loja não pôde ser conferida pelo link.
//    Se a última busca na SerpApi não achou nada (ex.: capinha da Apple), não gasta de novo.
// Com { full: true }, faz a busca na SerpApi de qualquer jeito.
// Na atualização automática (auto: true) a SerpApi é usada com ainda mais cuidado:
// no máximo 1 busca a cada SERPAPI_AUTO_DAYS dias por item, e nunca se a conta tiver SERPAPI_RESERVE consultas ou menos.
const AUTO_DAYS = Number(process.env.SERPAPI_AUTO_DAYS || 3);
const RESERVE = Number(process.env.SERPAPI_RESERVE || 20);

// Consultas que ainda restam na conta da SerpApi. Perguntar isso é grátis (não gasta consulta).
// Guarda a resposta por 10 minutos. null = não deu para saber.
let leftCache = { at: 0, value: null };
async function serpapiLeft() {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;
  if (Date.now() - leftCache.at < 10 * 60 * 1000) return leftCache.value;
  try {
    const res = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`);
    const json = res.ok ? await res.json() : {};
    const n = json.total_searches_left ?? json.plan_searches_left;
    leftCache = { at: Date.now(), value: typeof n === "number" ? n : null };
  } catch (e) {
    leftCache = { at: Date.now(), value: null };
  }
  return leftCache.value;
}

async function refreshItem(item, { full = false, auto = false } = {}) {
  const withPrices = (await db.listItems()).find(i => i.id === item.id) || { ...item, prices: { us: [], ca: [] } };
  const summary = { id: item.id, name: item.name, found: 0, direct: 0, credits: 0, searched: false, reason: "", errors: [] };

  // 1) Links diretos (grátis)
  let pending = 0;
  for (const country of ["us", "ca"]) {
    for (const row of withPrices.prices[country] || []) {
      if (typeof row.price !== "number") continue;            // ex.: "não vende"
      const r = row.url ? await checkDirect(row.url, row.price) : null;
      // Aceita só se o valor for coerente com o anterior (evita pegar outro tamanho/cor da mesma página).
      if (r && r.price >= row.price * 0.5 && r.price <= row.price * 2) {
        await db.upsertPrice(item.id, country, { store: row.store, price: r.price, url: row.url }, "link");
        summary.direct++;
      } else {
        pending++;
      }
    }
  }

  // 2) SerpApi só quando precisa
  let search = false;
  if (!process.env.SERPAPI_KEY) summary.reason = "busca automática desligada (sem SERPAPI_KEY)";
  else if (full) { search = true; summary.reason = "busca completa pedida"; }
  else if (!withPrices.searched_at) { search = true; summary.reason = "primeira busca deste item"; }
  else if (withPrices.search_found === 0) summary.reason = "a busca automática não encontra este item; conferido só pelos links";
  else if (pending > 0) { search = true; summary.reason = `${pending} loja(s) não puderam ser conferidas pelo link`; }
  else summary.reason = "todas as lojas conferidas pelo link";

  if (search && auto && !full) {
    const daysSince = withPrices.searched_at ? (Date.now() - new Date(withPrices.searched_at)) / 864e5 : Infinity;
    const left = await serpapiLeft();
    if (daysSince < AUTO_DAYS) {
      search = false;
      summary.reason += ` — SerpApi pulada (última busca há menos de ${AUTO_DAYS} dias)`;
    } else if (left !== null && left <= RESERVE) {
      search = false;
      summary.reason += ` — SerpApi pulada (restam só ${left} consultas)`;
    }
  }

  if (search) {
    summary.searched = true;
    leftCache.at = 0; // a conta muda depois da busca
    await searchItem(withPrices, summary);
  }

  await db.markChecked(item.id);
  return summary;
}

async function refreshFx() {
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) throw new Error(`Câmbio respondeu ${res.status}`);
  const json = await res.json();
  const rate = json && json.rates && json.rates.CAD;
  if (typeof rate !== "number") throw new Error("Câmbio USD→CAD não encontrado");
  const fx = { usdToCad: rate, updatedAt: new Date().toISOString(), source: "open.er-api.com" };
  await db.setSetting("fx", fx);
  return fx;
}

async function refreshAll() {
  const out = { fx: null, items: [], errors: [] };
  try { out.fx = await refreshFx(); } catch (err) { out.errors.push(err.message); }
  const items = await db.listItems();
  for (const item of items) out.items.push(await refreshItem(item));
  return out;
}

module.exports = { refreshItem, refreshFx, refreshAll, serpapiLeft, titleMatches, STORES };
