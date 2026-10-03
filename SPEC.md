# Portal Conecta da IFizinha — Especificação Técnica para Implementação Assistida por IA

**IFPR Campus Ivaiporã · Documento de implementação (v1.0)**
**Formato:** especificação executável por agente de IA · **Idioma do produto:** pt-BR

---

## 0. Como usar este documento (instruções para a IA)

> **Leia esta seção antes de qualquer código.**

### 0.1 Seu papel

Você é um agente de engenharia que vai **(a) auditar um projeto já existente** do Portal Conecta e **(b) implementar o que estiver faltando** para que o sistema atenda a esta especificação. Este documento é a fonte da verdade. Onde o código existente divergir, prevalece o que está aqui — **exceto** quando a divergência for uma melhoria deliberada já em produção; nesse caso, registre a divergência em um arquivo `DECISIONS.md` e siga em frente.

### 0.2 Fluxo de trabalho obrigatório

1. **Auditar antes de codar.** Antes de escrever qualquer linha, percorra o checklist da seção **§15 (Auditoria do projeto existente)** e produza um relatório `AUDIT.md` listando, por módulo: o que existe, o que está incompleto, o que está ausente e o que está quebrado.
2. **Priorizar pelo roadmap.** Implemente na ordem do roadmap (§16), entregando fatias verticais funcionais (front + back + dados), não camadas isoladas.
3. **Não inventar dados oficiais.** Endpoints do SUAP, números de processo SEI, conteúdo de editais e calendário acadêmico **não devem ser fabricados**. Onde faltar informação real, deixe um `TODO:` explícito e um campo configurável, nunca um valor placeholder que pareça real.
4. **Revisão humana é parte do produto.** Qualquer conteúdo gerado por IA (resumos, tags, extração de PDF) entra em estado `pendente_revisao` e só vai a público após aprovação humana. Isso é requisito, não detalhe.
5. **Testar contra os critérios de aceite (§14).** Cada módulo só é "pronto" quando passa nos critérios testáveis correspondentes.

### 0.3 Premissas técnicas assumidas

Estas premissas substituem lacunas do documento original. Se o projeto existente já adotou outra escolha equivalente, mantenha-a e registre em `DECISIONS.md`.

| Camada | Escolha assumida | Motivo |
|---|---|---|
| Backend / BD / Auth / Storage | **Supabase** (Postgres + Auth + Storage + Edge Functions + `pgvector`) | Já é o backend conectado ao projeto; resolve auth Google, RLS, vetores e arquivos em uma stack só |
| Frontend | **Next.js (App Router) + React + TypeScript + Tailwind** | Combina com a estética moderna descrita e com renderização híbrida (SEO público + área autenticada) |
| IA (extração e chat) | **API Anthropic (Claude)** para extração estruturada e geração; **embeddings** via modelo de embeddings compatível armazenado em `pgvector` | Saída estruturada confiável + RAG citável |
| Processamento de PDF | Extração de texto server-side (Edge Function/worker) + fallback OCR | Editais chegam como PDF |
| Fila / assíncrono | Tabela de jobs + worker agendado (pg_cron / Edge Function agendada) | PDF e sync SUAP não podem bloquear request |
| Hospedagem front | Vercel ou equivalente | Padrão Next.js |

### 0.4 Convenções

- **Idioma de dados de usuário:** pt-BR. **Idioma de código/identificadores:** inglês (nomes de tabela/coluna em inglês snake_case; rótulos de UI em português).
- **IDs:** `uuid` (default `gen_random_uuid()`).
- **Timestamps:** `timestamptz`, sempre `created_at` e `updated_at` (trigger de atualização automática).
- **Soft delete:** colunas `deleted_at timestamptz` onde houver risco de perda de histórico (editais, projetos, posts).
- **Datas oficiais:** o PDF original do edital é a fonte canônica; qualquer resumo é derivado e marcado como tal.

---

## 1. Visão geral do sistema

O **Portal Conecta da IFizinha** é a plataforma institucional do IFPR Campus Ivaiporã que **centraliza, organiza e traduz** informações para estudantes, professores e administradores. Funciona como ponto único de acesso para projetos, editais (PDF + resumo em linguagem simples), agenda acadêmica, inscrições em projetos, gestão docente, administração e **atendimento por IA conversacional (RAG) com a persona da IFizinha**.

**Identidade visual:** estética moderna, jovem e institucional — gradiente azul/roxo/rosa, cards arredondados, CTAs em destaque, presença da IFizinha e linguagem amigável, sem perder confiabilidade institucional.

**Pilares de produto:**
1. **Tradução** — transformar linguagem burocrática (SEI/SUAP/editais) em linguagem simples.
2. **Centralização** — um lugar só, em vez de e-mails e postagens dispersas.
3. **Confiabilidade** — IA sempre ancorada em documentos cadastrados, com fonte citada e revisão humana.
4. **Participação** — facilitar a inscrição de estudantes em projetos.

---

## 2. Arquitetura e stack (faltava no original)

### 2.1 Visão de alto nível

```
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js / React / Tailwind)                        │
│  • Site público (SSR/SSG p/ SEO)  • Área Professor  • Admin   │
└───────────────┬──────────────────────────────────────────────┘
                │ Supabase JS Client (RLS aplicada) + Server Actions
┌───────────────▼──────────────────────────────────────────────┐
│  SUPABASE                                                     │
│  • Postgres (dados + pgvector)   • Auth (Google OAuth)        │
│  • Storage (PDFs, banners)       • RLS (permissões)          │
│  • Edge Functions: pdf-extract, suap-sync, ifizinha-chat,    │
│    embed-document, rag-query                                  │
│  • pg_cron: sync agendado, jobs assíncronos                  │
└───────────────┬───────────────────────────────┬──────────────┘
                │                                 │
        ┌───────▼────────┐               ┌────────▼─────────┐
        │ API Anthropic  │               │  API SUAP IFPR   │
        │ (Claude)       │               │ (importação      │
        │ extração+chat  │               │  de projetos)    │
        └────────────────┘               └──────────────────┘
```

### 2.2 Responsabilidades por Edge Function

