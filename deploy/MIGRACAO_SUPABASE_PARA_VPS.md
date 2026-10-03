# Migração — Supabase → PostgreSQL local na VPS

**Decisão:** hospedar o Portal Conecta inteiro na VPS (app + banco + arquivos),
substituindo o Supabase por um PostgreSQL local com pgvector.

---

## Por que isso é uma boa troca

| Aspecto | Supabase (hoje) | Postgres local na VPS |
|---|---|---|
| Custo | free tier (pausa por inatividade) | R$ 0 (já incluído na VPS) |
| pgvector | precisa ser habilitado no painel | `CREATE EXTENSION vector;` — uma linha |
| Latência banco↔app | rede (região aws-1-sa-east-1) | socket local (localhost) |
| Limite de conexões | pooler necessário em serverless | conexão direta, sem pooler |
| Pausa por inatividade | sim (foi o motivo do cron `keep-db-alive`) | não existe |
| Dependência externa | Supabase fora do ar = portal fora do ar | tudo no mesmo servidor |
| Backup | gerenciado | **sua responsabilidade** (ver §5) |

Ganho concreto e imediato: **o cron `/api/cron/keep-db-alive` deixa de ser
necessário.** Ele existe só para evitar a pausa automática do Supabase —
um Postgres local nunca pausa. Isso remove uma peça móvel e uma entrada em
`vercel.json`.

O custo real da troca é operacional: **backup passa a ser seu**. É o único
ponto que exige disciplina (§5).

---

## 1. Provisionar o Postgres na VPS

```bash
# Copie a pasta deploy/ para a VPS e rode:
bash deploy/setup-postgres-local.sh
```

O script é idempotente e ao final imprime a connection string com a senha
gerada. Ele já:
- instala `postgresql-16` do repositório oficial (PGCG);
- instala `postgresql-16-pgvector` (a extensão `vector`);
- cria o banco e o usuário da aplicação;
- roda `CREATE EXTENSION IF NOT EXISTS vector;`;
- verifica e mostra a versão do pgvector instalada.

---

## 2. Aplicar o schema

```bash
cd /var/www/portal-conecta

# 2.1 Schema completo (cria todas as tabelas)
npx prisma db push

# 2.2 Coluna vetorial + função de busca
#     O schema Prisma declara `embedding` como Unsupported("vector(1536)")
#     justamente porque quem cria a coluna é este SQL, não o `db push`.
psql "$DATABASE_URL" -f prisma/pgvector-setup.sql
```

Verificação (deve retornar a coluna e a função):

```bash
psql "$DATABASE_URL" -c "\d chunks_kb"
psql "$DATABASE_URL" -c "SELECT proname FROM pg_proc WHERE proname='match_chunks_kb';"
```

> **Este é o passo que faltava no Supabase.** Sem ele, `searchSimilarChunks`
> cai no fallback em memória, que devolve `similarity: 0.5` fixo para todo
> chunk — o RAG responde, mas sem busca semântica nenhuma.

---

## 3. Migrar os dados existentes (opcional)

Se você já tem dados no Supabase que valem preservar:

### 3.1 Dump do Supabase

Pegue a connection string do Supabase no painel (Project Settings → Database).
A **direct connection** (porta 5432) é a mais confiável para dump.

```bash
# Schema + dados, ignorando os objetos internos do Supabase
pg_dump "$SUPABASE_DATABASE_URL" \
  --no-owner --no-privileges --no-acl \
  --exclude-schema=auth \
  --exclude-schema=storage \
  --exclude-schema=realtime \
  --exclude-schema=supabase_functions \
  --exclude-schema=vault \
  -f supabase-dump.sql
```

### 3.2 Restaurar no Postgres local

```bash
psql "$DATABASE_URL" -f supabase-dump.sql
```

### 3.3 Reaplicar o pgvector

O dump do Supabase costuma trazer `CREATE EXTENSION vector` e a coluna
`embedding` junto, mas a função `match_chunks_kb` e o índice HNSW podem vir
fora de ordem. Rodar o setup de novo é inofensivo (tudo é `IF NOT EXISTS`):

```bash
psql "$DATABASE_URL" -f prisma/pgvector-setup.sql
```

### 3.4 Alternativa mais segura: só o essencial

Se o dump completo der atrito (conflito de extensões, `auth.*` etc.), migre
apenas as tabelas que têm conteúdo real. As candidatas, em ordem de
importância:

