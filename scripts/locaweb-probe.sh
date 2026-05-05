#!/usr/bin/env bash
# scripts/locaweb-probe.sh
#
# Probe diagnóstico — não dispara email. Lista domínios + senders e tenta
# um POST /messages incompleto pra capturar a mensagem de erro EXATA da
# Locaweb (revela o que falta na conta: domain_id, sender pendente, etc.)
#
# USO:
#   LOCAWEB_EM_TOKEN=xxx LOCAWEB_EM_ACCOUNT_ID=202654 \
#     bash scripts/locaweb-probe.sh
#
# Sem zsh/quoting drama: salva tudo em /tmp/locaweb-probe-*.json e imprime
# o conteúdo no fim.

set -u

TOKEN="${LOCAWEB_EM_TOKEN:-}"
ACCT="${LOCAWEB_EM_ACCOUNT_ID:-}"
BASE="${LOCAWEB_EM_BASE_URL:-https://emailmarketing.locaweb.com.br/api/v1}"

if [ -z "$TOKEN" ] || [ -z "$ACCT" ]; then
  echo "ERRO: defina LOCAWEB_EM_TOKEN e LOCAWEB_EM_ACCOUNT_ID antes de rodar."
  echo "Exemplo:"
  echo "  LOCAWEB_EM_TOKEN=xxx LOCAWEB_EM_ACCOUNT_ID=202654 bash scripts/locaweb-probe.sh"
  exit 1
fi

OUT_DIR="/tmp"
TS="$(date +%s)"

probe() {
  local name="$1"; shift
  local file="$OUT_DIR/locaweb-probe-${name}-${TS}.json"
  local headers_file="$OUT_DIR/locaweb-probe-${name}-${TS}.headers"
  echo ""
  echo "============================================================"
  echo "[$name]"
  echo "============================================================"
  curl -sS -D "$headers_file" -o "$file" "$@"
  local rc=$?
  if [ $rc -ne 0 ]; then
    echo "(curl exit code $rc)"
  fi
  echo "--- HTTP status ---"
  head -1 "$headers_file" 2>/dev/null
  echo "--- body (first 2000 chars) ---"
  head -c 2000 "$file"
  echo ""
}

probe "domains" \
  -H "X-Auth-Token: $TOKEN" \
  -H "Accept: application/json" \
  "$BASE/accounts/$ACCT/domains"

probe "senders" \
  -H "X-Auth-Token: $TOKEN" \
  -H "Accept: application/json" \
  "$BASE/accounts/$ACCT/senders"

probe "lists" \
  -H "X-Auth-Token: $TOKEN" \
  -H "Accept: application/json" \
  "$BASE/accounts/$ACCT/lists"

# Probe POST /messages com payload inválido só pra capturar o erro real
probe "messages_probe" \
  -X POST \
  -H "X-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"name":"probe","subject":"probe","sender":"contato@bulking.com.br","sender_name":"BULKING","html_body":"<p>x</p>","list_ids":[]}' \
  "$BASE/accounts/$ACCT/messages"

echo ""
echo "============================================================"
echo "Outputs salvos em $OUT_DIR/locaweb-probe-*-${TS}.{json,headers}"
echo "Cola tudo acima na chat se quiser análise."
