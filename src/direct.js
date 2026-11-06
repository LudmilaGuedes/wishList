// Confere o preço direto na página do produto (de graça, sem SerpApi).
// Funciona em lojas que publicam o preço nos dados da página (JSON-LD, metatags ou Shopify).
// Lojas que bloqueiam leitura automática (ex.: Sephora, Ulta, Amazon) retornam null e caem na SerpApi.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function get(url, accept = "text/html") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return null;
    return { url: res.url, text: await res.text() };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const toNum = v => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Todos os objetos Product do JSON-LD da página.
function jsonLdProducts(html) {
  const out = [];
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch (e) { continue; }
    const walk = node => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      const type = [].concat(node["@type"] || []);
      if (type.includes("Product") || type.includes("ProductGroup")) out.push(node);
      if (node["@graph"]) walk(node["@graph"]);
      if (node.hasVariant) walk(node.hasVariant);
    };
    walk(data);
  }
  return out;
}

function offersOf(product) {
  const list = [];
  const add = o => {
    if (!o) return;
    if (Array.isArray(o)) return o.forEach(add);
    if (o.offers) add(o.offers);
    const price = toNum(o.price ?? o.lowPrice ?? (o.priceSpecification && o.priceSpecification.price));
    if (price) list.push({ price, name: [product.name, o.name, o.sku].filter(Boolean).join(" ") });
  };
  add(product.offers);
  return list;
}

// Lê o preço de uma página. `hint` é o preço atual salvo: entre várias opções, fica a mais próxima dele.
async function checkDirect(url, hint) {
  if (!/^https?:\/\//i.test(url || "")) return null;
  const candidates = [];

  // 1) Lojas Shopify com ?variant= no link: preço exato daquela variante.
  const variant = (url.match(/[?&]variant=(\d+)/) || [])[1];
  const handle = (url.match(/\/products\/([^/?#]+)/) || [])[1];
  if (variant && handle) {
    const js = await get(new URL(`/products/${handle}.js`, url).toString(), "application/json");
    if (js) {
      try {
        const p = JSON.parse(js.text);
        const v = (p.variants || []).find(x => String(x.id) === variant);
        if (v) return { price: v.price / 100, method: "shopify" };
      } catch (e) { /* segue para a página */ }
    }
  }

  // 2) Página do produto: JSON-LD e metatags de preço.
  const page = await get(url);
  if (!page) return null;
  const html = page.text;
  for (const p of jsonLdProducts(html)) for (const o of offersOf(p)) candidates.push(o.price);
  for (const re of [
    /<meta[^>]+(?:property|name)=["'](?:og|product):price:amount["'][^>]+content=["']([\d.,]+)["']/gi,
    /<meta[^>]+content=["']([\d.,]+)["'][^>]+(?:property|name)=["'](?:og|product):price:amount["']/gi,
  ]) {
    let m;
    while ((m = re.exec(html))) { const n = toNum(m[1]); if (n) candidates.push(n); }
  }
  // Apple: o preço vem num JSON da página ("currentPrice":{"amount":"$49.00"...}).
  let m;
  const apple = /"currentPrice"\s*:\s*\{\s*"amount"\s*:\s*"[^"\d]*([\d.,]+)"/g;
  while ((m = apple.exec(html))) { const n = toNum(m[1]); if (n) candidates.push(n); }

  const prices = [...new Set(candidates)];
  if (!prices.length) return null;
  const price = hint ? prices.reduce((a, b) => (Math.abs(b - hint) < Math.abs(a - hint) ? b : a)) : prices[0];
  return { price, method: prices.length > 1 ? "page-multi" : "page" };
}

module.exports = { checkDirect };
