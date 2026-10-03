#!/usr/bin/env bash
# ==============================================================================
# Portal Conecta 2.0 — PostgreSQL 16 + pgvector no AlmaLinux 9 (VPS CyberPanel)
# ==============================================================================
# Rode NA VPS como root:   bash /root/setup-postgres-almalinux.sh
#
# POR QUE O REPOSITÓRIO PGDG:
#   O repo base do AlmaLinux 9 (appstream) só oferece PostgreSQL 13, e o
#   pgvector exige >= 15. O repositório oficial do PostgreSQL (PGDG) fornece
#   postgresql16-server e pgvector_16 para EL9.
#
# POR QUE COEXISTE COM O CYBERPANEL:
#   O CyberPanel opera com MariaDB (porta 3306). O PostgreSQL sobe em 5432 e
#   escuta apenas em 127.0.0.1, então não há conflito nem exposição externa.
#
# ⚠️  O script NÃO toca em: nginx, OpenLiteSpeed, MariaDB, CyberPanel.
#     Ele só adiciona o PostgreSQL 16 e um banco novo.
#
# É idempotente: rodar duas vezes não quebra nada.
# ==============================================================================
set -euo pipefail

DB_NAME="${DB_NAME:-portal_conecta}"
DB_USER="${DB_USER:-portal}"
DB_PASS="${DB_PASS:-$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)}"
PG_MAJOR="${PG_MAJOR:-16}"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[AVISO] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[ERRO] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "rode como root"

# ------------------------------------------------------------------------------
# 0) Sanidade: confirmar que é EL9 e que a porta 5432 está livre
# ------------------------------------------------------------------------------
log "Checando o ambiente"

. /etc/os-release
[[ "$ID" == "almalinux" || "$ID_LIKE" == *rhel* ]] \
  || die "esperado AlmaLinux/RHEL, encontrado: $PRETTY_NAME"

if ss -tlnp 2>/dev/null | grep -q ':5432 '; then
  warn "já existe algo escutando na porta 5432 — o script vai continuar, mas confira depois"
fi

echo "SO: $PRETTY_NAME"
echo "CPU: $(nproc)  |  RAM: $(free -m | awk '/^Mem:/{print $2" MB"}')"
echo "Disco livre em /: $(df -h / | awk 'NR==2{print $4}')"

# ------------------------------------------------------------------------------
# 1) Repositório PGDG
# ------------------------------------------------------------------------------
log "Configurando o repositório oficial do PostgreSQL (PGDG)"

if rpm -q pgdg-redhat-repo >/dev/null 2>&1; then
  echo "pgdg-redhat-repo já instalado"
else
  dnf install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm"
fi

# O módulo `postgresql` do AppStream conflita com os pacotes do PGDG:
# sem desabilitá-lo, o dnf instala o Postgres 13 do AlmaLinux em vez do 16.
log "Desabilitando o módulo postgresql do AppStream (evita conflito de versão)"
dnf -qy module disable postgresql || warn "não consegui desabilitar o módulo (pode não existir)"

# ------------------------------------------------------------------------------
# 2) Instalar PostgreSQL 16 + pgvector
# ------------------------------------------------------------------------------
log "Instalando PostgreSQL $PG_MAJOR e pgvector"

dnf install -y \
  "postgresql${PG_MAJOR}-server" \
  "postgresql${PG_MAJOR}" \
  "postgresql${PG_MAJOR}-contrib" \
  "pgvector_${PG_MAJOR}"

# ------------------------------------------------------------------------------
# 3) Inicializar o cluster e subir o serviço
# ------------------------------------------------------------------------------
log "Inicializando o cluster de dados"

PGDATA="/var/lib/pgsql/${PG_MAJOR}/data"
if [[ -s "$PGDATA/PG_VERSION" ]]; then
  echo "cluster já inicializado em $PGDATA"
else
  "/usr/pgsql-${PG_MAJOR}/bin/postgresql-${PG_MAJOR}-setup" initdb
fi