| Function | Entrada | Saída | Observações |
|---|---|---|---|
| `pdf-extract` | `edital_id`, arquivo no Storage | texto extraído + campos estruturados sugeridos (status `pendente_revisao`) | OCR de fallback; grava `extraction_confidence` |
| `embed-document` | `documento_id`, texto | chunks + embeddings em `rag_chunks` | chunking semântico; idempotente por hash |
| `rag-query` | `pergunta`, `escopo`, `role` | chunks relevantes + metadados de fonte | aplica filtros de permissão antes da busca vetorial |
| `ifizinha-chat` | histórico, pergunta, contexto recuperado | resposta com citações | usa `rag-query`; aplica guardrails (§8.5) |
| `suap-sync` | `modo` (manual/agendado) | diff de projetos + log | idempotente; não sobrescreve edição manual sem flag |

### 2.3 Princípios de arquitetura

- **Separação de origem do dado:** todo registro carrega `source` (`suap` | `manual` | `import` | `ia`) e `last_synced_at`. Conteúdo de IA nunca se mistura indistinguível de conteúdo oficial.
- **Idempotência:** sync e embedding devem poder rodar de novo sem duplicar.
- **Async-first:** PDF, embeddings e sync rodam em fila; a UI mostra estado (`processando`, `pendente_revisao`, `publicado`, `erro`).
- **Public-read / write-restrito:** leitura pública é cacheável; escrita sempre passa por RLS + role.

---

## 3. Modelo de dados (faltava no original — crítico)

Esquema Postgres/Supabase. Tipos em SQL. Enums declarados como tipos Postgres. RLS detalhada na §4.4.

### 3.1 Enums (máquinas de estado)

```sql
create type user_role        as enum ('estudante', 'professor', 'admin');
create type data_source      as enum ('suap', 'manual', 'import', 'ia');
create type review_status    as enum ('rascunho', 'processando', 'pendente_revisao', 'publicado', 'rejeitado', 'arquivado', 'erro');

create type projeto_tipo     as enum ('ensino','pesquisa','extensao','inovacao','cultura','esporte','outro');
create type projeto_status   as enum ('ativo','em_execucao','encerrado','suspenso','inscricoes_abertas','sem_vagas');
create type vaga_tipo        as enum ('bolsista','voluntario','ambos');

create type edital_status    as enum ('em_breve','aberto','em_analise','resultado_parcial','prazo_recurso','resultado_publicado','encerrado');

create type inscricao_status as enum ('recebida','em_analise','selecionado','lista_espera','nao_selecionado','desistente');

create type evento_tipo      as enum ('letivo_inicio_fim','feriado','recesso','sabado_letivo','evento_academico',
                                      'evento_cientifico','evento_cultural','prazo_edital','inscricao','resultado',
                                      'recurso','projeto','reuniao','formacao','conselho_classe');

create type post_status      as enum ('rascunho','publicado','arquivado');
```

**Regra de transição (edital):** `em_breve → aberto → em_analise → resultado_parcial → prazo_recurso → resultado_publicado → encerrado`. Transições para trás exigem role `admin` e geram log. A UI nunca permite pular para `resultado_publicado` sem ter passado por estados anteriores (apenas admin pode forçar, com justificativa).

### 3.2 Tabelas — identidade e acesso

```sql
-- Espelha auth.users do Supabase; criada por trigger no signup
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null unique,
  full_name       text,
  avatar_url      text,
  role            user_role not null default 'estudante',
  is_institutional boolean generated always as (email like '%@ifpr.edu.br') stored,
  -- dados de estudante (preenchidos sob consentimento, ver LGPD §9)
  curso           text,
  turma           text,
  semestre        text,
  matricula       text,
  phone           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Permissões explícitas concedidas por admin (ex.: professor sem vínculo SUAP detectável)
create table user_permissions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  permission  text not null,        -- ex.: 'manage_project', 'admin_full'
  granted_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  unique (user_id, permission)
);
```

> **Validação de papel docente:** professor = `is_institutional = true` **E** (vínculo a ≥1 projeto via `project_coordinators`/`project_team` **OU** permissão `manage_project` concedida por admin). Ver §4.

### 3.3 Tabelas — projetos

```sql
create table projetos (
  id                 uuid primary key default gen_random_uuid(),
  suap_id            text unique,                  -- identificador no SUAP, se importado
  nome               text not null,
  slug               text unique not null,
  tipo               projeto_tipo not null default 'outro',
  categoria          text,
  resumo_curto       text,
  descricao          text,
  objetivos          text,
  publico_alvo       text,
  area_tematica      text,
  coordenador_nome   text,
  coordenador_email  text,
  carga_horaria_semanal int,
  local_realizacao   text,
  periodo_inicio     date,
  periodo_fim        date,
  requisitos         text,
  vagas_bolsista     int not null default 0,
  vagas_voluntario   int not null default 0,
  status             projeto_status not null default 'ativo',
  inscricoes_abertas boolean not null default false,
  inscricao_inicio   date,
  inscricao_fim      date,
  formulario_extra   jsonb default '[]',           -- campos complementares do form
  observacoes_estudantes text,
  banner_url         text,
  source             data_source not null default 'manual',
  review_status      review_status not null default 'rascunho',
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- Tags com origem (IA vs revisada)
create table projeto_tags (
  projeto_id  uuid references projetos(id) on delete cascade,
  tag         text not null,
  origem      data_source not null default 'manual',  -- 'ia' = sugerida, precisa revisão
  aprovada    boolean not null default false,
  primary key (projeto_id, tag)
);

create table project_coordinators (
  projeto_id  uuid references projetos(id) on delete cascade,
  user_id     uuid references profiles(id) on delete cascade,
  primary key (projeto_id, user_id)
);

create table project_team (
  projeto_id  uuid references projetos(id) on delete cascade,
  nome        text not null,
  email       text,
  papel       text,
  primary key (projeto_id, nome)
);

create table projeto_cursos (         -- cursos relacionados (N:N)
  projeto_id  uuid references projetos(id) on delete cascade,
  curso       text not null,
  primary key (projeto_id, curso)
);

create table projeto_faq (
  id          uuid primary key default gen_random_uuid(),
  projeto_id  uuid references projetos(id) on delete cascade,
  pergunta    text not null,
  resposta    text not null,
  ordem       int default 0
);
```

### 3.4 Tabelas — editais

