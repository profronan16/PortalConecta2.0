# Diagnóstico — Portal Conecta 2.0 (pré-lançamento)

**Data:** turno atual
**Escopo:** causa da falha de deploy na Vercel, estado das funcionalidades (foco no painel do professor), pipeline RAG/banco vetorial, armazenamento de arquivos e subdomínio na VPS.

---

## 1. RESOLVIDO — causa raiz da falha de build na Vercel

### Diagnóstico

`src/app/projetos/page.tsx` era **a única página pública sem `export const dynamic`**.
Sem essa flag o Next.js tenta **pré-renderizar a página durante o `next build`**, o que
executa `prisma.projeto.findMany()` em tempo de compilação.

Reproduzido localmente (banco inacessível, simulando o build da Vercel):

```
prisma:error
Invalid `prisma.projeto.findMany()` invocation:
Can't reach database server at `localhost:5432`

Error occurred prerendering page "/projetos".
PrismaClientInitializationError: ...
> Export encountered errors on following paths:
        /projetos/page: /projetos
exit=1
```

Ou seja: **qualquer** condição em que o banco não esteja acessível no momento do build
derruba o deploy inteiro — e não apenas a página `/projetos`.

Comparativo das páginas públicas:

| Página | `dynamic` | `prisma` | Resultado no build |
|---|---|---|---|
| `/` (`src/app/page.tsx`) | `force-dynamic` | sim | OK |
| `/editais` | `force-dynamic` | sim | OK |
| `/agenda` | `force-dynamic` | sim | OK |
| `/projetos` | **ausente** | sim | **FALHA** |

### Correção aplicada

Adicionado `export const dynamic = 'force-dynamic';` em `src/app/projetos/page.tsx`
(mantendo `revalidate = 300`, que continua válido e agora faz ISR em runtime).

**Verificado:** build completo passou, `exit=0`, e `/projetos` aparece como
`ƒ (Dynamic) server-rendered on demand` em vez de ser pré-renderizado.

```
├ ƒ /projetos                            4.17 kB         105 kB
✓ Generating static pages (42/42)
exit=0
```

---

## 2. Outros bloqueadores de produção (Vercel)

### 2.1 `fs` — escrita em disco incompatível com serverless

`src/app/api/admin/suap/token/route.ts` grava `.suap-token.json` em
`process.cwd()`, e `src/lib/suap-api.ts:205` lê esse mesmo arquivo.

No filesystem da Vercel (somente leitura, exceto `/tmp`, que é efêmero e
**não compartilhado** entre invocações), o resultado é:

- `POST` → tenta `writeFile` → **erro 500** "Erro ao salvar token";
- `GET` → nunca encontra o arquivo → token sempre `null`;
- mesmo se caísse em `/tmp`, o token se perderia entre requisições.

**Impacto:** salvar o token SUAP pela interface **não funciona em produção**.
O caminho confiável hoje é a variável de ambiente `SUAP_API_TOKEN`.
**Correção recomendada:** mover o token para uma tabela do banco (ou para `SiteConfig`).

### 2.2 RAG faz trabalho pesado de forma 100% síncrona

`src/app/api/admin/rag/upload/route.ts` executa, **dentro de uma única requisição HTTP**:

1. extração de texto do PDF (`pdf-parse`, em memória);
2. `chunkDocument()` + `createMany` de todos os chunks;
3. `curarDocumentoKb()` → chamada ao LLM (DeepSeek) para classificar/resumir;
4. `indexarDocumentoKb()` → **embeddings de todos os chunks** (Gemini) + inserts.

A própria `kb-worker.ts` reconhece isso no comentário: *"o job é processado
imediatamente (in-process), não por um consumidor externo/cron"*.

**Impacto:** em função serverless, uploads de PDF grande tendem a estourar o
timeout da função. O model `Job` já existe no schema e **já é usado** para logar
o ciclo `pendente → rodando → ok/erro` — falta só um consumidor real
(rota `/api/jobs/process` chamada por cron).

### 2.3 Limite de corpo da requisição

A Vercel impõe teto de corpo em funções serverless (da ordem de **4,5 MB**).
Os limites atuais da aplicação são **20 MB** (`MAX_FILE_SIZE_BYTES` em
`upload/route.ts` e em `editais/extract-pdf/route.ts`) — ou seja, **a aplicação
aceita arquivos que a plataforma não entrega**. Isso é relevante direto para o
requisito de 10 MB PDF / 5 MB imagem (ver §4).

### 2.4 Checagem de papel por e-mail vindo do cliente