log "Subindo o serviço"
systemctl enable --now "postgresql-${PG_MAJOR}"
sleep 2
systemctl is-active --quiet "postgresql-${PG_MAJOR}" \
  || die "o serviço postgresql-${PG_MAJOR} não subiu — veja: journalctl -u postgresql-${PG_MAJOR} -n 50"

echo "serviço ativo: postgresql-${PG_MAJOR}"
echo "versão: $(sudo -u postgres psql -tAc 'SHOW server_version;')"

# ------------------------------------------------------------------------------
# 4) Criar usuário e banco (idempotente)
# ------------------------------------------------------------------------------
log "Criando usuário '$DB_USER' e banco '$DB_NAME'"

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  echo "usuário já existe — atualizando a senha"
  sudo -u postgres psql -q -c "ALTER ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASS';"
else
  sudo -u postgres psql -q -c "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASS';"
fi

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  echo "banco já existe"
else
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

# ------------------------------------------------------------------------------
# 5) pgvector — o passo que faltava no Supabase
# ------------------------------------------------------------------------------
log "Habilitando a extensão pgvector no banco $DB_NAME"
sudo -u postgres psql -q -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Prisma precisa criar tabelas/índices neste schema
sudo -u postgres psql -q -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO \"$DB_USER\";"
sudo -u postgres psql -q -d "$DB_NAME" -c "ALTER SCHEMA public OWNER TO \"$DB_USER\";"

# ------------------------------------------------------------------------------
# 6) Endurecimento: aceitar conexão só do próprio host
# ------------------------------------------------------------------------------
# O CyberPanel já expõe muitos serviços; o Postgres não precisa estar na
# internet. `listen_addresses = 'localhost'` garante isso no nível do servidor.
log "Restringindo o Postgres a conexões locais"

PGCONF="/var/lib/pgsql/${PG_MAJOR}/data/postgresql.conf"
if grep -qE "^\s*listen_addresses" "$PGCONF"; then
  sed -i "s/^\s*listen_addresses.*/listen_addresses = 'localhost'/" "$PGCONF"
else
  echo "listen_addresses = 'localhost'" >> "$PGCONF"
fi
systemctl restart "postgresql-${PG_MAJOR}"
sleep 2

# ------------------------------------------------------------------------------
# 7) Verificação final
# ------------------------------------------------------------------------------
log "Verificando a instalação"

echo "--- extensão instalada ---"
sudo -u postgres psql -d "$DB_NAME" -tAc \
  "SELECT 'pgvector ' || extversion FROM pg_extension WHERE extname='vector';"

echo "--- o banco aceita conexão TCP local como $DB_USER? ---"
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT 'conexao TCP OK como ' || current_user;" \
  || die "falha ao conectar via TCP — verifique pg_hba.conf"

echo "--- porta 5432 escutando onde? ---"
ss -tlnp | grep ':5432' || echo "(nada na 5432?!)"

log "Concluído"
cat <<EOF

==================================================================
GUARDE ESTES DADOS — a senha NÃO é mostrada novamente
==================================================================
  banco:  $DB_NAME
  usuário: $DB_USER
  senha:   $DB_PASS
  porta:   5432 (apenas localhost)

CONNECTION STRING para o .env do projeto:

DATABASE_URL="postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?schema=public&connection_limit=10"
DIRECT_URL="postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?schema=public"
==================================================================

PRÓXIMOS PASSOS (no diretório do projeto, na VPS):

  1. npx prisma db push
        cria as 35 tabelas — inclusive vagas, perfis_aluno, documentos_kb,
        chunks_kb e rate_limit_hits, que faltavam no Supabase

  2. psql "\$DATABASE_URL" -f prisma/pgvector-setup.sql
        cria a coluna embedding vector(1536) e a função match_chunks_kb

  3. Conferir:
        psql "\$DATABASE_URL" -c "\d chunks_kb"
        psql "\$DATABASE_URL" -c "SELECT proname FROM pg_proc WHERE proname='match_chunks_kb';"
EOF
