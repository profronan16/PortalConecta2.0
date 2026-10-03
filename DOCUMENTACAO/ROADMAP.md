# ROADMAP — Portal Conecta IFPR

**Status:** ✅ Roadmap executado — 6 de 6 fases em 100%
**Última atualização:** 2026-09-16 (execução completa do roadmap)
**Deploy:** https://portal.ifcoding.com.br (VPS próprio — a Vercel saiu de cena)
**Base de código:** partiu de `f86208d` (16/09/2026) e foi concluído em `1854f22`

> Este documento foi reconciliado com o código real em 16/09/2026. A revisão anterior
> (17/06/2026) marcava como pendentes várias entregas que já estavam em produção
> (extração de PDF por IA, pipeline RAG, "Meus dados", e-mail pós-inscrição).
> O restante das pendências foi implementado na sequência — ver
> "Correções encontradas durante a cobertura de testes" e "Próximos passos" abaixo.

---

## ⛔ Fora de escopo (decisão do responsável — 2026-09-16)

| Item | Motivo |
|---|---|
| **5.4** Sync SUAP agendada (cron) | Depende de informações/credenciais do responsável; a sincronização permanece **manual**, disparada pelo admin. |
| **5.6** Tratamento de conflitos de sync | Cenário de conflito não deve existir no fluxo adotado (sync manual e revisado). |

> O cron `/api/cron/keep-db-alive` **foi removido** (junto com o bloco `crons` do `vercel.json`): ele existia só para o Supabase não pausar por inatividade, e o banco agora é um PostgreSQL próprio.

---

## 📋 FASE 1 — Fundação + MVP Público ✅ (100%)

**Objetivo:** Modelo de dados completo → home dinâmica → listagem/detalhe de projetos e editais → agenda → inscrição

### ✅ Tarefas concluídas:

- [x] **1.1** Expandir Prisma schema: **35 models**, enums documentados
- [x] **1.2** Aprimorar `User` model: campos perfil + SUAP
- [x] **1.3** Aprimorar `Projeto`: review_status, source, deleted_at
- [x] **1.4** Aprimorar `Edital`: pdf_path, review_status, source, deleted_at
- [x] **1.5** Role assignment: `assignUserRole` + `ensureUserProfile` + `requireRole`
- [x] **1.6** Home dinâmica: métricas BD + SiteConfig
- [x] **1.7** Projetos: listagem + filtros + busca + página individual
- [x] **1.8** Editais: listagem + filtros + "A IFizinha Explica"
- [x] **1.9** Página `/projetos/[slug]`: FAQ, tags, cursos, relacionados
- [x] **1.10** Página `/editais/[slug]`: tradução IFizinha + datas
- [x] **1.11** Agenda: timeline + eventos derivados + `.ics`
- [x] **1.12** Inscrição: formulário LGPD + protocolo + validações
- [x] **1.13** AI translation: DeepSeek API + botão "Gerar com IA"
- [x] **1.14** Painel admin/professor unificado em `/admin`
- [x] **1.15a** Busca textual de projetos (nome, coordenador, área, status) — `ProjetosExplorer`
- [x] **1.15b** Paginação + filtro server-side na listagem de projetos (`src/lib/projetos-filtros.ts` + `src/lib/projetos-publicos.ts`), com correção de visibilidade: a listagem pública não filtrava `review_status`/`deleted_at` e exibia rascunhos e projetos com soft delete
- [x] **1.18** Posts de projeto com editor rico (Tiptap) + sanitização (`xss`)
- [x] **1.19** Formulário de inscrição personalizável (campos extras por edital)
- [x] **1.20** Proteção contra troca de usuário com sessão antiga (segurança)

### ⚠️ Pendências:

- [x] **1.16** Testes: critérios de aceite §14 — infra Vitest (`npm test`) + **13 arquivos de teste** cobrindo: métricas (home × admin), filtros/paginação de projetos, edição controlada SUAP, proteção de edição manual, permissões e papéis, visibilidade de editais, inscrição (LGPD/validações/rate limit), idempotência do sync SUAP, agenda `.ics`, sanitização XSS, chunking do RAG, busca global, séries de relatórios e área do estudante.
      Seguem **manuais** (não automatizáveis aqui): responsividade/aparência, acessibilidade AA, ponta a ponta de upload de PDF e qualidade das respostas da IFizinha — roteiro em [RELATORIO_TESTES.md](../RELATORIO_TESTES.md) e [PLANO_DE_TESTES_E_VALIDACAO.md](../PLANO_DE_TESTES_E_VALIDACAO.md).
- [x] **1.17** View `public_metrics` para padronizar home × admin — `prisma/public-metrics-setup.sql` + `src/lib/metrics.ts`.
      Aplicado nos dois bancos (cluster local de desenvolvimento e PostgreSQL do VPS em produção); sem a view a app usa contagem ao vivo com os mesmos filtros.

---

## 📋 FASE 2 — Gestão de Professores ✅ (100%)

