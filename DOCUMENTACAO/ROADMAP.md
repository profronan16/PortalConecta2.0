# ROADMAP — Portal Conecta IFPR

**Status:** Em desenvolvimento conforme SPEC.md + DECISIONS.md
**Última atualização:** 2026-09-16
**Deploy:** https://portal-conecta2-0.vercel.app
**Base de código conferida em:** commit `f86208d` (16/09/2026)

> Este documento foi reconciliado com o código real em 16/09/2026. A revisão anterior
> (17/06/2026) marcava como pendentes várias entregas que já estavam em produção
> (extração de PDF por IA, pipeline RAG, "Meus dados", e-mail pós-inscrição).

---

## ⛔ Fora de escopo (decisão do responsável — 2026-09-16)

| Item | Motivo |
|---|---|
| **5.4** Sync SUAP agendada (cron) | Depende de informações/credenciais do responsável; a sincronização permanece **manual**, disparada pelo admin. |
| **5.6** Tratamento de conflitos de sync | Cenário de conflito não deve existir no fluxo adotado (sync manual e revisado). |

> O único cron do projeto permanece `/api/cron/keep-db-alive` (ver [vercel.json](../vercel.json)).

---

## 📋 FASE 1 — Fundação + MVP Público ✅ (~90%)

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

- [ ] **1.16** Testes: critérios de aceite §14 — infra pronta (Vitest, `npm test`), cobertura inicial em `tests/`; faltam os casos restantes de §14
- [x] **1.17** View `public_metrics` para padronizar/home × admin — `prisma/public-metrics-setup.sql` + `src/lib/metrics.ts`.
      **Ação manual pendente no banco:** aplicar `prisma/public-metrics-setup.sql` no Supabase (enquanto isso a app usa contagem ao vivo com os mesmos filtros).

---

## 📋 FASE 2 — Gestão de Professores ✅ (~90%)

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

### ⚠️ Pendências:

- [ ] **2.10** Edição controlada (campos SUAP bloqueados para edição manual)

---

## 📋 FASE 3 — IA de Extração ✅ (~100%)

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

## 📋 FASE 4 — IFizinha RAG ✅ (~100%)

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

- [ ] **4.8** Cobertura de testes do pipeline RAG (qualidade de resposta/citação) — depende de 1.16

---

## 📋 FASE 5 — Integração SUAP 🔶 (~80%)

**Objetivo:** Sync idempotente → criação professores → proteção edição manual

### ✅ Concluído:

- [x] **5.1** Cliente SUAP desacoplado (`src/lib/suap-api.ts`)
- [x] **5.2** Sync manual via API (`/api/suap/sync/projetos`, `/api/suap/sync/editais` + `SyncButtons`)
- [x] **5.3** Criação de professores por domínio / OAuth2 SUAP + controle por papel

> **5.4** (sync agendada) e **5.6** (tratamento de conflitos) foram **removidos do escopo** em 16/09/2026 — ver seção "Fora de escopo" no topo.

### ⚠️ Pendências:

- [ ] **5.5** Proteção de edição manual: hoje o re-sync preserva `review_status`, mas ainda sobrescreve campos de texto editados no admin. Falta marcar/ignorar campos editados manualmente (`suapSyncedAt` × `updatedAt`).

---

## 📋 FASE 6 — Portal Completo 🔶 (~25%)

**Objetivo:** Notificações → favoritos → alertas → relatórios avançados

### ✅ Concluído:

- [x] **6.1** Tabelas `AlertaInteresse`, `Favorito`, `Notificacao` (models no Prisma)
- [x] **6.5** "Meus dados" para estudantes

### ❌ Pendente:

- [ ] **6.2** UI + API de notificações
- [ ] **6.3** UI + API de favoritos
- [ ] **6.4** UI + API de alertas de interesse
- [ ] **6.6** Busca global (projetos + editais + posts)
- [ ] **6.7** Relatórios avançados com gráficos (nenhuma lib de gráficos instalada hoje)

**ETA original:** Novembro-Dezembro 2026

---

## 📊 STATUS GERAL

| Fase | Completude | Status |
|---|---|---|
| **1** | 90% | ✅ MVP funcional; faltam testes, paginação e `public_metrics` |
| **2** | 90% | ✅ Professor gerencia; falta bloqueio de campos SUAP |
| **3** | 100% | ✅ Upload + extração + revisão + publicação |
| **4** | 100% | ✅ RAG com pgvector, chat com citações |
| **5** | 80% | 🔶 Sync manual funcionando; cron e conflitos fora de escopo |
| **6** | 25% | 🔶 Modelos prontos; faltam todas as UIs |

---

## 🎯 PRÓXIMOS PASSOS (ordem de execução acordada)

### Curto prazo — dívida técnica do núcleo
1. **1.16** Infra de testes automatizados + critérios de aceite §14 (infra ✅ feita; faltam os casos)
2. **1.17** View `public_metrics` consumida por home e admin (código ✅; falta aplicar o SQL no banco)
3. **1.15b** Paginação server-side em `/projetos` ✅
4. **5.5** Proteção de campos editados manualmente no re-sync SUAP
5. **2.10** Bloqueio de campos SUAP na edição pelo professor

### Médio prazo — features da Fase 6
6. **6.3** Favoritos (UI + API)
7. **6.2** Notificações (UI + API)
8. **6.4** Alertas de interesse (UI + API)
9. **6.7** Relatórios avançados com gráficos
10. **6.6** Busca global
11. **4.8** Testes do pipeline RAG (após 1.16)

---

**Próximo:** 1.16 (testes) → 1.17 → 1.15b → 5.5 → Fase 6
