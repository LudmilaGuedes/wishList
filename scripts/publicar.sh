#!/usr/bin/env bash
# Publica sozinho: se houver mudanças no código, faz commit e envia para o GitHub.
# A Vercel vê o envio e atualiza o site em ~1 minuto.
# Usado pelo hook "Stop" do Claude Code (.claude/settings.local.json). Pode rodar à mão: bash scripts/publicar.sh
cd "$(dirname "$0")/.." || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git add -A 2>/dev/null
if ! git diff --cached --quiet; then
  arquivos=$(git diff --cached --name-only | head -5 | tr '\n' ' ')
  git commit -q -m "Atualização automática: ${arquivos}" || exit 0
fi
# Envia se houver commits ainda não enviados
if [ -n "$(git log origin/main..HEAD --oneline 2>/dev/null)" ]; then
  if git push -q origin main 2>/dev/null; then
    echo '{"systemMessage": "Publicado: mudanças enviadas ao GitHub, o site se atualiza em ~1 min."}'
  else
    echo '{"systemMessage": "Atenção: não consegui enviar ao GitHub (sem internet?). Tento de novo na próxima vez."}'
  fi
fi
exit 0
