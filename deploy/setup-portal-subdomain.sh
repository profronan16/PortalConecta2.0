#!/usr/bin/env bash
# ==============================================================================
# Portal Conecta 2.0 — provisionamento do subdomínio portal.ifcoding.com.br
#
# Rode NA VPS como root:   bash setup-portal-subdomain.sh
#
# O script é IDEMPOTENTE e NÃO toca no vhost do FECIPE (ifcoding.com.br).
# Faz backup de tudo que altera antes de alterar.
# ==============================================================================
set -euo pipefail

DOMAIN="portal.ifcoding.com.br"
VPS_IP="198.44.123.154"
EMAIL="${CERTBOT_EMAIL:-ronan.lopes@ifpr.edu.br}"
FILES_ROOT="/var/www/portal-files"
WEBROOT="/var/www/certbot"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[AVISO] %s\033[0m\n' "$*"; }

# ------------------------------------------------------------------------------
# 0) Pré-checagens
# ------------------------------------------------------------------------------
log "Pré-checagens"

if [[ $EUID -ne 0 ]]; then
  echo "ERRO: rode como root (sudo bash $0)" >&2
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "ERRO: nginx não encontrado nesta VPS." >&2
  exit 1
fi

# O registro DNS precisa existir ANTES do certbot, senão a validação ACME falha.
RESOLVED="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -n1 || true)"
if [[ -z "$RESOLVED" ]]; then
  echo "ERRO: $DOMAIN não resolve. Crie primeiro o registro DNS:" >&2
  echo "       Tipo A | Nome: portal | Valor: $VPS_IP | TTL: 300" >&2
  exit 1
fi
if [[ "$RESOLVED" != "$VPS_IP" ]]; then
  warn "$DOMAIN resolve para $RESOLVED (esperado $VPS_IP). Continuando mesmo assim."
else
  echo "DNS OK: $DOMAIN -> $RESOLVED"
fi

# ------------------------------------------------------------------------------
# 1) Diretórios
# ------------------------------------------------------------------------------
log "Criando diretórios de armazenamento e webroot ACME"
mkdir -p "$FILES_ROOT"/{pdf,imagens,outros}
mkdir -p "$WEBROOT"

# Dono: o usuário do serviço Node. Ajuste se na sua VPS o app roda com outro user.
APP_USER="${APP_USER:-www-data}"
chown -R "$APP_USER":"$APP_USER" "$FILES_ROOT" 2>/dev/null || warn "não consegui chown para $APP_USER"
chmod 755 "$FILES_ROOT" "$FILES_ROOT"/*

# ------------------------------------------------------------------------------
# 2) Vhost
# ------------------------------------------------------------------------------
log "Instalando vhost do nginx"
SRC_CONF="$(dirname "$0")/nginx-portal.ifcoding.com.br.conf"
AVAIL="/etc/nginx/sites-available/$DOMAIN"
ENABLED="/etc/nginx/sites-enabled/$DOMAIN"

if [[ ! -f "$SRC_CONF" ]]; then
  echo "ERRO: não encontrei $SRC_CONF (rode o script da mesma pasta do .conf)" >&2
  exit 1
fi

# Backup do estado atual do nginx (nunca é demais)
BACKUP="/root/nginx-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
log "Backup do /etc/nginx em $BACKUP"
tar czf "$BACKUP" /etc/nginx

cp "$SRC_CONF" "$AVAIL"

if [[ ! -L "$ENABLED" ]]; then
  ln -s "$AVAIL" "$ENABLED"
  echo "symlink criado: $ENABLED"
else
  echo "symlink já existia: $ENABLED"
fi

# ------------------------------------------------------------------------------
# 3) Validar ANTES de recarregar (se quebrar, o FECIPE continua no ar)
# ------------------------------------------------------------------------------
log "Validando configuração do nginx"
if ! nginx -t; then
  echo "" >&2
  echo "ERRO: 'nginx -t' falhou — NADA foi recarregado, o site atual segue intacto." >&2
  echo "Backup em: $BACKUP" >&2
  exit 1
fi

# ------------------------------------------------------------------------------
# 4) Certificado Let's Encrypt
# ------------------------------------------------------------------------------
log "Obtendo certificado TLS para $DOMAIN"
if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  echo "Certificado já existe — renovando/expandindo."
  certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos -m "$EMAIL" --expand
else
  if ! command -v certbot >/dev/null 2>&1; then
    warn "certbot não instalado. Instale e rode de novo:"
    warn "  apt update && apt install -y certbot python3-certbot-nginx"
    exit 1
  fi
  certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos -m "$EMAIL"
fi

# ------------------------------------------------------------------------------
# 5) Recarregar e verificar
# ------------------------------------------------------------------------------
log "Recarregando nginx"
nginx -t && systemctl reload nginx

log "Verificação final"
echo "--- nginx -T (só o server_name do portal) ---"
nginx -T 2>/dev/null | grep -n "server_name $DOMAIN" || true
echo ""
echo "--- HTTPS ---"
curl -sS -o /dev/null -w "portal: HTTP %{http_code}\n" "https://$DOMAIN/" || true
echo "--- FECIPE preservado? ---"
curl -sS -o /dev/null -w "fecipe: HTTP %{http_code}\n" "https://ifcoding.com.br/" || true

log "Pronto"
cat <<EOF

Subdomínio configurado. Próximos passos:

  1. Ligue o app na porta 3000 (bloco (A) do vhost está comentado — descomente-o).
     Ex.: /etc/systemd/system/portal-conecta.service  ->  next start -p 3000

  2. Arquivos enviados ficam em: $FILES_ROOT
     Servidos publicamente em:    https://$DOMAIN/files/...

  3. Renovação automática do certificado (já vem do certbot):
       systemctl list-timers | grep certbot

Backup do nginx antes das mudanças: $BACKUP
EOF
