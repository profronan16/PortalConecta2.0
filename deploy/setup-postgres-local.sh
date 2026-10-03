#!/usr/bin/env bash
# ==============================================================================
# Portal Conecta 2.0 — Provisiona PostgreSQL LOCAL + pgvector na VPS
#
# Rode NA VPS como root:  bash setup-postgres-local.sh
#
# Contexto: o projeto nasceu apontando para o Supabase, mas vai ser hospedado
# inteiro na VPS. Isso troca o banco gerenciado por um Postgres local no mesmo
# servidor, e tem uma consequência BOA e importante: como o banco passa a ser
# seu, instalar a extensão `vector` e criar a função `match_chunks_kb` deixa de
# ser um bloqueio de plataforma e vira um comando de uma linha.
#
# O script é idempotente: rodar duas vezes não quebra nada.
# ==============================================================================
set -euo pipefail

DB_NAME="${DB_NAME:-portal_conecta}"
DB_USER="${DB_USER:-portal}"
DB_PASS="${DB_PASS:-$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)}"
PG_VERSION="${PG_VERSION:-16}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "ERRO: rode como root (sudo bash $0)" >&2
  exit 1
fi

# ------------------------------------------------------------------------------
# 1) Repositório oficial do PostgreSQL (o da distro costuma ser antigo)
# ------------------------------------------------------------------------------
log "Adicionando repositório oficial do PostgreSQL (PGCG)"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg lsb-release

install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc

echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list

apt-get update -qq

# ------------------------------------------------------------------------------
# 2) Instalar PostgreSQL + pgvector
#     O pacote `postgresql-16-pgvector` traz a extensão `vector` — é ele que
#     substitui o que no Supabase era um botão no painel.
# ------------------------------------------------------------------------------
log "Instalando PostgreSQL $PG_VERSION e pgvector"
apt-get install -y -qq \
  "postgresql-$PG_VERSION" \
  "postgresql-$PG_VERSION-pgvector" \
  "postgresql-contrib-$PG_VERSION"

systemctl enable postgresql
systemctl start postgresql

# ------------------------------------------------------------------------------
# 3) Criar usuário e banco (idempotente)
# ------------------------------------------------------------------------------
log "Criando usuário '$DB_USER' e banco '$DB_NAME'"

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  echo "usuário $DB_USER já existe — atualizando senha"
  sudo -u postgres psql -c "ALTER ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASS';"
else
  sudo -u postgres psql -c "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASS';"
fi

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  echo "banco $DB_NAME já existe"
else
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

# ------------------------------------------------------------------------------
# 4) Habilitar pgvector — o passo que faltava no Supabase
# ------------------------------------------------------------------------------
log "Habilitando a extensão pgvector no banco $DB_NAME"
sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Dá ao usuário da aplicação permissão de criar objetos (Prisma precisa para
# rodar `db push` / migrations).
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO \"$DB_USER\";"
sudo -u postgres psql -d "$DB_NAME" -c "ALTER SCHEMA public OWNER TO \"$DB_USER\";"

# ------------------------------------------------------------------------------
# 5) Verificação
# ------------------------------------------------------------------------------
log "Verificando instalação"
sudo -u postgres psql -d "$DB_NAME" -tAc \
  "SELECT 'pgvector versao: ' || extversion FROM pg_extension WHERE extname='vector';"

log "Concluído"
cat <<EOF

------------------------------------------------------------------
CONNECTION STRING para o .env.local / .env.production:

DATABASE_URL="postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?schema=public&connection_limit=10"
DIRECT_URL="postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?schema=public"

GUARDE ESTA SENHA — ela não é mostrada de novo:
  usuário: $DB_USER
  senha:   $DB_PASS
  banco:   $DB_NAME
------------------------------------------------------------------

PRÓXIMOS PASSOS (na ordem):

  1. Aplicar o schema do Prisma:
       cd /var/www/portal-conecta
       npx prisma db push

  2. Criar a coluna vetorial e a função de busca (o schema Prisma declara
     `embedding` como Unsupported, então quem cria é o SQL):
       psql "\$DATABASE_URL" -f prisma/pgvector-setup.sql

  3. Conferir que a coluna e a função existem:
       psql "\$DATABASE_URL" -c "\\d chunks_kb"
       psql "\$DATABASE_URL" -c "SELECT proname FROM pg_proc WHERE proname='match_chunks_kb';"

  4. Migrar os dados do Supabase (se quiser preservar o que já existe):
       veja deploy/MIGRACAO_SUPABASE_PARA_VPS.md

OBSERVAÇÃO sobre o passo 2: o `pgvector-setup.sql` tem duas linhas de RLS
(ENABLE ROW LEVEL SECURITY) que fazem sentido no Supabase. Num Postgres local
onde só a aplicação acessa, RLS é opcional — se preferir manter simples, pode
ignorar essas duas linhas; elas não atrapalham.
EOF
