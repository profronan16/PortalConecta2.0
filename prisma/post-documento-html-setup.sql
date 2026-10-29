-- ==============================================================================
-- PORTAL CONECTA 2.0 — POST A PARTIR DE DOCUMENTO HTML
-- ==============================================================================
--
-- Cria "PostDocumentoHtml": o arquivo .html que o professor envia como post
-- (com o próprio CSS, imagens embutidas, fontes e scripts). A página pública
-- exibe esse documento num iframe isolado (sandbox), do jeito que ele foi
-- desenhado — ver src/lib/post-documento-html.ts.
--
-- Tabela à parte (1:1 com "Post") e não uma coluna nova: um documento com
-- imagens embutidas passa fácil de 500 KB, e as listagens de posts (home,
-- página do projeto, painel) fazem `findMany` sem `select`. Numa coluna, todas
-- elas passariam a carregar o documento inteiro de cada post.
--
-- COMO APLICAR (banco local em 127.0.0.1:5433; em produção, no VPS):
--   psql "$DATABASE_URL" -f prisma/post-documento-html-setup.sql
--
-- ⚠️ NÃO use `prisma db push` neste banco (ver DOCUMENTACAO/MIGRACAO_POSTGRES_LOCAL.md).
-- O script é IDEMPOTENTE: pode rodar quantas vezes quiser.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "PostDocumentoHtml" (
  "postId"      TEXT         NOT NULL,
  "html"        TEXT         NOT NULL,
  "nomeArquivo" TEXT,
  "bytes"       INTEGER      NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostDocumentoHtml_pkey" PRIMARY KEY ("postId"),
  -- Apagar o post apaga o documento junto.
  CONSTRAINT "PostDocumentoHtml_postId_fkey" FOREIGN KEY ("postId")
    REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
