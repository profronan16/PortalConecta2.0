-- ==============================================================================
-- VERIFICAÇÃO FINAL — versão enxuta (à prova de tabela ausente)
-- ==============================================================================
-- Projeto: uodkwdaruqrnprqkpgqr (PortalConecta2.0)
-- Onde rodar: painel do Supabase → SQL Editor → New query → colar tudo → Run
--
-- ------------------------------------------------------------------------------
-- POR QUE AS VERSÕES ANTERIORES FALHARAM (lição importante de SQL)
-- ------------------------------------------------------------------------------
-- O Postgres resolve nomes de tabela em tempo de PARSE, não de execução.
-- Portanto ISTO NÃO PROTEGE NADA:
--
--     CASE WHEN existe THEN (SELECT count(*) FROM tabela_que_pode_nao_existir) END
--
-- O nome é validado antes de qualquer ramo ser escolhido, e a query inteira
-- falha com 42P01 mesmo que o ramo nunca viesse a rodar.
--
-- A saída é SQL DINÂMICO: montar a query como TEXTO e só então executar, via
-- `query_to_xml(format('SELECT ... FROM %I', nome))`. Assim o nome só é
-- resolvido no momento da execução, quando já sabemos que a tabela existe.
--
-- ------------------------------------------------------------------------------
-- JÁ APURADO (não precisa reconfirmar)
-- ------------------------------------------------------------------------------
-- 30 tabelas existem. FALTAM exatamente as 5 que têm @@map no schema Prisma:
--     vagas · perfis_aluno · documentos_kb · chunks_kb · rate_limit_hits
--
-- portanto:
--   · o RAG NUNCA teve infraestrutura neste banco (sem pgvector, sem chunks_kb)
--   · criar/selecionar vaga e salvar perfil do aluno estao INOPERANTES
-- ------------------------------------------------------------------------------
-- ==============================================================================


-- ==============================================================================
-- CONSULTA 1 — Há ALGUM dado no banco? (a que decide o roteiro da migração)
-- ==============================================================================
-- Percorre todo o catálogo, sem precisar saber nome nenhum.
-- ESPERADO num banco limpo: ZERO LINHAS (filtra apenas tabelas com linhas > 0).
--
--   ZERO LINHAS  -> banco vazio: vamos direto para a VPS, sem dump/restore.
--   ALGUMA LINHA -> fazemos pg_dump antes, para não perder nada.
-- ==============================================================================
SELECT
  c.relname AS tabela,
  (xpath('/row/c/text()',
     query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname),
                  false, true, '')))[1]::text::bigint AS linhas
FROM pg_class c
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public'
  AND c.relkind = 'r'
  AND (xpath('/row/c/text()',
       query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname),
                    false, true, '')))[1]::text::bigint > 0
ORDER BY linhas DESC, tabela;


-- ==============================================================================
-- CONSULTA 2 — Total geral: quantas tabelas existem e quantas têm dados
-- ==============================================================================
WITH contagens AS (
  SELECT
    c.relname AS tabela,
    (xpath('/row/c/text()',
       query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname),
                    false, true, '')))[1]::text::bigint AS linhas
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r'
)
SELECT
  count(*)                                    AS total_tabelas,
  count(*) FILTER (WHERE linhas > 0)          AS tabelas_com_dados,
  COALESCE(sum(linhas), 0)                    AS total_de_linhas,
  CASE WHEN COALESCE(sum(linhas), 0) = 0
       THEN 'BANCO VAZIO — migracao dispensa dump/restore'
       ELSE 'HA DADOS — fazer pg_dump antes de migrar' END AS veredito
FROM contagens;


-- ==============================================================================
-- CONSULTA 3 — As tabelas que o RAG precisaria (confirmação documental)
-- Só lê o catálogo: não pode falhar.
-- ==============================================================================
SELECT
  nome AS tabela,
  CASE WHEN to_regclass('public.' || quote_ident(nome)) IS NULL
       THEN 'FALTA' ELSE 'existe' END AS situacao,
  CASE nome
    WHEN 'vagas'           THEN 'criar/selecionar vaga (bolsista/voluntario)'
    WHEN 'perfis_aluno'    THEN 'perfil do aluno em /meus-dados'
    WHEN 'documentos_kb'   THEN 'RAG: cadastro de documento'
    WHEN 'chunks_kb'       THEN 'RAG: chunks + embedding vetorial'
    WHEN 'rate_limit_hits' THEN 'rate limiting das rotas sensiveis'
  END AS funcionalidade_dependente
FROM (VALUES ('vagas'), ('perfis_aluno'), ('documentos_kb'),
             ('chunks_kb'), ('rate_limit_hits')) AS v(nome)
ORDER BY situacao DESC, nome;
