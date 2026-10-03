# Migração para PostgreSQL local / próprio

**Data:** 2026-09-16
**Situação:** em execução (passos 1–2 concluídos, 3–6 dependem de privilégio de administrador na máquina local)

---

## Por que esta migração

O projeto tinha `DATABASE_URL` apontando para um projeto Supabase
(`tmfalrsztreidcurxwss.supabase.co`) que **foi apagado** — o domínio nem resolve
mais. Resultado: o ambiente local não subia (erro `ENOTFOUND` do pooler do
Supabase), enquanto produção continuava funcionando em outro arranjo.

O código **não dependia da REST/Storage do Supabase**: a busca vetorial do RAG já
usava SQL direto via Prisma (`prisma.$queryRawUnsafe` com o operador `<=>` em
`src/lib/supabase-vector.ts`), e `src/lib/supabase.ts` (cliente REST) **não é
importado por ninguém** — é código morto. Ou seja: a migração era só trocar a
conexão de banco.

## Arquitetura depois da migração

| Ambiente | Onde roda | Banco |
|---|---|---|
| **Produção** — https://portal.ifcoding.com.br | VPS AlmaLinux 9.8 (IP e acesso SSH **fora deste repositório**), serviço systemd `portal-conecta.service`, código em `/var/www/portal-conecta`, porta 3000 atrás do nginx | PostgreSQL **16** local no próprio VPS, banco `portal_conecta` (dono `portal`), pgvector 0.8.6 |
| **Local (dev)** | Windows, `npm run dev` | PostgreSQL **18** local, banco `portal_conecta` (dono `portal_conecta`), pgvector 0.8.6 |

`prisma/schema.prisma` continua com `provider = "postgresql"`, `url = env("DATABASE_URL")`
e `directUrl = env("DIRECT_URL")`. No local os dois apontam para o mesmo banco
(sem pooler, que só era necessário no Supabase).

## Passos

### 1. pgvector no PostgreSQL 18 local ✅ (arquivos preparados)

O schema exige a extensão (modelo `chunks_kb` tem `embedding Unsupported("vector(1536)")`),
então `prisma db push` falha sem ela. Não há pacote no winget/choco; o binário veio do
build da comunidade para PG 18 (`vector.v0.8.6-pg18.zip`, release `0.8.6_18`, de
<https://github.com/andreiramani/pgvector_pgsql_windows/releases> — o pgvector oficial
não publica binários Windows). Conferido: `vector.control` com
`default_version = '0.8.6'` e os scripts de atualização no leiaute padrão.

### 2. Dump de produção ✅

Gerado no VPS com `pg_dump -Fc` (formato custom, comprimido) e baixado para
`C:\Users\Ronan\Documents\backups\portal_conecta-prod-<data>.dump`.
Tamanho ~90 KB; conteúdo conferido com `pg_restore -l`: 36 tabelas com dados,
extensão `vector` e função `match_chunks_kb`. Origem: PostgreSQL 16.15
(restaurar 16 → 18 é a direção suportada).

### 3. Usuário e banco no PostgreSQL local ⏳ requer administrador

O `pg_hba.conf` local exige `scram-sha-256`, então tudo isso precisa de
privilégio: o script `portal-setup-postgres.cmd` (em `C:\Users\Ronan\Desktop\` e em
`C:\Users\Public\`) faz, de forma idempotente:

1. para o serviço `postgresql-x64-18`;
2. copia `vector.dll` e os arquivos de extensão para `C:\Program Files\PostgreSQL\18`;
3. sobe o serviço;
4. cria o usuário `portal_conecta` (senha em `.env`) e o banco `portal_conecta`;
5. roda `CREATE EXTENSION vector` e passa a posse do schema `public` para o usuário.

### 4. Restaurar os dados ⏳

```powershell
$pg = "C:\Program Files\PostgreSQL\18\bin"
# schema + dados (--no-owner: o dono em produção é o role `portal`)
& "$pg\pg_restore.exe" --no-owner --no-acl --clean --if-exists `
  -U portal_conecta -h localhost -p 5432 -d portal_conecta `
  "$env:USERPROFILE\Documents\backups\portal_conecta-prod-<data>.dump"
```

### 5. Sincronizar schema e funções auxiliares ⏳

```powershell
npx prisma db push                     # garante que o schema bate com schema.prisma
# psql local: aplica a função de busca vetorial e a view de métricas
& "$pg\psql.exe" -U portal_conecta -h localhost -d portal_conecta -f prisma/pgvector-setup.sql
& "$pg\psql.exe" -U portal_conecta -h localhost -d portal_conecta -f prisma/public-metrics-setup.sql
```

### 6. Validar ⏳

```powershell
npm test          # 232 testes
npx tsc --noEmit
npm run dev       # a home deve carregar com os dados reais
```

---

## Como atualizar os dados locais a partir de produção

```bash
# no VPS
sudo -u postgres pg_dump -Fc -d portal_conecta -f /tmp/portal_conecta.dump
```

```powershell
# na máquina local (host e chave conforme o seu acesso ao VPS — não versionar)
scp root@<ip-do-vps>:/tmp/portal_conecta.dump $env:TEMP\
```

Depois repita o passo 4. **Atenção:** o restore com `--clean` apaga o conteúdo
local do banco antes de recarregar — não use se houver dados locais a preservar.

---

## Pendências e limpezas decorrentes

- **Cron `keep-db-alive` não faz mais sentido**: `src/app/api/cron/keep-db-alive` e o
  bloco `crons` do `vercel.json` existiam só para o Supabase não pausar por
  inatividade (plano free). Produção é um VPS com Postgres próprio e o deploy não é
  Vercel — a rota pode ser removida (fica a decisão de quando).
- **`src/lib/supabase.ts` é código morto** (nenhum import) e pode ser apagado junto
  com as variáveis `SUPABASE_*` do ambiente de produção.
- **`DIRECT_URL` no local** aponta para o mesmo banco do `DATABASE_URL`; só era
  diferente por causa do pooler do Supabase.
- **Backup do `.env` anterior** (com as credenciais do Supabase apagado):
  `%TEMP%\portal-env-backup-20261003-114254.txt` — pode descartar, o projeto
  Supabase não existe mais.
- **Segredos locais**: a senha do usuário `portal_conecta` fica apenas no `.env`
  (ignorado pelo Git) e no script `.cmd` que deve ser apagado após o uso.
