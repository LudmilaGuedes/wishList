# Lista de Compras EUA · Canadá

Site para montar uma lista de compras por categoria e comparar preços nos EUA e no Canadá
(loja oficial, Amazon, Walmart, Target, Best Buy). Detalhes para usuários estão no `README.md`.

## Como trabalhar neste projeto

- Falar com a usuária em **português**.
- Rodar: `npm start` → http://localhost:3000 (porta vem do `.env`, padrão 3000).
- Desenvolvimento com recarga automática: `npm run dev`.
- Atualizar todos os preços pelo terminal: `npm run update-prices` (gasta buscas da SerpApi).
- Teste rápido: `curl localhost:3000/healthz` deve responder `ok`; `curl localhost:3000/api/items` lista os itens.
- Não há testes automatizados. Código no GitHub: https://github.com/LudmilaGuedes/wishList (público, branch main).
- Commits **sem** linha Co-Authored-By do Claude (pedido da usuária).
- Nunca mostrar o conteúdo do `.env` (tem a `SERPAPI_KEY`).

## Ao adicionar um produto (pedido da usuária)

Sempre cadastrar com **foto e preços dos EUA e do Canadá**, do jeito grátis:
achar páginas oficiais/lojas físicas pela web → conferir preço com `checkDirect` (`src/direct.js`) →
foto pelo CDN da marca (conferir a cor) → gravar via `PUT /api/items/:id` e `PUT /api/items/:id/prices/:country`
(com Node `fetch`). Só usar SerpApi se não achar de graça. The North Face CA bloqueia leitura automática (403);
a TNF EUA às vezes também.

## Estrutura

| Arquivo | O que faz |
|---|---|
| `server.js` | Express: API `/api/items`, edição manual de preços, atualização, senha opcional (`APP_PASSWORD`) |
| `src/db.js` | Banco: Postgres se `DATABASE_URL` existir, senão arquivo `data/db.json` |
| `src/prices.js` | Busca no Google Shopping via SerpApi + câmbio (open.er-api.com) |
| `src/direct.js` | Confere preço direto na página do produto (JSON-LD/metatags/Shopify), grátis; se falhar, cai na SerpApi |
| `scripts/update-prices.js` | Atualiza todos os preços (usado pelo Cron Job do Render) |
| `public/` | Front-end (`index.html`, `app.js`, `styles.css`) |
| `render.yaml` | Deploy no Render (site + Postgres + cron diário 09:00 UTC) |
| `lista-de-compras.html` | Versão antiga em arquivo único (anterior ao servidor) |

## Configuração atual (local)

- `SERPAPI_KEY`: preenchida → busca automática de preços ligada.
- `APP_PASSWORD`: vazia → site sem senha.
- `DATABASE_URL`: vazia → dados em `data/db.json`.

## Histórico de conversas

Ao fim de cada sessão, adicionar aqui um resumo curto (data, o que foi pedido, o que foi feito, pendências).

### 2026-11-05
- Usuária pediu para rodar o site. Iniciado com `npm start` (banco: json) e aberto no navegador.
  Verificado: `/healthz` → ok, página inicial carrega, `/api/items` retorna os itens
  (ex.: capinha iPhone 18 Pro Max Silicone Case com preço Apple US e Apple CA).
- Criado este `CLAUDE.md` para guardar contexto e histórico entre sessões.
- Objetivo do site: ver promoções quando for viajar. Lista ainda incompleta (5 itens). Não atualizar preços agora.
  SerpApi tem limite mensal: nunca estourar; sempre dar dicas e escolher a forma mais econômica.
- Discutido (nada implementado ainda — "vamos fazer depois"):
  - Hospedagem: recomendada **Vercel + Neon** (abre rápido, agendamento diário grátis, banco sem prazo)
    em vez de Render (dorme ~1 min, cron pago, Postgres grátis expira).
    Ajustes necessários: só Postgres na nuvem (db.json não persiste), atualizar em lotes (limite de tempo),
    `waitUntil` para tarefa em segundo plano, adaptar `server.js` e trocar `render.yaml` por config da Vercel.
  - Atualização 1x por dia ao abrir o site (se ainda não rodou no dia), em segundo plano, com trava contra execução dupla.
  - Modo viagem (só atualiza perto das datas), links grátis todo dia e SerpApi a cada X dias por item,
    teto mensal de consultas (+ checar saldo pela Account API da SerpApi, que não gasta), destaque "menor preço já visto".
  - Pendente da usuária: datas da viagem e limite mensal do plano SerpApi.
  - Obs.: README diz 2 consultas por item, mas o código gasta até 4.
- Adicionado item 9: Women's Snoga Pant (The North Face, NF0A87X3), roupas, nota "Tamanho M", sem cor definida.
  Adicionado pela API (sem busca de preço, 0 consultas SerpApi).
  Dica: ao mandar texto com acento via curl no Git Bash, os acentos quebram; usar Node `fetch`.