```sql
create table editais (
  id                  uuid primary key default gen_random_uuid(),
  titulo              text not null,
  numero              text,
  ano                 int,
  slug                text unique not null,
  categoria           text,
  setor_responsavel   text,
  publico_alvo        text,
  resumo_simples      text,           -- "A IFizinha explica" (derivado, revisado)
  resumo_tecnico      text,
  pdf_path            text,           -- Storage path do PDF original (canônico)
  pdf_filename        text,
  data_publicacao     date,
  inscricao_inicio    date,
  inscricao_fim       date,
  data_resultado_parcial date,
  prazo_recurso       date,
  data_resultado_final   date,
  local_inscricao     text,
  link_inscricao      text,
  documentos_necessarios jsonb default '[]',
  criterios_selecao   text,
  beneficios          text,
  quem_pode           text,
  quem_nao_pode       text,
  contato_duvidas     text,
  observacoes         text,
  fonte_oficial       text,
  status              edital_status not null default 'em_breve',
  source              data_source not null default 'manual',
  review_status       review_status not null default 'rascunho',
  extraction_confidence numeric,      -- 0..1, da extração por IA
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create table edital_tags (
  edital_id  uuid references editais(id) on delete cascade,
  tag        text not null,
  origem     data_source not null default 'manual',
  aprovada   boolean not null default false,
  primary key (edital_id, tag)
);

-- Bloco estruturado "A IFizinha explica" (Q&A)
create table edital_explicacao (
  id          uuid primary key default gen_random_uuid(),
  edital_id   uuid references editais(id) on delete cascade,
  pergunta    text not null,   -- ex.: "Quem pode participar?"
  resposta    text not null,
  ordem       int default 0,
  revisada    boolean not null default false
);

-- Versionamento de resumos (sugestão 5 do original)
create table edital_resumo_versoes (
  id          uuid primary key default gen_random_uuid(),
  edital_id   uuid references editais(id) on delete cascade,
  resumo      text not null,
  gerado_por  data_source not null,   -- 'ia' ou 'manual'
  revisado_por uuid references profiles(id),
  created_at  timestamptz not null default now()
);
```

### 3.5 Tabelas — agenda e eventos

