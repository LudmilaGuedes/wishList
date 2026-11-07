(function () {
  const CATS = [
    { id: "roupas", label: "Roupas" },
    { id: "beleza", label: "Beleza" },
    { id: "eletronicos", label: "Eletrônicos" },
    { id: "casa", label: "Casa" },
    { id: "outros", label: "Outros" },
  ];
  const catLabel = id => (CATS.find(c => c.id === id) || CATS[CATS.length - 1]).label;
  const $ = id => document.getElementById(id);
  let items = [], fx = null, autoPrices = false, cat = "todas", q = "", loaded = false, autoInfo = null, serpLeft = null, autoRunning = false;

  // Chave de acesso que vem no link (?k=...). Fica guardada no aparelho e vai em todo pedido.
  let key = new URLSearchParams(location.search).get("k") || "";
  try { if (key) localStorage.setItem("lc-key", key); else key = localStorage.getItem("lc-key") || ""; } catch (e) {}
  try { cat = localStorage.getItem("lc-cat") || "todas"; } catch (e) {}

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => (typeof u === "string" && /^https?:\/\//i.test(u)) ? u : "";
  const num = n => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n, cur) => (cur === "CAD" ? "C$ " : "US$ ") + num(n);
  // Cotação usada para mostrar o valor aproximado em reais. Mude aqui quando quiser.
  const BRL = { USD: 5.4, CAD: 3.8 };
  const brl = (n, cur) => "R$ " + num(n * BRL[cur]);
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "";
  const priced = arr => (arr || []).filter(r => typeof r.price === "number");

  async function api(method, url, body) {
    const headers = body ? { "Content-Type": "application/json" } : {};
    if (key) headers["x-app-key"] = key;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Algo deu errado. Tente de novo.");
    return json;
  }

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  async function load() {
    try {
      const data = await api("GET", "/api/items");
      items = data.items; fx = data.fx; autoPrices = data.autoPrices; autoInfo = data.auto; serpLeft = data.serpapiLeft;
    } catch (err) {
      $("list").innerHTML = `<div class="empty"><h2>Não foi possível carregar a lista</h2><p>${esc(err.message)}</p></div>`;
      return;
    }
    loaded = true; render();
  }

  // Atualização automática: o servidor diz quais itens ainda não foram atualizados hoje (só a partir da data marcada).
  // Atualiza um por vez, mostrando o progresso, e redesenha a lista no fim.
  async function runAuto() {
    if (autoRunning || !autoInfo || !autoInfo.active || !autoInfo.due.length) return;
    autoRunning = true;
    const ids = autoInfo.due.slice();
    let credits = 0, done = 0;
    for (const id of ids) {
      $("autoline").hidden = false;
      $("autoline").textContent = `Atualizando preços de hoje… ${done + 1} de ${ids.length}`;
      try { const r = await api("POST", `/api/items/${id}/auto-refresh`); credits += r.credits || 0; } catch (e) {}
      done++;
    }
    autoRunning = false;
    await load();
    toast(`Preços de hoje atualizados (${ids.length} ${ids.length === 1 ? "item" : "itens"}) · ${creditsText(credits)}.`);
  }

  /* -------- render -------- */
  function renderTabs() {
    const counts = { todas: items.length };
    items.forEach(i => { counts[i.category] = (counts[i.category] || 0) + 1; });
    $("tabs").innerHTML = [{ id: "todas", label: "Todas" }, ...CATS].map(c =>
      `<button type="button" class="tab" role="tab" data-cat="${c.id}" aria-selected="${cat === c.id}">${c.label}<span class="n">${counts[c.id] || 0}</span></button>`
    ).join("");
  }

  // Uma seção de país: lista "loja ........ preço", uma loja por linha.
  function countryHtml(rows, cur, cls, title) {
    const list = rows || [];
    const p = priced(list);
    const low = p.length ? Math.min(...p.map(r => r.price)) : null;
    const body = list.length ? `<ul class="rows">${list.map(r => {
      const has = typeof r.price === "number";
      const url = safeUrl(r.url);
      const name = url ? `<a class="store" href="${esc(url)}" target="_blank" rel="noopener">${esc(r.store)}</a>` : `<span class="store">${esc(r.store)}</span>`;
      let delta = "";
      if (has && typeof r.previous_price === "number" && r.previous_price !== r.price) {
        const d = r.price - r.previous_price;
        delta = `<span class="delta ${d < 0 ? "down" : "up"}" title="Antes: ${money(r.previous_price, cur)}">${d < 0 ? "↓" : "↑"}${num(Math.abs(d))}</span>`;
      }
      const state = !has ? " na" : (r.price === low ? " low" : "");
      return `<li class="row${state}">${name}<span class="dots" aria-hidden="true"></span>${delta}<span class="p">${has ? `${money(r.price, cur)}<small class="brl">${brl(r.price, cur)}</small>` : "não vende"}</span></li>`;
    }).join("")}</ul>` : `<p class="none">Ainda sem preço</p>`;
    return { html: `<section class="country ${cls}"><h4>${title}</h4>${body}</section>`, low, rows: p };
  }

  function card(it) {
    const us = countryHtml(it.prices.us, "USD", "us", "Estados Unidos");
    const ca = countryHtml(it.prices.ca, "CAD", "ca", "Canadá");
    const pending = !us.rows.length && !ca.rows.length;

    // Um quadro de "melhor preço" para cada país.
    const bestBox = (side, cur, label) => {
      if (side.low == null) {
        return `<div class="best empty-best"><span class="best-label">${label}</span><span class="best-price">—</span><span class="best-where">Ainda sem preço</span></div>`;
      }
      const stores = side.rows.filter(r => r.price === side.low).map(r => r.store);
      const where = stores.length > 2 ? `em ${stores.length} lojas` : stores.join(" e ");
      return `<div class="best"><span class="best-label">${label}</span><span class="best-price">${money(side.low, cur)}</span><span class="best-brl">${brl(side.low, cur)}</span><span class="best-where">${esc(where)}</span></div>`;
    };
    const best = `<div class="bests">${bestBox(us, "USD", "EUA")}${bestBox(ca, "CAD", "Canadá")}</div>`;

    const kicker = [catLabel(it.category), it.official_store].filter(Boolean).map(esc).join(" · ");
    const foot = it.prices_checked_at ? `Atualizado em ${fmtDate(it.prices_checked_at)}` : `Adicionado em ${fmtDate(it.created_at)}`;
    const img = safeUrl(it.image_url);
    return `<article class="card">
      ${img ? `<div class="photo"><img src="${esc(img)}" alt="${esc(it.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></div>` : ""}
      <div class="card-body">
        <p class="kicker">${kicker}${pending ? ` <span class="pending">· aguardando preços</span>` : ""}</p>
        <h3>${esc(it.name)}</h3>
        ${it.model ? `<p class="model">${esc(it.model)}</p>` : ""}
        ${it.variant ? `<p class="variant"><span>Cor / tamanho</span>${esc(it.variant)}</p>` : ""}
        ${it.note ? `<p class="note">${esc(it.note)}</p>` : ""}
        ${best}
        <div class="countries">${us.html}${ca.html}</div>
      </div>
      <footer class="card-foot"><span>${foot}</span><span class="acts">
        <button type="button" class="act" data-refresh="${it.id}" title="Confere os links de graça; usa a SerpApi só se precisar">Atualizar</button>
        ${autoPrices ? `<button type="button" class="act" data-refresh="${it.id}" data-full="1" title="Pesquisa em todas as lojas (gasta até 4 consultas da SerpApi)">Busca completa</button>` : ""}
        <button type="button" class="act" data-edit="${it.id}">Editar preços</button>
        <button type="button" class="act" data-del="${it.id}">Remover</button>
      </span></footer>
    </article>`;
  }

  function render() {
    renderTabs();
    $("refreshAll").hidden = !items.length;
    if (!autoRunning) $("autoline").hidden = true; // só aparece enquanto atualiza os preços do dia
    if (!loaded) return;
    const term = q.trim().toLowerCase();
    const shown = items
      .filter(i => cat === "todas" || i.category === cat)
      .filter(i => !term || `${i.name} ${i.model} ${i.variant || ""} ${i.note}`.toLowerCase().includes(term));
    const pend = items.filter(i => !priced(i.prices.us).length && !priced(i.prices.ca).length).length;
    $("summary").innerHTML = items.length
      ? `<span><strong>${items.length}</strong> ${items.length === 1 ? "item" : "itens"} na lista</span><span><strong>${pend}</strong> aguardando pesquisa</span>`
      : "";
    if (!items.length) {
      $("list").innerHTML = `<div class="empty"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M14 18h20l-2 22H16z"/><path d="M19 18v-3a5 5 0 0 1 10 0v3"/><path d="M24 26c-1.5-2-5-1.5-5 1 0 2.5 5 5.5 5 5.5s5-3 5-5.5c0-2.5-3.5-3-5-1z" fill="currentColor" stroke="none"/></svg><h2>Sua lista está vazia</h2><p>Clique em <b>+ Adicionar item</b>, escreva o produto com marca e modelo e escolha a categoria.</p></div>`;
    } else if (!shown.length) {
      $("list").innerHTML = `<div class="empty"><h2>Nada por aqui</h2><p>Nenhum item ${term ? "corresponde à busca" : "nesta categoria"}.</p></div>`;
    } else {
      $("list").innerHTML = `<div class="grid">${shown.map(card).join("")}</div>`;
    }
  }

  /* -------- eventos -------- */
  $("brlRates").textContent = `US$ 1 = R$ ${num(BRL.USD)} e C$ 1 = R$ ${num(BRL.CAD)}`;
  $("f-cat").innerHTML = CATS.map(c => `<option value="${c.id}">${c.label}</option>`).join("");

  $("tabs").addEventListener("click", e => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    cat = b.dataset.cat; try { localStorage.setItem("lc-cat", cat); } catch (err) {}
    render();
  });
  $("q").addEventListener("input", e => { q = e.target.value; render(); });

  const panel = $("addPanel");
  $("addToggle").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { if (cat !== "todas") $("f-cat").value = cat; $("f-name").focus(); }
  });
  $("addCancel").addEventListener("click", () => { panel.hidden = true; $("formMsg").textContent = ""; });

  $("addForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("addSave").disabled = true; $("formMsg").textContent = "";
    try {
      const item = await api("POST", "/api/items", {
        name: $("f-name").value, model: $("f-model").value, category: $("f-cat").value,
        official_store: $("f-official").value, note: $("f-note").value, image_url: $("f-image").value,
        variant: $("f-variant").value,
      });
      $("addForm").reset(); panel.hidden = true;
      await load();
      if (autoPrices) refreshOne(item.id, null, true);
      else toast("Item salvo. Use “Editar preços” para adicionar os preços.");
    } catch (err) { $("formMsg").textContent = err.message; }
    finally { $("addSave").disabled = false; }
  });

  const creditsText = n => n ? `${n} consulta${n > 1 ? "s" : ""} da SerpApi` : "nenhuma consulta da SerpApi";

  async function refreshOne(id, btn, full = false) {
    const label = btn && btn.textContent;
    if (btn) { btn.disabled = true; btn.textContent = full ? "Buscando…" : "Atualizando…"; }
    try {
      const r = await api("POST", `/api/items/${id}/refresh${full ? "?full=1" : ""}`);
      const parts = [];
      if (r.direct) parts.push(`${r.direct} conferido(s) pelo link`);
      if (r.searched) parts.push(`${r.found} encontrado(s) na busca`);
      toast(`${r.name}: ${parts.join(", ") || "nada novo"} · ${creditsText(r.credits)}.${r.errors.length ? " " + r.errors.join(" ") : ""}`);
      await load();
    } catch (err) { toast(err.message); if (btn) { btn.disabled = false; btn.textContent = label; } }
  }

  $("refreshAll").addEventListener("click", async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "Atualizando…";
    try {
      // Um item por vez (cada pedido fica curto, o que a Vercel exige).
      let direct = 0, credits = 0, n = 0;
      for (const it of items.slice()) {
        b.textContent = `Atualizando… ${++n}/${items.length}`;
        const r = await api("POST", `/api/items/${it.id}/refresh`);
        direct += r.direct; credits += r.credits;
      }
      toast(`${n} item(ns) atualizados: ${direct} preço(s) conferidos pelo link · ${creditsText(credits)}.`);
      await load();
    } catch (err) { toast(err.message); }
    finally { b.disabled = false; b.textContent = "Atualizar todos os preços"; }
  });

  $("list").addEventListener("click", async e => {
    const ref = e.target.closest("[data-refresh]");
    if (ref) return refreshOne(ref.dataset.refresh, ref, ref.dataset.full === "1");
    const ed = e.target.closest("[data-edit]");
    if (ed) return openEditor(Number(ed.dataset.edit));
    const b = e.target.closest("[data-del]");
    if (!b) return;
    if (!b.classList.contains("confirm")) {
      b.classList.add("confirm"); b.textContent = "Confirmar?";
      setTimeout(() => { if (b.isConnected) { b.classList.remove("confirm"); b.textContent = "Remover"; } }, 4000);
      return;
    }
    b.disabled = true;
    try { await api("DELETE", `/api/items/${b.dataset.del}`); toast("Item removido."); await load(); }
    catch (err) { toast(err.message); b.disabled = false; }
  });

  /* -------- editor de preços -------- */
  const dlg = $("editor");
  let editingId = null;

  function priceRow(country, r = {}) {
    const div = document.createElement("div");
    div.className = "price-row";
    div.innerHTML = `
      <input class="store" list="stores-${country}" placeholder="Loja" aria-label="Loja" value="${esc(r.store || "")}">
      <input class="price" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Preço" aria-label="Preço" value="${typeof r.price === "number" ? r.price : ""}">
      <button type="button" class="btn-ghost rm" aria-label="Remover loja">×</button>
      <input class="url" type="url" placeholder="Link do produto (opcional)" aria-label="Link do produto" value="${esc(r.url || "")}">`;
    div.querySelector(".rm").addEventListener("click", () => div.remove());
    return div;
  }

  function openEditor(id) {
    const it = items.find(i => i.id === id); if (!it) return;
    editingId = id;
    $("editorName").textContent = [it.name, it.model].filter(Boolean).join(" · ");
    $("editorMsg").textContent = "";
    for (const c of ["us", "ca"]) {
      const box = $(`rows-${c}`); box.innerHTML = "";
      const rows = it.prices[c].length ? it.prices[c] : [{}];
      rows.forEach(r => box.appendChild(priceRow(c, r)));
    }
    dlg.showModal();
  }

  dlg.addEventListener("click", e => {
    const add = e.target.closest("[data-addrow]");
    if (add) $(`rows-${add.dataset.addrow}`).appendChild(priceRow(add.dataset.addrow));
  });
  $("editorCancel").addEventListener("click", () => dlg.close());

  $("editorForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("editorSave").disabled = true;
    try {
      for (const c of ["us", "ca"]) {
        const rows = [...$(`rows-${c}`).querySelectorAll(".price-row")].map(row => ({
          store: row.querySelector(".store").value,
          price: row.querySelector(".price").value,
          url: row.querySelector(".url").value,
        })).filter(r => r.store.trim());
        await api("PUT", `/api/items/${editingId}/prices/${c}`, { rows });
      }
      dlg.close(); toast("Preços salvos."); await load();
    } catch (err) { $("editorMsg").textContent = err.message; }
    finally { $("editorSave").disabled = false; }
  });

  render();
  load().then(runAuto);

  /* -------- celular: esconde o topo ao rolar para baixo, mostra ao rolar para cima -------- */
  (function () {
    const top = document.querySelector("header.top");
    const mobile = window.matchMedia("(max-width: 720px)");
    let lastY = window.scrollY;
    window.addEventListener("scroll", () => {
      const y = window.scrollY;
      if (!mobile.matches || y < 80 || document.activeElement === $("q")) top.classList.remove("escondido");
      else if (y > lastY + 6) top.classList.add("escondido");
      else if (y < lastY - 6) top.classList.remove("escondido");
      lastY = y;
    }, { passive: true });
  })();
})();
