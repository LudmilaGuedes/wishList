# Lista de Compras EUA · Canadá

Site para montar uma lista de compras por categoria (roupas, beleza, eletrônicos, casa, outros) e comparar o preço de cada produto nos **EUA** e no **Canadá**: na loja oficial da marca, Amazon, Walmart, Target e Best Buy.

- Mostra o mais barato, já convertido entre US$ e C$ (o câmbio é atualizado sozinho).
- Mostra ▲▼ quanto o preço mudou desde a última atualização.
- Preços automáticos pelo Google Shopping (via [SerpApi](https://serpapi.com)) ou digitados à mão.

## Rodar no seu computador

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm install
copy .env.example .env    # depois abra o .env e preencha (tudo é opcional)
npm start
```

Abra http://localhost:3000. No computador os dados ficam em `data/db.json`.

## Preços automáticos (opcional)

1. Crie uma conta em https://serpapi.com e copie a sua API key.
2. Coloque no `.env`: `SERPAPI_KEY=sua_chave`.
3. Reinicie o site. Aparecem os botões **Buscar preços** e **Atualizar todos os preços**.

Cada item gasta 2 buscas por atualização (uma nos EUA, uma no Canadá). O plano gratuito da SerpApi tem um limite de buscas por mês; veja os valores atuais no site deles.

Para atualizar tudo pelo terminal: `npm run update-prices`.

## Colocar no Render

1. Suba esta pasta para um repositório no GitHub.
2. No [Render](https://render.com): **New → Blueprint** e escolha o repositório. O `render.yaml` cria o site, o banco Postgres e a tarefa diária de preços.
3. Quando o Render pedir, preencha `SERPAPI_KEY` e `APP_PASSWORD` (a senha para entrar no site; qualquer nome de usuário funciona).

Avisos sobre o Render:
- O plano gratuito "dorme" depois de um tempo sem acesso; a primeira visita depois disso demora uns segundos.
- O Postgres gratuito do Render expira depois de um tempo (veja o prazo atual no site deles). Alternativa grátis e sem prazo: criar o banco no [Neon](https://neon.tech) ou [Supabase](https://supabase.com) e colocar o endereço em `DATABASE_URL`.
- Cron Jobs (a atualização diária) são pagos no Render. Se não quiser pagar, apague o bloco `cron` do `render.yaml` e use o botão **Atualizar todos os preços**.

## Estrutura

| Arquivo | O que faz |
|---|---|
| `server.js` | Servidor e API (`/api/items`, edição de preços, atualização) |
| `src/db.js` | Banco de dados: Postgres (com `DATABASE_URL`) ou arquivo JSON local |
| `src/prices.js` | Busca de preços (SerpApi) e câmbio (open.er-api.com) |
| `scripts/update-prices.js` | Atualiza todos os preços (usado pelo Cron Job) |
| `public/` | O site (HTML, CSS e JavaScript) |
| `render.yaml` | Configuração do Render |
