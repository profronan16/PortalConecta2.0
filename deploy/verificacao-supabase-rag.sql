-- ==============================================================================
-- VERIFICAÇÃO DO RAG NO SUPABASE — rode no SQL Editor do painel
-- ==============================================================================
-- Projeto: uodkwdaruqrnprqkpgqr (PortalConecta2.0)
--
-- Por que isto importa: o /api/chat NÃO quebra quando o pgvector está ausente.
-- Ele cai num fallback em memória que devolve `similarity: 0.5` FIXO para todo
-- chunk (src/lib/supabase-vector.ts). O filtro `minSimilarity >= 0.2` nunca
-- elimina nada, então o chat responde normalmente — só que SEM busca semântica
-- nenhuma. A degradação é invisível sem consultar o banco.
--
-- Rode cada bloco e me mande o resultado.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- 1) A extensão pgvector está instalada?
--    ESPERADO: 1 linha, com versão (ex.: "0.8.0")
--    SE VIER VAZIO  -> o RAG está degradado (fallback), precisa rodar
--                      prisma/pgvector-setup.sql
-- ------------------------------------------------------------------------------
SELECT extname, extversion
FROM pg_extension
WHERE extname = 'vector';


-- ------------------------------------------------------------------------------
-- 2) A coluna `embedding` existe de verdade em chunks_kb?
--    ESPERADO: 1 linha com data_type = 'USER-DEFINED' e udt_name = 'vector'
--    SE VIER VAZIO  -> a coluna não existe fisicamente; todo INSERT com
--                      embedding cai no fallback do Prisma (sem vetor)
-- ------------------------------------------------------------------------------
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'chunks_kb' AND column_name = 'embedding';


-- ------------------------------------------------------------------------------
-- 3) A função de busca match_chunks_kb existe?
--    ESPERADO: 1 linha
--    SE VIER VAZIO  -> searchSimilarChunks tenta a RPC, falha, e cai para a
--                      query direta (nível 2); se a coluna também não existir,
--                      cai para o fallback em memória (nível 3)
-- ------------------------------------------------------------------------------
SELECT proname
FROM pg_proc
WHERE proname = 'match_chunks_kb';


-- ------------------------------------------------------------------------------
-- 4) O índice HNSW existe? (só performance — ausência não quebra nada,
--    mas sem ele a busca vetorial faz scan completo)
-- ------------------------------------------------------------------------------
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'chunks_kb';


-- ------------------------------------------------------------------------------
-- 5) O RAG tem conteúdo indexado de verdade?
--    ESPERADO: total_chunks > 0 e com_embedding = total_chunks
--    Se `com_embedding` for 0 com total > 0, os chunks existem mas não têm
--    vetor -> a busca semântica não encontra nada deles.
-- ------------------------------------------------------------------------------
SELECT
  count(*)                                    AS total_chunks,
  count(embedding)                            AS com_embedding,
  count(*) FILTER (WHERE ativo)               AS ativos,
  count(DISTINCT documento_id)                AS documentos
FROM chunks_kb;


-- ------------------------------------------------------------------------------
-- 6) Panorama dos documentos na base de conhecimento
-- ------------------------------------------------------------------------------
SELECT
  d.titulo,
  d.tipo,
  d.status,
  d.total_chunks,
  d.modelo_embedding,
  d.embedding_dimensions,
  d.processado_em,
  count(c.id) FILTER (WHERE c.embedding IS NOT NULL) AS chunks_com_vetor
FROM documentos_kb d
LEFT JOIN chunks_kb c ON c.documento_id = d.id
GROUP BY d.id, d.titulo, d.tipo, d.status, d.total_chunks,
         d.modelo_embedding, d.embedding_dimensions, d.processado_em
ORDER BY d.created_at DESC
LIMIT 20;


-- ------------------------------------------------------------------------------
-- 7) As tabelas principais existem? (confirma que o schema foi aplicado,
--    mesmo com o painel dizendo "No migrations")
--    ESPERADO: 1 linha por tabela existente.
-- ------------------------------------------------------------------------------
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('User','Projeto','Edital','Inscricao','Vaga',
                    'documentos_kb','chunks_kb','SiteConfig','PerfilAluno')
ORDER BY tablename;


-- ------------------------------------------------------------------------------
-- 8) VOLUME DE DADOS — decide se vale migrar ou começar limpo
--    Rode e veja o que tem conteúdo real. Se estiver tudo zerado, a migração
--    para o Postgres da VPS fica trivial (não há nada para levar).
-- ------------------------------------------------------------------------------
SELECT 'User'          AS tabela, count(*) AS linhas FROM "User"
UNION ALL SELECT 'Projeto',      count(*) FROM "Projeto"
UNION ALL SELECT 'Edital',       count(*) FROM "Edital"
UNION ALL SELECT 'Inscricao',    count(*) FROM "Inscricao"
UNION ALL SELECT 'Vaga',         count(*) FROM "Vaga"
UNION ALL SELECT 'Post',         count(*) FROM "Post"
UNION ALL SELECT 'documentos_kb',count(*) FROM documentos_kb
UNION ALL SELECT 'chunks_kb',    count(*) FROM chunks_kb
ORDER BY linhas DESC;
