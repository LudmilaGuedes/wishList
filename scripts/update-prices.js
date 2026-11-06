// Atualiza o câmbio e os preços de todos os itens.
// Uso local: npm run update-prices
// No Render: rode como Cron Job (veja render.yaml).
require("dotenv").config();
const { db } = require("../src/db");
const { refreshAll } = require("../src/prices");

(async () => {
  await db.init();
  const out = await refreshAll();
  if (out.fx) console.log(`Câmbio: US$ 1 = C$ ${out.fx.usdToCad}`);
  for (const it of out.items) {
    console.log(`${it.name}: ${it.direct} pelo link, ${it.found} pela busca, ${it.credits} consulta(s) SerpApi — ${it.reason}${it.errors.length ? " — " + it.errors.join("; ") : ""}`);
  }
  out.errors.forEach(e => console.error(e));
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
