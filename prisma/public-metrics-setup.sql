-- ─────────────────────────────────────────────────────────────────────────────
-- public_metrics — fonte ÚNICA das métricas públicas (SPEC §5.1, ROADMAP 1.17)
--
-- Motivação: a home e o dashboard admin já divergiram no passado porque cada um
-- contava com filtros próprios (rascunhos e registros com soft delete entravam em
-- um lado e não no outro). A partir daqui os dois consomem esta view.
--
-- Aplicar COMO O USUÁRIO DA APLICAÇÃO (recomendado):
--   psql "$DIRECT_URL" -f prisma/public-metrics-setup.sql
--
-- ⚠️ Se você rodar como superusuário (ex.: `sudo -u postgres psql`), a view e a
-- função ficam pertencendo ao superusuário e a aplicação recebe
-- "permission denied for materialized view public_metrics" — caindo no fallback
-- de contagem ao vivo silenciosamente (foi exatamente o que aconteceu no deploy
-- de 2026-10-03). Nesse caso, passe a posse para o usuário da aplicação:
--   ALTER MATERIALIZED VIEW public_metrics OWNER TO <usuario_da_app>;
--   ALTER FUNCTION refresh_public_metrics() OWNER TO <usuario_da_app>;
--
-- Depois de aplicar, `getPublicMetrics()` (src/lib/metrics.ts) passa a ler a view.
-- Se a view não existir (ou não for legível), a aplicação cai automaticamente
-- para contagem ao vivo e loga um aviso — nenhum deploy quebra por isso.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. View materializada com a linha única de métricas.
DROP MATERIALIZED VIEW IF EXISTS public_metrics;

CREATE MATERIALIZED VIEW public_metrics AS
SELECT
  (SELECT count(*) FROM "Edital"
     WHERE status = 'ABERTO'
       AND review_status = 'PUBLICADO'
       AND deleted_at IS NULL)::bigint            AS editais_ativos,
  (SELECT count(*) FROM "Projeto"
     WHERE status IN ('ATIVO', 'EM_EXECUCAO', 'INSCRICOES_ABERTAS')
       AND review_status = 'PUBLICADO'
       AND deleted_at IS NULL)::bigint            AS projetos_em_execucao,
  (SELECT count(*) FROM "User")::bigint           AS usuarios,
  (SELECT count(*) FROM "Evento"
     WHERE data >= now())::bigint                 AS eventos_proximos,
  now()                                           AS refreshed_at;

-- 2. Índice único exigido por REFRESH ... CONCURRENTLY (view de 1 linha).
CREATE UNIQUE INDEX public_metrics_singleton_idx ON public_metrics ((true));

-- 3. Função de refresh usada pela aplicação (TTL de 5 min) e pelo cron.
--    Versão não-concorrente: pode rodar dentro de transação, então o
--    `$executeRaw` do Prisma funciona sem erro (CONCURRENTLY não pode).
CREATE OR REPLACE FUNCTION refresh_public_metrics()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public_metrics;
END;
$$ LANGUAGE plpgsql;

-- 4. Leitura concedida ao role da aplicação.
--    Os nomes `authenticated`/`anon`/`service_role` são do Supabase e NÃO existem
--    num PostgreSQL próprio (VPS/local) — por isso o grant é condicional. Assim o
--    mesmo arquivo serve para os dois ambientes.
DO $$
DECLARE
  papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['authenticated', 'anon', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('GRANT SELECT ON public_metrics TO %I', papel);
      EXECUTE format('GRANT EXECUTE ON FUNCTION refresh_public_metrics() TO %I', papel);
    END IF;
  END LOOP;
END $$;

-- 5. Refresh inicial.
SELECT refresh_public_metrics();
