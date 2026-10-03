'use server';

import { getPublicMetrics } from '@/lib/metrics';

// `syncUserProfileAction`/`getCurrentUserAction` removidas em 2026-08-26:
// eram Server Actions sem checagem de autorização nenhuma (achados S18/S26
// do RELATORIO_TESTES.md — aceitavam `userId`/`email` como parâmetro comum,
// sem provar posse da conta), e não tinham nenhum caller — o fluxo real de
// login já usa `ensureUser`/`getUserRole` (src/actions/admin.ts) via
// AuthContext. Autoatendimento real (perfil, exclusão de conta) agora vive
// em src/actions/perfil.ts e src/actions/meus-dados.ts, com verificação de
// token via `verifySessionToken` (src/lib/auth-helpers.ts).

/**
 * Estatísticas exibidas na home pública.
 *
 * SPEC §5.1 / ROADMAP 1.17: home e dashboard admin leem a MESMA fonte
 * (`getPublicMetrics` → view materializada `public_metrics`, com fallback de
 * contagem ao vivo usando os mesmos filtros canônicos). Não reimplemente as
 * contagens aqui — se os filtros mudarem, mude em `src/lib/metrics.ts`.
 */
export async function getDashboardStatsAction() {
  try {
    const metrics = await getPublicMetrics();
    return {
      editaisAtivos: metrics.editaisAtivos,
      projetos: metrics.projetos,
      usuarios: metrics.usuarios,
      eventos: metrics.eventos,
    };
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    throw error;
  }
}