**Objetivo:** Login professor → painel → edição projetos → inscrições → relatórios

### ✅ Tarefas concluídas:

- [x] **2.1** Login Google com detecção `@ifpr.edu.br`
- [x] **2.2** Dashboard professor com stats
- [x] **2.3** Edição de projetos pelo professor
- [x] **2.4** Listagem de inscrições com filtros
- [x] **2.5** Alteração de status de inscrições
- [x] **2.6** Export CSV de inscrições (via `xlsx`)
- [x] **2.7** Relatórios com estatísticas (tabulares)
- [x] **2.8** Confirmação por e-mail pós-inscrição — `src/lib/email.ts` (Resend), chamada em `src/actions/inscricao.ts`
- [x] **2.9** "Meus dados" para estudantes — `src/app/meus-dados` + `src/actions/meus-dados.ts`
- [x] **2.10** Edição controlada — `src/lib/projetos-edicao.ts`: em projeto vindo do SUAP, nome/coordenador/área/situação são somente leitura (bloqueados **no servidor** em `updateMyProjeto`, não só na tela); o professor segue editando descrição, cor, contatos, links e formulário de inscrição

### ⚠️ Pendências:

- (nenhuma)

---

## 📋 FASE 3 — IA de Extração ✅ (100%)

**Objetivo:** Upload PDF → extração IA → revisão → publicação

### ✅ Concluído:

- [x] **3.1** API DeepSeek configurada e funcional (`src/lib/llm.ts`)
- [x] **3.2** Botão "Gerar com IA" no admin editais
- [x] **3.3** Tabela `IaRevisao` criada
- [x] **3.4** Upload de PDF/DOCX para extração — `src/app/api/admin/editais/extract-pdf`
- [x] **3.5** Extração de campos do documento (`pdf-parse` + `mammoth` + `src/lib/document-extract.ts`)
- [x] **3.6** Tela de revisão por campo no admin de editais
- [x] **3.7** Publicação após aprovação (via `review_status`)

---

## 📋 FASE 4 — IFizinha RAG ✅ (100%)

**Objetivo:** Ingestão → embeddings → busca vetorial → chat com citações

### ✅ Concluído:

- [x] **4.1** Tabelas `RagDocumento`, `RagChunk`, `ChatSessao`, `ChatMensagem`
- [x] **4.2** Migrar `embedding` para pgvector — `prisma/pgvector-setup.sql` (HNSW + cosine)
- [x] **4.3** Ingestão de documentos publicados (`src/lib/indexador.ts`, `src/lib/kb-worker.ts`)
- [x] **4.4** Geração de embeddings (`src/lib/embeddings.ts`, `src/lib/rag-processor.ts`)
- [x] **4.5** Busca vetorial com filtro de permissão (`src/lib/supabase-vector.ts`, `src/lib/curador.ts`)
- [x] **4.6** Chat com citações e guardrails — `/api/chat` + `ChatWidget`; curadoria de fontes
- [x] **4.7** Painel admin de RAG com upload e reindexação — `src/app/admin/(protected)/rag`

### ⚠️ Pendências:

- [x] **4.8** Testes do pipeline RAG — camada determinística coberta: `tests/conteudo-e-chunking.test.ts` (chunking por seção, limite de tokens, overlap, ausência de chunk vazio) e sanitização do conteúdo que alimenta o índice. Falta cobertura de qualidade de resposta/citação (exige banco vetorial real).

---

## 📋 FASE 5 — Integração SUAP ✅ (100%)

**Objetivo:** Sync idempotente → criação professores → proteção edição manual

### ✅ Concluído:

- [x] **5.1** Cliente SUAP desacoplado (`src/lib/suap-api.ts`)
- [x] **5.2** Sync manual via API (`/api/suap/sync/projetos`, `/api/suap/sync/editais` + `SyncButtons`)
- [x] **5.3** Criação de professores por domínio / OAuth2 SUAP + controle por papel

> **5.4** (sync agendada) e **5.6** (tratamento de conflitos) foram **removidos do escopo** em 16/09/2026 — ver seção "Fora de escopo" no topo.

### ⚠️ Pendências:

- [x] **5.5** Proteção de edição manual — `src/lib/suap-edicao-manual.ts`: o sync detecta registros alterados no portal depois do último sync (`updatedAt` × `suapSyncedAt`), **não** os sobrescreve, reporta em `preservados` e oferece a "Sync forçada" no painel admin como válvula de escape.

---

## 📋 FASE 6 — Portal Completo ✅ (100%)

**Objetivo:** Notificações → favoritos → alertas → relatórios avançados

### ✅ Concluído:

