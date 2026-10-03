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

## 11. Hospedagem: VPS própria vs. Vercel + Supabase

**Contexto (2026, pré-lançamento):**
→ O sistema estava implantado na Vercel, com banco no Supabase (`uodkwdaruqrnprqkpgqr`,
org "DebysBru's Org", compute NANO, região `aws-1-sa-east-1`).

**Decisão:**
→ **Hospedar tudo na VPS própria** (RackNerd, `198.44.123.154`, nginx 1.20.1,
que já serve outros projetos sob `ifcoding.com.br`): aplicação Next.js,
**PostgreSQL local com pgvector** e **armazenamento de arquivos em disco**.

**Justificativa:**
- **Limite de upload:** a Vercel corta o corpo da requisição em ~4,5 MB. O requisito
  é 10 MB para PDF e 5 MB para imagem, o que **não é atingível** sem contornar a
  plataforma (upload direto do navegador para a VPS).
- **Armazenamento:** "guardar no próprio servidor" é incompatível com função
  serverless — o filesystem é somente leitura exceto `/tmp`, que é efêmero e não
  compartilhado entre invocações. Comprovação: a rota `api/admin/suap/token`
  grava `.suap-token.json` e **sempre falha** na Vercel.
- **pgvector:** no Supabase, instalar a extensão é uma ação manual no painel e
  nunca foi feita — deixando o RAG em fallback silencioso. Em Postgres próprio
  vira `CREATE EXTENSION vector;`.
- **Latência e pooler:** o app serverless exigia o pooler do Supabase; com o
  banco no mesmo host, a conexão é local.
- **Pausa por inatividade:** o cron `keep-db-alive` existe só por causa do
  Supabase. Um Postgres local nunca pausa — o cron deixa de ser necessário.
- **Autonomia:** banco e repositório estavam em contas de terceiros. App, dados
  e arquivos passam a ficar sob controle do projeto.

**Tradeoff aceito:**
- **Backup passa a ser responsabilidade do projeto.** Sem o Supabase não há
  backup gerenciado (o painel mostrava "No backups"). O script está em
  `deploy/MIGRACAO_SUPABASE_PARA_VPS.md` §5 e **precisa ser testado** pelo menos
  uma vez restaurando num banco descartável.
- A VPS é ponto único de falha (app + banco + arquivos no mesmo host), o que não
  era o caso com Vercel + Supabase separados.

**Implementação:**
- `deploy/setup-postgres-local.sh` — PostgreSQL 16 (repo oficial PGCG) + `postgresql-16-pgvector`
- `deploy/setup-portal-subdomain.sh` + `deploy/nginx-portal.ifcoding.com.br.conf` — vhost e TLS do subdomínio
- `deploy/MIGRACAO_SUPABASE_PARA_VPS.md` — dump/restore, `.env`, backup, checklist
- `src/lib/file-storage.ts` — armazenamento local (10 MB PDF / 5 MB imagem)
- `src/app/api/files/upload/route.ts` — upload autenticado

**Repositório canônico:** `github.com/profronan16/PortalConecta2.0`
(a Vercel estava conectada a `DebysBru/PortalConecta2.0` — divergência que será
eliminada junto com a saída da Vercel).

**Registrado em:** DECISIONS.md (este arquivo)
**Impacto:** §2.3, §3.8, §5.3, §7, §8, §10.1 (e substitui o item "Storage:
Firebase Storage" da Decisão 1)

---

## 12. Editais: professor publica, admin modera

**Contexto:**
→ Publicar edital era exclusivo do Administrador Geral (`createEdital` em
`src/actions/admin.ts`). O painel do professor não tinha **nenhuma** função de
edital, apesar do requisito de que o professor publica os editais dos seus
projetos.

**Decisão:**
→ **Professor publica editais vinculados aos seus próprios projetos; o
Administrador Geral mantém a válvula de moderação.**

**Implementação:**
- `Edital.projetoId` (opcional, `onDelete: SetNull`) + relação inversa `Projeto.editais`.
  Editais institucionais sem projeto continuam válidos.
- Autorização em `podeGerenciarEdital`: admin passa sempre; professor só se for
  coordenador/vice/admin do projeto do edital **ou** o autor original. Trocar o
  `projetoId` para projeto alheio é bloqueado.
- Edital nasce `review_status: 'PUBLICADO'`, que é a condição exigida pela
  página pública `/editais`. O professor pode despublicar; o admin também, pelo
  painel dele.
- Slug com sufixo de timestamp (o admin usa apenas `slugify` e colide com título
  repetido).
- Excluir o edital remove o PDF do disco **depois** do registro sair do banco,
  para não deixar registro apontando para arquivo inexistente.

**Registrado em:** DECISIONS.md (este arquivo)
**Impacto:** §3.2 (editais), painel do professor

---

## 13. Armazenamento de arquivos: disco local servido pelo nginx

**Decisão:**
→ **Arquivos no disco da VPS** (`STORAGE_ROOT`, padrão `/var/www/portal-files`),
servidos diretamente pelo nginx em `/files/`, **sem** passar pelo processo Node.

**Limites:** PDF 10 MB · PNG/JPG/WEBP/GIF 5 MB.

**Justificativa de segurança** (todo arquivo vem de upload de usuário e é
servido publicamente — é o vetor de ataque mais óbvio):
1. **O nome original nunca toca o disco** — nome físico é UUID + extensão
   derivada do tipo validado. Elimina travessia de diretório e nomes maliciosos.
2. **Tipo detectado por magic bytes**, não por `file.type` nem pela extensão —
   ambos controlados pelo cliente.
3. **Travessia conferida de novo** no caminho resolvido (`path.relative` não
   pode começar com `..`), como defesa em profundidade.
4. Nginx **bloqueia execução** de `.php/.sh/.js/.html/.svg` dentro de `/files/`
   e força PDF como `attachment` com `X-Content-Type-Options: nosniff`.

**Tradeoff:** servir pelo nginx em vez do Node significa que um arquivo público
não passa por checagem de sessão. Aceito porque o conteúdo (editais e imagens de
posts) é público por natureza; **se algum dia for necessário arquivo
restringido, ele não pode entrar em `/files/`** — precisa de rota autenticada.

**Registrado em:** DECISIONS.md (este arquivo)

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
| **Hospedagem na VPS própria (Dec. 11)** | Sai Vercel + Supabase; backup passa a ser nosso; VPS vira ponto único de falha | pré-lançamento | Habilita 10MB/5MB e pgvector sem contorno |
| **Professor publica editais (Dec. 12)** | `Edital.projetoId`; admin mantém moderação | pré-lançamento | Substitui fluxo "só admin publica" |
| **Arquivos em disco local (Dec. 13)** | `/files/` servido pelo nginx, público; precisa rota autenticada se um dia for restrito | pré-lançamento | 10MB PDF / 5MB imagem |

---

**Próximo:** Consultar este arquivo durante implementação; atualizar conforme surgem novas decisões.
