# DECISIONS.md — Divergências do SPEC

**Propósito:** Registrar decisões arquiteturais onde o projeto existente diverge do SPEC.md, com justificativas.

---

## 1. Backend: Prisma + Firebase vs. Supabase puro

**SPEC (§2.3):**  
→ Backend: Supabase (Postgres + Auth + Storage + Edge Functions + pgvector)

**Decisão:**  
→ **Manter Prisma + PostgreSQL + Firebase Auth + NextAuth**

**Justificativa:**  
- Projeto já tem investimento em Prisma ORM, NextAuth, e Firebase Authentication.
- Stack é viável e amplamente testada; migração para Supabase puro causaria refatoração massiva (trocar ORM, auth, redefinir RLS).
- **Tradeoff:** Perde nativamente: Supabase Storage (use Firebase Storage ou S3), Edge Functions (use Vercel Functions / Next.js API routes), pgvector integrado (use API de embeddings externa + PostgreSQL vector extension manualmente).

**Implementação:**
- RLS nativa do Postgres será habilitada, mas validação de permissões ocorrerá no Prisma / servidor via campos `userId` e relações.
- Storage: Firebase Storage para PDFs + arquivos.
- Edge Functions: Next.js API routes + `/api` folder e server actions.
- Embeddings: API Anthropic (Claude) + extensão `vector` do Postgres (manual).

**Registrado em:** DECISIONS.md (este arquivo)  
**Impacto:** §2.3, §3.8, §5.3, §7, §8, §10.1

---

## 2. Autenticação: Firebase Auth + NextAuth vs. Google OAuth puro

**SPEC (§4.1):**  
→ Google OAuth (qualquer e-mail para estudante, `@ifpr.edu.br` para professor)

**Decisão:**  
→ **Manter Firebase Auth + NextAuth**, adicionar restrição `@ifpr.edu.br` em lógica de aplicação

**Justificativa:**  
- Projeto já usa Firebase; integração com Supabase Auth exigiria mudança de auth provider.
- NextAuth abstrai detalhes; trocar por Supabase Auth é refatoração de autenticação global.

**Implementação:**
- Signup via Google (Firebase) → criar `User` no Prisma com `role = VISITANTE`.
- Se e-mail termina em `@ifpr.edu.br` E coordena projetos no SUAP → `role = PROFESSOR` (verificação em sync SUAP).
- Admin: seed list em `.env` (`ADMIN_EMAILS`).
- RLS: validar `user.role` em queries do lado do servidor (Prisma + server actions).

---

## 3. Enums de role: Mismatch com SPEC

**SPEC (§3.1):**  
→ `create type user_role as enum ('estudante', 'professor', 'admin');`

**Atual (Prisma):**
```prisma
enum UserRole {
  VISITANTE
  EDITOR_IFIZINHA
  EQUIPE_PROJETO
  ADMINISTRADOR
}
```

**Decisão:**  
→ **Manter 7 valores por agora** (inclui legados: VISITANTE, EDITOR_IFIZINHA, EQUIPE_PROJETO, ADMINISTRADOR)
→ **Limpar em Fase 2** quando o fluxo de auth estiver completo

**Justificativa:**  
- AuthContext.tsx usa valores legados (`ADMINISTRADOR`, `EDITOR_IFIZINHA`, `EQUIPE_PROJETO`)
- Mudar agora quebra o login existente
- Limpeza segura apenas após migração de todos os usuários

**Implementação:**
```prisma
enum UserRole {
  ESTUDANTE      // Google auth qualquer domínio
  PROFESSOR      // Google @ifpr.edu.br + vínculo SUAP
  ADMIN          // Seed list
  // Legados (remover Fase 2):
  VISITANTE      // → migrar para ESTUDANTE
  EDITOR_IFIZINHA // → migrar para ADMIN
  EQUIPE_PROJETO  // → migrar para PROFESSOR
  ADMINISTRADOR   // → migrar para ADMIN
}
```

**Registrado em:** DECISIONS.md  
**Impacto:** AuthContext.tsx, toda lógica de role

---

## 4. Modelo de dados: Redução de complexidade inicial

**Decisão:**  
→ Implementar Fase 1 (§16) com **subset de tabelas**, expandir em fases posteriores

