// Entrada do site.
// - No computador: npm start → http://localhost:3000
// - Na Vercel: ela detecta o Express sozinha e usa o app exportado aqui (as páginas de public/ vão direto pela CDN).
const { app, ready } = require("./src/app");
const { db } = require("./src/db");

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  ready.then(() => {
    app.listen(PORT, () => console.log(`Lista de Compras rodando em http://localhost:${PORT} (banco: ${db.kind})`));
  }).catch(err => {
    console.error("Falha ao iniciar o banco de dados:", err);
    process.exit(1);
  });
}
