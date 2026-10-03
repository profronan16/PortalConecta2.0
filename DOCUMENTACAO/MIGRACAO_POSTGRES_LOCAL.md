# Migração para PostgreSQL local / próprio

**Data:** 2026-09-16 (migração concluída e validada)
**Situação:** ✅ concluída — o desenvolvimento local roda contra um PostgreSQL 18 próprio, com os dados reais de produção restaurados.

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

## Arquitetura

| Ambiente | Onde roda | Banco |
|---|---|---|
| **Produção** — https://portal.ifcoding.com.br | VPS AlmaLinux 9.8 (IP e acesso SSH **fora deste repositório**), serviço systemd `portal-conecta.service`, código em `/var/www/portal-conecta`, porta 3000 atrás do nginx | PostgreSQL **16** no próprio VPS, banco `portal_conecta` (dono `portal`), pgvector 0.8.6 |
| **Local (dev)** | Windows — cluster em espaço de usuário, **porta 5433** | PostgreSQL **18.6**, banco `portal_conecta` (dono `portal_conecta`), pgvector 0.8.6 |

`prisma/schema.prisma` continua com `provider = "postgresql"`, `url = env("DATABASE_URL")`
e `directUrl = env("DIRECT_URL")` — no local os dois apontam para o mesmo banco.

## Como o banco local está montado

Como o `pg_hba.conf` do serviço PostgreSQL 18 já instalado na máquina exige
`scram-sha-256` (e escrever em `C:\Program Files` exigiria administrador), o
projeto ganhou um **cluster próprio, em espaço de usuário** — sem tocar no
serviço existente:

- **Binários:** cópia de `C:\Program Files\PostgreSQL\18` em `%USERPROFILE%\pgsql18-portal`
  (com `vector.dll` e os arquivos de extensão do pgvector 0.8.6 adicionados).
- **Cluster:** `%USERPROFILE%\pgsql18-portal\data`, criado com `initdb`
  (`--auth=scram-sha-256`, locale `C`, encoding UTF8), escutando só em `127.0.0.1:5433`.
- **Início/parada:** tarefas agendadas do usuário (não exigem administrador):
  - `PortalConecta-Postgres-Start` — sobe o cluster; tem gatilho **no logon**, então
    o banco já está no ar quando você abre a sessão.
  - `PortalConecta-Postgres-Stop` — parada limpa (`-m fast`).
  - Scripts equivalentes: `%USERPROFILE%\pgsql18-portal\start-postgres.cmd` e `stop-postgres.cmd`.
- **Log do servidor:** `%USERPROFILE%\pgsql18-portal\data\postgres.log`.
- **Senhas:** a do usuário da aplicação (`portal_conecta`) está no `.env` (ignorado
  pelo Git); a do superusuário `postgres` do cluster ficou em `%TEMP%\portal-pg-superuser.txt`.

> Alternativa não usada: instalar o pgvector no serviço que já existe
> (`portal-setup-postgres.cmd`, em `C:\Users\Public\` e no Desktop). Ficou pronto
> caso você prefira concentrar tudo na porta 5432 — nesse caso seria preciso rodar
> como administrador e informar a senha do usuário `postgres` do serviço.

## ⚠️ Nunca rode `prisma db push` neste banco

O banco restaurado de produção tem **duas coisas que o `schema.prisma` não declara**:

1. `Edital.projetoId` (+ FK e índice) — **com dados** (os 2 editais têm valor).
2. `chunks_kb_embedding_hnsw_idx` — índice vetorial criado por `prisma/pgvector-setup.sql`
   (o Prisma não consegue modelar índice HNSW sobre `Unsupported("vector(1536)")`).

`prisma db push` sincroniza o banco **para** o schema, ou seja: ele **apagaria os
dois**. O banco é a fonte de verdade do modelo; o `schema.prisma` existe para gerar
o client tipado. Se precisar conferir divergência, use só leitura:

```powershell
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma `
  --to-schema-datamodel prisma/schema.prisma --script
```

## O que foi feito

1. **`.env`** apontado para `postgresql://portal_conecta:***@127.0.0.1:5433/portal_conecta?schema=public`
   (as 4 variáveis `SUPABASE_*` ficaram comentadas; app não as usa).
2. **pgvector 0.8.6** instalado no cluster local. O binário veio do build da
   comunidade para PG 18 (`vector.v0.8.6-pg18.zip`, release `0.8.6_18`, de
   <https://github.com/andreiramani/pgvector_pgsql_windows/releases> — o pgvector
   oficial não publica binários Windows). Conferido: `vector.control` com
   `default_version = '0.8.6'` e os scripts de atualização no leiaute padrão.
3. **Dump de produção** gerado no VPS com `pg_dump -Fc` e baixado para
   `C:\Users\Ronan\Documents\backups\portal_conecta-prod-<data>.dump`
   (90 KB; 36 tabelas; extensão `vector` e função `match_chunks_kb` inclusas).
4. **Restore** com `pg_restore --no-owner --no-acl`, **excluindo** as entradas da
   extensão (já criada) e do comentário dela (o comentário falha porque a extensão
   pertence ao superusuário — erro cosmético, sem efeito).
5. **`prisma/pgvector-setup.sql`** e **`prisma/public-metrics-setup.sql`** aplicados.
   O segundo foi ajustado para ser portátil: os `GRANT` para
   `authenticated`/`anon`/`service_role` (papéis do Supabase) agora são condicionais,
   porque esses papéis não existem num PostgreSQL próprio.
6. **Validação:** 232 testes, `tsc --noEmit` limpo, `next build` OK e o app servindo
   com dados reais (home completa, `/projetos` com os 3 projetos, `/editais`,
   `/busca` e `/minha-area` respondendo 200).

Contagens conferidas local × produção: `User` 11, `Inscricao` 8, `Job` 8, `Evento` 8,
`vagas` 6, `Projeto` 3, `Edital` 2, 36 tabelas.

## Operação no dia a dia

```powershell
# o cluster sobe sozinho no logon; para subir/parar na mão:
Start-ScheduledTask -TaskName "PortalConecta-Postgres-Start"
Start-ScheduledTask -TaskName "PortalConecta-Postgres-Stop"

# aplicação
npm run dev
```

Conferir se o banco está no ar:

```powershell
& "$env:USERPROFILE\pgsql18-portal\bin\pg_isready.exe" -h 127.0.0.1 -p 5433
```

## Atualizar os dados locais a partir de produção

```bash
# no VPS
sudo -u postgres pg_dump -Fc -d portal_conecta -f /tmp/portal_conecta.dump
```

```powershell
# na máquina local (host e chave conforme o seu acesso ao VPS — não versionar)
scp root@<ip-do-vps>:/tmp/portal_conecta.dump $env:TEMP\
# e então repita o passo 4 (com --clean se quiser substituir o conteúdo local)
```

## Limpezas decorrentes (pendentes de decisão)

- **Cron `keep-db-alive`**: `src/app/api/cron/keep-db-alive` e o bloco `crons` do
  `vercel.json` existiam só para o Supabase não pausar por inatividade. Produção é
  um VPS (não Vercel) e o banco é local — a rota perdeu função.
- **`src/lib/supabase.ts`**: código morto (nenhum import); pode ser apagado junto com
  as variáveis `SUPABASE_*` do ambiente de produção.
