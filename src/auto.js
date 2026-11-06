// Regras da atualização automática ao abrir o site.
// - Antes de AUTO_REFRESH_FROM (padrão 2027-01-17): nada automático, só pelos botões.
// - A partir dessa data: ao abrir o site, cada item é atualizado no máximo 1 vez por dia.
// O "dia" é contado no horário de Toronto/Nova York (a viagem é na América do Norte).
const FROM = process.env.AUTO_REFRESH_FROM || "2027-01-17";
const TZ = process.env.AUTO_REFRESH_TZ || "America/Toronto";

// "2027-01-17" no fuso escolhido.
const dayKey = d => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d)) : "");
const today = () => dayKey(new Date());
const active = () => today() >= FROM;

function skipReason(item) {
  if (!active()) return `a atualização automática começa em ${FROM}`;
  if (dayKey(item.prices_checked_at) === today()) return "já atualizado hoje";
  return "";
}

function status(items) {
  return {
    from: FROM,
    active: active(),
    due: items.filter(i => !skipReason(i)).map(i => i.id),
  };
}

module.exports = { FROM, dayKey, today, active, skipReason, status };