`upload/route.ts`, `extract-pdf/route.ts` e `suap/token/route.ts` autorizam com
`adminEmail` **enviado no corpo do formulário** e conferem o papel no banco:

```ts
const adminEmail = formData.get('adminEmail') as string | null;
if (!(await isAdmin(adminEmail))) return 403;
```

Isso **não é explorável** (o papel é conferido no servidor contra a tabela
`User`, então forjar o e-mail só resulta em 403 se aquele e-mail não for ADMIN).
Mas existe um **problema real de vínculo**: a rota confia em um e-mail que o
cliente escolhe, e não na **sessão verificada** do servidor — que já existe e
já está pronta em `src/lib/session.ts` (`getVerifiedServerSession()`, cookie
`session` verificado com `verifySessionCookie`).

**Correção recomendada:** trocar `adminEmail` do corpo por
`getVerifiedServerSession()` nas rotas administrativas.

---

## 3. Painel do Professor — estado real

| Requisito | Estado | Evidência |
|---|---|---|
| Ver projetos sob sua responsabilidade | ✅ Funciona | `listMyProjetos` → `projetosAcessiveis()` |
| Editar dados do projeto | ✅ Funciona | `updateMyProjeto` com checagem de vínculo |
| Publicar/editar/excluir posts | ✅ Funciona, com editor rico | `src/app/professor/(protected)/projetos/[id]/posts/page.tsx`, `RichTextEditor` |
| Abrir/fechar inscrições com prazo | ✅ Funciona | `abrirInscricoes`, `toggleInscricoes`, `AbrirInscricoesModal` |
| **Criar/editar vagas (bolsista/voluntário)** | ✅ Funciona | `createVaga`/`updateVaga`/`deleteVaga`, modal `VagaFormModal` |
| **Selecionar alunos por vaga** | ✅ Funciona, **com trava de vagas** | `updateInscricaoStatus` recusa selecionar além de `Vaga.quantidade` |
| Exportar inscrições em CSV | ✅ Funciona, com checagem de vínculo | `exportInscricoesCSV` |
| **Postar editais** | ❌ **NÃO EXISTE** | `src/actions/professor.ts` não tem **nenhuma** função de edital |
| Upload de imagem/arquivo do professor | ❌ Não existe | nenhum `upload` nos componentes do professor |

### Detalhe do ponto crítico: "postar editais"

Confirmado por busca: o arquivo `src/actions/professor.ts` (534 linhas) contém
`getProfessorStats`, `listMyProjetos`, `getProjetoDetalhes`, `listInscricoes`,
`updateMyProjeto`, `abrirInscricoes`, `toggleInscricoes`, `updateInscricaoStatus`,
**vagas** (`listVagas`/`createVaga`/`updateVaga`/`deleteVaga`), **posts**
(`listPosts`/`createPost`/`updatePost`/`deletePost`) e `exportInscricoesCSV` —
**zero ocorrências de "edital"**.

A criação de editais existe **apenas no painel admin**
(`src/actions/admin.ts`: `createEdital`, `updateEdital`, `toggleEditalPublicacao`,
`deleteEdital`), em `/admin/editais`.

**Conclusão:** hoje o professor **não consegue** publicar editais. Ou ele recebe
essa capacidade (novas actions + tela), ou o fluxo continua sendo
"professor pede, admin publica" — **precisa de decisão sua**.

### Ponto de atenção — permissão local de projeto

O modelo `UserPermission` (permissão `manage_project` por usuário) existe no
schema e **não é usado por nenhuma action**. Adicionar um aluno como "admin do
projeto" promove o `User.role` global para `PROFESSOR`, em vez de conceder
permissão só naquele projeto — divergindo do requisito "permissão local, não
confundir com o Admin geral do sistema".

---

## 4. Armazenamento de arquivos — o que falta e o que decide a arquitetura

### Estado atual

**Não existe armazenamento de arquivo nenhum.** No upload de RAG o PDF é lido em
memória e **descartado**; o banco guarda só
`metadata: { fileType, filename, sizeBytes, uploaded_at }`.
O campo `DocumentoKb.storagePath` existe no schema e **nunca é preenchido**.
O `pgvector-setup.sql` também não envolve arquivos.

### Restrição decisiva

Escrever no disco da VPS **a partir de código serverless na Vercel não é
possível** — são máquinas diferentes. Portanto, "armazenar dentro do próprio
servidor" só funciona de uma destas três formas:

| Opção | Como funciona | Limite de 10MB PDF / 5MB imagem |
|---|---|---|
| **A. App hospedado na VPS** | Next.js roda na VPS; grava direto em `/var/www/portal-files` | ✅ Respeitado de ponta a ponta, sem proxy |
| **B. App na Vercel + microsserviço de arquivos na VPS** | Serviço Node na VPS (porta 3100) exposto via nginx em `/api/files/`, autenticado por token | ⚠️ **O teto de ~4,5 MB da Vercel bloqueia antes** — exigiria upload direto do navegador para a VPS, contornando a função serverless |
| **C. App na Vercel + arquivos na VPS servidos pelo nginx** | Igual a B, mas só leitura/serving | Mesma limitação de B no upload |

Só a **opção A** atende o requisito (10 MB PDF / 5 MB imagem) sem gambiarra.

### Configuração já preparada (para A ou B)

Criei os dois arquivos de deploy, prontos para uso:

- `deploy/nginx-portal.ifcoding.com.br.conf`
- `deploy/setup-portal-subdomain.sh`

O vhost já inclui:

- `client_max_body_size 12M` — teto do nginx **acima** dos 10 MB, porque
  `multipart/form-data` soma envelope + boundary + demais campos; a validação
  fina por tipo (10 MB PDF / 5 MB imagem) fica na aplicação, que responde com
  mensagem clara;
- `location /files/` servindo `/var/www/portal-files/` direto pelo nginx, com
  `X-Content-Type-Options: nosniff`, PDF forçado como `attachment` e **bloqueio
  de execução** de `.php/.sh/.js/.html/.svg` — para que um arquivo enviado nunca
  seja interpretado como código;
- `proxy_request_buffering off` no bloco do app, para uploads grandes irem
  direto a disco em vez de buffer em memória.

---

## 5. Chatbot / RAG / banco vetorial

### O que está bom

A pipeline vetorial **está corretamente ligada** — a análise antiga
(`ANALISE_E_PLANO_RAG.md`) está desatualizada neste ponto. Verificado:

- `/api/chat` chama `generateEmbedding(pergunta)` → `searchSimilarChunks()`
  → lê de **`chunks_kb`** (não mais do `RagChunk` legado);
- `indexarDocumentoKb()` gera embeddings em lote e grava com
  `$executeRawUnsafe(... $12::vector)`;
- `curarDocumentoKb()` faz a curadoria via LLM antes de indexar;
- `documentos_kb`/`chunks_kb` são versionados (`ativo`, `versao`), com
  `deactivateOldDocumentVersions()` implementada e chamada;
- fallback gracioso em três níveis na busca (RPC → SQL direto → memória).

O legado `RagDocumento`/`RagChunk` já **não é usado em lugar nenhum** do fluxo,
só aparece em `limpeza-tables.ts` (tela de limpeza de dados).

### Riscos concretos

1. **Se a extensão `vector` / a função `match_chunks_kb` não existirem no banco,
   o RAG degrada silenciosamente.** Os dois primeiros níveis falham para o
   terceiro — o fallback em memória — que retorna `similarity: 0.5` **fixo** para
   todo chunk (`supabase-vector.ts:249`). O chat continua respondendo, mas
   **sem busca semântica real**: é literalmente só "os 50 primeiros chunks", e o
   filtro `minSimilarity >= 0.2` nunca elimina nada (0.5 > 0.2). Não há aviso
   na interface. **Precisa ser verificado no banco.**

2. **Se `GEMINI_API_KEY` não estiver configurada, os embeddings viram hash
   SHA-256 determinístico** (`embeddings.ts:61`). Isso *parece* funcionar (não
   quebra), mas **não há semântica nenhuma** — vetores de textos parecidos não
   ficam próximos. Em produção isso é indistinguível de um RAG funcionando até
   alguém testar a qualidade das respostas.

3. **Duas funções de chat diferentes** coexistindo: `/api/chat` (a IFizinha, com
   RAG) e `/api/ai/ifizinha` (tradução de edital para linguagem simples). Não é
   bug, mas confunde manutenção.

### Alternativa gratuita ao banco vetorial — vale a pena trocar?

**Recomendação: NÃO trocar.** Justificativa:

| Opção | Custo | Ganho real neste projeto | Custo de troca |
|---|---|---|---|
| **pgvector no Supabase atual** | **R$ 0** (já incluído) | — | — |
| Qdrant / Chroma / LanceDB self-hosted na VPS | R$ 0 (mas ocupa a VPS) | busca um pouco mais rápida em escala | +1 serviço para operar, backup separado, dados **fora** do Postgres |
| Pinecone / Weaviate Cloud free tier | R$ 0 até certo limite | gerenciado | limites apertados, mais uma dependência externa |
| Supabase Storage + pgvector | R$ 0 no free tier | resolve **arquivos**, não vetores | — |