```sql
create table eventos (
  id           uuid primary key default gen_random_uuid(),
  titulo       text not null,
  descricao    text,
  tipo         evento_tipo not null,
  data_inicio  timestamptz not null,
  data_fim     timestamptz,
  dia_inteiro  boolean not null default true,
  local        text,
  publico_alvo text,
  curso        text,                 -- null = todos os cursos
  urgente      boolean not null default false,
  -- vínculos opcionais (um evento pode derivar de edital/projeto)
  edital_id    uuid references editais(id) on delete set null,
  projeto_id   uuid references projetos(id) on delete set null,
  source       data_source not null default 'manual',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

> **Geração automática de eventos:** ao publicar um edital, criar/atualizar eventos derivados (`prazo_edital`, `inscricao`, `resultado`, `recurso`) a partir das datas do edital. Ao mudar datas do edital, sincronizar os eventos. Idem para projetos (`inscricao`, `projeto`).

### 3.6 Tabelas — inscrições

```sql
create table inscricoes (
  id                uuid primary key default gen_random_uuid(),
  protocolo         text unique not null,    -- gerado: ex. "PRJ-2026-000123"
  projeto_id        uuid not null references projetos(id) on delete cascade,
  user_id           uuid references profiles(id) on delete set null,
  -- dados do form (snapshot, pois perfil pode mudar)
  nome_completo     text not null,
  email             text not null,
  telefone          text,
  curso             text,
  turma             text,
  semestre          text,
  idade             int,
  matricula         text,
  tipo_interesse    vaga_tipo not null,
  disponibilidade   text,
  experiencia_previa text,
  justificativa     text,
  ciencia_regras    boolean not null default false,
  consentimento_lgpd boolean not null default false,   -- ver §9
  campos_extra      jsonb default '{}',
  status            inscricao_status not null default 'recebida',
  observacao_interna text,                              -- visível só a prof/admin
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

### 3.7 Tabelas — posts/notícias

```sql
create table posts (
  id           uuid primary key default gen_random_uuid(),
  titulo       text not null,
  slug         text unique not null,
  imagem_url   text,
  texto        text not null,
  categoria    text,
  status       post_status not null default 'rascunho',
  destaque_home boolean not null default false,
  autor_id     uuid references profiles(id),
  edital_id    uuid references editais(id) on delete set null,
  projeto_id   uuid references projetos(id) on delete set null,
  publicado_em timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table post_tags (
  post_id uuid references posts(id) on delete cascade,
  tag     text not null,
  primary key (post_id, tag)
);
```

### 3.8 Tabelas — RAG / base de conhecimento

```sql
create extension if not exists vector;

-- Documento-fonte indexado (edital, projeto, calendário, FAQ...)
create table rag_documentos (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null,         -- 'edital','projeto','agenda','calendario','faq','contato'
  ref_id       uuid,                  -- id do registro de origem (edital_id, projeto_id...)
  titulo       text not null,
  conteudo     text not null,         -- texto canônico revisado que alimenta o RAG
  content_hash text not null,         -- p/ idempotência de re-embedding
  metadata     jsonb default '{}',
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table rag_chunks (
  id            uuid primary key default gen_random_uuid(),
  documento_id  uuid not null references rag_documentos(id) on delete cascade,
  chunk_index   int not null,
  conteudo      text not null,
  embedding     vector(1536),         -- ajustar dimensão ao modelo de embedding
  metadata      jsonb default '{}',   -- p/ filtro: {tipo, status, publico_alvo, curso}
  created_at    timestamptz not null default now()
);
create index on rag_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Log de conversas (auditoria + relatório de perguntas frequentes)
create table chat_sessoes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete set null,
  iniciada_em timestamptz not null default now()
);

create table chat_mensagens (
  id          uuid primary key default gen_random_uuid(),
  sessao_id   uuid not null references chat_sessoes(id) on delete cascade,
  papel       text not null,          -- 'user' | 'assistant'
  conteudo    text not null,
  fontes      jsonb default '[]',     -- [{documento_id, tipo, titulo}]
  created_at  timestamptz not null default now()
);
```

### 3.9 Tabelas — operação (jobs, sync, IA, config, logs)

```sql
-- Fila de jobs assíncronos
create table jobs (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null,          -- 'pdf_extract','embed','suap_sync'
  payload     jsonb not null default '{}',
  status      text not null default 'pendente',  -- pendente|rodando|ok|erro
  tentativas  int not null default 0,
  erro        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Sincronizações SUAP
create table suap_syncs (
  id            uuid primary key default gen_random_uuid(),
  modo          text not null,        -- 'manual'|'agendado'
  iniciada_em   timestamptz not null default now(),
  finalizada_em timestamptz,
  status        text not null default 'rodando',
  projetos_novos int default 0,
  projetos_atualizados int default 0,
  conflitos     jsonb default '[]',   -- campos alterados manualmente que mudaram na fonte
  erro          text
);

-- Fila de revisão de saídas de IA (extração/sugestões)
create table ia_revisoes (
  id            uuid primary key default gen_random_uuid(),
  entidade      text not null,        -- 'edital'|'projeto'
  entidade_id   uuid not null,
  campo         text not null,
  valor_extraido text,
  confianca     numeric,              -- 0..1
  status        text not null default 'pendente',  -- pendente|aceito|editado|rejeitado
  valor_final   text,
  revisor_id    uuid references profiles(id),
  created_at    timestamptz not null default now()
);

-- Configuração da home e do site (chave-valor versionável)
create table site_config (
  chave       text primary key,       -- 'hero_titulo','cta_final','rodape',...
  valor       jsonb not null,
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now()
);

-- Log administrativo (auditoria)
create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id),
  acao        text not null,
  entidade    text,
  entidade_id uuid,
  detalhes    jsonb default '{}',
  ip          inet,
  created_at  timestamptz not null default now()
);

-- Alertas/notificações e interesses do estudante
create table alertas_interesse (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade,
  canal       text not null,          -- 'email'|'portal'|'whatsapp'
  categorias  text[] default '{}',    -- categorias de edital/projeto de interesse
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);

create table favoritos (
  user_id     uuid references profiles(id) on delete cascade,
  entidade    text not null,          -- 'edital'|'projeto'
  entidade_id uuid not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, entidade, entidade_id)
);

create table notificacoes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade,
  titulo      text not null,
  texto       text,
  link        text,
  lida        boolean not null default false,
  created_at  timestamptz not null default now()
);
```

---

## 4. Autenticação e autorização (detalhamento que faltava)

### 4.1 Login

- **Estudante:** Google OAuth (qualquer e-mail) **ou** navegação pública sem login (leitura).
- **Professor:** Google OAuth **restrito a `@ifpr.edu.br`**. Se o e-mail não for institucional, bloquear elevação a professor.
- **Admin:** definido manualmente (seed inicial + concessão por outro admin).

### 4.2 Atribuição de papel (no signup / trigger)

```
on signup:
  cria profile (role default 'estudante')
  se email termina em '@ifpr.edu.br':
     se existe projeto no SUAP com este coordenador_email  → role = 'professor', vincula projetos
     senão                                                 → role = 'estudante' (admin pode promover)
  e-mails na ADMIN_SEED_LIST                               → role = 'admin'
```

### 4.3 Matriz de permissões

| Ação | Público | Estudante | Professor | Admin |
|---|:--:|:--:|:--:|:--:|
| Ver editais/projetos/agenda publicados | ✅ | ✅ | ✅ | ✅ |
| Baixar PDF de edital | ✅ | ✅ | ✅ | ✅ |
| Chat IFizinha (modo público) | ✅ | ✅ | ✅ | ✅ |
| Inscrever-se em projeto | ❌ | ✅ | ✅ | ✅ |
| Favoritar / alertas / histórico | ❌ | ✅ | ✅ | ✅ |
| Gerenciar **seus** projetos | ❌ | ❌ | ✅ | ✅ |
| Ver inscritos dos **seus** projetos | ❌ | ❌ | ✅ | ✅ |
| Exportar relatório dos **seus** projetos | ❌ | ❌ | ✅ | ✅ |
| Gerenciar **qualquer** conteúdo | ❌ | ❌ | ❌ | ✅ |
| Rodar sync SUAP / revisar IA / config home | ❌ | ❌ | ❌ | ✅ |
| Ver logs e métricas globais | ❌ | ❌ | ❌ | ✅ |

### 4.4 RLS (Row Level Security) — políticas-chave

Ativar RLS em **todas** as tabelas. Padrão: leitura pública só de conteúdo `review_status = 'publicado'` e não deletado; escrita conforme papel.

```sql
-- Função auxiliar de papel
create or replace function auth_role() returns user_role language sql stable as $$
  select role from profiles where id = auth.uid();
$$;

-- EDITAIS: público lê publicados; admin tudo
alter table editais enable row level security;
create policy editais_public_read on editais for select
  using (review_status = 'publicado' and deleted_at is null);
create policy editais_admin_all on editais for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- PROJETOS: público lê publicados; professor edita os seus; admin tudo
alter table projetos enable row level security;
create policy projetos_public_read on projetos for select
  using (review_status = 'publicado' and deleted_at is null);
create policy projetos_prof_update on projetos for update using (
  exists (select 1 from project_coordinators pc
          where pc.projeto_id = projetos.id and pc.user_id = auth.uid())
);
create policy projetos_admin_all on projetos for all
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- INSCRICOES: estudante vê só as suas; professor vê as dos seus projetos; admin tudo
alter table inscricoes enable row level security;
create policy inscr_estudante on inscricoes for select using (user_id = auth.uid());
create policy inscr_insert on inscricoes for insert with check (
  user_id = auth.uid() and consentimento_lgpd = true and ciencia_regras = true
);
create policy inscr_prof_read on inscricoes for select using (
  exists (select 1 from project_coordinators pc
          where pc.projeto_id = inscricoes.projeto_id and pc.user_id = auth.uid())
);
create policy inscr_prof_update on inscricoes for update using (
  exists (select 1 from project_coordinators pc
          where pc.projeto_id = inscricoes.projeto_id and pc.user_id = auth.uid())
);
create policy inscr_admin on inscricoes for all using (auth_role() = 'admin');

-- PROFILES: cada um lê/edita o seu; admin lê todos
alter table profiles enable row level security;
create policy profile_self on profiles for select using (id = auth.uid() or auth_role() = 'admin');
create policy profile_update_self on profiles for update using (id = auth.uid());
```

> **Importante:** `observacao_interna` de inscrições e dados pessoais de inscritos **nunca** podem vazar para o papel estudante. Validar com teste automatizado (§14).

---

## 5. Módulos funcionais

### 5.1 Página inicial pública

Estrutura: cabeçalho → hero → métricas → editais em destaque → projetos em destaque → agenda → CTAs → rodapé. Todo o conteúdo configurável vem de `site_config` e dos dados reais.

**Cabeçalho:** logo "Portal Conecta", selo "IFPR Ivaiporã", menu (Editais, Projetos, Agenda, Posts/Notícias), botão "Ver Editais", botão "Entrar / Área do Professor".

**Hero:** chamada principal (ex.: "Tudo do IFPR traduzido pra você"), texto curto, botões "Ver Editais Abertos" / "Explorar Projetos" / "Falar com a IFizinha", card visual da IFizinha, selo "linguagem simples".

**Métricas (resolução da inconsistência apontada no original):** as métricas devem ser **calculadas pela mesma fonte** em home e admin, divergindo apenas no rótulo. Regras canônicas:

| Métrica | Definição SQL (regra única) |
|---|---|
| Editais ativos/abertos | `count(*) where status='aberto' and review_status='publicado' and deleted_at is null` |
| Projetos em execução | `count(*) where status in ('em_execucao','ativo','inscricoes_abertas') and review_status='publicado'` |
| Estudantes beneficiados | `count(distinct user_id) from inscricoes where status='selecionado'` |
| Editais traduzidos | `count(*) editais where resumo_simples is not null and review_status='publicado'` |

> A home **não** pode mostrar "4 editais" enquanto o admin mostra "0": ambos consomem a mesma view. Implementar uma **view materializada** `public_metrics` (refresh a cada 5 min ou on-write) e consumi-la nos dois lugares. Números do tipo "25+" são apenas formatação de exibição, nunca um valor diferente do real.

**Editais/Projetos em destaque:** controlados por flag manual (`destaque_home`) com fallback automático (mais recentes/urgentes). CTAs finais e captura de interesse em alertas (e-mail / portal / WhatsApp institucional, este último opt-in e condicionado a viabilidade institucional).

### 5.2 Módulo de Projetos

- **Listagem pública:** busca textual, filtros avançados (palavra-chave, curso, área, categoria, tipo, coordenador, status, com bolsa, com vaga voluntária, inscrição aberta, novos, turno, local, público), ordenação, grade/lista, paginação ou scroll progressivo.
- **Página individual:** título, resumo, descrição, coordenador/a, tags, vagas, requisitos, datas, botão de inscrição (se aberto), FAQ, projetos relacionados, botão "Perguntar para a IFizinha sobre este projeto" (abre chat com escopo restrito a este projeto).
- **Projetos relacionados:** por tag/área/curso em comum.

### 5.3 Módulo de Editais

Fluxo de cadastro (admin envia PDF):

1. Upload do PDF → Storage (`editais/{id}/original.pdf`), registro com `review_status='processando'`.
2. Job `pdf-extract`: extrai texto (OCR se necessário), chama IA para extração estruturada (§7).
3. Preenche campos sugeridos + `extraction_confidence`; gera `resumo_simples` e bloco "A IFizinha explica"; sugere tags/categorias.
4. `review_status='pendente_revisao'` → tela de revisão (aceitar/editar/rejeitar por campo, §7.3).
5. Publicação só após aprovação → `review_status='publicado'`; dispara geração de eventos derivados e embedding para o RAG.

**Preservação do oficial:** o PDF original fica sempre disponível; a UI deixa explícito que o resumo é apoio e que, em divergência, **prevalece o edital oficial**. Filtros de editais conforme original (aberto, encerrado, resultado publicado, bolsa, assistência estudantil, pesquisa, extensão, ensino, estágio, transporte, alimentação, curso, público-alvo, data de encerramento, recentes, urgentes).

### 5.4 Módulo de Agenda

Visão unificada agregando: calendário acadêmico oficial, datas de editais, datas de projetos, eventos manuais e datas do SUAP (quando disponíveis). Tipos conforme enum `evento_tipo`. Visualizações: lista de próximos, calendário mensal, filtros (categoria, curso, público, mês, urgência), destaque para prazos próximos, integração com cards de edital/projeto, **exportar `.ics`** e "adicionar ao Google Agenda".

> **Calendário acadêmico:** os eventos do Calendário Acadêmico e Administrativo 2026 do Campus Ivaiporã devem ser **importados a partir do documento oficial fornecido pela instituição**, não fabricados. Modele cada item como `evento` com `source='import'` e `tipo` adequado. Deixe um `TODO:` para ingestão do arquivo oficial.

### 5.5 Área do Professor

Dashboard: seus projetos, status, nº de inscritos, vagas, pendências de atualização, alertas de prazo, ações rápidas (editar, ver inscritos, abrir/fechar inscrições, exportar relatório). Edição de campos controlados (resumo, descrição, objetivos, requisitos, vagas, tipo de vaga, status de inscrição, datas, observações, FAQ, banner). **Campos vindos do SUAP** ficam bloqueados ou exigem aprovação admin para alterar. Gestão de inscrições: listar, filtrar (curso, turma, idade, semestre, tipo de interesse, situação), ver dados individuais, alterar status, exportar planilha (CSV/XLSX), registrar observação interna.

### 5.6 Formulário padronizado de inscrição

Único para todos os projetos, com `formulario_extra` por projeto. Campos da §3.6. Recursos: confirmação automática por e-mail, geração de `protocolo`, exportação CSV/XLSX, histórico do estudante. **Consentimento LGPD e ciência das regras são obrigatórios** (constraint na RLS de insert).

### 5.7 Área Administrativa

Menu: Dashboard, Editais, Projetos, Agenda, Posts, Usuários, Sync SUAP, Configurações, IA/RAG, Relatórios, Logs. Dashboard com cards (editais ativos, projetos ativos, próximos eventos, usuários, inscrições abertas/recebidas, PDFs aguardando revisão, projetos sem categoria, projetos sem professor, última sync SUAP, alertas críticos). Ações rápidas: novo edital/projeto/evento/post, importar edital PDF, sincronizar SUAP, revisar sugestões IA, configurar destaques, ver prazos próximos, ver inscrições recentes. Configuração completa da home via `site_config` (hero, botões, destaques, métricas exibidas, banner, CTA, rodapé, links, redes, contatos, mensagens da IFizinha, ordem das seções).

### 5.8 Posts/Notícias

CRUD com os campos da §3.7. Usos: avisos, chamadas de edital, divulgação de projeto, tutoriais, destaques da IFizinha, comunicados urgentes. Flag `destaque_home`.

---

## 6. Integração SUAP

> ⚠️ **Não invente endpoints.** A API do SUAP do IFPR exige autenticação e documentação específica da instância. Implemente um **cliente desacoplado** (`suap-client`) com a base URL e credenciais em variáveis de ambiente, e deixe `TODO:` nos pontos onde o contrato real precisa ser confirmado com a TI do campus.

**Dados a importar:** nome, coordenador/a + e-mail, equipe, tipo, área, situação, período, resumo, bolsistas (se disponível), campus, identificador SUAP.

**Criação de usuários:** ao importar, identificar e-mails `@ifpr.edu.br`, criar/atualizar `profiles` como `professor`, vincular via `project_coordinators`, permitir login Google e exigir confirmação de vínculo no primeiro acesso.

**Sincronização:**
- Execução **manual** (admin) e **agendada** (`pg_cron`).
- Cada run grava `suap_syncs` com diff (novos/atualizados/conflitos).
- **Idempotência:** chave `suap_id`; `upsert` por essa chave.
- **Proteção de edição manual:** se um campo foi editado manualmente (rastreado por `source`/histórico) e a fonte mudou, **não sobrescrever**: registrar em `conflitos` e exigir decisão do admin.
- Log de erros e comparação antes/depois.

---

## 7. Pipeline de IA — extração e classificação

### 7.1 Extração de editais (PDF → estrutura)

Chamada à API Anthropic com **saída estruturada (JSON estrito)**. System prompt: "Você extrai campos de editais institucionais. Responda **apenas** com JSON válido, sem texto fora do JSON, sem markdown. Use `null` quando a informação não constar. Nunca invente datas, números ou nomes."

**Schema de saída esperado:**
```json
{
  "titulo": "string|null",
  "numero": "string|null",
  "ano": "number|null",
  "categoria": "string|null",
  "setor_responsavel": "string|null",
  "publico_alvo": "string|null",
  "datas": {
    "publicacao": "YYYY-MM-DD|null",
    "inscricao_inicio": "YYYY-MM-DD|null",
    "inscricao_fim": "YYYY-MM-DD|null",
    "resultado_parcial": "YYYY-MM-DD|null",
    "prazo_recurso": "YYYY-MM-DD|null",
    "resultado_final": "YYYY-MM-DD|null"
  },
  "local_inscricao": "string|null",
  "link_inscricao": "string|null",
  "documentos_necessarios": ["string"],
  "criterios_selecao": "string|null",
  "beneficios": "string|null",
  "quem_pode": "string|null",
  "quem_nao_pode": "string|null",
  "contato_duvidas": "string|null",
  "tags_sugeridas": ["string"],
  "resumo_simples": "string",
  "ifizinha_explica": [{ "pergunta": "string", "resposta": "string" }],
  "confianca_geral": 0.0
}
```
Cada campo extraído vira uma linha em `ia_revisoes` com sua `confianca`.

### 7.2 Classificação de projetos (SUAP → enriquecimento)

Para cada projeto importado, a IA sugere: tags, categoria, área temática, resumo simplificado, palavras-chave, público provável, cursos relacionados. Saída em JSON, gravada como sugestão (`origem='ia'`, `aprovada=false`).

### 7.3 Revisão humana obrigatória

Tela de revisão por campo: mostra **texto extraído**, **campo sugerido**, **grau de confiança** e botões **Aceitar / Editar / Rejeitar**. Nada de IA vai a público sem `status='aceito'`/`'editado'`. Campos com `confianca < 0.6` aparecem destacados para conferência prioritária.

---

## 8. IFizinha Conversacional (RAG)

### 8.1 Objetivo e regra de ouro

Ajudar estudantes a entender projetos, editais, prazos e documentos. **Responde apenas com base nos dados cadastrados e processados** (`rag_documentos` ativos). Sem fonte recuperada relevante → admite que não encontrou e sugere o setor responsável. **Nunca inventa.**

### 8.2 Pipeline

```
pergunta do usuário
  → rag-query: aplica filtros de permissão (role, status='publicado')
  → busca vetorial top-k em rag_chunks (cosine), + filtro por metadata
  → monta contexto com os chunks + metadados de fonte
  → ifizinha-chat: Claude responde no tom da persona, citando fontes
  → grava chat_mensagens (com fontes) p/ auditoria e relatório
```

### 8.3 Ingestão (o que alimenta o RAG)

PDFs de editais, resumos revisados, projetos publicados, agenda, calendário acadêmico, FAQs, dados estruturados de prazos, contatos por setor. Cada documento → `rag_documentos` (texto canônico revisado) → `embed-document` cria `rag_chunks`. **Só conteúdo publicado e revisado entra no RAG** (resumos não revisados ficam fora).

### 8.4 Chunking e embeddings

- Chunking semântico (por seção/parágrafo), ~300–500 tokens, com sobreposição leve.
- `content_hash` evita re-embeddar conteúdo inalterado.
- Re-embedding disparado quando o registro de origem é re-publicado.
- Metadata no chunk (`tipo`, `status`, `publico_alvo`, `curso`) usada como pré-filtro.

### 8.5 System prompt da IFizinha (guardrails — modelo)

```
Você é a IFizinha, assistente virtual do Portal Conecta do IFPR Campus Ivaiporã.
Tom: jovem, acolhedor, claro e institucional. Trata o estudante por "você".

REGRAS INEGOCIÁVEIS:
1. Responda SOMENTE com base no CONTEXTO fornecido abaixo (documentos do portal).
2. Se a resposta não estiver no contexto, diga que não encontrou essa informação
   no portal e indique o setor/contato responsável. NUNCA invente.
3. Sempre cite a fonte interna usada (ex.: "segundo o Edital X" / "no projeto Y").
4. Explique termos difíceis em linguagem simples.
5. Para prazos e regras, lembre que o documento oficial (PDF do edital) prevalece
   e oriente o estudante a confirmá-lo.
6. Não dê opinião pessoal, não prometa aprovação em bolsa/projeto, não substitua
   a leitura do edital oficial.
7. Respeite permissões: não revele dados pessoais de inscritos nem conteúdo não publicado.
8. Quando útil, ofereça o próximo passo (link interno, botão de inscrição, contato).

CONTEXTO:
{chunks recuperados, cada um com sua fonte}

PERGUNTA: {pergunta do usuário}
```

### 8.6 Modo público vs. autenticado

- **Público:** só responde sobre conteúdo publicado; não acessa dados de inscrições.
- **Autenticado:** pode responder sobre o histórico de inscrições **do próprio usuário** (filtro `user_id`).
- **Escopo por página:** o botão "Perguntar sobre este projeto/edital" injeta filtro de `ref_id` no `rag-query`.

### 8.7 Citações na resposta

Toda resposta retorna `fontes: [{documento_id, tipo, titulo, link}]`. A UI renderiza as fontes como chips clicáveis abaixo da mensagem.


---

## 9. LGPD, segurança e privacidade (reforçado)

O portal trata dados pessoais de estudantes (nome, e-mail, telefone, matrícula, idade). Conformidade com a **LGPD (Lei 13.709/2018)** é requisito.

### 9.1 Princípios aplicados

- **Minimização:** coletar só o necessário ao processo seletivo. Campos não essenciais são opcionais.
- **Finalidade explícita:** o formulário declara para que os dados serão usados (seleção interna do projeto) e registra `consentimento_lgpd` com timestamp.
- **Base legal:** consentimento do titular (inscrição voluntária).
- **Acesso restrito:** dados de inscritos visíveis só ao(s) coordenador(es) do projeto e a admins (garantido por RLS, §4.4).
- **Direitos do titular:** o estudante pode ver, exportar e solicitar exclusão dos seus dados (tela "Meus dados" + fluxo de exclusão).
- **Retenção:** definir prazo de retenção de inscrições encerradas (ex.: fim do ciclo + N meses) e rotina de anonimização.
- **Registro:** `audit_logs` registra acessos e exportações de dados de inscritos.

### 9.2 Segurança

- Auth Google + RLS em todas as tabelas (deny by default).
- PDFs em Storage com política de acesso (públicos só os de editais publicados; uploads em revisão restritos a admin).
- Rate limiting no chat e nos endpoints de IA (anti-abuso e custo).
- Sanitização de uploads (validar MIME/tamanho); antivírus se viável.
- Segredos só em variáveis de ambiente do servidor; **nunca** expor chave de API no client.
- Logs administrativos imutáveis (append-only).
- Backup automático do banco e versionamento de editais/projetos.

### 9.3 Transparência da IA

- Página "Como a IFizinha funciona": explica que ela responde com base nos documentos do portal, pode errar e não substitui o edital oficial.
- "Selo de informação revisada" em resumos conferidos por servidor/admin.
- Disclaimer fixo no chat.

---

## 10. Requisitos não funcionais

### 10.1 Performance
- Home com SSG/ISR + cache da view `public_metrics`.
- Busca eficiente (índices em colunas filtráveis; full-text `tsvector` em projetos/editais).
- Paginação em listas grandes; scroll progressivo opcional.
- Processamento de PDF, embeddings e sync **sempre assíncrono** (fila `jobs`).

### 10.2 Manutenibilidade
- Estrutura modular (um módulo por domínio).
- Separação rígida entre dado oficial, resumo derivado e conteúdo de IA (campo `source` + `review_status`).
- Histórico de alterações e versionamento (editais/projetos/resumos).
- Migrations versionadas no repositório.

### 10.3 Confiabilidade
- Jobs com retry e registro de erro.
- Sync SUAP tolerante a falha parcial (não corrompe estado).
- Health checks das Edge Functions.

---

## 11. Acessibilidade e linguagem (alvo: WCAG 2.1 AA)

- Linguagem simples e progressiva; pouca informação por card.
- Contraste mínimo AA (4.5:1 texto normal); cuidado com texto sobre gradiente.
- Responsivo e bom em celular (mobile-first).
- Navegação por teclado e foco visível; landmarks ARIA.
- `alt` em todas as imagens; ícones decorativos com `aria-hidden`.
- Títulos hierárquicos corretos (`h1`→`h2`→…).
- Estados de loading/erro acessíveis (aria-live nas respostas da IFizinha).
- Tom da IFizinha sem comprometer a confiabilidade institucional.

---

## 12. Observabilidade, logs e relatórios

**Logs:** `audit_logs` (ações admin/prof), `jobs` (assíncronos), `suap_syncs`, `chat_mensagens` (auditoria de IA).

**Relatórios (admin):** projetos por categoria/curso; projetos com vagas; nº de inscritos e perfil; editais mais acessados; downloads de PDF; perguntas mais frequentes à IFizinha; prazos mais consultados; acessos por período; conteúdos sem atualização recente; taxa de aceite/rejeição das sugestões de IA.

---

## 13. Variáveis de ambiente / segredos

```
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # só server-side

# Google OAuth (via Supabase Auth)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
ALLOWED_PROFESSOR_DOMAIN=ifpr.edu.br

# IA
ANTHROPIC_API_KEY=                # só server-side / Edge Function
EMBEDDING_MODEL=                  # definir; alinhar dimensão do vector()

# SUAP (TODO: confirmar com a TI do campus)
SUAP_BASE_URL=
SUAP_TOKEN=

# App
ADMIN_SEED_EMAILS=               # e-mails que nascem admin
WHATSAPP_ENABLED=false           # alertas por WhatsApp são opt-in/condicionais
```

---

## 14. Critérios de aceite (testáveis, por módulo)

> Cada item deve virar um teste automatizado ou um roteiro de QA verificável.

**Geral / permissões**
- [ ] Visitante não autenticado **não** consegue ler dados de inscritos (RLS bloqueia).
- [ ] Estudante autenticado vê só as **próprias** inscrições.
- [ ] Professor vê inscritos **apenas** dos seus projetos.
- [ ] E-mail não `@ifpr.edu.br` **não** é promovido a professor.

**Página inicial**
- [ ] As métricas da home batem exatamente com as do dashboard admin (mesma view).
- [ ] Admin altera hero/CTAs/destaques e a home reflete sem deploy.

**Projetos**
- [ ] Estudante filtra projetos por curso/área/status e vê resultados corretos.
- [ ] Página individual mostra vagas, requisitos e botão de inscrição quando aberto.

**Editais**
- [ ] Admin envia PDF; sistema extrai campos e gera resumo em `pendente_revisao`.
- [ ] Nenhum edital fica público sem aprovação humana.
- [ ] PDF original sempre baixável; aviso de prevalência do oficial visível.

**Agenda**
- [ ] Eventos de calendário, editais e projetos aparecem unificados e filtráveis.
- [ ] Exportação `.ics` funciona.

**Professor**
- [ ] Login `@ifpr.edu.br` acessa só seus projetos; edita campos controlados.
- [ ] Abre/fecha inscrições e exporta planilha de inscritos.

**Inscrições**
- [ ] Inscrição exige consentimento LGPD e ciência das regras.
- [ ] Gera protocolo e confirmação por e-mail.

**IA (extração)**
- [ ] Campos de baixa confiança aparecem destacados para revisão.
- [ ] Aceitar/editar/rejeitar por campo funciona e registra revisor.

**IFizinha (RAG)**
- [ ] Responde só com base em documentos publicados e cita a fonte.
- [ ] Sem fonte relevante, admite que não sabe e indica setor — não inventa.
- [ ] Não revela dados não publicados nem de inscritos.

**SUAP**
- [ ] Sync é idempotente (rodar 2x não duplica).
- [ ] Edição manual não é sobrescrita pelo sync (a sync forçada é a válvula de escape explícita).

> **Revisão 2026-09-16:** "sync agendada" e "tratamento de conflitos" saíram do
> escopo por decisão do responsável (ver `DECISIONS.md` §14) — a sync é manual e
> conflito automático não é cenário legítimo neste fluxo. Permanece apenas a
> proteção de edição manual acima.

---

## 15. Auditoria do projeto existente (faça primeiro → gere `AUDIT.md`)

Para cada item, marque: **OK / Parcial / Ausente / Quebrado** e descreva.

- [ ] Stack confere com §2.3 (ou divergência registrada em `DECISIONS.md`)?
- [ ] Todas as tabelas da §3 existem com colunas/enums corretos?
- [ ] RLS ativa em **todas** as tabelas? Políticas da §4.4 presentes?
- [ ] Login Google funciona? Restrição `@ifpr.edu.br` para professor?
- [ ] Atribuição de papel no signup implementada?
- [ ] Home consome a mesma fonte de métricas que o admin? (inconsistência resolvida?)
- [ ] Config da home via `site_config` funciona sem deploy?
- [ ] Listagem/filtros/página individual de projetos completos?
- [ ] Upload de edital → extração IA → revisão → publicação funciona ponta a ponta?
- [ ] PDF original preservado e baixável; aviso de prevalência presente?
- [ ] Agenda unifica fontes e exporta `.ics`?
- [ ] Geração automática de eventos a partir de editais/projetos?
- [ ] Área do professor: dashboard, edição controlada, gestão de inscritos, export?
- [ ] Formulário de inscrição único com consentimento LGPD e protocolo?
- [ ] Pipeline RAG: ingestão, chunking, embeddings, retrieval com filtro de permissão?
- [ ] IFizinha cita fontes e respeita guardrails (§8.5)?
- [ ] Cliente SUAP desacoplado, sync idempotente, proteção de edição manual?
- [ ] Fila de jobs assíncrona para PDF/embedding/sync?
- [ ] LGPD: consentimento, acesso restrito, exportação/exclusão, retenção?
- [ ] Acessibilidade AA básica (contraste, teclado, alt, headings)?
- [ ] Logs de auditoria e relatórios admin?

---

## 16. Roadmap priorizado (fatias verticais)

**Fase 1 — Fundação + MVP público**
Modelo de dados (§3) + RLS (§4) → home configurável com métricas unificadas → listagem e página individual de projetos e editais → agenda simples → cadastro manual via admin.

**Fase 2 — Gestão de professores**
Login Google (`@ifpr.edu.br`) → painel do professor → edição controlada de projetos → formulário de inscrição (com LGPD) → listagem/exportação de inscritos.

**Fase 3 — IA de extração**
Upload de PDF → `pdf-extract` → extração estruturada (§7) → tela de revisão por campo → publicação após aprovação.

**Fase 4 — IFizinha (RAG)**
Ingestão + embeddings → `rag-query` com filtro de permissão → `ifizinha-chat` com guardrails e citações → modos público/autenticado/por-página → log de conversas.

**Fase 5 — Integração SUAP**
Cliente desacoplado → importação idempotente → criação/vínculo de professores → sync manual (agendada e conflitos fora do escopo — `DECISIONS.md` §14) → proteção de edição manual.

**Fase 6 — Portal completo**
Notificações internas → favoritos → alertas personalizados → relatórios avançados → modo urgente → integração com calendários externos → busca global → páginas "Como participar", FAQ geral, contatos por setor, página pública por coordenador, transparência da IA.

---

## 17. Lacunas do documento original que esta especificação preencheu

1. **Stack tecnológica** — não havia; definida em §2.
2. **Modelo de dados** — ausente; esquema completo em §3.
3. **RLS / segurança em nível de linha** — ausente; políticas em §4.4.
4. **Atribuição e validação de papéis** — vaga; formalizada em §4.
5. **Resolução da inconsistência de métricas** — apontada mas sem solução; regra única + view em §5.1.
6. **Pipeline e schemas de extração de IA** — conceitual; JSON estrito em §7.
7. **Arquitetura de RAG** (chunking, embeddings, retrieval, citações) — só citada; detalhada em §8.
8. **System prompt / guardrails da IFizinha** — ausente; modelo em §8.5.
9. **LGPD operacional** (consentimento, retenção, direitos, exclusão) — superficial; §9.
10. **Processamento assíncrono / fila de jobs** — implícito; modelado em §3.9 e §10.
11. **Geração automática de eventos** a partir de editais/projetos — ausente; §3.5/§5.4.
12. **Variáveis de ambiente / segredos** — ausente; §13.
13. **Critérios de aceite testáveis** — só descritivos; convertidos em checklist em §14.
14. **Checklist de auditoria do existente** — ausente; §15.
15. **Idempotência e proteção de edição manual no SUAP** — citada vagamente; formalizada em §6.
16. **WCAG como alvo concreto** — linguagem genérica; alvo AA em §11.
17. **Versionamento de resumos e editais** — sugerido; modelado (`edital_resumo_versoes`) em §3.4.
18. **Auditoria de conversas da IA** (`chat_mensagens` com fontes) — ausente; §3.8/§8.7.

---

## 18. Glossário

- **RAG** — Retrieval-Augmented Generation: a IA responde recuperando trechos de documentos cadastrados, reduzindo alucinação.
- **RLS** — Row Level Security: regras do Postgres que filtram linhas por usuário/papel.
- **pgvector** — extensão Postgres para busca por similaridade de embeddings.
- **SUAP** — Sistema Unificado de Administração Pública (origem dos projetos do campus).
- **SEI** — Sistema Eletrônico de Informações (processos administrativos).
- **Embedding** — representação numérica de texto usada na busca semântica do RAG.
- **`review_status`** — ciclo de vida editorial de um registro (rascunho → … → publicado).
- **`source`** — origem do dado (suap / manual / import / ia), garante rastreabilidade.

---

*Fim da especificação. Comece pela §15 (auditoria), gere `AUDIT.md`, e implemente seguindo o roadmap da §16.*