- Snoga Pant: cor definida como Black (nota "Tamanho M · cor TNF Black").
- `src/prices.js`: adicionadas lojas com loja física — EUA: REI, Dick's Sporting Goods, Academy Sports, Nordstrom;
  Canadá: Sport Chek, Sporting Life, MEC, Altitude Sports. (Só online, como Backcountry, ficam de fora.)
  Nome da loja agora casa por palavra inteira (evita "rei" casar com "Reitmans").
  Título aceita singular/plural ("Pant" = "Pants"); antes a Snoga Pant não seria encontrada.
  Testado offline, sem gastar SerpApi. Pendente: em que cidade do Canadá ela vai (Sporting Life é forte em Ontário).
- Adicionado item 10: Women's Apex Insulated Etip Gloves (The North Face, NF0A89RC), roupas, "Tamanho XS", cor pendente.
  Sem busca de preço. "insulated" entrou em VARIANT_WORDS para não confundir com a luva Apex Etip (sem isolamento).
- Fotos (preto, TNF Black/JK3) e preços adicionados de graça, 0 SerpApi:
  - Snoga Pant: EUA TNF oficial US$ 240 (página oficial); CA Altitude Sports C$ 299,99 (conferido pelo link).
  - Luvas: EUA TNF oficial US$ 65 (página oficial); CA TNF oficial C$ 44,98 (de C$ 80) — veio da busca na web, não conferido ao vivo.
  - Alerta: altitude-sportshub.it.com parece site falso imitando a Altitude Sports.
- Item 8 corrigido: a capa é do **iPhone 18 Pro** (não Pro Max). Agora "iPhone 18 Pro Silicone Case with MagSafe",
  Burgundy, código MK8U4ZM/A, foto MK8U4, links Apple US (US$ 49) e Apple CA (C$ 69) conferidos de graça.
  A busca já rejeita anúncios "Pro Max" para este item.
- Adicionado item 11: Women's Cirque Down Jacket (The North Face, NF0A87WS), Black, "Tamanho S", com foto.
  EUA TNF oficial US$ 490 (da busca na web; site bloqueou); CA Altitude Sports C$ 609,99 (conferido pelo link).
  Promoções vistas na web (não gravadas): Saint Bernard US$ 239,90 (final sale), Sommets C$ 479,99, Kunstadt C$ 359,99.
- Adicionado item 12: Women's Lenado Jacket (The North Face, NF0A8DDS = versão atual), Black, "Tamanho S", com foto.
  EUA TNF oficial US$ 370 (conferido pelo link, URL sem ?color); CA Altitude Sports C$ 489,99 (da busca na web).
  Ski Essentials anuncia a NF0A8DDS com 40% off (só online). Códigos antigos: NF0A87X0, NF0A4R1M, NF0A3M5B.
- **Publicação na Vercel + Neon (em andamento):**
  - Código: `src/app.js` (app Express, exportado por `server.js`; a Vercel detecta o Express sozinha, `public/` vai pela CDN).
  - Acesso: `APP_KEY` — a API só responde com `?k=CHAVE` no link (o navegador guarda a chave). Sem senha para digitar.
    A chave está em `.app-key.local` (fora do git/Vercel). Localmente não há APP_KEY → sem chave.
  - `src/auto.js`: antes de 2027-01-17 (`AUTO_REFRESH_FROM`) só atualiza pelos botões; depois, ao abrir o site,
    cada item é atualizado no máximo 1x por dia (dia no fuso America/Toronto). O servidor decide (`POST /api/items/:id/auto-refresh`).
  - Proteção da SerpApi na atualização automática: no máx. 1 busca a cada 3 dias por item (`SERPAPI_AUTO_DAYS`)
    e nada se restarem ≤ 20 consultas (`SERPAPI_RESERVE`); saldo via Account API (grátis), mostrado no topo do site.
    Saldo em 2026-11-05: 218 consultas.
  - "Atualizar todos" agora vai item por item (pedidos curtos para a Vercel).
  - `scripts/migrate-to-postgres.js` copia `data/db.json` para o Neon.
  - Vercel: projeto `ludmila17/lista-de-compras` criado; `SERPAPI_KEY` e `APP_KEY` configuradas (Production).
  - Pendente: usuária criar o banco Neon pelo painel da Vercel (o comando `vercel integration add neon` foi bloqueado
    pela permissão automática); depois: `vercel env pull`, migrar dados, `vercel --prod`.

### 2026-11-06
- Projeto colocado no GitHub (LudmilaGuedes/wishList, público), commit só no nome da usuária, sem co-autor Claude.
  Fora do git: .env*, .app-key.local, data/, node_modules, .vercel. Conferido que nenhuma chave está no código.
- Pendente: ligar o repositório à Vercel (deploy automático a cada push) e criar o banco Neon.