- [x] **6.1** Tabelas `AlertaInteresse`, `Favorito`, `Notificacao` (models no Prisma)
- [x] **6.2** Notificações: leitura/marcação em `src/actions/notificacoes.ts`, produtor em `src/lib/notificacoes.ts`, sino no cabeçalho (`NotificationBell`) e lista em `/minha-area`. Já é alimentado pela mudança de status de inscrição.
- [x] **6.3** Favoritos: `src/actions/favoritos.ts` + botão `BotaoFavorito` nas páginas de projeto e edital + lista em `/minha-area`
- [x] **6.4** Alertas de interesse: `src/actions/alertas.ts` (um alerta por canal, ativo/inativo, categorias) + disparo em `src/lib/alertas.ts` quando um edital é publicado (notificação no portal e e-mail), idempotente por edital/usuário
- [x] **6.5** "Meus dados" para estudantes

### ✅ Concluído (fase fechada):

- [x] **6.6** Busca global (projetos + editais + posts) — `/busca` com formulário GET (funciona sem JS), regras puras em `src/lib/busca-filtros.ts` e consultas em `src/lib/busca.ts`; respeita a visibilidade de cada tipo (projeto/edital PUBLICADO e não deletado; post PUBLICADO e de projeto público)
- [x] **6.7** Relatórios avançados com gráficos — componentes SVG próprios em `src/components/charts/` (**sem dependência nova**), séries puras em `src/lib/relatorios-series.ts` e agregações no banco em `src/lib/relatorios.ts` (admin: status/mês/área/categoria; professor: escopo dos próprios projetos e ocupação de vagas)

**ETA original:** Novembro-Dezembro 2026

---

## 📊 STATUS GERAL

| Fase | Completude | Status |
|---|---|---|
| **1** | 100% | ✅ MVP + busca/paginação + testes automatizados |
| **2** | 100% | ✅ Professor gerencia com edição controlada |
| **3** | 100% | ✅ Upload + extração + revisão + publicação |
| **4** | 100% | ✅ RAG com pgvector, chat com citações |
| **5** | 100% | ✅ Sync manual idempotente + proteção de edição manual (cron e conflitos fora de escopo) |
| **6** | 100% | ✅ Favoritos, notificações, alertas, busca global e gráficos |

---

## 🐞 Correções encontradas durante a cobertura de testes (2026-09-16)

Achadas ao escrever os testes dos critérios §14 — todas corrigidas e com teste de regressão:

| Problema | Impacto | Correção |
|---|---|---|
| `/projetos` não filtrava `review_status`/`deleted_at` | Rascunhos e projetos com soft delete apareciam na listagem pública | `src/lib/projetos-filtros.ts` (filtro base obrigatório) |
| `/editais/[slug]` buscava só pelo `slug` | Edital em RASCUNHO (inclusive recém-extraído pela IA) acessível por URL, com título vazando no metadata | `src/lib/editais-publicos.ts` usado pela listagem, pelo detalhe e pelo metadata |
| Métricas divergentes entre home e admin | Home e dashboard mostravam números diferentes para a mesma coisa | `src/lib/metrics.ts` como fonte única |
| Re-sync SUAP sobrescrevia edições manuais | Trabalho de revisão no portal era apagado pelo sync | `src/lib/suap-edicao-manual.ts` + sync forçada explícita |
| `import '@/lib/email'` sem `RESEND_API_KEY` | Lançava "Missing API key" no import, derrubando rotas que só importavam o módulo | Cliente Resend criado sob demanda |

---

## 🎯 PRÓXIMOS PASSOS

### ✅ Entregue (execução de 2026-09-16)
1. **1.16** Infra de testes automatizados + critérios de aceite §14 (13 arquivos, `npm test`)
2. **1.17** View `public_metrics` consumida por home e admin (código ✅ — falta aplicar o SQL no banco)
3. **1.15b** Paginação + filtro server-side em `/projetos` (+ correção de rascunhos/soft delete na listagem)
4. **5.5** Proteção de campos editados manualmente no re-sync SUAP
5. **2.10** Bloqueio de campos SUAP na edição pelo professor
6. **6.3 / 6.2 / 6.4** Favoritos, notificações e alertas (UI + API) em `/minha-area`
7. **6.7** Relatórios avançados com gráficos (SVG próprio, sem dependência nova)
8. **6.6** Busca global em `/busca`
9. **4.8** Testes da camada determinística do RAG (chunking) — pendente só a avaliação de qualidade de resposta

### ⏭️ Ações manuais que dependem de você
- **Nada pendente de banco**: o SQL das métricas já foi aplicado em produção (PostgreSQL do VPS) e no cluster local de desenvolvimento.
- **Revisar o `RELATORIO_TESTES.md`** para o que não é automatizável: aparência/responsividade, acessibilidade AA e um teste ponta a ponta de upload de PDF → revisão → publicação.
- **Validar o sync SUAP** com o token real e conferir o campo `preservados` no relatório do painel admin (comportamento novo: não sobrescreve mais edição manual).
- **Decidir sobre o envio de e-mail**: `RESEND_API_KEY` já é opcional em runtime, mas os avisos por e-mail (confirmação de inscrição, mudança de status e alertas) só saem com a chave configurada.

---

**Status final:** roadmap concluído — 6 de 6 fases em 100%, com as duas exceções de escopo registradas no topo deste documento.