**Tabelas Fase 1 (existentes):**
- `User` (aprimorado com campos profile + SUAP) ✅
- `Projeto` (aprimorado com enums + review_status) ✅
- `Edital` (aprimorado com enums + review_status) ✅
- `Evento` ✅
- `Post` ✅
- `SyncLog` (renomear para `SuapSyncRecord` — pendente)
- `ProjectCoordinator`, `UserPermission`, `Inscricao`, `Job`, `RagDocumento`, `RagChunk`, `ChatSessao`, `ChatMensagem`, `IaRevisao`, `SiteConfig`, `AuditLog` ✅

**Tabelas ausentes (adicionar em Fase 2+):**  
→ `projeto_tags`, `projeto_cursos`, `projeto_faq`, `edital_tags`, `edital_explicacao`, `edital_resumo_versoes`, `alertas_interesse`, `favoritos`, `notificacoes`

**Justificativa:** MVP focado; evita schema bloat; mantém releases incrementais.

---

## 4.1 Enums legados: StatusProjeto e StatusEdital

**SPEC (§3.1):**
→ `StatusProjeto`: 6 valores (ativo, em_execucao, encerrado, suspenso, inscricoes_abertas, sem_vagas)
→ `StatusEdital`: 7 valores (em_breve, aberto, em_analise, resultado_parcial, prazo_recurso, resultado_publicado, encerrado)

**Atual (Prisma):**
→ `StatusProjeto`: 9 valores (inclui ENVIADO_2026, CONCLUIDO, INATIVADO)
→ `StatusEdital`: 9 valores (inclui ATIVO, ENCERRA_BREVE, ENCERRADO, RESULTADO_PUBLICADO)

**Decisão:**
→ **Manter valores legados** até migração de dados existentes
→ **Limpar em Fase 2** quando dados SUAP estiverem sincronizados

**Justificativa:**
- Dados existentes no banco usam valores legados
- Mudar agora quebra queries existentes
- Migração segura: mapear ENVIADO_2026→EM_EXECUCAO, CONCLUIDO→ENCERRADO, etc.

---

## 5. RLS (Row Level Security)

**SPEC (§4.4):**  
→ RLS nativo do Postgres via políticas SQL

**Decisão:**  
→ **Implementar validação de permissões no Prisma + server actions** (simulação de RLS)

**Justificativa:**  
- RLS nativa requer Supabase Auth com `auth.uid()`.
- Com Firebase, `auth.uid()` não está disponível no Postgres automaticamente.
- Alternativa: Validar `userId` e `role` no servidor antes de cada query Prisma.

**Implementação:**
```typescript
// src/lib/auth.ts — helper de autorização
export async function requireRole(userId: string, requiredRole: UserRole) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== requiredRole) throw new Error('Unauthorized');
}

export async function requireProjectCoordinator(userId: string, projectId: string) {
  const isCoordinator = await db.projectCoordinators.findUnique({
    where: { projeto_id_user_id: { projeto_id: projectId, user_id: userId } }
  });
  if (!isCoordinator) throw new Error('Unauthorized');
}
```

---

## 6. Processamento assíncrono: Fila de jobs

**SPEC (§10.1, §3.9):**  
→ Fila `jobs` em tabela Postgres + `pg_cron` / Edge Functions agendadas

**Decisão:**  
→ **Tabela `Job` + worker manual** (pode escalar para Bull/BullMQ depois)

**Justificativa:**  
- `pg_cron` requer extensão Postgres especial; pode não estar disponível em Supabase free.
- Bull/BullMQ adicionaria dependência Redis.
- Solução simples: tabela `Job` + Vercel Functions / cron interno (Next.js 15+) ou worker externo.

**Implementação:**
- Tabela `Job` com `status` (pendente | processando | ok | erro).
- Server action dispara insert em `Job`; responde imediatamente ao cliente.
- Worker assíncrono (Node.js simples ou cronjob externo) verifica pendentes a cada N segundos.

---

## 7. Calendário acadêmico: Dados reais vs. fabricados

**SPEC (§5.4, §0.2):**  
→ Calendário Acadêmico Oficial do Campus Ivaiporã deve ser **importado do documento oficial**, não fabricado.

**Decisão:**  
→ **Deixar TODO explícito; criar estrutura para import; inicializar com dados de exemplo** até obter oficial.