O ponto decisivo: com pgvector, **chunk + embedding + metadados + JOIN com
`documentos_kb` vivem na mesma transação e no mesmo banco**, e o filtro
(`ativo`, `categoria`, `tipo`) é um `WHERE` comum. Migrar para um banco vetorial
externo implicaria **duplicar fonte de verdade** (texto no Postgres, vetor fora),
sincronização, e nenhuma tabela para fazer JOIN — tudo isso para um ganho que só
aparece em milhões de vetores. O volume aqui é de **dezenas a poucos milhares de
chunks**.

**O problema do RAG hoje não é o banco vetorial — é a infra pgvector não estar
provisionada e as chaves de API não estarem configuradas.** Trocar de banco não
resolve nenhum dos dois.

---

## 6. Subdomínio `portal.ifcoding.com.br` — situação

Verificado por fora (sem SSH):

| Item | Situação |
|---|---|
| DNS `ifcoding.com.br` | ✅ `A 198.44.123.154` |
| DNS `portal.ifcoding.com.br` | ❌ **não resolve** — registro ainda não criado |
| Portas 80 / 443 da VPS | ✅ abertas (nginx 1.20.1 respondendo o FECIPE) |
| **Porta 22 (SSH)** | ❌ **timeout** — bloqueada/indisponível |
| Certificados existentes | Let's Encrypt por subdomínio (`fecipe.`, `sga.`, `prova.`, `sepin.`…) — padrão já consolidado |
| `portal.` no crt.sh | não existe ainda |

**Ação necessária (você):**

1. **DNS** — criar: Tipo `A` · Nome `portal` · Valor `198.44.123.154` · TTL 300.
2. **SSH** — o acesso está bloqueado. Verifique no painel da RackNerd (SolusVM)
   se há firewall/porta SSH em uso diferente de 22, ou se o IP está na lista de
   bloqueio. Sem isso não consigo provisionar o vhost diretamente.

Com o SSH liberado, os passos 2–5 (`deploy/setup-portal-subdomain.sh`) já estão
prontos e são idempotentes, com backup automático do `/etc/nginx` antes de
qualquer alteração e `nginx -t` antes do reload — de modo que o FECIPE
**não sai do ar** em nenhuma hipótese.

---

## 7. Prioridades sugeridas

| # | Item | Tipo | Bloqueia lançamento? |
|---|---|---|---|
| 1 | `/projetos` sem `force-dynamic` | ✅ **corrigido** | sim (build) |
| 2 | Provisionar pgvector + `match_chunks_kb` no banco | config | sim (RAG real) |
| 3 | Configurar `DEEPSEEK_API_KEY` e `GEMINI_API_KEY` | config | sim (chat + embeddings) |
| 4 | Token SUAP em `fs` (não persiste na Vercel) | código | não |
| 5 | Decidir hospedagem e implementar storage 10MB/5MB | código+infra | sim (requisito) |
| 6 | Professor publicar editais (ou manter só admin) | código | depende da decisão |
| 7 | RAG assíncrono via `Job` + cron | código | não (mas evita timeout) |
| 8 | Trocar `adminEmail` do corpo por sessão verificada | código | não (endurecimento) |
| 9 | DNS + vhost + TLS do subdomínio | infra | sim (URL de lançamento) |
| 10 | Remover modelos legados `RagDocumento`/`RagChunk` | limpeza | não |

---

## 8. Decisões tomadas e o que foi implementado

Você definiu o rumo:

1. **Hospedagem:** mover tudo para a VPS + **PostgreSQL local** em vez de Supabase.
2. **Editais:** professor publica editais dos seus projetos.
3. **Verificação:** instalar as CLIs e logar para inspecionar o banco real.

### 8.1 Armazenamento local de arquivos — implementado

Novo módulo `src/lib/file-storage.ts`, com os limites exatos que você pediu:

| Tipo | Limite |
|---|---|
| PDF | **10 MB** |
| PNG / JPG / WEBP / GIF | **5 MB** |

Layout em disco: `$STORAGE_ROOT/{pdf,imagens}/<ano>/<mês>/<uuid>.<ext>`,
servido pelo nginx em `https://<host>/files/...`.

Decisões de segurança (arquivo de usuário servido publicamente é o vetor de
ataque mais óbvio):

- **O nome original nunca toca o disco** — o nome físico é UUID + extensão
  derivada do tipo validado. Elimina travessia de diretório e nomes maliciosos.
