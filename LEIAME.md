# Portal Conecta — IFPR Campus Ivaiporã

Plataforma web de comunicação institucional do IFPR Campus Ivaiporã, mediada pela persona **IFizinha**.

## 🚀 Como rodar localmente

```bash
npm install
npm run dev
# Acesse http://localhost:3000
```

O banco de desenvolvimento é um **PostgreSQL local na porta 5433** (cluster próprio
do projeto, sobe junto com o logon do Windows). Para subir/parar na mão e para
conferir se está no ar, veja [MIGRACAO_POSTGRES_LOCAL.md](DOCUMENTACAO/MIGRACAO_POSTGRES_LOCAL.md).

```bash
npm test            # 232 testes (Vitest)
npm run typecheck   # tsc --noEmit
```

## ⚙️ Configuração do Banco de Dados

O projeto **não usa mais Supabase** (o projeto antigo foi apagado). Hoje:

- **Produção:** PostgreSQL 16 no próprio VPS, banco `portal_conecta`.
- **Local:** PostgreSQL 18 em `127.0.0.1:5433`, banco `portal_conecta` — mesma
  estrutura e mesmos dados de produção (restaurados por `pg_dump`/`pg_restore`).

Passos para um ambiente novo:

```bash
npm run db:generate   # Gera o Prisma Client
npm run db:seed       # Popula com dados iniciais de demonstração
```

> ⚠️ **Não rode `npm run db:push`.** O banco tem objetos que o `schema.prisma` não
> declara (a coluna `Edital.projetoId`, com dados, e o índice vetorial HNSW do
> pgvector) e o `db push` os apagaria. Detalhes no runbook da migração.

## 📦 Stack

| Tecnologia | Uso |
|---|---|
| Next.js 14 (App Router) | Framework principal |
| TypeScript | Tipagem estática |
| Tailwind CSS | Estilização |
| shadcn/ui | Componentes UI |
| Prisma | ORM |
| PostgreSQL (próprio) | Banco de dados — Supabase foi descontinuado |
| NextAuth.js + Firebase Auth | Autenticação |
| VPS próprio (systemd + nginx) | Deploy |

## 🎨 Identidade Visual

```css
--azul-eletrico: #2F52D3;
--roxo-luminoso: #7B24C7;
--rosa-vibrante: #E83D89;
--ciano-claro: #17A2B8;
--dourado-ifizinha: #FFD700;
```

## 📄 Estrutura de Páginas

```
/                   → Homepage com hero IFizinha, editais, projetos, eventos
/editais            → Listagem de editais com filtros
/editais/[slug]     → Edital individual com abas (IFizinha / Original)
/projetos           → Diretório de projetos (28 projetos cadastrados)
/projetos/[slug]    → Página individual do projeto
/agenda             → Agenda escolar com timeline por mês
```

## 🌱 Seed Data

O seed inclui:
- **28 projetos** de extensão do IFPR Ivaiporã (25 em execução, 2 enviados 2026)
- **4 editais** com tradução IFizinha completa
- **7 eventos** na agenda escolar

## 🚢 Deploy

Produção roda em **VPS próprio** (AlmaLinux), não na Vercel:

1. Código em `/var/www/portal-conecta`
2. Serviço `systemd`: `portal-conecta.service` (`npm run start -- --port 3000`)
3. nginx na frente faz o proxy do domínio
4. Variáveis de ambiente em `/var/www/portal-conecta/.env` (inclui `DATABASE_URL`
   apontando para o PostgreSQL 16 local do VPS e `STORAGE_ROOT=/var/www/portal-files`)
5. Scripts e documentação da migração de infraestrutura em `deploy/` **no servidor**

> ⚠️ **Atenção — o repositório e a produção estão divergentes.** O código em produção
> (`/var/www/portal-conecta`) **não é um checkout git** e evoluiu depois do último
> commit: há arquivos que só existem lá (por exemplo `src/lib/file-storage.ts`, o
> endpoint `src/app/api/files/upload` e a página do professor de editais) e dezenas
> de arquivos com conteúdo diferente do repositório. **Não faça deploy a partir do
> git antes de reconciliar os dois lados** — isso regrediria produção. O passo
> recomendado é trazer o estado do servidor para um commit no repositório e só
> depois retomar o fluxo normal.