**Implementação:**
- Arquivo `docs/calendario_ifpr_ivaipora_2026.pdf` (ou `.xlsx`) será ponto de ingestão.
- Script `scripts/import-calendar.ts` fará parse e inserção em tabela `Evento`.
- TODO comentário em código: `// TODO: Substituir por import do calendário oficial do Campus Ivaiporã`.

---

## 8. Variáveis de ambiente

**Decisão:**  
→ Adicionar seções novas em `.env.example`:

```bash
# BANCO
SUPABASE_URL=              # ou deixar vazio; usar DIRECT_URL
SUPABASE_SERVICE_ROLE_KEY= # opcional; usar apenas para admin tasks

# IA
ANTHROPIC_API_KEY=         # Claude API
EMBEDDING_MODEL=text-embedding-3-small  # OpenAI ou Anthropic (definir)

# ADMIN
ADMIN_EMAILS=admin@ifpr.edu.br,admin2@ifpr.edu.br

# FEATURES
WHATSAPP_ENABLED=false
SUAP_ENABLED=true
```

---

## 9. Implementação de Fases

**SPEC (§16):**  
→ Fases 1–6 de desenvolvimento

**Decisão:**  
→ Fase 1 (MVP): Fundação + home configurável + projetos + editais + agenda  
→ Fases 2–6: Conforme roadmap, incrementalmente

**Registro:** Ver ROADMAP.md (arquivo separado) ou comments no código.

---

## 10. Soft delete vs. Hard delete

**SPEC (§3):**  
→ `deleted_at timestamptz` para editais, projetos, posts (soft delete para histórico)

**Decisão:**  
→ **Implementar soft delete em `Edital`, `Projeto`, `Post`; hard delete em outros**

**Implementação:**
```prisma
model Edital {
  // ...
  deleted_at DateTime?
  @@index([deleted_at])
}

// Nas queries: WHERE deleted_at IS NULL
```

---

## 11. Sync SUAP: manual, sem cron e sem tratamento de conflitos

**Contexto:**
→ O ROADMAP previa **5.4** sync agendada (cron) e **5.6** tratamento de conflitos de sincronização.

**Decisão (2026-09-16):**
→ **Remover os dois itens do escopo.**

**Justificativa:**
- A sync agendada depende de informações/credenciais que só o responsável possui e não devem ser automatizadas sem supervisão.
- No fluxo adotado (sync manual, disparada pelo admin e revisada em seguida), não existe cenário legítimo de conflito automático — o tratamento de conflitos resolveria um problema que não ocorre.

**Implementação:**
- Sync permanece **manual**, via `/api/suap/sync/projetos`, `/api/suap/sync/editais` e botões em `SyncButtons`.
- O único cron do projeto continua sendo `/api/cron/keep-db-alive` (evita pause do Supabase por inatividade).
- Permanece no escopo apenas **5.5** (proteção de edição manual: re-sync não deve sobrescrever campos editados no admin).

**Registrado em:** DECISIONS.md + DOCUMENTACAO/ROADMAP.md
**Impacto:** Fase 5 do roadmap

---

## Resumo de impactos

| Decisão | Impacto | Fase | Notas |
|---|---|---|---|
| Manter Prisma/Firebase | Sem RLS nativa; validação de app | 1+ | Tradeoff: menos segurança de BD, mais controle de app |
| Firebase Auth + NextAuth | Validação `@ifpr.edu.br` em app | 1 | Simples de implementar |
| Enums 7-valores (legados) | Mistura novos/antigos; limpar Fase 2 | 1 | AuthContext usa valores legados |
| StatusProjeto/StatusEdital legados | Dados existentes usam valores antigos | 1 | Migrar dados Fase 2 |
| RLS simulada | Segurança depende de código | 1+ | Requer testes rigorosos |
| Fila manual | Pode estar lenta; MVP ok | 1+ | Escalar se necessário |
| TODO calendário oficial | Dados de exemplo até então | 1 | Não bloqueia MVP |
| Tabelas ausentes (tags, faq, favoritos) | MVP sem features avançadas | 2+ | Adicionar incrementalmente |
| Sync SUAP manual (sem cron, sem conflitos) | Menos automação; exige ação do admin | 5 | Depende de credenciais do responsável; ver §11 |

---

**Próximo:** Consultar este arquivo durante implementação; atualizar conforme surgem novas decisões.
