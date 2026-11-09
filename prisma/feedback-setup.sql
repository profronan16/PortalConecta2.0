-- ==============================================================================
-- PORTAL CONECTA 2.0 — FEEDBACK DOS VISITANTES SOBRE O SITE
-- ==============================================================================
--
-- Cria a tabela "Feedback": mensagens enviadas em /feedback e lidas pelo
-- Administrador Geral em /admin/feedbacks.
--
--   tipo    sugestao | problema | elogio | duvida | outro
--   status  novo | lido | resolvido
--
-- `user_id` é opcional (envio aberto a quem não está logado) e vira NULL se a
-- conta for excluída — a mensagem fica, sem vínculo com a pessoa.
--
-- COMO APLICAR (banco local em 127.0.0.1:5433; em produção, no VPS):
--   psql "$DATABASE_URL" -f prisma/feedback-setup.sql
--
-- ⚠️ NÃO use `prisma db push` neste banco (ver DOCUMENTACAO/MIGRACAO_POSTGRES_LOCAL.md).
-- O script é IDEMPOTENTE: pode rodar quantas vezes quiser.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS "Feedback" (
  "id"         TEXT         NOT NULL,
  "tipo"       TEXT         NOT NULL,
  "mensagem"   TEXT         NOT NULL,
  "contato"    TEXT,
  "pagina"     TEXT,
  "user_id"    TEXT,
  "status"     TEXT         NOT NULL DEFAULT 'novo',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Feedback_status_created_at_idx" ON "Feedback" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "Feedback_user_id_idx" ON "Feedback" ("user_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Feedback_user_id_fkey') THEN
    ALTER TABLE "Feedback"
      ADD CONSTRAINT "Feedback_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
