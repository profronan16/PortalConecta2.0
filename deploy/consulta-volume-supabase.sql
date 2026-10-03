-- ==============================================================================
-- CONSULTA ÚNICA (versão robusta) — o que existe hoje no banco do Supabase?
-- ==============================================================================
-- Projeto: uodkwdaruqrnprqkpgqr (PortalConecta2.0, org "DebysBru's Org")
-- Onde rodar: painel do Supabase → SQL Editor → New query → colar → Run
--
-- ESTA VERSÃO NÃO DÁ "relation does not exist": os nomes de tabela são
-- comparados com o catálogo do Postgres (information_schema) em vez de serem
-- consultados direto, e cada contagem só executa se a tabela existir.
--
-- ATENÇÃO AOS NOMES: 5 models do schema Prisma têm @@map, então a tabela real
-- tem nome DIFERENTE do model — e é o nome da TABELA que vale no SQL:
--
--     model Vaga         -> tabela "vagas"
--     model PerfilAluno  -> tabela "perfis_aluno"
--     model DocumentoKb  -> tabela "documentos_kb"
--     model ChunkKb      -> tabela "chunks_kb"
--     model RateLimitHit -> tabela "rate_limit_hits"
--
-- Os outros models não têm @@map, então a tabela tem o mesmo nome do model,
-- inclusive com maiúscula ("User", "Projeto", "Edital", "Inscricao").
--
-- Retorna TRÊS resultados, nesta ordem:
--   1. Quais tabelas do projeto existem / faltam
--   2. Contagem de linhas de TODA tabela existente (via NOTICE)
--   3. Diagnóstico do RAG: pgvector, coluna embedding, função de busca (via NOTICE)
-- ==============================================================================


-- ==============================================================================
-- PARTE 1 — Quais das tabelas do projeto existem? (só leitura de catálogo)
-- ESPERADO: todas com situacao = 'existe'
-- Qualquer linha com 'FALTA' indica schema desatualizado no Supabase.
-- ==============================================================================
WITH esperadas(nome) AS (
  VALUES
    ('User'), ('Account'), ('Session'), ('VerificationToken'),
    ('Edital'), ('Projeto'), ('Post'), ('Evento'), ('SyncLog'),
    ('ProjectCoordinator'), ('UserPermission'), ('Inscricao'), ('Job'),
    ('RagDocumento'), ('RagChunk'), ('ChatSessao'), ('ChatMensagem'),
    ('IaRevisao'), ('SiteConfig'), ('AuditLog'), ('ProjetoTag'),
    ('ProjetoCurso'), ('ProjetoFaq'), ('EditalTag'), ('EditalExplicacao'),
    ('EditalResumoVersao'), ('AlertaInteresse'), ('Favorito'), ('Notificacao'),
    ('RagUploadLog'),
    -- nomes REAIS no banco (models com @@map)
    ('vagas'), ('perfis_aluno'), ('documentos_kb'), ('chunks_kb'),
    ('rate_limit_hits')
)
SELECT
  e.nome                                              AS tabela_esperada,
  CASE WHEN t.table_name IS NULL THEN 'FALTA' ELSE 'existe' END AS situacao,
  COALESCE(t.table_type, '-')                         AS tipo
FROM esperadas e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = e.nome
ORDER BY (t.table_name IS NULL) DESC, e.nome;


-- ==============================================================================
-- PARTE 3 — Contagem de linhas de CADA tabela que existe em public
-- Não precisa saber nome nenhum: percorre o catálogo e conta o que achar.
-- A saída aparece na aba "Notices"/"Messages" do SQL Editor (RAISE NOTICE),
-- NÃO como tabela de resultado — é de propósito, para não falhar por nome.
-- ==============================================================================
DO $$
DECLARE
  r       record;
  n       bigint;
  total   bigint := 0;
  vazias  int    := 0;
  comuns   int    := 0;
BEGIN
  RAISE NOTICE '%-40s | %10s', 'TABELA', 'LINHAS';
  RAISE NOTICE '%', repeat('-', 53);

  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO n;
    total := total + n;
    IF n = 0 THEN vazias := vazias + 1; ELSE comuns := comuns + 1; END IF;
    RAISE NOTICE '%-40s | %10s', r.relname, n;
  END LOOP;

  RAISE NOTICE '%', repeat('=', 53);
  RAISE NOTICE 'Tabelas com dados: %   |   Tabelas vazias: %', comuns, vazias;
  RAISE NOTICE 'TOTAL DE LINHAS NO BANCO: %', total;
END $$;


-- ==============================================================================
-- PARTE 4 — O RAG tem embedding de verdade? (o teste que importa)
-- Se `chunks_kb` não existir, o bloco abaixo avisa em vez de dar erro.
-- ==============================================================================
DO $$
DECLARE
  tem_tabela boolean;
  tem_coluna boolean;
  total      bigint := 0;
  com_vetor  bigint := 0;
  tem_ext    boolean;
  tem_func   boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='chunks_kb'
  ) INTO tem_tabela;

  IF NOT tem_tabela THEN
    RAISE NOTICE 'RAG: tabela chunks_kb NAO EXISTE -> o pipeline vetorial nunca foi provisionado neste banco.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='chunks_kb' AND column_name='embedding'
  ) INTO tem_coluna;

  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') INTO tem_ext;

  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='match_chunks_kb') INTO tem_func;

  EXECUTE 'SELECT count(*) FROM public.chunks_kb' INTO total;

  IF tem_coluna THEN
    EXECUTE 'SELECT count(embedding) FROM public.chunks_kb' INTO com_vetor;
  END IF;

  RAISE NOTICE '%', repeat('=', 53);
  RAISE NOTICE 'DIAGNOSTICO DO RAG';
  RAISE NOTICE '%', repeat('-', 53);
  RAISE NOTICE 'extensao pgvector instalada : %', CASE WHEN tem_ext  THEN 'SIM' ELSE 'NAO  <-- problema' END;
  RAISE NOTICE 'coluna chunks_kb.embedding  : %', CASE WHEN tem_coluna THEN 'SIM' ELSE 'NAO  <-- problema' END;
  RAISE NOTICE 'funcao match_chunks_kb      : %', CASE WHEN tem_func THEN 'SIM' ELSE 'NAO  <-- problema' END;
  RAISE NOTICE 'chunks gravados             : %', total;
  RAISE NOTICE 'chunks COM vetor            : %', com_vetor;

  IF tem_ext AND tem_coluna AND tem_func THEN
    IF total = 0 THEN
      RAISE NOTICE 'VEREDITO: infra do RAG OK, mas a base de conhecimento esta VAZIA (nada indexado ainda).';
    ELSIF com_vetor = total THEN
      RAISE NOTICE 'VEREDITO: RAG OK — todos os chunks tem vetor. Busca semantica real funcionando.';
    ELSE
      RAISE NOTICE 'VEREDITO: RAG PARCIAL — % de % chunks sem vetor. Esses chunks sao INVISIVEIS para a busca semantica.', (total - com_vetor), total;
    END IF;
  ELSE
    RAISE NOTICE 'VEREDITO: RAG DEGRADADO — cai no fallback em memoria (similarity 0.5 fixo).';
    RAISE NOTICE '          O chat responde normalmente, mas SEM busca semantica. Nao ha erro visivel em lugar nenhum.';
  END IF;
END $$;