- **O tipo é detectado pelos magic bytes**, não por `file.type` nem pela
  extensão — ambos são controlados pelo cliente.
- **Travessia de diretório** é conferida de novo no caminho resolvido
  (`path.relative` não pode começar com `..`), como defesa em profundidade.
- O nginx **bloqueia execução** de `.php/.sh/.js/.html/.svg` dentro de
  `/files/` e força PDF como `attachment` com `nosniff`.

Rota de upload: `src/app/api/files/upload/route.ts` (professor **e** admin —
diferente das rotas `/api/admin/*`, que exigem ADMIN). Erros devolvem o status
certo: **415** tipo não permitido, **413** acima do limite.

### 8.2 Professor publica editais — implementado

Antes: `src/actions/professor.ts` não tinha **nenhuma** função de edital.

Agora:

- **Schema:** `Edital.projetoId` (opcional, `onDelete: SetNull`) + a relação
  inversa `Projeto.editais`. Editais institucionais sem projeto continuam
  válidos.
- **Actions novas** em `src/actions/professor.ts`: `listProjetosParaEdital`,
  `listMeusEditais`, `createMeuEdital`, `updateMeuEdital`, `deleteMeuEdital`.
- **Autorização:** Administrador Geral passa sempre; professor só passa se for
  coordenador/vice/admin do projeto do edital, ou se for o autor original
  (via `podeGerenciarEdital`). Trocar o `projetoId` de um edital para um
  projeto alheio também é bloqueado.
- **Edital nasce `PUBLICADO`** — é exatamente o que a página pública
  `/editais` exige (`review_status: 'PUBLICADO'`). O professor pode
  despublicar; o Administrador Geral continua com a mesma válvula no painel
  dele (moderação preservada).
- **Slug único:** o admin usa só `slugify` e quebra com título repetido; a
  versão do professor acrescenta sufixo de timestamp.
- **PDF:** upload para o armazenamento local, gravando `pdfPath` (disco) e
  `arquivoPdfUrl` (URL pública). Excluir o edital remove o PDF do disco
  **depois** do registro sair do banco.
- **Tela nova:** `src/app/professor/(protected)/editais/page.tsx`, com abas
  "Informações" e "Tradução IFizinha", upload de PDF com feedback de
  progresso e erro. Item **"Meus Editais"** adicionado ao menu lateral
  (`ProfessorShell`).

**Bug de exibição corrigido de passagem:** o campo "Benefícios" era o único
do formulário que **não aparecia em lugar nenhum** na página pública — o texto
era gravado e nunca renderizado. Adicionado em
`src/app/editais/[slug]/page.tsx`, com fallback para a coluna de topo
`Edital.beneficios` (usada pelo sync do SUAP).

### 8.3 Postgres local na VPS — scripts prontos

- `deploy/setup-postgres-local.sh` — instala PostgreSQL 16 (repositório
  oficial PGCG) + `postgresql-16-pgvector`, cria banco/usuário, roda
  `CREATE EXTENSION vector` e **verifica** a versão instalada. Idempotente.
- `deploy/MIGRACAO_SUPABASE_PARA_VPS.md` — dump/restore, ajuste do `.env`,
  checklist e **como configurar backup** (que passa a ser sua
  responsabilidade sem o Supabase).

**Ganho colateral:** o cron `keep-db-alive` deixa de ser necessário — ele só
existe para evitar a pausa automática do Supabase, e um Postgres local nunca
pausa.

**O passo que faltava no Supabase** vira uma linha aqui:

```bash
psql "$DATABASE_URL" -f prisma/pgvector-setup.sql
```

### 8.4 Diagnóstico de embeddings — implementado

Adicionado `getEmbeddingProviderStatus()` em `src/lib/embeddings.ts`. Ele
existe porque a degradação é **silenciosa**: sem `GEMINI_API_KEY` o serviço
não falha, só passa a gerar vetores por hash SHA-256 — 1536 dimensões válidas,
**zero semântica**. O chat continua respondendo e nada aparece no log. A
função permite que o painel mostre um aviso explícito em vez de esconder o
problema.

### 8.5 Verificação

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0, sem erros |
| `npx next build` | ✅ exit 0, 44/44 páginas |
| `/professor/editais` | ✅ gerada (8.49 kB) |
| `/api/files/upload` | ✅ gerada |
| `/projetos` | ✅ dinâmica (`ƒ`), não mais pré-renderizada |

---

## 9. Perguntas que travam a implementação

As respostas definem **como** eu implemento os itens 5, 6 e 9 — ver mensagem
final do turno.