```bash
for t in "User" "Projeto" "Edital" "Inscricao" "Vaga" "Post" "Evento" \
         "documentos_kb" "chunks_kb" "SiteConfig" "PerfilAluno" \
         "ProjectCoordinator" "UserPermission"; do
  pg_dump "$SUPABASE_DATABASE_URL" --data-only --no-owner --no-acl \
    -t "\"$t\"" >> dados-essenciais.sql
done
psql "$DATABASE_URL" -f dados-essenciais.sql
```

> **Atenção com `chunks_kb`:** a coluna `embedding` é `vector(1536)`. O
> `pg_dump` escreve o valor como texto (`'[0.1,0.2,...]'::vector`), o que
> funciona. Mas se você **trocar de provedor de embedding** depois, os vetores
> antigos ficam incompatíveis — nesse caso o caminho certo é **reindexar**
> (novo upload / nova indexação) em vez de migrar os chunks.

---

## 4. Ajustar o `.env` do projeto

```dotenv
# Banco local — não esqueça o `?schema=public`
DATABASE_URL="postgresql://portal:SENHA@127.0.0.1:5432/portal_conecta?schema=public&connection_limit=10"
DIRECT_URL="postgresql://portal:SENHA@127.0.0.1:5432/portal_conecta?schema=public"

# Armazenamento local de arquivos (10MB PDF / 5MB imagem)
STORAGE_ROOT=/var/www/portal-files
STORAGE_PUBLIC_PREFIX=/files

# URL pública real (usada por NextAuth e pelos links absolutos)
NEXTAUTH_URL=https://portal.ifcoding.com.br
```

As variáveis do Supabase (`NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, etc.) **podem ser removidas** — depois desta
migração nenhum código as consome. Vale conferir antes com:

```bash
grep -rn "SUPABASE_" src/ --include=*.ts --include=*.tsx
```

Se o único resultado for `src/lib/supabase.ts` (que não é importado por
ninguém), o arquivo pode ser apagado junto.

---

## 5. Backup — o que passa a ser sua responsabilidade

Sem o Supabase, não há backup gerenciado. O mínimo aceitável:

```bash
# /etc/cron.daily/portal-backup
#!/bin/bash
set -euo pipefail
DEST=/var/backups/portal
mkdir -p "$DEST"
STAMP=$(date +%F-%H%M)

# Banco
sudo -u postgres pg_dump portal_conecta | gzip > "$DEST/db-$STAMP.sql.gz"

# Arquivos enviados (10MB PDFs / imagens)
tar czf "$DEST/files-$STAMP.tar.gz" /var/www/portal-files

# Retenção de 30 dias
find "$DEST" -type f -mtime +30 -delete
```

```bash
chmod +x /etc/cron.daily/portal-backup
```

**Backup que nunca foi testado não é backup.** Uma vez por mês, restaure o
dump mais recente num banco descartável (`portal_teste`) e confirme que as
tabelas têm linhas.

---

## 6. Checklist da migração

- [ ] `setup-postgres-local.sh` rodou e mostrou a versão do pgvector
- [ ] `npx prisma db push` concluiu sem erro
- [ ] `pgvector-setup.sql` aplicado (`\d chunks_kb` mostra a coluna `embedding`)
- [ ] `match_chunks_kb` existe em `pg_proc`
- [ ] Dados migrados (ou banco novo, se for lançamento limpo)
- [ ] `.env` aponta para `127.0.0.1` e `STORAGE_ROOT=/var/www/portal-files`
- [ ] App sobe e `/projetos` lista os projetos
- [ ] Upload de PDF de teste grava em `/var/www/portal-files/pdf/...`
- [ ] PDF acessível em `https://portal.ifcoding.com.br/files/pdf/...`
- [ ] `/api/chat` responde citando documentos (prova que o RAG lê do banco)
- [ ] Backup diário configurado E **testado uma vez**
- [ ] `vercel.json` (e o cron `keep-db-alive`) removidos, se não usar mais Vercel

---

## 7. Sobre o cron `keep-db-alive`

Depois da migração ele perde a razão de existir:

- `src/app/api/cron/keep-db-alive/route.ts`
- a entrada `crons` em `vercel.json`

Não apaguei automaticamente porque ele é inofensivo (só faz `SELECT 1`) e
removê-lo é uma decisão sua. Quando quiser, é só apagar o arquivo da rota e o
`vercel.json`.
